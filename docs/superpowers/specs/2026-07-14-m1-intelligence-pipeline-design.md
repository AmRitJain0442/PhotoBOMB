# M1 — Local Intelligence Pipeline (folder → reel) — Design

**Date:** 2026-07-14
**Status:** Approved
**Milestone:** PRD §7 M1 — "librosa beat/energy extraction; Gemini media analysis; Montage Director; local folder→reel works end-to-end."

User decisions (2026-07-14): scope = M1 as spec'd (no narration — that's M3 narrative mode); runtime split = Python analysis + TS orchestrator (matches Tech Spec §1); audio = mini local library with ingest + `--track` override ("Both"); **Google/Gemini models only — no Claude-on-Vertex, no other providers.**

## 1. Goal

One command turns a local folder of photos into a rendered montage reel:

```
npx darkroom run --photos photos/rooftop-jaipur [--track song.mp3] [--pro] [--out out/]
```

Output: `out/<batch>/reel.mp4` plus every intermediate artifact (`media_pool.json`, `production_plan.json`, `edl.json`, `meta.json`) so the EDL can be opened in the workbench.

## 2. Repo layout

```
analysis/            Python package (matches Tech Spec §1 analysis workers)
  pyproject.toml     deps: google-genai, librosa, opencv-python-headless, imagehash, pillow, exifread (or PIL EXIF)
  analyze_media.py   photos dir → media_pool.json (triage + Gemini vision)
  ingest_audio.py    audio-library/*.mp3 → audio-library/index.json
  extract_beats.py   single track → beat grid JSON (used by --track path)
orchestrator/        TypeScript package (matches Tech Spec orchestrator)
  package.json       deps: @google/genai, zod (same major as renderer), commander (CLI)
  src/cli.ts         `darkroom run` entrypoint
  src/stages/*.ts    one module per stage (see §4)
  src/gemini.ts      thin Vertex client wrapper (see §5)
prompts/
  producer.md        Producer system prompt (Tech Spec §4–5 heuristics live HERE)
  director_montage.md Montage Director prompt (emits EDL; lists closed vocabularies verbatim)
audio-library/       user drops licensed MP3s here; ingest generates index.json (both *.mp3 and index.json gitignored — regenerable)
cache/               gitignored; content-hash-keyed analysis artifacts
photos/              gitignored; user's input batches
out/                 gitignored; results
```

The orchestrator imports `EdlSchema` and `checkInvariants` **directly from `../renderer/src/edl/`** (relative TS path, same repo). One contract, no duplication. The renderer remains unchanged.

## 3. Contracts (from Tech Spec, trimmed to M1)

- **`media_pool.json`** — Tech Spec §3 exactly, minus clip fields (stills only in M1). `subject_bbox` mandatory. `quality_flags` merged from the OpenCV pass (blur = variance-of-Laplacian below threshold; dupes removed by phash distance ≤ threshold, keep the sharper one; rejected files listed with reasons in a `rejects` array alongside the pool).
- **`production_plan.json`** — Tech Spec §4, with M1 constraints: `mode` is always `"montage"` (Producer is told this; field kept for forward-compat), `hero_shots` always `[]` (Veo is M4), `voiceover` always `null` (M3), `captions`/`hashtags` still generated (cheap, useful).
- **`edl.json`** — the existing renderer contract (Tech Spec §6, `renderer/src/edl/schema.ts`). Director must emit `audio.beat_grid_ms` copied from the analysis, cuts beat-snapped ±33 ms, `text.in_ms/out_ms` relative to entry start (M0 contract decision).
- **`audio-library/index.json`** — per track: `{id, file, bpm, beat_grid_ms, energy_curve (downsampled RMS), duration_ms, mood: "<one-line Gemini description>"}`.
- **`meta.json`** — per run: stage timings, Gemini token usage per call (incl. `thoughtsTokenCount`), model ids used, cache hits.

## 4. Orchestrator stages (`darkroom run`)

