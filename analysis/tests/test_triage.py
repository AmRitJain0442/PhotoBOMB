import numpy as np
from PIL import Image, ImageFilter

from darkroom_analysis.triage import sharpness, triage


def _noise_image(path, seed=1, size=(320, 320)):
    rng = np.random.default_rng(seed)
    arr = rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)
    Image.fromarray(arr).save(path)
    return str(path)


def _blurred_copy(src, dst, radius):
    Image.open(src).filter(ImageFilter.GaussianBlur(radius)).save(dst)
    return str(dst)


def test_sharpness_orders_blur(tmp_path):
    sharp = _noise_image(tmp_path / "sharp.png")
    soft = _blurred_copy(sharp, tmp_path / "soft.png", radius=4)
    assert sharpness(sharp) > sharpness(soft)


def test_duplicate_removed_keeping_sharper(tmp_path):
    sharp = _noise_image(tmp_path / "a.png")
    dupe = _blurred_copy(sharp, tmp_path / "a_copy.png", radius=1)
    result = triage([sharp, dupe])
    assert sharp in result.survivors
    assert dupe not in result.survivors
    assert any("duplicate" in r["reason"] for r in result.rejects)


def test_very_blurry_rejected(tmp_path):
    sharp = _noise_image(tmp_path / "s.png", seed=2)
    blurry = _noise_image(tmp_path / "b_src.png", seed=3)
    blurry = _blurred_copy(blurry, tmp_path / "b.png", radius=12)
    result = triage([sharp, blurry])
    assert sharp in result.survivors
    assert blurry not in result.survivors
    assert any("blurry" in r["reason"] for r in result.rejects)


def test_mild_blur_flagged_but_survives(tmp_path):
    sharp = _noise_image(tmp_path / "s.png", seed=4)
    # a distinct image, mildly blurred: sharpness between threshold and 2x threshold
    mild_src = _noise_image(tmp_path / "m_src.png", seed=5)
    mild = _blurred_copy(mild_src, tmp_path / "m.png", radius=2)
    result = triage([sharp, mild], blur_threshold=sharpness(mild) * 0.7)
    assert mild in result.survivors
    assert "slight_blur" in result.flags.get(mild, [])
