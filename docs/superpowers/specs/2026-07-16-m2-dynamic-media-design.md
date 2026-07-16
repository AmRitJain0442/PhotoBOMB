# M2 Dynamic Media: Live Moments, AI Film, Enhanced Photos, Lyria Library — Design

Date: 2026-07-16. Extends M1 + dynamic edits (`2026-07-15-dynamic-edits-design.md`) on `feature/m1-pipeline`. User decisions: BOTH woven hero clips and a full AI-film mode, chosen per reel; Create screen gets a 3-way Style selector + an "Enhance photos" toggle; Lyria seeds a 5-track library once; Approach A (one pipeline, one EDL contract).

Hard constraints carried over: only Gemini/Google models; no pipeline jargon in user-facing copy; one contract (the EDL) drives preview and export; decoration never fails a reel; `my-product-sa-key.json` never committed or read into context.

## 1. Models (all verified live on Vertex with the existing service account, 2026-07-16)

| Role | Model | Location | API |
|---|---|---|---|
| Producer / Director / song mood / photo analysis | `gemini-3-flash-preview` | `global` | `generateContent`, JSON responseSchema, `thinking_level: "low"` |
| Director pro override (`DARKROOM_DIRECTOR_MODEL=pro`) | `gemini-2.5-pro` (unchanged) | `us-central1` | `generateContent` |
| Cutout segmentation (unchanged — Gemini 3 dropped segmentation) | `gemini-2.5-flash` | `us-central1` | plain-text fenced JSON (per dynamic-edits spec) |
| Photo enhancement | `gemini-3.1-flash-image` (Nano Banana 2) | `global` | `generateContent` with image input + edit prompt, image output |
| Photo → video clip, AI film | `gemini-omni-flash-preview` | `global` | **Interactions API** (`client.interactions.create`), `video_config.task: "image_to_video"` / `"reference_to_video"`, `aspect_ratio: "9:16"` |
| Music seeding | `lyria-002` | `us-central1` | `:predict`, 30s WAV output |

Cost notes (paid tier): omni video ≈ $0.10/second of 720p; nano banana ≈ $0.045/image. Per reel: Classic ≈ pennies, Live moments ≈ $0.75–1.75, AI film ≈ $1.20. The style picker copy hints "uses more magic" — no dollar figures in UI.

`orchestrator/src/gemini.ts` gains per-model locations: `MODELS` entries become `{id, location}`; the Vertex transport builds the host from the location (`global` → `aiplatform.googleapis.com`). Gemini 3 calls set `thinking_level` instead of relying on thinking-token headroom, and keep `maxOutputTokens ≥ 8192`.

## 2. Create screen: Style + Enhance

- **Style** (3-way, glass segmented control): `classic` "Classic montage" · `live` "Live moments — a photo or two comes alive" · `film` "AI film — one continuous video from your photos".
- **Enhance photos** toggle (off by default): nano-banana cinematic grade on the selected photos. Applies to `classic` and `live`; ignored by `film` (omni styles its own footage).
- `POST /api/pipeline/run` body: `{track, avoid?, style: 'classic'|'live'|'film', enhance: boolean}`. Defaults `classic`/`false` keep old clients working.

## 3. Pipeline flow per style

