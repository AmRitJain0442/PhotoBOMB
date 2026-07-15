"""analyze_media.py --photos <dir> --cache <dir> --out <file> [--batch 10]

Builds the media_pool JSON (spec 2026-07-14-m1 §3, stills only):
{"pool": [entry...], "rejects": [{"file", "reason"}]}

Exit codes: 0 ok, 3 not_enough_photos (<3 triage survivors).
"""

import argparse
import json
import sys
from pathlib import Path

from darkroom_analysis import cache, exif_meta, triage

RASTER_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
NAMESPACE = "vision"


def _list_photos(photos_dir: str) -> list:
    return sorted(
        str(p) for p in Path(photos_dir).iterdir()
        if p.is_file() and p.suffix.lower() in RASTER_EXTS
    )


def main(argv, analyze_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=10)
    args = ap.parse_args(argv)

    paths = _list_photos(args.photos)
    result = triage.triage(paths)
    if len(result.survivors) < 3:
        print(json.dumps({"error": "not_enough_photos"}))
        return 3

    keys = {p: cache.file_key(p) for p in result.survivors}
    analyses = {}
    uncached = []
    for p in result.survivors:
        hit = cache.get(args.cache, keys[p], NAMESPACE)
        if hit is not None:
            analyses[p] = hit
        else:
            uncached.append(p)

    if uncached:
        if analyze_fn is None:
            from darkroom_analysis import gemini_vision

            client = gemini_vision.make_client()
            analyze_fn = lambda batch: gemini_vision.analyze_batch(client, batch)  # noqa: E731
        for i in range(0, len(uncached), args.batch):
            batch = uncached[i : i + args.batch]
            for p, analysis in zip(batch, analyze_fn(batch)):
                analyses[p] = analysis
                cache.put(args.cache, keys[p], NAMESPACE, analysis)

    pool = []
    for p in result.survivors:
        analysis = dict(analyses[p])
        flags = list(analysis.get("quality_flags", []))
        for f in result.flags.get(p, []):
            if f not in flags:
                flags.append(f)
        analysis["quality_flags"] = flags
        pool.append(
            {
                "id": Path(p).stem,
                "file": Path(p).name,
                "type": "still",
                "exif": exif_meta.read(p),
                "analysis": analysis,
            }
        )

    rejects = [{"file": Path(r["file"]).name, "reason": r["reason"]} for r in result.rejects]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"pool": pool, "rejects": rejects}, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
