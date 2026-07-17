"""animate_clip.py --source <img> --prompt <text> --out <mp4> --cache <dir>

One hero clip via omni image_to_video (spec 2026-07-16 §7). Prints
{"duration_ms": N} on success. Exit 4 with {"error": ...} when no clip could
be generated — the failure is NEVER cached, so a later run retries.
Cache key = source content hash + prompt, namespace "clip".
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from darkroom_analysis import cache

NAMESPACE = "clip"


def main(argv, generate_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", required=True)
    args = ap.parse_args(argv)

    out = Path(args.out)
    key = cache.file_key(args.source) + "-" + hashlib.sha1(args.prompt.encode("utf-8")).hexdigest()[:12]
    hit = cache.get(args.cache, key, NAMESPACE)
    if hit is not None and out.exists():
        print(json.dumps({"duration_ms": hit["duration_ms"]}))
        return 0

    if generate_fn is None:
        from darkroom_analysis import omni_media

        client = omni_media.make_client()
        generate_fn = lambda task, prompt, image_paths, out_path: omni_media.generate_video(  # noqa: E731
            client, task=task, prompt=prompt, image_paths=image_paths, out_path=out_path
        )

    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        duration = generate_fn("image_to_video", args.prompt, [args.source], str(out))
    except Exception as ex:
        print(json.dumps({"error": str(ex)[:200]}))
        return 4
    if not duration:
        print(json.dumps({"error": "no_clip"}))
        return 4

    cache.put(args.cache, key, NAMESPACE, {"duration_ms": duration})
    print(json.dumps({"duration_ms": duration}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
