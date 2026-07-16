"""film_video.py --refs <img,img,...> --prompt <text> --out <mp4>

One continuous AI film via omni reference_to_video (spec 2026-07-16 §7).
Prints {"duration_ms": N}; exit 4 with {"error": ...} on failure. No cache —
every take is intentionally fresh.
"""

import argparse
import json
import sys
from pathlib import Path


def main(argv, generate_fn=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    refs = [r for r in args.refs.split(",") if r]

    if generate_fn is None:
        from darkroom_analysis import omni_media

        client = omni_media.make_client()
        generate_fn = lambda task, prompt, image_paths, out_path: omni_media.generate_video(  # noqa: E731
            client, task=task, prompt=prompt, image_paths=image_paths, out_path=out_path
        )

    try:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        duration = generate_fn("reference_to_video", args.prompt, refs, args.out)
    except Exception as ex:
        print(json.dumps({"error": str(ex)[:200]}))
        return 4
    if not duration:
        print(json.dumps({"error": "no_film"}))
        return 4

    print(json.dumps({"duration_ms": duration}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
