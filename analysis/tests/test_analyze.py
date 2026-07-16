import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze_media import main  # noqa: E402


def _noise_image(path, seed, size=(320, 320)):
    rng = np.random.default_rng(seed)
    arr = rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)
    Image.fromarray(arr).save(path)
    return str(path)


def _canned(paths):
    return [
        {
            "aesthetic_score": 8,
            "description": f"photo {Path(p).stem}",
            "subject": "texture",
            "subject_bbox": [0.4, 0.4, 0.6, 0.6],
            "dominant_colors": ["#888888"],
            "mood_tags": ["warm"],
            "energy": "medium",
            "orientation": "portrait",
            "quality_flags": [],
        }
        for p in paths
    ]


def _tiny_png():
    import io

    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _no_segment(path, subject, bbox):
    return None


def _setup_photos(tmp_path, n=4):
    photos = tmp_path / "photos"
    photos.mkdir()
    for i in range(n):
        _noise_image(photos / f"img{i}.jpg", seed=10 + i)
    return photos


def test_pool_merges_triage_exif_analysis(tmp_path):
    photos = _setup_photos(tmp_path)
    (photos / "vector.svg").write_text("<svg></svg>")
    out = tmp_path / "media_pool.json"
    calls = []

    def fake(paths):
        calls.append(list(paths))
        return _canned(paths)

    code = main(
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"), "--out", str(out),
         "--cutouts", str(tmp_path / "cutouts")],
        analyze_fn=fake,
        segment_fn=_no_segment,
    )
    assert code == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    ids = [e["id"] for e in data["pool"]]
    assert "vector" not in ids
    assert len(data["pool"]) == 4
    entry = data["pool"][0]
    assert entry["type"] == "still"
    assert entry["file"].endswith(".jpg")
    assert "ts" in entry["exif"] and "gps" in entry["exif"]
    assert entry["analysis"]["aesthetic_score"] == 8
    assert isinstance(entry["analysis"]["quality_flags"], list)
    assert calls, "analyze_fn should have been called"


def test_cache_skips_analyze_fn(tmp_path):
    photos = _setup_photos(tmp_path)
    cache_dir = tmp_path / "cache"
    counter = {"n": 0}

    def fake(paths):
        counter["n"] += len(paths)
        return _canned(paths)

    args = ["--photos", str(photos), "--cache", str(cache_dir), "--out", str(tmp_path / "o1.json"),
            "--cutouts", str(tmp_path / "cutouts")]
    assert main(args, analyze_fn=fake, segment_fn=_no_segment) == 0
    first = counter["n"]
    assert first == 4
    args2 = ["--photos", str(photos), "--cache", str(cache_dir), "--out", str(tmp_path / "o2.json"),
             "--cutouts", str(tmp_path / "cutouts")]
    assert main(args2, analyze_fn=fake, segment_fn=_no_segment) == 0
    assert counter["n"] == first  # all cached, no new calls


def test_not_enough_photos_exits_3(tmp_path, capsys):
    photos = _setup_photos(tmp_path, n=2)
    out = tmp_path / "out.json"

    def fake(paths):
        raise AssertionError("should not be called")

    code = main(
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"), "--out", str(out),
         "--cutouts", str(tmp_path / "cutouts")],
        analyze_fn=fake,
        segment_fn=_no_segment,
    )
    assert code == 3
    payload = json.loads(capsys.readouterr().out)
    assert payload == {"error": "not_enough_photos"}


def test_batching(tmp_path):
    photos = _setup_photos(tmp_path, n=5)
    batches = []

    def fake(paths):
        batches.append(len(paths))
        return _canned(paths)

    code = main(
        [
            "--photos", str(photos), "--cache", str(tmp_path / "cache"),
            "--out", str(tmp_path / "out.json"), "--batch", "2",
            "--cutouts", str(tmp_path / "cutouts"),
        ],
        analyze_fn=fake,
        segment_fn=_no_segment,
    )
    assert code == 0
    assert batches == [2, 2, 1]


def test_pool_carries_has_cutout_and_writes_pngs(tmp_path):
    photos = _setup_photos(tmp_path)
    cutouts = tmp_path / "cutouts"
    seen = []

    def seg(path, subject, bbox):
        seen.append(Path(path).stem)
        return _tiny_png() if Path(path).stem in {"img0", "img2"} else None

    code = main(
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"),
         "--out", str(tmp_path / "pool.json"), "--cutouts", str(cutouts)],
        analyze_fn=lambda paths: _canned(paths), segment_fn=seg,
    )
    assert code == 0
    pool = json.loads((tmp_path / "pool.json").read_text(encoding="utf-8"))["pool"]
    flags = {e["id"]: e["has_cutout"] for e in pool}
    assert flags == {"img0": True, "img1": False, "img2": True, "img3": False}
    assert (cutouts / "img0.png").exists()
    assert not (cutouts / "img1.png").exists()
    assert sorted(seen) == ["img0", "img1", "img2", "img3"]


def test_cutout_cache_hit_skips_segment_fn(tmp_path):
    photos = _setup_photos(tmp_path)
    cutouts = tmp_path / "cutouts"
    counter = {"n": 0}

    def seg(path, subject, bbox):
        counter["n"] += 1
        return _tiny_png() if Path(path).stem == "img0" else None

    def run(out):
        return main(
            ["--photos", str(photos), "--cache", str(tmp_path / "cache"),
             "--out", str(tmp_path / out), "--cutouts", str(cutouts)],
            analyze_fn=lambda paths: _canned(paths), segment_fn=seg,
        )

    assert run("o1.json") == 0
    assert counter["n"] == 4
    assert run("o2.json") == 0
    assert counter["n"] == 4  # cache hits (true-with-png and false) skip the API
    # deleting a cutout PNG invalidates only that photo's hit
    (cutouts / "img0.png").unlink()
    assert run("o3.json") == 0
    assert counter["n"] == 5
    assert (cutouts / "img0.png").exists()


def test_segment_failure_is_not_cached(tmp_path):
    photos = _setup_photos(tmp_path)
    counter = {"n": 0}

    def boom(path, subject, bbox):
        counter["n"] += 1
        raise RuntimeError("transient network failure")

    def run(out, seg):
        return main(
            ["--photos", str(photos), "--cache", str(tmp_path / "cache"),
             "--out", str(tmp_path / out), "--cutouts", str(tmp_path / "cutouts")],
            analyze_fn=lambda paths: _canned(paths), segment_fn=seg,
        )

    assert run("o1.json", boom) == 0  # failures never fail the pipeline
    pool = json.loads((tmp_path / "o1.json").read_text(encoding="utf-8"))["pool"]
    assert all(e["has_cutout"] is False for e in pool)
    assert counter["n"] == 4
    # a later run retries — the failure was not cached as "no cutout"
    assert run("o2.json", boom) == 0
    assert counter["n"] == 8
