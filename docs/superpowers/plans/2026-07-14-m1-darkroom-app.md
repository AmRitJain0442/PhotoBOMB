# M1 Darkroom Product App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photos + music in a consumer web app → Gemini-planned, beat-cut, rendered Instagram reel — no JSON or jargon visible anywhere.

**Architecture:** Python `analysis/` package (triage + Gemini vision + librosa audio) invoked as subprocesses by a TypeScript `orchestrator/` library (Producer→Director Gemini calls, EDL gate reused from `renderer/src/edl/`), exposed through the existing Express server, consumed by a new three-screen React app (`renderer/app/`) that replaces the deleted JSON workbench.

**Tech Stack:** Python 3.12 (librosa, opencv-python-headless, imagehash, pillow, google-genai), TypeScript + Node ESM (@google/genai, zod 3), Express + multer, Vite 7 + React 19, @remotion/player 4.0.489, vitest + pytest.

## Global Constraints

- **Google models only:** `gemini-2.5-flash` for every call; `gemini-2.5-pro` only via env `DARKROOM_DIRECTOR_MODEL=pro`. Never any other provider.
- **Vertex:** project `project-a2dcdad0-5d65-4d61-846`, location `us-central1`. Auth via `GOOGLE_APPLICATION_CREDENTIALS`; server auto-points it at `<repo>/my-product-sa-key.json` if unset and file exists.
- **JSON discipline:** every Gemini call sets `responseMimeType: 'application/json'` (py: `response_mime_type`) + a response schema; `maxOutputTokens: 8192` minimum (2.5 thinking-token gotcha).
- **No jargon in UI copy:** never EDL, pipeline, render job, schema, invariant, asset. Product voice, sentence case.
- **Contracts:** EDL = `renderer/src/edl/schema.ts` + `checkInvariants` (import, never duplicate). `text.in_ms/out_ms` relative to entry start. Beat snap ±33 ms.
- **Ports:** Express 7787, app 5799 (proxy `/api`, `/renders`). zod stays v3 (^3.23). All Node packages ESM.
- **Windows:** write JSON files without BOM (plain `fs.writeFileSync` UTF-8 is fine; never PowerShell `Out-File`); Python launcher `py -3` preferred, fall back `python`.
- **Microcommits** after every green test cycle (CLAUDE.md).

## File Structure

```
analysis/pyproject.toml, darkroom_analysis/{__init__,cache,triage,exif_meta,gemini_vision,audio}.py,
         analyze_media.py, ingest_audio.py, tests/{test_cache,test_triage,test_analyze,test_audio}.py
orchestrator/package.json, tsconfig.json, vitest.config.ts,
         src/{contracts,gemini,paths}.ts, src/stages/{analyze,audio,produce,direct,finalize}.ts,
         src/pipeline.ts, src/*.test.ts, scripts/smoke.mjs
prompts/producer.md, director_montage.md
renderer/server/workbench-server.mjs (extended; job table + pipeline endpoints)
renderer/app/ (replaces renderer/workbench/, deleted): vite.config.ts, index.html,
         src/{main.tsx,App.tsx,api.ts,styles.css},
         src/lib/{edl-tweaks.ts,edl-tweaks.test.ts,stage-copy.ts,stage-copy.test.ts,gating.ts,gating.test.ts},
         src/screens/{CreateScreen.tsx,DevelopingScreen.tsx,ReviewScreen.tsx},
         src/components/{PhotoGrid.tsx,MusicPicker.tsx,PhoneFrame.tsx,TweaksPanel.tsx,ExportPanel.tsx}
```

---

### Task 1: Orchestrator scaffold + Gemini wrapper + live auth smoke

**Files:** Create `orchestrator/package.json`, `orchestrator/tsconfig.json`, `orchestrator/vitest.config.ts`, `orchestrator/src/gemini.ts`, `orchestrator/src/gemini.test.ts`, `orchestrator/scripts/smoke.mjs`.

