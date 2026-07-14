# M1 — Intelligence Pipeline, driven from the Workbench — Design

**Date:** 2026-07-14 (revised same day: no CLI — everything operable from the frontend)
**Status:** Approved
**Milestone:** PRD §7 M1 — "librosa beat/energy extraction; Gemini media analysis; Montage Director; local folder→reel works end-to-end" — with the workbench UI as the only control surface.

User decisions (2026-07-14): scope = M1 (no narration — that's M3 narrative mode); runtime split = Python analysis + TS orchestrator (matches Tech Spec §1); audio = mini local library with ingest + per-run track override ("Both"); **no CLI — photos in, reel out, all from the frontend**; generate flow = pipeline stops at EDL loaded into the workbench editor, user tweaks then hits the existing render button; **Google/Gemini models only — no Claude-on-Vertex, no other providers.**

## 1. Goal & flow

In the workbench (`npm run workbench`):

1. Drag photos into the assets tray (existing upload, unchanged).
2. Drop MP3s into a new **music tray** — each upload is auto-ingested (BPM, beat grid, energy, Gemini mood line) and listed.
3. Hit **develop reel** (optionally pinning a track; default "producer picks"). A stage checklist shows live progress: analyze → produce → direct.
4. The generated EDL loads into the editor (validated by the existing gate), preview updates, a plan summary shows the Producer's story read, track reason, captions and hashtags.
5. User tweaks JSON if desired → existing **render mp4** button → reel.

No terminal commands beyond starting the workbench.

## 2. Repo layout

```
analysis/            Python package (mirrors Tech Spec §1 analysis workers)
  pyproject.toml     deps: google-genai, librosa, opencv-python-headless, imagehash, pillow
  analyze_media.py   --photos <files...> --cache cache/ --out media_pool.json  (triage + Gemini vision)
  ingest_audio.py    --track <file> --cache cache/ --out <json>  (BPM/beat grid/energy + Gemini mood)
orchestrator/        TypeScript package: pure pipeline library (NO CLI)
  package.json       deps: @google/genai, zod (same major as renderer)
  src/pipeline.ts    runPipeline(opts, onProgress) — stages in §4
  src/stages/*.ts    one module per stage
  src/gemini.ts      Vertex client wrapper (§5)
prompts/
  producer.md        Producer prompt (Tech Spec §4–5 heuristics live HERE)
  director_montage.md Montage Director prompt (closed vocabularies verbatim)
audio-library/       uploaded MP3s + generated index.json (both gitignored)
cache/               gitignored; content-hash-keyed analysis artifacts
```

The workbench Express server (`renderer/server/workbench-server.mjs`) grows pipeline endpoints (§6) and imports the orchestrator. The orchestrator imports `EdlSchema`/`checkInvariants` from `renderer/src/edl/` — one contract, no duplication. (Server is ESM `.mjs`, orchestrator is TS: orchestrator ships a small build step `tsc` → `dist/`, run automatically by the `workbench` npm script before starting the server.)

## 3. Contracts (Tech Spec, trimmed to M1)

- **`media_pool.json`** — Tech Spec §3 minus clip fields (stills only). `subject_bbox` mandatory. `quality_flags` from OpenCV (blur = variance-of-Laplacian under threshold); phash dedup (distance ≤ threshold keeps the sharper); rejects listed with reasons.
- **`production_plan.json`** — Tech Spec §4 with M1 constraints: `mode` always `"montage"`, `hero_shots` `[]` (Veo=M4), `voiceover` `null` (M3); `captions`/`hashtags` still generated.
- **`edl.json`** — existing renderer contract (§6 / `renderer/src/edl/schema.ts`): beat-snapped cuts ±33 ms, `text.in_ms/out_ms` relative to entry start, asset ids resolvable.
- **`audio-library/index.json`** — per track: `{id, file, bpm, beat_grid_ms, energy_curve, duration_ms, mood}`.
- **Run record** `out/pipeline/<runId>/` — media_pool, plan, edl, meta.json (stage timings, token usage incl. thoughtsTokenCount, model ids, cache hits).

## 4. Pipeline stages (orchestrator library)

`runPipeline({photoFiles, track?: 'auto' | trackId, models}, onProgress)`:

1. **analyze** — spawn `analyze_media.py` over the workbench's uploaded **raster photos** (jpg/jpeg/png/webp under `renderer/public/assets/`; SVG fixtures automatically excluded). Per-photo Gemini results cached by content hash — re-develops skip the API.
2. **produce** — one Gemini call: producer prompt + media_pool + audio index (or pinned track info) → plan. Zod `ProductionPlanSchema` gate, one repair retry, then hard fail.
3. **direct** — one Gemini call: director prompt + plan + pool + beat grid → EDL. Gate: `EdlSchema.parse` + `checkInvariants`. On failure: errors sent back, "fix and re-emit JSON only", max 1 retry (Tech Spec §6), then hard fail with the errors.
4. **finalize** — copy the chosen track into `renderer/public/assets/audio/` so `staticFile()` resolves it for Player preview and CLI render; write the run record; return `{edl, plan, mediaPool, meta}`.

Guard: <3 usable photos after triage → stop with "not enough usable photos". Each stage failure carries the stage name + human-readable reason (surfaced in the UI checklist).

Render is NOT a pipeline stage — the user renders from the existing render deck after reviewing the EDL.

## 5. Gemini client (Google models only)

- `gemini-2.5-flash` for everything; a UI toggle ("director quality: flash / pro") swaps only the direct stage to `gemini-2.5-pro`. No other providers, ever.
- Vertex AI, project `project-a2dcdad0-5d65-4d61-846`, `us-central1` (per GCP_MODELS_USAGE.md).
- Auth: the workbench server sets `GOOGLE_APPLICATION_CREDENTIALS` to `<repo>/my-product-sa-key.json` at startup if the env var is unset and the file exists (zero-config); otherwise env var wins. Key is git-ignored. If neither exists, pipeline endpoints return a clear setup error; the rest of the workbench works as before.
- JSON discipline: `responseMimeType: "application/json"` + `responseSchema`; `maxOutputTokens` ≥ 8192 (thinking-token gotcha). Verify current SDK shapes via Context7 at implementation time.
- Wrapper: `generateJson<T>({model, systemFile, parts, schema}): Promise<{data: T, usage}>` — one retry on invalid JSON. Python mirrors minimally for the vision batch.

## 6. Server endpoints (added to workbench-server.mjs)

- `GET  /api/audio` — track list from index.json (`[]` + hint if empty).
- `POST /api/audio` — multer MP3 upload → spawn `ingest_audio.py` → update index.json → return track entry. (Synchronous is fine; ingest is seconds.)
- `POST /api/pipeline/run` — body `{track: 'auto'|trackId, directorModel: 'flash'|'pro'}` → 202 `{runId}`; 409 if a pipeline or ingest already running (same single-job pattern as render).
- `GET  /api/pipeline/status` — `{state: idle|running|done|failed, stage, stageStates, error, runId}` — UI polls every 2 s (same pattern as render status).
- `GET  /api/pipeline/result/:runId` — `{edl, plan}` when done.

## 7. Workbench UI additions (plain, matching current styling — the visual overhaul is a separate parked spec)

- **Music tray** (between filmstrip and render deck): drag-drop/browse MP3 upload; rows show name, BPM, duration, mood line; radio pick "producer chooses" (default) or pin a track.
- **Develop deck**: "develop reel" button (disabled with reason if <3 raster photos or no tracks and no pin), director flash/pro toggle, stage checklist with live states (pending/running/done/failed + failure reason), and on success a **plan card**: story read, chosen track + reason, captions, hashtags.
- On completion the EDL JSON replaces the editor content (the previous text is recoverable via the existing "load fixture" button and browser undo; acceptable for a dev tool).
- Existing preview/render flow unchanged.

## 8. Out of scope (M1)

Video clips/scene detection (M4), Veo (M4), narration/Cloud TTS (M3), narrative & edit Directors (M3), track-matching embeddings (M2+; the Producer reads the index text), GCP deploy/Firestore/Telegram (M2), the visual UI overhaul (parked spec on `feature/workbench-ui-overhaul`), auth/multi-user (local single-user tool).

## 9. Testing

- **No live API calls in test suites.** Gemini wrapper injectable; canned responses.
- TS (vitest, orchestrator/): prompt assembly snapshots, ProductionPlanSchema accept/reject, direct-stage repair loop wiring (bad EDL → retry → hard fail), cache keys, pipeline state machine transitions.
- Python (pytest, analysis/): phash dedup keeps sharper duplicate, blur threshold flagging, beat grid on a generated click track, cache hit skips recompute.
- Server: endpoint tests with the orchestrator stubbed (409 discipline, status shape).
- **Live verification (manual):** real photos + a real MP3 through the UI — watch stages, inspect EDL in editor, render, watch reel. Browser pass via claude-in-chrome.

## 10. Risks / notes

- SA has `roles/aiplatform.user` on the Gemini project (GCP_MODELS_USAGE.md §5b); implementation starts with a cheap live smoke call to fail fast on auth.
- librosa/MP3 on Windows: prefer soundfile/audioread wheels; fall back to ffmpeg decode if needed.
- Python discovery: server tries `py -3` then `python`; clear UI error if neither exists.
- Vision batch size: start 10 images/call; tune.
- Costs are pennies per run (Tech Spec §11); usage logged in meta.json.
