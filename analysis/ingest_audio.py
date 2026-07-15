"""ingest_audio.py --track <file> --cache <dir> --out <json> [--describe]

Emits the track record (spec 2026-07-14-m1 §3):
{id, file, bpm, beat_grid_ms, energy_curve, duration_ms, mood, feel}

Extraction is cached by content hash (namespace "audio"); --describe adds a
real Gemini mood/feel call, otherwise mood=""/feel="steady".
"""

import argparse
import json
import sys
from pathlib import Path

from darkroom_analysis import audio, cache

NAMESPACE = "audio"


def main(argv, extract_fn=None, describe_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--describe", action="store_true")
    args = ap.parse_args(argv)

    key = cache.file_key(args.track)
    info = cache.get(args.cache, key, NAMESPACE)
    if info is None:
        info = (extract_fn or audio.extract)(args.track)
        cache.put(args.cache, key, NAMESPACE, info)

    record = {
        "id": Path(args.track).stem,
        "file": Path(args.track).name,
        **info,
        "mood": "",
        "feel": "steady",
    }
    if args.describe:
        described = (describe_fn or audio.describe_track)(record)
        record["mood"] = described["mood"]
        record["feel"] = described["feel"]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