**Interfaces produced:**
```ts
export type GeminiUsage = {inputTokens: number; outputTokens: number; thoughtsTokens: number};
export type GeminiTransport = (req: {model: string; system: string; parts: Array<{text: string}>;
  responseSchema: object; maxOutputTokens: number}) => Promise<{text: string; usage: GeminiUsage}>;
export const vertexTransport: GeminiTransport;             // @google/genai, vertexai:true
export async function generateJson<T>(opts: {transport: GeminiTransport; model: string; system: string;
  parts: Array<{text: string}>; zodSchema: z.ZodType<T>; responseSchema: object; maxOutputTokens?: number;
  repairNote?: string}): Promise<{data: T; usage: GeminiUsage; repaired: boolean}>;
export function resolveCredentials(repoRoot: string): {ok: boolean; message?: string}; // env-var autoset
export const MODELS = {flash: 'gemini-2.5-flash', pro: 'gemini-2.5-pro'} as const;
export const VERTEX = {project: 'project-a2dcdad0-5d65-4d61-846', location: 'us-central1'} as const;
```
`generateJson`: call transport → `JSON.parse` → `zodSchema.safeParse`. On parse/schema failure, ONE retry appending the error text + `repairNote` (default "Fix the JSON and re-emit ONLY valid JSON.") as an extra part; second failure throws `GeminiJsonError` with stage-readable message.

- [ ] Steps: `package.json` (name `@darkroom/orchestrator`, type module, scripts `build: tsc`, `test: vitest run`, deps `@google/genai`, `zod ^3.23`; dev `typescript ^5.5`, `vitest ^3`); tsconfig (`module: NodeNext`, `outDir: dist`, `rootDir: src`, strict). `npm install`.
- [ ] Failing tests in `gemini.test.ts` with a fake transport: (1) valid JSON → data typed, `repaired: false`; (2) first response invalid JSON, second valid → `repaired: true` and retry request contains error text; (3) both invalid → throws `GeminiJsonError`; (4) schema-valid JSON but zod-invalid → retry path too.
- [ ] Implement `gemini.ts`; tests pass; typecheck (`npx tsc --noEmit`).
- [ ] `scripts/smoke.mjs`: `resolveCredentials`, then live `generateJson` (flash, schema `{ok: boolean}`, prompt "Return {\"ok\": true}"). Run it ONCE manually — expected `{ok: true}` + token usage printed. This is the fail-fast auth check from spec §10.
- [ ] Commit `feat(orchestrator): gemini wrapper + auth smoke`.

### Task 2: Python analysis package — cache, triage, EXIF

**Files:** Create `analysis/pyproject.toml` (name darkroom-analysis, requires-python >=3.11, deps: `google-genai`, `librosa`, `soundfile`, `opencv-python-headless`, `imagehash`, `pillow`; optional dev `pytest`), `analysis/darkroom_analysis/{__init__,cache,triage,exif_meta}.py`, `analysis/tests/{test_cache,test_triage}.py`.

**Interfaces produced (python):**
- `cache.get(cache_dir, key: str, namespace: str) -> dict|None`, `cache.put(cache_dir, key, namespace, data)`, `cache.file_key(path) -> str` (sha256 of bytes). Layout `cache/<namespace>/<key>.json`.
- `triage.sharpness(path) -> float` (variance of Laplacian, cv2 grayscale);
  `triage.triage(paths: list[str], phash_threshold=6, blur_threshold=60.0) -> TriageResult` where result has `survivors: list[str]`, `rejects: list[{file, reason}]`, `flags: dict[path, list[str]]` ("slight_blur" when sharpness < 2×threshold, reject "too blurry" when < threshold; phash distance ≤ threshold → reject the LESS sharp one as `duplicate of <other>`).
- `exif_meta.read(path) -> {"ts": iso8601|None, "gps": [lat, lon]|None}` (PIL `getexif`, tags 36867/DateTimeOriginal + GPSInfo).

