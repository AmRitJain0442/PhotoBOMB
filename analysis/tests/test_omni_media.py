import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from animate_clip import main as animate_main  # noqa: E402
from darkroom_analysis import omni_media  # noqa: E402
from film_video import main as film_main  # noqa: E402


def _mp4_bytes(timescale=1000, duration=6200):
    body = (
        b"\x00" + b"\x00\x00\x00" + b"\x00" * 8
        + timescale.to_bytes(4, "big") + duration.to_bytes(4, "big") + b"\x00" * 80
    )
    mvhd = (8 + len(body)).to_bytes(4, "big") + b"mvhd" + body
    moov = (8 + len(mvhd)).to_bytes(4, "big") + b"moov" + mvhd
    ftyp = (16).to_bytes(4, "big") + b"ftyp" + b"isom" + b"\x00\x00\x02\x00"
    return ftyp + moov


def _photo(tmp_path, name="hero.jpg"):
    rng = np.random.default_rng(3)
    arr = rng.integers(0, 255, size=(120, 90, 3), dtype=np.uint8)
    p = tmp_path / name
    Image.fromarray(arr).save(p)
    return p


def test_mp4_duration_parses_mvhd(tmp_path):
    p = tmp_path / "clip.mp4"
    p.write_bytes(_mp4_bytes(timescale=600, duration=3720))  # 6.2s at 600
    assert omni_media.mp4_duration_ms(str(p)) == 6200
    p.write_bytes(b"not an mp4 at all")
    assert omni_media.mp4_duration_ms(str(p)) is None


def test_animate_caches_and_skips_regeneration(tmp_path, capsys):
    photo = _photo(tmp_path)
    out = tmp_path / "clips" / "hero.mp4"
    counter = {"n": 0}

    def gen(task, prompt, image_paths, out_path):
        counter["n"] += 1
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(_mp4_bytes())
        return 6200

    args = ["--source", str(photo), "--prompt", "drift up", "--out", str(out),
            "--cache", str(tmp_path / "cache")]
    assert animate_main(args, generate_fn=gen) == 0
    assert json.loads(capsys.readouterr().out) == {"duration_ms": 6200}
    assert counter["n"] == 1

    assert animate_main(args, generate_fn=gen) == 0
    assert json.loads(capsys.readouterr().out) == {"duration_ms": 6200}
    assert counter["n"] == 1  # cache hit

    # a different prompt is a different clip
    args2 = ["--source", str(photo), "--prompt", "zoom out", "--out", str(out),
             "--cache", str(tmp_path / "cache")]
    assert animate_main(args2, generate_fn=gen) == 0
    assert counter["n"] == 2


def test_animate_failure_exits_4_and_is_not_cached(tmp_path, capsys):
    photo = _photo(tmp_path)
    counter = {"n": 0}

    def boom(task, prompt, image_paths, out_path):
        counter["n"] += 1
        raise RuntimeError("transient")

    args = ["--source", str(photo), "--prompt", "drift", "--out", str(tmp_path / "c.mp4"),
            "--cache", str(tmp_path / "cache")]
    assert animate_main(args, generate_fn=boom) == 4
    assert "error" in json.loads(capsys.readouterr().out)
    assert animate_main(args, generate_fn=boom) == 4  # retried, not cached
    assert counter["n"] == 2


def test_film_prints_duration_or_exits_4(tmp_path, capsys):
    a = _photo(tmp_path, "a.jpg")
    b = _photo(tmp_path, "b.jpg")
    seen = {}

    def gen(task, prompt, image_paths, out_path):
        seen["task"] = task
        seen["refs"] = list(image_paths)
        Path(out_path).write_bytes(_mp4_bytes(duration=11000))
        return 11000

    out = tmp_path / "film.mp4"
    args = ["--refs", f"{a},{b}", "--prompt", "a dusk story", "--out", str(out)]
    assert film_main(args, generate_fn=gen) == 0
    assert json.loads(capsys.readouterr().out) == {"duration_ms": 11000}
    assert seen["task"] == "reference_to_video"
    assert seen["refs"] == [str(a), str(b)]

    def boom(task, prompt, image_paths, out_path):
        return None

    assert film_main(args, generate_fn=boom) == 4
