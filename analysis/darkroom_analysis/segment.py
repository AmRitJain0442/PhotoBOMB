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
import re

import numpy as np
from PIL import Image, ImageFilter

MODEL = "gemini-2.5-flash"  # Gemini 3 dropped segmentation — this stays 2.5
PROJECT = "project-a2dcdad0-5d65-4d61-846"


def make_client():
    """Segmentation-specific client: 2.5-flash only exists at us-central1."""
    from google import genai

    return genai.Client(vertexai=True, project=PROJECT, location="us-central1")
MIN_AREA_FRAC = 0.03
MAX_AREA_FRAC = 0.90
MASK_THRESHOLD = 127
PAD_PX = 16
SEND_MAX_PX = 512  # downscale before sending: keeps the returned mask small

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
    if not isinstance(response_text, str):
        return None
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", response_text.strip())
    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(items, list) or not items:
        return None
    item = items[0]
    box = item.get("box_2d")
    mask = item.get("mask")
    if not isinstance(box, list) or len(box) != 4 or not isinstance(mask, str):
        return None
    mask = mask.strip()
    if "," in mask:  # strip a data:image/png;base64, prefix
        mask = mask.split(",", 1)[1]
    mask += "=" * (-len(mask) % 4)  # the model often omits base64 padding
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


def bbox_area_frac(subject_bbox):
    """Area of a normalized [x_min, y_min, x_max, y_max] bbox, 0 on garbage."""
    try:
        x0, y0, x1, y1 = (float(v) for v in subject_bbox)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def _send_bytes(photo_path):
    """Downscaled, lightly smoothed JPEG for the API call — big or noisy
    inputs make the model emit masks too large for the output token budget.
    The mask is composited against the ORIGINAL photo, so this loses nothing."""
    photo = Image.open(photo_path).convert("RGB")
    if max(photo.size) > SEND_MAX_PX:
        photo.thumbnail((SEND_MAX_PX, SEND_MAX_PX))
    photo = photo.filter(ImageFilter.GaussianBlur(1.5))
    buf = io.BytesIO()
    photo.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def cutout_png(client, photo_path, subject, subject_bbox):
    """One Gemini call -> cutout PNG bytes, or None (no usable mask).

    Skips the call entirely when the known subject box already covers almost
    the whole frame — that mask could only fail the 90% gate.
    """
    from google.genai import types

    if bbox_area_frac(subject_bbox) >= MAX_AREA_FRAC:
        return None

    send = _send_bytes(photo_path)
    # NO response_mime_type here: forced-JSON mode makes the model emit huge
    # raw masks that truncate at MAX_TOKENS; plain text yields compact
    # fenced-JSON palette masks. Retry twice — mask size is nondeterministic.
    for _ in range(2):
        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(
                            text=_PROMPT.format(
                                subject=subject or "main subject", bbox=subject_bbox
                            )
                        ),
                        types.Part.from_bytes(data=send, mime_type="image/jpeg"),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                # skip thinking (Google's guidance for 2.5 segmentation)
                max_output_tokens=65535,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        parsed = first_mask(response.text)
        if parsed is not None:
            box_2d, mask_bytes = parsed
            return compose_cutout(photo_path, box_2d, mask_bytes)
    return None
