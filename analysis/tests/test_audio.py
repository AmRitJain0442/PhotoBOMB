import json
import statistics
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from darkroom_analysis.audio import extract  # noqa: E402
from ingest_audio import main  # noqa: E402


def _click_wav(path, bpm=120, beats=24, sr=44100):
    """Same synthesis as renderer/scripts/make-fixtures.mjs."""
    beat_s = 60.0 / bpm
    total = int(np.ceil(beats * beat_s * sr))
    pcm = np.zeros(total, dtype=np.float64)
    click_len = int(0.04 * sr)
    for b in range(beats):
        start = int(b * beat_s * sr)
        freq = 1320 if b % 4 == 0 else 880
        n = np.arange(click_len)
        env = 1.0 - n / click_len
        pcm[start : start + click_len] = 0.6 * env * np.sin(2 * np.pi * freq * n / sr)
    sf.write(str(path), pcm, sr, subtype="PCM_16")
    return str(path)


def test_extract_click_track(tmp_path):
    wav = _click_wav(tmp_path / "click.wav")
    info = extract(wav)
    assert 118 <= info["bpm"] <= 122
    grid = info["beat_grid_ms"]
    assert all(isinstance(v, int) for v in grid)
    assert all(b > a for a, b in zip(grid, grid[1:]))
    spacings = [b - a for a, b in zip(grid, grid[1:])]
    assert abs(statistics.median(spacings) - 500) <= 20
    curve = info["energy_curve"]
    assert 0 < len(curve) <= 64
    assert all(0.0 <= v <= 1.0 for v in curve)
    assert abs(info["duration_ms"] - 12000) <= 100


def test_ingest_writes_json_and_caches(tmp_path):
    wav = _click_wav(tmp_path / "song.wav")
    cache_dir = tmp_path / "cache"
    counter = {"n": 0}

    def counting_extract(path):
        counter["n"] += 1
        return extract(path)

    out1 = tmp_path / "t1.json"
    assert main(["--track", wav, "--cache", str(cache_dir), "--out", str(out1)], extract_fn=counting_extract) == 0
    assert counter["n"] == 1
    data = json.loads(out1.read_text(encoding="utf-8"))
    assert data["id"] == "song"
    assert data["file"] == "song.wav"
    assert data["mood"] == ""
    assert data["feel"] == "steady"
    assert 118 <= data["bpm"] <= 122

    out2 = tmp_path / "t2.json"
    assert main(["--track", wav, "--cache", str(cache_dir), "--out", str(out2)], extract_fn=counting_extract) == 0
    assert counter["n"] == 1  # cache hit, no recompute


def test_describe_injectable(tmp_path):
    wav = _click_wav(tmp_path / "vibe.wav")
    out = tmp_path / "out.json"

    def fake_describe(info):
        return {"mood": "upbeat", "feel": "bright steady pulse"}

    code = main(
        ["--track", wav, "--cache", str(tmp_path / "cache"), "--out", str(out), "--describe"],
        describe_fn=fake_describe,
    )
    assert code == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["mood"] == "upbeat"
    assert data["feel"] == "bright steady pulse"