- [ ] `py -3 -m pip install -e analysis[dev]` (create venv NOT required — user-level install acceptable for this machine).
- [ ] Failing pytest: cache roundtrip + miss; triage on generated images (PIL: one sharp random-noise image, its Gaussian-blurred copy → duplicate removed keeping sharper; a heavily blurred unique image → rejected "too blurry"; mild blur → survivor with `slight_blur`).
- [ ] Implement; `py -3 -m pytest analysis/tests -q` green; commit `feat(analysis): cache, triage, exif`.

### Task 3: Gemini vision + analyze_media.py

**Files:** Create `analysis/darkroom_analysis/gemini_vision.py`, `analysis/analyze_media.py`, `analysis/tests/test_analyze.py`.

**Contract:** `analyze_media.py --photos <dir> --cache <dir> --out <file> [--batch 10]` → media_pool JSON (spec §3, stills only): `{"pool": [entry...], "rejects": [...]}`; entry = `{id (filename sans ext), file, type: "still", exif, analysis: {aesthetic_score, description, subject, subject_bbox, dominant_colors, mood_tags, energy, orientation, quality_flags}}`. Raster only (jpg/jpeg/png/webp). Gemini results cached per `cache.file_key`; triage flags merged into `quality_flags`.

- `gemini_vision.analyze_batch(client, paths: list[str]) -> list[dict]`: ONE `generate_content` call per batch — parts: instruction text (asks for a JSON array, one object per image, **in input order**, fields above, bbox normalized 0-1) then `types.Part.from_bytes` per image; config `response_mime_type='application/json'`, `response_schema` (ARRAY of OBJECT with required props incl. `subject_bbox` 4-item number array), `max_output_tokens=16384`. Model `gemini-2.5-flash`, client `genai.Client(vertexai=True, project=..., location='us-central1')`.
- `main(argv, analyze_fn=None)` — test injects `analyze_fn`; real run builds client lazily.

- [ ] Failing pytest: with fake `analyze_fn` returning canned analyses — pool merges triage+exif+analysis; cached photo skips fn (call counter); <3 survivors → exit code 3 with `{"error": "not_enough_photos"}` on stdout; SVG in dir ignored.
- [ ] Implement; pytest green; commit `feat(analysis): gemini vision + analyze_media CLI`.

### Task 4: ingest_audio.py + beat extraction

**Files:** Create `analysis/darkroom_analysis/audio.py`, `analysis/ingest_audio.py`, `analysis/tests/test_audio.py`.

**Contract:** `ingest_audio.py --track <file> --cache <dir> --out <json> [--describe]` → `{id (filename sans ext), file (basename), bpm: float, beat_grid_ms: int[], energy_curve: float[] (RMS downsampled to ≤64 points, 0-1 normalized), duration_ms: int, mood: str, feel: str}`. `audio.extract(path) -> dict` does librosa `load` (mono, sr=22050) → `beat_track` → `frames_to_time`*1000 rounded → RMS via `librosa.feature.rms`. Beat grid MUST start ≤ first beat and be strictly increasing. Mood/feel via one Gemini text call describing bpm/energy shape + filename (schema `{mood, feel}`, feel = 2–4 plain lowercase words) — injectable, `--describe` triggers real call; without it mood/feel default `""`/`"steady"` (tests never hit network). Cached by `cache.file_key` (namespace `audio`).

- [ ] Failing pytest: generate 120 BPM click WAV (same synthesis as `renderer/scripts/make-fixtures.mjs`: int16 sine bursts every 0.5 s, 12 s) → `extract` bpm within 118–122, beat spacing median 500±20 ms, energy_curve length ≤64 within [0,1]; cache hit skips recompute.
- [ ] Implement; pytest green; commit `feat(analysis): audio ingest + beat extraction`.

### Task 5: Prompts

**Files:** Create `prompts/producer.md`, `prompts/director_montage.md`.

