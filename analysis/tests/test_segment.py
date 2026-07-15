import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from darkroom_analysis import segment  # noqa: E402


def _photo(tmp_path, size=(200, 200)):
    rng = np.random.default_rng(1)
    arr = rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)
    p = tmp_path / "photo.jpg"
    Image.fromarray(arr).save(p)
    return str(p)


def _mask_png(w, h, fill=255):
    buf = io.BytesIO()
    Image.new("L", (w, h), fill).save(buf, format="PNG")
    return buf.getvalue()


def test_compose_produces_cropped_rgba_cutout(tmp_path):
    photo = _photo(tmp_path)
    # box covers the middle 50% x 50% of the frame -> 25% area, inside the gate
    png = segment.compose_cutout(photo, [250, 250, 750, 750], _mask_png(100, 100))
    assert png is not None
    img = Image.open(io.BytesIO(png))
    assert img.mode == "RGBA"
    assert img.size[0] < 200 and img.size[1] < 200  # cropped to the subject
    alpha = np.asarray(img)[:, :, 3]
    assert alpha.max() == 255 and alpha.min() == 0  # real transparency


def test_gate_rejects_tiny_mask(tmp_path):
    photo = _photo(tmp_path)
    # 20x20 px box on 200x200 -> 1% area
    assert segment.compose_cutout(photo, [0, 0, 100, 100], _mask_png(20, 20)) is None


def test_gate_rejects_huge_mask(tmp_path):
    photo = _photo(tmp_path)
    # full-frame box -> 100% area
    assert segment.compose_cutout(photo, [0, 0, 1000, 1000], _mask_png(50, 50)) is None


def test_first_mask_parses_and_strips_data_uri():
    mask_b64 = base64.b64encode(_mask_png(4, 4)).decode()
    text = json.dumps(
        [{"box_2d": [1, 2, 3, 4], "mask": f"data:image/png;base64,{mask_b64}", "label": "dog"}]
    )
    box, mask = segment.first_mask(text)
    assert box == [1, 2, 3, 4]
    assert mask == base64.b64decode(mask_b64)


def test_first_mask_absent_or_malformed():
    assert segment.first_mask("[]") is None
    assert segment.first_mask("not json") is None
    assert segment.first_mask(json.dumps([{"box_2d": [1, 2], "mask": "x"}])) is None
