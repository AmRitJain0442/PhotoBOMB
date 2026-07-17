"""Batch photo analysis via Gemini on Vertex AI (google-genai SDK).

One generate_content call per batch: instruction text + one image part per
photo, structured JSON output enforced with response_schema.
"""

import json
import mimetypes
from pathlib import Path

PROJECT = "project-a2dcdad0-5d65-4d61-846"
LOCATION = "global"  # Gemini 3 lives at the global Vertex endpoint
MODEL = "gemini-3-flash-preview"

_INSTRUCTION = """You are a photo analyst for short-form video editing.
You will receive {n} photos. Return a JSON array with EXACTLY {n} objects,
one per photo, IN THE SAME ORDER as the input images.

For each photo provide:
- aesthetic_score: integer 1-10 (composition, light, emotional pull)
- description: one sentence, what the photo shows
- subject: the main subject in 1-4 words
- subject_bbox: [x_min, y_min, x_max, y_max] of the main subject, normalized 0-1
- dominant_colors: 2-4 hex colors
- mood_tags: 2-4 lowercase mood words
- energy: one of "low", "medium", "high"
- orientation: one of "portrait", "landscape", "square"
- quality_flags: array of issues, from: "overexposed", "underexposed",
  "noisy", "tilted_horizon", "cluttered" (empty if none)
"""

_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "aesthetic_score": {"type": "INTEGER"},
            "description": {"type": "STRING"},
            "subject": {"type": "STRING"},
            "subject_bbox": {
                "type": "ARRAY",
                "items": {"type": "NUMBER"},
                "minItems": 4,
                "maxItems": 4,
            },
            "dominant_colors": {"type": "ARRAY", "items": {"type": "STRING"}},
            "mood_tags": {"type": "ARRAY", "items": {"type": "STRING"}},
            "energy": {"type": "STRING"},
            "orientation": {"type": "STRING"},
            "quality_flags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": [
            "aesthetic_score", "description", "subject", "subject_bbox",
            "dominant_colors", "mood_tags", "energy", "orientation",
            "quality_flags",
        ],
    },
}


def make_client():
    from google import genai

    return genai.Client(vertexai=True, project=PROJECT, location=LOCATION)


def analyze_batch(client, paths) -> list:
    from google.genai import types

    parts = [types.Part.from_text(text=_INSTRUCTION.format(n=len(paths)))]
    for p in paths:
        mime = mimetypes.guess_type(p)[0] or "image/jpeg"
        parts.append(types.Part.from_bytes(data=Path(p).read_bytes(), mime_type=mime))

    response = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
            max_output_tokens=16384,
        ),
    )
    results = json.loads(response.text)
    if not isinstance(results, list) or len(results) != len(paths):
        raise ValueError(
            f"expected {len(paths)} analyses, got "
            f"{len(results) if isinstance(results, list) else type(results).__name__}"
        )
    return results