- [ ] `producer.md`: role (photo Producer for IG reels); inputs it will receive (media_pool JSON, audio index or pinned track, optional `avoid` note); Tech Spec §5 heuristics verbatim (duration by A-grade count `<8→7000`, `8–14→15000`, `15+→30000`, bias short; A-grade = aesthetic_score ≥ 7 without blur flags); mode fixed `"montage"`; pick track by mood/BPM fit (montage comfort 70–100 BPM, soft rule) with one-line reason; order `selects` for visual flow (color/energy continuity); `hero_shots: []`, `voiceover: null`; write `captions.short/long` + 5–10 `hashtags`; obey `avoid` (different track and/or different opening); output = production_plan JSON ONLY.
- [ ] `director_montage.md`: role (Montage Director emitting an EDL); the EXACT closed vocabularies from Tech Spec §6 (motion/transition/effects/text.style/anchor lists verbatim); rules: timeline covers `[0, duration_ms]` no gaps/overlaps; every cut within ±33 ms of a `beat_grid_ms` entry (first entry starts at 0; last ends exactly at duration_ms); only asset ids from `selects`; each entry ken_burns with focal point = `subject_bbox` center (cx,cy), zoom 1.0–1.25, pan small; text sparse (≤3 entries), `in_ms/out_ms` RELATIVE to entry start and inside the entry; styles limited to `caption_lower|kinetic_word|none` (M1 renderer set); transitions `cut` (others render as cut); audio block copies `track`, `trim_start_ms` (0 default), `beat_grid_ms`, `mute_render: false`, `voiceover: null`; `fps: 30`, `aspect: "9:16"`; output = EDL JSON ONLY.
- [ ] Commit `feat(prompts): producer + montage director`.

### Task 6: Orchestrator contracts, stages, pipeline

**Files:** Create `orchestrator/src/contracts.ts`, `orchestrator/src/paths.ts`, `orchestrator/src/stages/{analyze,audio,produce,direct,finalize}.ts`, `orchestrator/src/pipeline.ts`, tests `orchestrator/src/{contracts,produce,direct,pipeline}.test.ts`.

**Interfaces produced:**
```ts
// contracts.ts
export const ProductionPlanSchema = z.object({
  story: z.object({read: z.string(), type: z.string(), arc_possible: z.boolean()}),
  mode: z.literal('montage'), duration_ms: z.number().int().positive(),
  selects: z.array(z.string()).min(3), rejects: z.array(z.object({id: z.string(), reason: z.string()})).default([]),
  hero_shots: z.array(z.unknown()).max(0).default([]),
  audio: z.object({track_id: z.string(), reason: z.string(), trim_start_ms: z.number().int().min(0).default(0)}),
  typography_direction: z.string().default(''), voiceover: z.null().default(null),
  captions: z.object({short: z.string(), long: z.string()}), hashtags: z.array(z.string()).min(1),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;
export type MediaPool = {pool: MediaEntry[]; rejects: {file: string; reason: string}[]};  // §3 shape
export type TrackInfo = {id; file; bpm; beat_grid_ms: number[]; energy_curve: number[]; duration_ms; mood; feel};
// pipeline.ts
export type StageName = 'analyze'|'produce'|'direct'|'finalize';
export type Progress = (stage: StageName, state: 'running'|'done') => void;
export type RunResult = {runId: string; edl: Edl; plan: ProductionPlan; mediaPool: MediaPool; meta: RunMeta};
export function runPipeline(opts: {photosDir: string; track: 'auto'|string; avoid?: {track_id?: string; summary?: string};
  deps: PipelineDeps}, onProgress: Progress): Promise<RunResult>;
export function revisePipeline(opts: {runId: string; pin?: string; removeAsset?: string; deps: PipelineDeps},
  onProgress: Progress): Promise<RunResult>;
export type PipelineDeps = {transport: GeminiTransport; repoRoot: string; directorModel: string;
  spawnPy: (script: string, args: string[]) => Promise<{code: number; stdout: string}>};
```
Stage details: **analyze** spawns `analyze_media.py` (spawnPy: try `py -3` then `python`, cwd repoRoot); exit 3 → `PipelineError('analyze', 'not_enough_photos')`. **audio**: track `'auto'` → read `audio-library/index.json` (missing/empty → `PipelineError('produce','no_music')`); specific id → its entry; `--track`-style ad hoc not needed (uploads always ingest). **produce**: `generateJson` with producer.md + pool + tracks (+avoid); pin (revise) bypasses produce and patches `plan.audio.track_id`. **direct**: `generateJson` → `EdlSchema.parse` + `checkInvariants(edl, assetIds)` (import from `../../renderer/src/edl/...`; assetIds = selects ∪ staged audio id); on violations, repair retry with violations text; then hard fail. Director model from `DARKROOM_DIRECTOR_MODEL==='pro' ? MODELS.pro : MODELS.flash`. **finalize**: copy track file to `renderer/public/assets/audio/<file>`; EDL `audio.track` must equal `assets/audio/<file>` (post-patch if Director wrote track_id); write `out/pipeline/<runId>/{media_pool,production_plan,edl,meta}.json`; runId = `p<timestamp>`. Revise: load run record; `removeAsset` → filter selects (error `too_few_photos` if <3) ; re-run direct+finalize only.

