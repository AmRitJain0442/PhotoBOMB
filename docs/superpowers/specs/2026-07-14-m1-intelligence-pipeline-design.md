# M1 — Darkroom Product App (photos → reel, zero technical surface) — Design

**Date:** 2026-07-14 (rev 3: consumer product UI; JSON workbench removed entirely)
**Status:** Approved
**Milestone:** PRD §7 M1 — librosa beat/energy extraction; Gemini media analysis; Montage Director; local folder→reel end-to-end — operated entirely from a consumer-grade frontend.

User decisions (2026-07-14): Python analysis + TS orchestrator (Tech Spec §1 split); audio = local library w/ ingest + per-reel song choice; no CLI, no terminal steps beyond starting the app; **frontend is a product for a non-technical person — no JSON, no schema errors, no pipeline jargon anywhere**; post-generation controls = approve/export, regenerate, tweak basics (switch song, reword on-screen text, remove a photo); **the JSON workbench UI is removed entirely** (its Express server survives as the app's backend); the parked workbench-UI-overhaul spec (`2026-07-14-workbench-ui-overhaul-design.md`, branch `feature/workbench-ui-overhaul`) is **superseded and abandoned**; **Google/Gemini models only.**

## 1. Product flow (three screens)

`npm run darkroom` (renamed from `workbench`) → browser opens the app.

**Create.** One page: "Add your photos" drop zone (drag/browse; thumbnail grid fills as they upload; small ✕ on each to remove before creating). Music section: uploaded songs as cards showing name + plain-word feel ("warm · slow · 82 bpm-ish" phrasing decided at implementation, no jargon), an "Add a song" drop target (MP3), and a default selected card "Let Darkroom choose". Primary button **Create my reel** — disabled with a friendly hint until ≥3 photos (and ≥1 song OR "choose" selectable only when library non-empty; with an empty library the hint says to add a song first).

**Developing.** Centered single progress moment with darkroom-flavored copy advancing with real stages: analyze → "Looking at your photos…", produce → "Finding the story…", direct → "Cutting to the beat…". No logs, percentages optional. Failure states in human words with one retry button ("That didn't come out right — try again"), the real error only in server logs.

**Review.** Phone-frame preview (Remotion Player, real `Reel` composition) playing the generated reel, with:
- **Export video** — runs the MP4 render server-side with progress; done → "Save video" (download) + the AI-written caption and hashtags with copy buttons.
- **Try another take** — regenerate: re-runs produce+direct with a "avoid the previous interpretation" hint (Tech Spec §5 regen behavior, scaled to M1: pass previous track_id + a summary of the prior take to avoid).
- **Tweaks** (no AI jargon):
  - **Song switcher** — pick a different card → pipeline re-runs direct with the new track's beat grid (produce kept, track pinned). Progress shown as "Re-cutting to the new song…".
  - **Text edits** — every on-screen text in the reel listed as editable fields; changing wording mutates the EDL in memory client-side (no LLM call), preview updates instantly. Empty field removes that text.
  - **Photo strip** — the photos used, in order; ✕ on one → re-runs direct without that asset ("Re-cutting…"). Blocked with a friendly message if it would drop usable count below 3.

The EDL never appears in the UI. It lives in client memory + run records on disk.

## 2. Repo layout

```
analysis/            Python package (mirrors Tech Spec §1 analysis workers)
  pyproject.toml     google-genai, librosa, opencv-python-headless, imagehash, pillow
  analyze_media.py   --photos <files...> --cache cache/ --out media_pool.json (triage + Gemini vision)
  ingest_audio.py    --track <file> --cache cache/ --out <json> (BPM/beat grid/energy + Gemini mood + plain-words feel)
orchestrator/        TS package: pure pipeline library (no CLI)
  src/pipeline.ts    runPipeline / revisePipeline (§4), progress callbacks
  src/stages/*.ts
  src/gemini.ts      Vertex wrapper (§5)
prompts/
  producer.md, director_montage.md
audio-library/       uploaded MP3s + index.json (gitignored)
cache/               content-hash-keyed analysis artifacts (gitignored)
renderer/
  app/               NEW product frontend (Vite + React) — replaces workbench/ (deleted)
  server/            existing Express server, extended (§6)
  src/               Remotion project, unchanged
```

Orchestrator imports `EdlSchema`/`checkInvariants` from `renderer/src/edl/` (single contract). Orchestrator builds via `tsc` → `dist/`, wired into the `darkroom` npm script. `renderer/workbench/` and its components are deleted; reusable pieces (Player wiring, upload plumbing, render-job client) migrate into `app/`.

## 3. Contracts (Tech Spec, trimmed to M1)

- **media_pool.json** — §3 minus clip fields (stills only). `subject_bbox` mandatory; OpenCV blur flags; phash dedup (keep sharper); rejects with reasons.
- **production_plan.json** — §4 with `mode:"montage"` fixed, `hero_shots:[]`, `voiceover:null`; captions/hashtags generated (surfaced at Export).
- **edl.json** — existing renderer contract (`renderer/src/edl/schema.ts`); beat-snap ±33 ms; text in/out relative to entry start.
- **audio-library/index.json** — per track `{id, file, bpm, beat_grid_ms, energy_curve, duration_ms, mood, feel}` where `feel` is the 2–4 plain words shown on cards.
- **Run record** `out/pipeline/<runId>/` — media_pool, plan, edl, meta.json (timings, tokens incl. thoughtsTokenCount, models, cache hits).

## 4. Pipeline library

`runPipeline({photoFiles, track: 'auto'|trackId, avoid?}, onProgress)` — stages: **analyze** (spawn analyze_media.py over uploaded raster photos; per-photo Gemini cached by content hash) → **produce** (Gemini + producer.md; Zod ProductionPlanSchema gate, 1 repair retry) → **direct** (Gemini + director_montage.md; EdlSchema + checkInvariants gate, 1 repair retry, Tech Spec §6) → **finalize** (copy track into `renderer/public/assets/audio/`, write run record, return {edl, plan, meta}).

`revisePipeline({runId, pin?: trackId, removeAsset?: assetId})` — reuses the run's media_pool and plan (track pin replaces plan.audio; removed asset filtered from selects) and re-runs **direct** only. Regenerate = `runPipeline` with `avoid` populated from the previous run.

Guards: <3 usable photos after triage → friendly failure. Every stage error carries stage + human-readable reason; the UI maps stages to product copy and shows generic friendly failure text.

Render is not a pipeline stage — Export triggers the existing render job with the current (possibly text-tweaked) in-memory EDL.

## 5. Gemini client (Google models only)

- `gemini-2.5-flash` everywhere. (`gemini-2.5-pro` reserved as an internal env-var escape hatch `DARKROOM_DIRECTOR_MODEL=pro` — no UI toggle; non-technical users don't pick models.)
- Vertex AI, project `project-a2dcdad0-5d65-4d61-846`, `us-central1` (GCP_MODELS_USAGE.md). No other providers, ever.
- Auth: server sets `GOOGLE_APPLICATION_CREDENTIALS` to `<repo>/my-product-sa-key.json` at startup when unset and present (zero-config); pipeline endpoints return a friendly setup error otherwise.
- All calls: `responseMimeType:"application/json"` + `responseSchema`, `maxOutputTokens` ≥ 8192 (thinking-token gotcha). Verify SDK shapes via Context7 at implementation.
- Wrapper `generateJson<T>({model, systemFile, parts, schema})` with one invalid-JSON retry; injectable for tests.

## 6. Server endpoints (extend `renderer/server/workbench-server.mjs`)

Existing kept: photo upload (`POST /api/assets`), asset list, render job trio (`POST /api/render`, status, `/renders/:file`), single-in-flight-job discipline.

Added:
- `GET/POST /api/audio` — track list / MP3 upload (multer) → spawn ingest_audio.py → updated entry. Ingest failures return a friendly message ("We couldn't read that song file").
- `POST /api/pipeline/run` — `{track, avoid?}` → 202 `{runId}`; 409 if busy.
- `POST /api/pipeline/revise` — `{runId, pin?|removeAsset?}` → 202 `{runId}` (new runId, direct-only).
- `GET /api/pipeline/status` — `{state, stage, error, runId}`; UI polls 2 s.
- `GET /api/pipeline/result/:runId` — `{edl, plan}` (plan supplies captions/hashtags/text list metadata).
- `DELETE /api/assets/:file` — remove an uploaded photo (Create screen ✕). Basename-sanitized like existing handlers.

## 7. Visual design (implementation via frontend-design skill)

Consumer-warm darkroom identity: the lab metaphor stays (developing, takes, prints) but softened for a non-technical owner — inviting, photographic, zero instrument-panel severity. Design tokens, type pairing, and the signature moment (the "developing" screen) get a dedicated design pass at implementation; quality floor: responsive to mobile widths, visible focus, `prefers-reduced-motion` respected, friendly empty states ("Your photos will appear here"). All copy in product voice: verbs, sentence case, no jargon (never "EDL", "render job", "pipeline", "invariant").

## 8. Out of scope (M1)

Video clips (M4), Veo (M4), narration/Cloud TTS (M3), narrative/edit modes (M3), embeddings (M2+), GCP deploy/Telegram (M2), timeline drag-editing, accounts/multi-user, the abandoned CodeMirror workbench overhaul.

## 9. Testing

- No live API calls in suites; Gemini wrapper injectable.
- vitest (orchestrator): prompt assembly snapshots, plan schema accept/reject, direct repair loop, revise semantics (pin/removeAsset), avoid-hint construction, cache keys.
- pytest (analysis): dedup keeps sharper, blur flags, beat grid on click track, cache hits.
- Server: endpoint tests with orchestrator stubbed (409s, status shapes, delete sanitization).
- Frontend: vitest for EDL text-mutation helper (reword/remove text → valid EDL, verified against imported EdlSchema).
- Live manual: real photos + MP3 through the UI; browser pass (claude-in-chrome) across all three screens incl. tweaks and export.

## 10. Risks / notes

- SA already has `roles/aiplatform.user` on the Gemini project; first implementation task includes a live smoke call to fail fast on auth.
- librosa/MP3 on Windows: soundfile/audioread wheels, ffmpeg fallback.
- Python discovery: `py -3` then `python`; friendly UI error if absent.
- Vision batch size: start 10 images/call; tune.
- Regeneration cost is pennies; tokens logged per run.
