"""Content-hash-keyed JSON cache: cache/<namespace>/<key>.json."""

import hashlib
import json
from pathlib import Path


def file_key(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _path(cache_dir, key: str, namespace: str) -> Path:
    return Path(cache_dir) / namespace / f"{key}.json"


def get(cache_dir, key: str, namespace: str):
    p = _path(cache_dir, key, namespace)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def put(cache_dir, key: str, namespace: str, data) -> None:
    p = _path(cache_dir, key, namespace)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
