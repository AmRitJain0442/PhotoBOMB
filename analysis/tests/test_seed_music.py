import io
import json
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seed_music import PROMPTS, main  # noqa: E402


def _wav_bytes():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00\x00" * 2 * 4800)
    return buf.getvalue()


def _fake_ingest(path):
    stem = Path(path).stem
    return {
        "id": stem,
        "file": Path(path).name,
        "bpm": 96,
        "beat_grid_ms": [0, 625],
        "energy_curve": [0.4],
        "duration_ms": 30000,
        "mood": "warm",
        "feel": "steady glow",
    }


def test_seeds_exactly_five_and_preserves_uploads(tmp_path, capsys):
    library = tmp_path / "audio-library"
    library.mkdir()
    (library / "index.json").write_text(
        json.dumps([{"id": "mysong", "file": "mysong.wav", "bpm": 120}]), encoding="utf-8"
    )
    calls = {"n": 0}

    def predict(prompt):
        calls["n"] += 1
        return _wav_bytes()

    code = main(
        ["--library", str(library), "--cache", str(tmp_path / "cache")],
        predict_fn=predict,
        ingest_fn=_fake_ingest,
    )
    assert code == 0
    assert calls["n"] == 5
    assert len(PROMPTS) == 5

    index = json.loads((library / "index.json").read_text(encoding="utf-8"))
    lyria = [t for t in index if t["id"].startswith("lyria_")]
    assert len(lyria) == 5
    assert [t for t in index if t["id"] == "mysong"], "uploads preserved"
    for t in lyria:
        assert (library / t["file"]).exists()
        assert t["mood"] == "warm"


def test_rerun_replaces_seeds_without_duplicates(tmp_path):
    library = tmp_path / "audio-library"
    library.mkdir()

    def predict(prompt):
        return _wav_bytes()

    args = ["--library", str(library), "--cache", str(tmp_path / "cache")]
    assert main(args, predict_fn=predict, ingest_fn=_fake_ingest) == 0
    assert main(args, predict_fn=predict, ingest_fn=_fake_ingest) == 0
    index = json.loads((library / "index.json").read_text(encoding="utf-8"))
    assert len(index) == 5  # the cap holds across reruns


def test_failed_track_is_skipped_not_fatal(tmp_path):
    library = tmp_path / "audio-library"
    library.mkdir()
    calls = {"n": 0}

    def flaky(prompt):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("lyria hiccup")
        return _wav_bytes()

    code = main(
        ["--library", str(library), "--cache", str(tmp_path / "cache")],
        predict_fn=flaky,
        ingest_fn=_fake_ingest,
    )
    assert code == 0
    index = json.loads((library / "index.json").read_text(encoding="utf-8"))
    assert len(index) == 4  # one track skipped, the rest landed