**classic**: analyze → produce → [enhance] → direct → finalize (today's flow + optional enhance).

**live**: analyze → produce → [enhance] → animate → direct → finalize.
- Producer fills `hero_shots` (1–2) when style is `live`: `{id, motion_prompt}` — a one-sentence camera/subject motion grounded in the photo ("the balloon drifts upward as the sky deepens").
- `animate` generates one ~6s muted 9:16 clip per hero via omni `image_to_video`, sourcing the **enhanced** still when enhance is on. Output: `renderer/public/assets/clips/<id>.mp4` + measured `duration_ms`.
- Director input marks hero assets: pool entries passed to the Director gain `clip: {duration_ms}`; prompt rules: hero entries use `"kind": "clip"`, entry length ≤ clip duration and 2–4 beats, never two hero entries back-to-back, stills for everything else.

**film**: analyze → produce (film variant) → film → finalize.
- Producer film variant returns story/captions/hashtags plus `film_prompt`: a narrative brief for omni (subjects, arc, mood, pacing) grounded in the pool.
- `film` stage: one omni `reference_to_video` call, up to 8 photos as references (enhanced ignored), target ≈ 10–12 s, 9:16, omni's own audio KEPT.
- Finalize builds a one-entry EDL: `mode: "narrative"` (beat invariants auto-skip), `timeline: [{asset: "film", kind: "veo", start_ms: 0, end_ms: <duration>}]`, `audio.track: null`, `mute_render: false`. The film file lands at `renderer/public/assets/clips/film-<runId>.mp4` and rides in `entry.clip_path` (see §5).

**Stage names & copy**: `StageName` gains `'enhance' | 'animate' | 'film'`; Developing screen lines — enhance: "Giving your photos the darkroom treatment", animate: "Bringing a moment to life", film: "Directing your film". Progress order matches the flow.

## 4. Contracts

`ProductionPlanSchema` changes (orchestrator/src/contracts.ts):
- `hero_shots`: `z.array(z.object({id: z.string(), motion_prompt: z.string().min(1)})).max(2).default([])` (replaces the `max(0)` placeholder). Producer rule: exactly 0 unless style is `live`.
- New optional `film_prompt: z.string().optional()` — required by prompt when style is `film`, absent otherwise.
- `runProduce` gains `style` in its options and passes it (plus allowed hero count) into the prompt context.

`MediaPool` entries: unchanged on disk; the Director's *view* of a hero entry gains `clip: {duration_ms}` (assembled in direct.ts, not persisted by analysis).

Run result: gains `asset_paths: Record<string, string>` — id → renderer-relative path for every asset the EDL references, pointing at `assets/enhanced/<id>.jpg` when enhanced, `assets/<file>` otherwise, and `assets/clips/…` for clip/film ids. ReviewScreen and the render request use `asset_paths` verbatim (no more rebuilding from `/api/assets`).

## 5. EDL schema + invariants (renderer/src/edl)

- `TimelineEntrySchema` gains optional `clip_path: z.string()` and optional `clip_duration_ms: z.number().int().positive()` — BOTH patched by finalize (like `cutout`) from the animate/film results, never written by the Director; the renderer uses them to source and trim the video.
- Invariants third-arg object grows: `checkInvariants(edl, assetIds, extras?: {cutoutIds?: Set<string>; clipDurations?: Map<string, number>})` — breaking-change refactor of the current third positional arg (only direct.ts and tests call it). New rules: an entry with `kind: "clip"`/`"veo"` must reference a known clip and its length must be ≤ the clip's duration; `kind: "still"` entries must not carry `clip_path`.
- Renderer: `kind === 'clip' | 'veo'` renders `<OffthreadVideo src={staticFile(entry.clip_path)} muted={edl.audio.track !== null} trimAfter…>` sized like stills; missing `clip_path` at render time degrades to the still image (never crashes). Text overlays and transitions work on clip entries exactly as on stills.

## 6. Enhancement stage (nano banana)

New module `orchestrator/src/stages/enhance.ts`:
- For each select: one `gemini-3.1-flash-image` call — input photo + prompt "Regrade this photo with a warm cinematic film look: richer golden tones, gentle lifted blacks, subtle grain. Keep composition, subjects, and framing exactly unchanged." Output image written to `renderer/public/assets/enhanced/<id>.jpg`.
- Cache: namespace `enhance` keyed by `sha256(file) + PROMPT_VERSION`; a hit with the JPG present skips the call; failures are NEVER cached (per the segmentation lesson); any failure means that photo stays original.
- Injectable `enhanceFn` for tests, same pattern as `spawnPy`/transport.
- Server `DELETE /api/assets/:file` also removes `enhanced/<id>.jpg` and `clips/<id>.mp4`.

## 7. Animate + film stages (omni)

New module `orchestrator/src/stages/animate.ts`:
- `runAnimate(deps, {heroes, sourceFor})`: per hero, `client.interactions.create` (via a thin injectable `omni` dep on `PipelineDeps`) with the source still, `task: "image_to_video"`, `aspect_ratio: "9:16"`, motion prompt; poll/download URI delivery to `assets/clips/<id>.mp4`; probe duration via ffprobe (Remotion's bundled ffmpeg) or omni metadata.
- Cache namespace `clip`: keyed by source-file hash + motion prompt + PROMPT_VERSION. Failures degrade (hero dropped, Director never told about it) and are not cached.

New module `orchestrator/src/stages/film.ts`:
- One `reference_to_video` interaction (photos as references + `film_prompt`), download to `assets/clips/film-<runId>.mp4`, measure duration. No cache (each take is intentionally fresh). Failure → `PipelineError('film', 'film_failed')` → friendly copy "That film didn't come out — try again or switch to a montage."

The omni dep lives in `PipelineDeps` as `omni: OmniTransport` (`(req) => Promise<{videoPath: string; durationMs: number}>` with a real implementation in a new `orchestrator/src/omni.ts` and a scripted fake in test-fixtures).

## 8. Lyria seed script

`analysis/seed_music.py`: generates exactly 5 tracks via `lyria-002` `:predict` (prompts: warm golden-hour acoustic · upbeat feel-good indie · moody late-night R&B · sweeping cinematic strings · minimal lo-fi beat), writes `audio-library/lyria_<slug>.wav`, runs the existing `ingest_audio` per track (beats + `gemini-3-flash-preview` mood line), and rewrites `index.json` replacing any previous `lyria_*` entries so the seeded set never exceeds 5. Idempotent; run manually once (and re-runnable). Uploads keep working unchanged.

## 9. Review screen behavior

- classic/live: unchanged tweaks (text, song switch, photo removal, another take). Removing a hero photo re-directs; the hero clip for a removed photo is deleted with the photo. `asset_paths` drives the preview.
- film: preview + captions + hashtags + export + "Try another take" (re-runs produce+film with the avoid note). No text tweaks, no song switch (omni owns the audio), no photo removal.

## 10. Testing

- **Orchestrator (vitest, scripted fakes)**: plan schema (hero_shots ≤ 2 with motion prompts, film_prompt); enhance stage (cache hit skips, failure degrades + not cached, paths); animate stage (clip cached, failure drops hero silently); film stage (one-entry narrative EDL, duration from omni); direct with clips (invariant: clip entry too long → repair; back-to-back heroes discouraged via prompt only); finalize `asset_paths` assembly; gemini.ts per-model locations (transport receives global host for 3-flash).
- **Renderer**: schema round-trips clip_path/clip_duration_ms; invariants clip rules; fixture gains one clip entry; Reel falls back to still when clip_path missing (schema-level test + manual).
- **Python**: seed_music with injectable predict fn (5 files, index replacement, cap).
- **Live E2E**: seed the Lyria library (real), then one reel per style — verify enhanced JPGs, a hero clip playing inside the beat-cut reel muted, a film take with omni audio, exports for each.

## 11. Out of scope

Per-photo enhancement control (it's all-or-nothing per reel), user-written motion prompts, film length control, regenerating individual Lyria tracks from the UI, Veo fallback, cost display in UI.