- [ ] Failing tests (fake transport + fake spawnPy + tmp dirs): plan schema accept/reject (hero_shots nonempty rejected, mode edit rejected); produce repair loop (bad then good JSON); direct: valid-EDL happy path; invariant-violating EDL (cut at 940 off 500ms grid) → repair attempt → good → passes; twice-bad → PipelineError containing violation text; revise pin swaps track + skips produce (transport sees only director call); removeAsset filters selects and errors below 3; runPipeline emits progress running/done per stage in order; meta captures usage.
- [ ] Implement; vitest green; `npx tsc --noEmit`; commit `feat(orchestrator): pipeline stages with repair + revise`.

### Task 7: Server extensions

**Files:** Modify `renderer/server/workbench-server.mjs`; create `renderer/server/server.test.mjs` (vitest, listens on port 0, stubbed pipeline).

Refactor: export `createApp({pipelineImpl, ingestImpl, roots})` from the same file; entry block (`if run as main`) builds real impls: `pipelineImpl = {run, revise, status}` wrapping orchestrator `dist/` (server stays .mjs; orchestrator built by npm script). Job model mirrors existing render job: single in-flight pipeline job `{state, stage, runId, error, result}`.

Endpoints added (spec §6): `GET /api/audio` (read index.json → `[]` if absent), `POST /api/audio` (multer single mp3/wav → `audio-library/`; spawn `ingest_audio.py --describe`; append/replace entry in index.json; 422 friendly message on ingest failure), `POST /api/pipeline/run` (`{track:'auto'|id}` → 202 `{runId}` / 409 busy / 422 `{error:'setup', message}` when credentials missing), `POST /api/pipeline/revise` (`{runId, pin?|removeAsset?}` → 202), `GET /api/pipeline/status`, `GET /api/pipeline/result/:runId` (from job result or run record on disk), `DELETE /api/assets/:file` (basename-sanitize like GET /renders; only within public/assets; 204). Credentials autoset: at startup `if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && exists(repoRoot/my-product-sa-key.json)) set it`.

- [ ] Failing tests with stubbed impls: run→202+status running→done with result; second run while running → 409; revise→202; credentials-missing stub → 422 setup; DELETE traversal attempt (`..%2F`) → 400/404, legit file → 204 and gone from `GET /api/assets`; POST /api/audio with stub ingest → entry in GET list.
- [ ] Implement; vitest green; commit `feat(server): pipeline, audio, delete endpoints`.

### Task 8: Product app scaffold + design system (replaces workbench)

**Files:** Delete `renderer/workbench/` (git rm). Create `renderer/app/{vite.config.ts,index.html}`, `renderer/app/src/{main.tsx,App.tsx,api.ts,styles.css}`, `renderer/app/src/lib/{gating.ts,gating.test.ts}`. Modify `renderer/package.json` (script `darkroom`: build orchestrator then concurrently server+vite on app dir; keep `workbench` as alias to `darkroom` for muscle memory; add deps `@fontsource/fraunces`, `@fontsource/public-sans`), `renderer/.gitignore` unchanged, root `.gitignore` add `out/pipeline/` if needed (already ignored via renderer/out? pipeline out lives at repo `out/` — add `out/`).

