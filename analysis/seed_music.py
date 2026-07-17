"""seed_music.py --library <dir> [--cache <dir>]

Builds Darkroom's house music library: exactly 5 tracks generated with
lyria-002 on Vertex (spec 2026-07-16 §8), each run through the same beat
analysis + mood description as an upload. Re-running replaces the previous
lyria_* seeds (the cap never grows); user uploads are left alone.
"""

import argparse
import base64
import json
import sys
import tempfile
from pathlib import Path

PROJECT = "project-a2dcdad0-5d65-4d61-846"
LYRIA_URL = (
    "https://us-central1-aiplatform.googleapis.com/v1/projects/"
    f"{PROJECT}/locations/us-central1/publishers/google/models/lyria-002:predict"
)

# five moods that cover the montage comfort zone (roughly 85-100 BPM)
PROMPTS = [
    ("golden_hour", "Warm acoustic guitar and soft keys, golden hour glow, gentle 90 BPM, hopeful and unhurried, instrumental"),
    ("feel_good", "Sunny feel-good indie pop, bright plucks and claps, 100 BPM, playful energy, instrumental"),
    ("late_night", "Moody late-night R&B groove, deep bass and airy pads, 85 BPM, smooth and intimate, instrumental"),
    ("cinematic", "Sweeping cinematic strings with soft piano, slow build, 90 BPM, awe and wonder, instrumental"),
    ("lofi", "Minimal lofi beat, dusty vinyl texture, mellow keys, 88 BPM, calm focus, instrumental"),
]


def _default_predict(prompt):
    """One lyria-002 predict call -> WAV bytes."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    resp = AuthorizedSession(creds).post(
        LYRIA_URL,
        json={"instances": [{"prompt": prompt}], "parameters": {"sample_count": 1}},
        timeout=300,
    )
    resp.raise_for_status()
    prediction = resp.json()["predictions"][0]
    b64 = prediction.get("bytesBase64Encoded") or prediction.get("audioContent")
    return base64.b64decode(b64)


def _make_default_ingest(cache_dir):
    """Reuse the upload pipeline: librosa beats + Gemini mood line."""
    import ingest_audio

    def ingest(track_path):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "track.json"
            code = ingest_audio.main(
                ["--track", str(track_path), "--cache", cache_dir, "--out", str(out), "--describe"]
            )
            if code != 0:
                raise RuntimeError(f"ingest failed with exit {code}")
            return json.loads(out.read_text(encoding="utf-8"))

    return ingest


def main(argv, predict_fn=None, ingest_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True)
    ap.add_argument("--cache", default="out/cache")
    args = ap.parse_args(argv)

    library = Path(args.library)
    library.mkdir(parents=True, exist_ok=True)
    index_path = library / "index.json"

    predict = predict_fn or _default_predict
    ingest = ingest_fn or _make_default_ingest(args.cache)

    try:
        existing = json.loads(index_path.read_text(encoding="utf-8"))
        if not isinstance(existing, list):
            existing = []
    except (OSError, json.JSONDecodeError):
        existing = []
    kept = [t for t in existing if not str(t.get("id", "")).startswith("lyria_")]

    seeded = []
    for slug, prompt in PROMPTS:
        name = f"lyria_{slug}.wav"
        try:
            wav = predict(prompt)
            (library / name).write_bytes(wav)
            record = ingest(library / name)
            seeded.append(record)
            print(f"seeded {name} ({record.get('bpm', '?')} bpm)", file=sys.stderr)
        except Exception as ex:  # one bad track never sinks the library
            print(f"skipped {name}: {str(ex)[:200]}", file=sys.stderr)

    index_path.write_text(json.dumps(kept + seeded, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
