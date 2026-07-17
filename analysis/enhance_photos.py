"""enhance_photos.py --photos <dir> --ids a,b,c --out-dir <dir> --cache <dir>

Grades the requested photos with Nano Banana (spec 2026-07-16 §6) and prints
{"enhanced": {"<id>": "<file>.jpg" | null}}. A photo failing to enhance is
reported as null and NEVER cached, so a later run retries it. Exit code 0
always — enhancement is decoration, not a gate.
"""

import argparse
import json
import sys
from pathlib import Path

from darkroom_analysis import cache

NAMESPACE = "enhance"
RASTER_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _find_photo(photos_dir, photo_id):
    for ext in RASTER_EXTS:
        p = Path(photos_dir) / f"{photo_id}{ext}"
        if p.exists():
            return p
    return None


def main(argv, edit_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cache", required=True)
    args = ap.parse_args(argv)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    enhanced = {}
    for photo_id in [i for i in args.ids.split(",") if i]:
        photo = _find_photo(args.photos, photo_id)
        if photo is None:
            enhanced[photo_id] = None
            continue
        out_file = out_dir / f"{photo_id}.jpg"
        key = cache.file_key(str(photo))
        hit = cache.get(args.cache, key, NAMESPACE)
        if hit is not None and out_file.exists():
            enhanced[photo_id] = hit["file"]
            continue
        if edit_fn is None:
            from darkroom_analysis import enhance

            client = enhance.make_client()
            edit_fn = lambda p: enhance.graded_jpeg(client, p)  # noqa: E731
        try:
            data = edit_fn(str(photo))
        except Exception:
            data = None  # decoration never fails the pipeline
        if data:
            out_file.write_bytes(data)
            enhanced[photo_id] = out_file.name
            cache.put(args.cache, key, NAMESPACE, {"file": out_file.name})
        else:
            enhanced[photo_id] = None

    print(json.dumps({"enhanced": enhanced}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
