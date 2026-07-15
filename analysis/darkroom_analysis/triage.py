"""Deterministic photo triage: perceptual-hash dedup + blur detection.

Rules (spec 2026-07-14-m1):
- sharpness = variance of Laplacian on grayscale (higher = sharper)
- sharpness < blur_threshold        -> reject "too blurry"
- sharpness < 2 * blur_threshold    -> survivor flagged "slight_blur"
- phash hamming distance <= phash_threshold -> duplicates; keep the sharper
"""

from dataclasses import dataclass, field

import cv2
import imagehash
from PIL import Image


@dataclass
class TriageResult:
    survivors: list = field(default_factory=list)
    rejects: list = field(default_factory=list)  # [{"file", "reason"}]
    flags: dict = field(default_factory=dict)  # path -> ["slight_blur", ...]


def sharpness(path: str) -> float:
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def triage(paths, phash_threshold: int = 6, blur_threshold: float = 60.0) -> TriageResult:
    result = TriageResult()
    sharp_by_path = {p: sharpness(p) for p in paths}
    hashes = {}
    for p in paths:
        with Image.open(p) as im:
            hashes[p] = imagehash.phash(im)

    rejected = {}
    # dedup: pairwise, keep the sharper of any near-identical pair
    ordered = list(paths)
    for i, a in enumerate(ordered):
        if a in rejected:
            continue
        for b in ordered[i + 1 :]:
            if b in rejected:
                continue
            if hashes[a] - hashes[b] <= phash_threshold:
                keep, drop = (a, b) if sharp_by_path[a] >= sharp_by_path[b] else (b, a)
                rejected[drop] = f"duplicate of {keep}, lower sharpness"
                if drop == a:
                    break

    for p in paths:
        if p in rejected:
            result.rejects.append({"file": p, "reason": rejected[p]})
            continue
        s = sharp_by_path[p]
        if s < blur_threshold:
            result.rejects.append({"file": p, "reason": "too blurry"})
            continue
        if s < 2 * blur_threshold:
            result.flags.setdefault(p, []).append("slight_blur")
        result.survivors.append(p)
    return result
