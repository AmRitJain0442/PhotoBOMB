"""Gemini segmentation -> transparent cutout PNGs (spec 2026-07-15 §2).

cutout_png() makes ONE Gemini call for a photo's known main subject and
returns RGBA PNG bytes cropped to the subject, or None when there is no
usable mask (quality gate: mask must cover 3%-90% of the frame). The pure
helpers (first_mask, compose_cutout) carry the logic and are unit-tested;
the API wrapper stays thin, like gemini_vision.analyze_batch.
"""

import base64
import io
import json
import mimetypes
from pathlib import Path

import numpy as np
from PIL import Image

MODEL = "gemini-2.5-flash"
MIN_AREA_FRAC = 0.03
MAX_AREA_FRAC = 0.90
MASK_THRESHOLD = 127
PAD_PX = 16

_PROMPT = (
    "Give the segmentation mask for the {subject} (the photo's main subject; "
    "its approximate bounding box is {bbox}, normalized 0-1). Output a JSON "
    "list of segmentation masks where each entry contains the 2D bounding box "
    'in the key "box_2d" (normalized 0-1000, [y0, x0, y1, x1]), the base64 '
    'PNG segmentation mask in the key "mask", and the text label in the key '
    '"label".'
)


def first_mask(response_text):
    """Parse the model's JSON -> (box_2d, mask_png_bytes), or None."""
    try:
        items = json.loads(response_text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(items, list) or not items:
        return None
    item = items[0]
    box = item.get("box_2d")
    mask = item.get("mask")
    if not isinstance(box, list) or len(box) != 4 or not isinstance(mask, str):
        return None
    if "," in mask:  # strip a data:image/png;base64, prefix
        mask = mask.split(",", 1)[1]
    try:
        return box, base64.b64decode(mask)
    except Exception:
        return None


def compose_cutout(photo_path, box_2d, mask_png_bytes):
    """Composite mask over photo -> cropped RGBA PNG bytes, or None when the
    mask fails the area gate or cannot be decoded."""
    photo = Image.open(photo_path).convert("RGB")
    w, h = photo.size
    y0, x0, y1, x1 = (int(v) for v in box_2d)  # 0-1000, y-first (Gemini format)
    left, top = int(x0 / 1000 * w), int(y0 / 1000 * h)
    right, bottom = int(x1 / 1000 * w), int(y1 / 1000 * h)
    if right <= left or bottom <= top:
        return None
    try:
        mask_img = Image.open(io.BytesIO(mask_png_bytes)).convert("L")
    except Exception:
        return None
    mask_img = mask_img.resize((right - left, bottom - top))
    box_alpha = np.asarray(mask_img) > MASK_THRESHOLD

    area_frac = box_alpha.sum() / float(w * h)
    if area_frac < MIN_AREA_FRAC or area_frac > MAX_AREA_FRAC:
        return None

    alpha = np.zeros((h, w), dtype=np.uint8)
    alpha[top:bottom, left:right] = box_alpha.astype(np.uint8) * 255

    rgba = np.dstack([np.asarray(photo), alpha])
    ys, xs = np.nonzero(alpha)
    cy0, cy1 = max(0, ys.min() - PAD_PX), min(h, ys.max() + 1 + PAD_PX)
    cx0, cx1 = max(0, xs.min() - PAD_PX), min(w, xs.max() + 1 + PAD_PX)
    out = Image.fromarray(rgba[cy0:cy1, cx0:cx1], "RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def cutout_png(client, photo_path, subject, subject_bbox):
    """One Gemini call -> cutout PNG bytes, or None (no usable mask)."""
    from google.genai import types

    mime = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=_PROMPT.format(subject=subject or "main subject", bbox=subject_bbox)
                    ),
                    types.Part.from_bytes(
                        data=Path(photo_path).read_bytes(), mime_type=mime
                    ),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=8192,
        ),
    )
    parsed = first_mask(response.text)
    if parsed is None:
        return None
    box_2d, mask_bytes = parsed
    return compose_cutout(photo_path, box_2d, mask_bytes)
