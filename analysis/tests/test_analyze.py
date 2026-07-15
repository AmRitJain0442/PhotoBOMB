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
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"), "--out", str(out)],
        analyze_fn=fake,
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

    args = ["--photos", str(photos), "--cache", str(cache_dir), "--out", str(tmp_path / "o1.json")]
    assert main(args, analyze_fn=fake) == 0
    first = counter["n"]
    assert first == 4
    args2 = ["--photos", str(photos), "--cache", str(cache_dir), "--out", str(tmp_path / "o2.json")]
    assert main(args2, analyze_fn=fake) == 0
    assert counter["n"] == first  # all cached, no new calls


def test_not_enough_photos_exits_3(tmp_path, capsys):
    photos = _setup_photos(tmp_path, n=2)
    out = tmp_path / "out.json"

    def fake(paths):
        raise AssertionError("should not be called")

    code = main(
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"), "--out", str(out)],
        analyze_fn=fake,
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
        ],
        analyze_fn=fake,
    )
    assert code == 0
    assert batches == [2, 2, 1]
