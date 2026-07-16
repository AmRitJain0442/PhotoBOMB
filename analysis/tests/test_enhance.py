import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from enhance_photos import main  # noqa: E402


def _photo(photos, name, seed):
    rng = np.random.default_rng(seed)
    arr = rng.integers(0, 255, size=(120, 90, 3), dtype=np.uint8)
    Image.fromarray(arr).save(photos / name)


def _jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 150, 90)).save(buf, format="JPEG")
    return buf.getvalue()


def _setup(tmp_path, names=("img0.jpg", "img1.jpg")):
    photos = tmp_path / "photos"
    photos.mkdir()
    for i, n in enumerate(names):
        _photo(photos, n, seed=i + 1)
    return photos


def _run(tmp_path, photos, ids, edit_fn, out="out"):
    return main(
        ["--photos", str(photos), "--ids", ",".join(ids),
         "--out-dir", str(tmp_path / out), "--cache", str(tmp_path / "cache")],
        edit_fn=edit_fn,
    )


def test_enhances_requested_ids_and_caches(tmp_path, capsys):
    photos = _setup(tmp_path)
    counter = {"n": 0}

    def edit(path):
        counter["n"] += 1
        return _jpeg_bytes()

    assert _run(tmp_path, photos, ["img0", "img1"], edit) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["enhanced"] == {"img0": "img0.jpg", "img1": "img1.jpg"}
    assert (tmp_path / "out" / "img0.jpg").exists()
    assert counter["n"] == 2

    assert _run(tmp_path, photos, ["img0", "img1"], edit) == 0
    assert counter["n"] == 2  # cache hits skip the API

    # deleting an output invalidates only that photo's hit
    (tmp_path / "out" / "img0.jpg").unlink()
    assert _run(tmp_path, photos, ["img0", "img1"], edit) == 0
    assert counter["n"] == 3


def test_failure_reports_null_and_is_not_cached(tmp_path, capsys):
    photos = _setup(tmp_path)
    counter = {"n": 0}

    def boom(path):
        counter["n"] += 1
        raise RuntimeError("transient")

    assert _run(tmp_path, photos, ["img0"], boom) == 0
    assert json.loads(capsys.readouterr().out)["enhanced"] == {"img0": None}
    assert _run(tmp_path, photos, ["img0"], boom) == 0
    assert counter["n"] == 2  # failure was not cached


def test_missing_photo_reports_null(tmp_path, capsys):
    photos = _setup(tmp_path)

    def edit(path):
        raise AssertionError("should not be called for a missing photo")

    assert _run(tmp_path, photos, ["ghost"], edit) == 0
    assert json.loads(capsys.readouterr().out)["enhanced"] == {"ghost": None}
