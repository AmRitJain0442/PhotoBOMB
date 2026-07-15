"""Beat/energy extraction (librosa) + optional Gemini mood description."""

import json


def extract(path: str) -> dict:
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.asarray(tempo).reshape(-1)[0])

    beat_ms = [int(round(t * 1000)) for t in librosa.frames_to_time(beat_frames, sr=sr)]
    grid = []
    for v in beat_ms:
        if not grid or v > grid[-1]:
            grid.append(v)

    # the frame-quantized tempo estimate drifts (e.g. 117.45 for a 120 BPM
    # click); the mean inter-beat interval across the whole grid averages the
    # ~23 ms frame quantization out
    if len(grid) >= 3:
        mean_ms = (grid[-1] - grid[0]) / (len(grid) - 1)
        if mean_ms > 0:
            bpm = round(60000.0 / mean_ms, 2)

    rms = librosa.feature.rms(y=y)[0]
    if len(rms) > 64:
        chunks = np.array_split(rms, 64)
        rms = np.array([c.mean() for c in chunks])
    peak = rms.max()
    curve = (rms / peak if peak > 0 else rms).clip(0.0, 1.0)

    return {
        "bpm": bpm,
        "beat_grid_ms": grid,
        "energy_curve": [round(float(v), 4) for v in curve],
        "duration_ms": int(round(len(y) / sr * 1000)),
    }


_DESCRIBE_SCHEMA = {
    "type": "OBJECT",
    "properties": {"mood": {"type": "STRING"}, "feel": {"type": "STRING"}},
    "required": ["mood", "feel"],
}


def describe_track(info: dict) -> dict:
    """One Gemini text call: mood word + short plain-words feel."""
    from google.genai import types

    from darkroom_analysis.gemini_vision import MODEL, make_client

    curve = info.get("energy_curve", [])
    third = max(1, len(curve) // 3)
    shape = [round(sum(curve[i : i + third]) / max(1, len(curve[i : i + third])), 2)
             for i in range(0, len(curve), third)][:3]
    prompt = (
        "Describe a music track for a video editor picking songs.\n"
        f"Filename: {info.get('file', 'unknown')}\n"
        f"BPM: {round(info.get('bpm', 0))}\n"
        f"Energy shape (start/middle/end, 0-1): {shape}\n"
        'Return JSON {"mood": one lowercase word, "feel": 2-4 plain lowercase words}.'
    )
    client = make_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_DESCRIBE_SCHEMA,
            max_output_tokens=8192,
        ),
    )
    data = json.loads(response.text)
    return {"mood": str(data["mood"]), "feel": str(data["feel"])}
