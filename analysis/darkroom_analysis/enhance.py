"""Nano Banana photo grading (spec 2026-07-16 §6).

graded_jpeg() makes one gemini-3.1-flash-image call that regrades a photo
with a warm cinematic look while keeping composition unchanged, returning
JPEG/PNG bytes or None when the model returns no image.
"""

import mimetypes
from pathlib import Path

MODEL = "gemini-3.1-flash-image"
PROJECT = "project-a2dcdad0-5d65-4d61-846"

PROMPT = (
    "Regrade this photo with a warm cinematic film look: richer golden tones, "
    "gentle lifted blacks, subtle grain. Keep composition, subjects, and framing "
    "exactly unchanged."
)


def make_client():
    from google import genai

    return genai.Client(vertexai=True, project=PROJECT, location="global")


def graded_jpeg(client, photo_path):
    """One image-edit call -> image bytes, or None (no image in response)."""
    from google.genai import types

    mime = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
    resp = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=PROMPT),
                    types.Part.from_bytes(data=Path(photo_path).read_bytes(), mime_type=mime),
                ],
            )
        ],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    for candidate in resp.candidates or []:
        for part in candidate.content.parts or []:
            data = getattr(part, "inline_data", None)
            if data is not None and data.data:
                return data.data
    return None