1. **ingest** — list photos (jpg/jpeg/png/webp), sha256 each; read EXIF timestamp/GPS.
2. **analyze** — spawn `python analysis/analyze_media.py --photos <dir> --cache cache/ --out <batch>/media_pool.json`. Python does: phash dedup → blur flags → batched Gemini vision calls (many images per call, Tech Spec §3) → merge → media_pool.json. Per-photo Gemini results cached by content hash; cached photos skip the API entirely.
3. **audio** — if `--track`: `extract_beats.py` on that file (cached by hash), Producer told track is fixed. Else: load `audio-library/index.json` (error with instructions if missing/empty → "run `npx darkroom ingest-audio`").
4. **produce** — one Gemini call: `prompts/producer.md` + media_pool + audio index (or fixed track info) → `production_plan.json`. Validated by a Zod `ProductionPlanSchema` (new, in orchestrator). One repair retry on validation failure, then hard fail.
5. **direct** — one Gemini call: `prompts/director_montage.md` + plan + pool + beat grid → `edl.json`. Gate: `EdlSchema.parse` + `checkInvariants` (imported from renderer). On failure: send errors back, "fix and re-emit JSON only", max 1 retry (Tech Spec §6), then hard fail printing the errors.
6. **stage-assets** — copy selected photos to `renderer/public/assets/<batch>/`, copy/point the audio file likewise, build the `assets` id→path map.
7. **render** — write props JSON (UTF-8 **no BOM**), spawn `npx remotion render Reel out/<batch>/reel.mp4 --props=...` in `renderer/` (same mechanism as the workbench server).
8. **report** — write `meta.json`, print summary (duration, shots, track, tokens, cost estimate, output path).

Guard: if <3 usable photos survive triage, stop at stage 2 with "not enough usable photos" (no degenerate reels).

## 5. Gemini client (Google models only)

- **Models:** `gemini-2.5-flash` for everything; `--pro` swaps the **direct** stage (and only it) to `gemini-2.5-pro`. No other providers, ever, per user constraint.
- **Endpoint:** Vertex AI, project `project-a2dcdad0-5d65-4d61-846`, location `us-central1` (per GCP_MODELS_USAGE.md).
- **Auth:** `GOOGLE_APPLICATION_CREDENTIALS` → `my-product-sa-key.json` (git-ignored). Both SDKs (`google-genai` py / `@google/genai` ts) read it automatically in Vertex mode. CLI fails fast with a setup message if the env var is unset.
- **JSON discipline:** all calls set `responseMimeType: "application/json"` and a `responseSchema`; `maxOutputTokens` ≥ 8192 (2.5 thinking-token gotcha — visible output starves if the budget is small). Verify current `@google/genai` / `google-genai` API shapes via Context7 at implementation time.
- Wrapper interface (TS): `generateJson<T>(opts: {model, systemFile, parts, schema: ZodSchema<T>}): Promise<{data: T, usage}>` — retries once on invalid JSON. Python side mirrors this minimally for the vision batch call.

## 6. Prompts (`prompts/`)

Plain markdown, loaded at runtime — editing a prompt requires no rebuild. Producer prompt encodes Tech Spec §5 heuristics (duration by A-grade count: <8→7s, 8–14→15s, 15+→30s; bias short) and §9 track matching (pick from the provided index by mood/BPM; montage BPM comfort 70–100, not a hard rule). Director prompt lists the closed vocabularies verbatim from §6, states the beat-snap rule (±33 ms), coverage rule (no gaps/overlaps, ends at duration_ms), asset-id rule (only ids from `selects`), the ken-burns focal-point rule (use `subject_bbox` center), and the text-timing rule (in/out relative to entry start).

## 7. Out of scope (M1)

Video clips/scene detection (M4), Veo (M4), narration/voiceover & Cloud TTS (M3), narrative & edit Directors (M3), embeddings for track matching (M2+, LLM picks from index text for now), GCP deploy/Eventarc/Firestore/Telegram (M2), workbench UI changes (parked separate spec).

## 8. Testing

- **No live API calls in the test suite.** The Gemini wrapper is injectable; tests use canned responses.
- TS (vitest, in orchestrator/): prompt assembly (fixed inputs → exact prompt text snapshot), ProductionPlanSchema accept/reject cases, EDL gate wiring (bad EDL → repair path invoked → hard fail), cache key derivation, asset staging map.
- Python (pytest, in analysis/): phash dedup keeps sharper duplicate, blur flag threshold, beat-grid output shape on a generated click track (reuse the M0 WAV generator idea), cache hit skips recompute.
- **Live verification (manual, once per milestone):** real run on a user photo folder + a library track; open resulting `edl.json` in the workbench; watch `reel.mp4`.

## 9. Risks / notes

- SA has `roles/aiplatform.user` on the Gemini project (verified in GCP_MODELS_USAGE.md §5b); first implementation step includes a cheap live smoke call to fail fast on auth.
- librosa install on Windows: use Python ≥3.10 + pip wheels; if soundfile/audioread struggles with MP3, fall back to ffmpeg decode (renderer already ships ffmpeg via Remotion).
- Gemini vision batch size: start 10 images/call; tune by output quality/token limits.
- Cost per run is pennies (Tech Spec §11); token usage logged to meta.json regardless.