**Design tokens (frontend-design pass, consumer-warm darkroom):** room `#181114` (warm black), paper `#f5efe6` (print paper, cards), tray `#221a1e`, ink-on-dark `#f0e9df`, ink-on-paper `#2a2125`, safelight `#ff5b4d` (primary action + brand accent), amber `#e8b04b` (progress), print-green `#8fc98a` (success); display type **Fraunces** (warm editorial, used for screen titles + brand), UI/body **Public Sans**; radius 14px cards / 999 pills; the signature is the **Developing screen**: near-dark room, a soft pulsing safelight glow behind a film-reel spinner and Fraunces status line. Buttons: primary = safelight fill, dark text? no — white text on safelight, hover deepens; secondary = outline on tray. Reduced motion: glow static. App shell: state machine `phase: 'create'|'developing'|'review'` in `App.tsx`; `api.ts` = typed fetch client for all endpoints (assets CRUD, audio, pipeline run/revise/status/result, render trio).

`gating.ts`: `canCreate({photoCount, trackCount, choice}) -> {ok: boolean; hint?: string}` — <3 photos → "Add at least 3 photos to make a reel."; choice 'auto' && trackCount===0 → "Add a song first — drop an MP3 in."; ok otherwise.

- [ ] Delete workbench, scaffold app, tokens/styles, shell with placeholder screens; gating tests green; `npm run darkroom` boots (manual smoke: page loads at 5799 with Create placeholder). Vite config: root app/, publicDir `../public`, port 5799, proxy as before.
- [ ] Commit `feat(app)!: replace workbench with product app shell`.

### Task 9: Create screen

**Files:** Create `renderer/app/src/components/{PhotoGrid.tsx,MusicPicker.tsx}`, `renderer/app/src/screens/CreateScreen.tsx`.

- PhotoGrid: drop zone + browse (reuse upload plumbing pattern from old AssetStrip: FormData POST /api/assets, `Array.from(files as ArrayLike<File>)`), thumbnails of **raster** assets only (filter svg out of GET /api/assets), ✕ per photo → DELETE + refresh, count badge, empty state "Your photos will appear here".
- MusicPicker: cards from GET /api/audio (name from id, `feel`, rounded bpm as "~82 bpm"), radio-select incl. default "Let Darkroom choose" card; "Add a song" drop/browse → POST /api/audio with uploading state; empty library hint.
- CreateScreen composes both + primary button wired to `canCreate`; disabled state shows hint text; click → POST /api/pipeline/run `{track: choiceId|'auto'}` → parent `setPhase('developing')`.
- [ ] Implement, visual check in browser (screenshot), commit `feat(app): create screen`.

### Task 10: Developing screen

**Files:** Create `renderer/app/src/lib/{stage-copy.ts,stage-copy.test.ts}`, `renderer/app/src/screens/DevelopingScreen.tsx`.

- `stage-copy.ts`: `copyFor(stage: string): string` — analyze→"Looking at your photos…", produce→"Finding the story…", direct→"Cutting to the beat…", finalize→"Almost there…", fallback "Developing…"; plus `friendlyError(code: string): string` — `not_enough_photos`→"We need at least 3 clear, sharp photos. Add a few more and try again.", `no_music`→"Add a song first — reels need a beat.", `setup`→"Darkroom isn't connected to its AI yet. Check the service key and restart.", default "That take didn't come out right. Let's try again."
- Screen: poll `GET /api/pipeline/status` every 2 s; safelight glow + spinner + Fraunces copy line (crossfade on change, reduced-motion: cut); `failed` → friendly error + "Try again" (back to create, photos/music intact); `done` → fetch `result/:runId`, hand `{edl, plan, runId}` up, phase→review.
- [ ] stage-copy tests green; implement screen; commit `feat(app): developing screen`.

### Task 11: Review screen — preview, tweaks, another take

**Files:** Create `renderer/app/src/lib/{edl-tweaks.ts,edl-tweaks.test.ts}`, `renderer/app/src/components/{PhoneFrame.tsx,TweaksPanel.tsx}`, `renderer/app/src/screens/ReviewScreen.tsx`.

**edl-tweaks.ts (pure, tested):**
```ts
export type TextRef = {entryIndex: number; content: string};
export function listTexts(edl: Edl): TextRef[];                       // entries with text.style !== 'none'
export function setText(edl: Edl, entryIndex: number, content: string): Edl;  // ''→ style 'none' (removes), else content swap; immutable
export function usedPhotoIds(edl: Edl): string[];                     // timeline order, dedup
```
Tests: listTexts skips none; setText immutably rewords; empty string removes overlay; result still passes `EdlSchema.parse` (import renderer schema).

- PhoneFrame: bezel + `@remotion/player` `Player` (component `Reel` from `renderer/src/Reel`, same import style as old PreviewPane; inputProps `{edl, assets}` where assets map built from GET /api/assets + `assets/audio/` track); controls, loop.
- TweaksPanel: (1) **Text** — input per `listTexts` entry, onBlur → `setText` → preview updates instantly; (2) **Song** — MusicPicker cards (minus "let choose"), selecting different id → POST `/api/pipeline/revise {runId, pin}` → inline "Re-cutting to the new song…" state → swap in new result; (3) **Photos** — thumbnails of `usedPhotoIds`, ✕ → revise `{removeAsset}` (blocked with message when 3 left: "A reel needs at least 3 photos.").
- ReviewScreen: PhoneFrame left, right column: "Try another take" (POST run with `avoid: {track_id, summary: plan.story.read}` → phase developing), TweaksPanel, ExportPanel (Task 12). Revise states poll same status endpoint.
- [ ] Tweaks tests green; implement; browser check; commit `feat(app): review screen with tweaks`.

### Task 12: Export panel + full verification

**Files:** Create `renderer/app/src/components/ExportPanel.tsx`; modify `renderer/app/src/screens/ReviewScreen.tsx` (mount).

- ExportPanel: "Export video" → POST /api/render `{edl: currentEdl, assets}` (current = with text tweaks) → poll render status → progress state "Printing your reel…" → done: "Save video" anchor to `/renders/<file>` (download attr) + caption card (plan.captions.short/long, hashtags joined, copy buttons) ; failed → "The export hit a snag — try again."
- [ ] Full suite: orchestrator vitest, analysis pytest, renderer vitest (old workbench tests removed with it), app vitest, `tsc --noEmit` everywhere.
- [ ] Live E2E: generate 8 photo-like JPEGs (PIL script into scratchpad→upload via UI) + one 30 s WAV song; drive all three screens with claude-in-chrome (create→developing with real Gemini→review: text tweak, song present, export→MP4 plays). Screenshots at each screen; mobile-width screenshot.
- [ ] Update memory `darkroom-project-status.md`; commit `feat(app): export panel`; then **superpowers:finishing-a-development-branch**.

---

## Self-review notes

- Spec coverage: §1 flow → Tasks 8–12; §2 layout → 1–6; §3 contracts → 3,4,6; §4 pipeline+revise → 6; §5 client rules → 1; §6 endpoints → 7; §7 visual/copy → 8–12 (tokens in 8, copy in 10); §8 exclusions respected; §9 testing mapped per task; §10 risks → smoke (1), py fallback (6 spawnPy), batch size (3).
- Type consistency: `RunResult{runId,edl,plan,mediaPool,meta}` consumed by server (7) and app result endpoint (10/11); `TrackInfo.feel` consumed by MusicPicker (9); gating/stage-copy names match usage.
- No placeholders: prompts content specified in Task 5; token values fixed in Task 8.
