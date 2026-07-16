# M2 Dynamic Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three reel styles (Classic / Live moments / AI film) + an Enhance-photos toggle, powered by gemini-3-flash-preview (LLM), gemini-3.1-flash-image (grade), gemini-omni-flash-preview (clips/film), and a 5-track lyria-002 library — all on the existing Vertex SA.

**Architecture:** Spec `docs/superpowers/specs/2026-07-16-m2-dynamic-media-design.md` (Approach A): one pipeline, one EDL. New Python modules do the image/video/music API work (they own PIL + the google-genai Python SDK, whose Interactions support is verified); orchestrator stages spawn them like `analyze_media`. Finalize patches `clip_path`/`clip_duration_ms` and assembles `asset_paths`.

**Tech Stack:** google-genai (Python 2.11.0 + @google/genai JS), zod 3, Remotion OffthreadVideo, pytest/vitest.

## Global Constraints

- Only Gemini/Google models. Verified IDs/locations: `gemini-3-flash-preview`@global, `gemini-3.1-flash-image`@global, `gemini-omni-flash-preview`@global (Interactions API), `gemini-2.5-flash`@us-central1 (segmentation only), `gemini-2.5-pro`@us-central1 (pro override), `lyria-002`@us-central1.
- No jargon in user-facing copy. Decoration degrades, never fails a reel. Expensive video results cached; FAILURES NEVER CACHED.
- Segmentation prompt/config untouched (2.5-flash, no JSON mime — see dynamic-edits spec).
- Microcommits. Windows: `py -3`, PowerShell 5.1 has no `&&`.
- Test commands: `py -3 -m pytest analysis/tests -q` · orchestrator: `cd orchestrator; npx vitest run`; build `npm run build` · renderer: `cd renderer; npx tsc --noEmit; npx vitest run`.

---

### Task 1: ModelRef — per-model locations + Gemini 3 Flash everywhere the LLM speaks

**Files:**
- Modify: `orchestrator/src/gemini.ts`, `orchestrator/src/pipeline.ts` (resolveDirectorModel), `orchestrator/src/stages/produce.ts` + `direct.ts` (MODELS usage), `orchestrator/src/test-fixtures.ts` (makeDeps), `orchestrator/src/gemini.test.ts`, `orchestrator/src/direct.test.ts` (model assertions), `analysis/darkroom_analysis/gemini_vision.py`, `analysis/darkroom_analysis/segment.py`, `analysis/ingest_audio.py` (describe model if hardcoded — check), `analysis/tests` as needed.

**Interfaces:**
- Produces: `type ModelRef = {id: string; location: string}`; `MODELS = {flash: {id:'gemini-3-flash-preview', location:'global'}, pro: {id:'gemini-2.5-pro', location:'us-central1'}}`; `GeminiRequest.model: ModelRef`; `PipelineDeps.directorModel: ModelRef`. Python: `gemini_vision.MODEL='gemini-3-flash-preview'`, `make_client(location='global')`; `segment.make_client()` (own, us-central1).

- [ ] **Step 1: Failing tests.** In `gemini.test.ts` add/adjust: transport fake records `req.model` — assert produce uses `{id:'gemini-3-flash-preview', location:'global'}`. In `direct.test.ts` change `expect(calls[0].model).toBe('gemini-2.5-flash')` → `toEqual({id:'gemini-3-flash-preview', location:'global'})` and the pro test → `{id:'gemini-2.5-pro', location:'us-central1'}`. Run vitest → FAIL (type + value).

- [ ] **Step 2: Implement gemini.ts.**

```ts
export type ModelRef = {id: string; location: string};
export const MODELS = {
  flash: {id: 'gemini-3-flash-preview', location: 'global'},
  pro: {id: 'gemini-2.5-pro', location: 'us-central1'},
} as const;
export const VERTEX = {project: 'project-a2dcdad0-5d65-4d61-846'} as const;
```

`GeminiRequest.model: ModelRef`; `generateJson` opts `model: ModelRef` (pass-through). Transport keeps one client per location:

```ts
const clients = new Map<string, import('@google/genai').GoogleGenAI>();
export const vertexTransport: GeminiTransport = async (req) => {
  let client = clients.get(req.model.location);
  if (!client) {
    const {GoogleGenAI} = await import('@google/genai');
    client = new GoogleGenAI({vertexai: true, project: VERTEX.project, location: req.model.location});
    clients.set(req.model.location, client);
  }
  const isGemini3 = req.model.id.startsWith('gemini-3');
  const response = await client.models.generateContent({
    model: req.model.id,
    contents: [{role: 'user', parts: req.parts}],
    config: {
      systemInstruction: req.system,
      responseMimeType: 'application/json',
      responseSchema: req.responseSchema,
      maxOutputTokens: req.maxOutputTokens,
      ...(isGemini3 ? {thinkingConfig: {thinkingLevel: 'LOW' as never}} : {}),
    },
  });
  …same usage mapping…
};
```

(`thinkingLevel` verified live in Step 5; if the SDK/endpoint rejects it, delete the spread — Gemini 3 defaults still work with our token budgets.)

`resolveDirectorModel(env): ModelRef` returns `MODELS.pro` or `MODELS.flash`. `produce.ts` uses `MODELS.flash` (now a ref). `makeDeps` directorModel: `{id:'gemini-2.5-flash', location:'us-central1'}`? NO — fixtures assert real defaults: use `MODELS.flash` import in `makeDeps`.

- [ ] **Step 3: Python swap.** `gemini_vision.py`: `MODEL = "gemini-3-flash-preview"`, `make_client()` → `genai.Client(vertexai=True, project=PROJECT, location="global")`. `segment.py`: add its own

```python
PROJECT = "project-a2dcdad0-5d65-4d61-846"

def make_client():
    from google import genai
    return genai.Client(vertexai=True, project=PROJECT, location="us-central1")
```

and `analyze_media.py` default segment path uses `segment.make_client()`. Check `ingest_audio.py --describe` model reference: if it imports `gemini_vision.MODEL`, it upgrades for free; if hardcoded, switch to `gemini-3-flash-preview` + global client.

- [ ] **Step 4: Run both suites** (`pytest`, `vitest`, `npm run build`) → green.
- [ ] **Step 5: Live probe** (one cheap call through the real transport, e.g. a tiny node script calling generateJson with a 2-field schema) to confirm `thinkingLevel: 'LOW'` is accepted; on 400 remove the spread and note it in the commit body.
- [ ] **Step 6: Commit** `feat(models): gemini-3-flash-preview via per-location ModelRef`.

---

### Task 2: Producer contract — hero_shots, film_prompt, style

**Files:**
- Modify: `orchestrator/src/contracts.ts`, `orchestrator/src/stages/produce.ts`, `prompts/producer.md`, `orchestrator/src/test-fixtures.ts`, `orchestrator/src/contracts.test.ts`, `orchestrator/src/produce.test.ts`.

**Interfaces:**
- Produces: `type ReelStyle = 'classic' | 'live' | 'film'` (exported from contracts); plan `hero_shots: {id, motion_prompt}[] (max 2, default [])`, `film_prompt?: string`; `runProduce` opts gain `style: ReelStyle`; fixture `LIVE_PLAN` (PLAN + two heroes).

- [ ] **Step 1: Failing tests.** contracts.test: accepts `hero_shots: [{id:'img0', motion_prompt:'the sun sinks slowly'}]`; rejects 3 heroes; rejects hero without motion_prompt; accepts optional film_prompt. produce.test: transport queue with plan JSON; assert `calls[0].parts.map(p=>p.text).join()` contains `style: live` and the hero rule text when style live, and `style: film` mentions film_prompt requirement. Run → FAIL.

- [ ] **Step 2: Implement.** contracts.ts:

```ts
export type ReelStyle = 'classic' | 'live' | 'film';
export const HeroShotSchema = z.object({id: z.string(), motion_prompt: z.string().min(1)});
  hero_shots: z.array(HeroShotSchema).max(2).default([]),
  film_prompt: z.string().optional(),
```

produce.ts: `ProduceOptions` gains `style: ReelStyle`; PLAN_RESPONSE_SCHEMA `hero_shots` → `{type:'ARRAY', items:{type:'OBJECT', properties:{id:{type:'STRING'}, motion_prompt:{type:'STRING'}}, required:['id','motion_prompt']}}`, add `film_prompt: {type:'STRING'}`; parts gain:

```ts
    {text: `style: ${opts.style}\n` + STYLE_RULES[opts.style]},
```

with

```ts
const STYLE_RULES: Record<ReelStyle, string> = {
  classic: 'hero_shots MUST be [] and film_prompt MUST be omitted.',
  live:
    'Pick 1-2 hero_shots: the photos that most deserve motion. Each motion_prompt is one ' +
    'grounded sentence describing subtle, realistic motion for THAT photo (camera drift, ' +
    'subject movement, atmosphere). film_prompt MUST be omitted.',
  film:
    'hero_shots MUST be []. Write film_prompt: a 3-5 sentence brief for a single continuous ' +
    '10-12 second vertical film made from these photos — subjects, arc, mood, pacing. ' +
    'Ground it ONLY in what the photos show.',
};
```

producer.md: document the `style` input and the three rules verbatim (rules section). test-fixtures: `export const LIVE_PLAN = {...PLAN, hero_shots: [{id: 'img0', motion_prompt: 'the balloon drifts gently upward'}, {id: 'img2', motion_prompt: 'city lights flicker on at dusk'}]};` (img0 has_cutout true, img2 false — irrelevant here). Existing `runProduce` callers (pipeline.ts) pass `style: 'classic'` for now (full wiring Task 6).

- [ ] **Step 3: Suites green; commit** `feat(producer): style-aware plan - hero shots + film prompt`.

---

### Task 3: EDL clips — schema, invariants extras, renderer video

**Files:**
- Modify: `renderer/src/edl/schema.ts` (+test), `renderer/src/edl/invariants.ts` (+test), `renderer/src/Reel.tsx`, `renderer/fixtures/montage.json`, `renderer/src/edl/fixture.test.ts`, `orchestrator/src/stages/direct.ts` (call-site signature only).

**Interfaces:**
- Produces: `TimelineEntrySchema` + `clip_path?: string`, `clip_duration_ms?: number(int>0)`; `type InvariantExtras = {cutoutIds?: Set<string>; clipDurations?: Map<string, number>}`; `checkInvariants(edl, assetIds, extras?: InvariantExtras)`.

- [ ] **Step 1: Failing tests.** schema.test: clip entry `{asset:'CLIP_001', kind:'clip', start_ms:1000, end_ms:2000, clip_path:'assets/clips/CLIP_001.mp4', clip_duration_ms:6000}` parses; `clip_duration_ms: 0` rejected. invariants.test: rewrite existing cutout tests to `checkInvariants(edl, assets, {cutoutIds: new Set(['A'])})`; new tests — clip entry with `clipDurations: new Map([['A', 1500]])` and length 1000 → ok; length 2000 (> 1500) → violation mentions `clip`; clip entry for asset NOT in the map → violation; no extras → clip rules skipped. Run → FAIL (signature).

- [ ] **Step 2: Implement schema + invariants.** schema: two optional fields after `cutout` (comment: patched by finalize). invariants:

```ts
export type InvariantExtras = {cutoutIds?: Set<string>; clipDurations?: Map<string, number>};
export const checkInvariants = (edl: Edl, assetIds: Set<string>, extras: InvariantExtras = {}): string[] => {
  const {cutoutIds, clipDurations} = extras;
```

cutout check unchanged (guarded by `cutoutIds &&`). New, inside the entry loop:

```ts
    if ((e.kind === 'clip' || e.kind === 'veo') && clipDurations) {
      const dur = clipDurations.get(e.asset);
      if (dur === undefined) {
        errors.push(`entry ${i} is kind "${e.kind}" but asset "${e.asset}" has no generated clip — use kind "still"`);
      } else if (e.end_ms - e.start_ms > dur) {
        errors.push(`entry ${i} clip runs ${e.end_ms - e.start_ms}ms but the clip is only ${dur}ms long`);
      }
    }
```

direct.ts call site: `checkInvariants(res.data, assetIds, {cutoutIds})` (clipDurations wired in Task 6).

- [ ] **Step 3: Renderer.** In `Reel.tsx` Shot, before the quote_card/KenBurns branch:

```tsx
      {(entry.kind === 'clip' || entry.kind === 'veo') && entry.clip_path ? (
        <OffthreadVideo
          src={staticFile(entry.clip_path)}
          muted={edlHasTrack}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      ) : entry.effects.includes('quote_card') ? (…existing chain…)}
```

Shot gains prop `edlHasTrack: boolean` (passed `edl.audio.track !== null` from Reel); import `OffthreadVideo` from remotion. A clip entry WITHOUT `clip_path` falls through to the still-image branch (degrade). Fixture: give `IMG_009` (index 8) `"kind": "clip", "clip_path": "assets/clips/IMG_009.mp4", "clip_duration_ms": 1000`; fixture.test adds `expect(edl.timeline.some((e) => e.kind === 'clip' && e.clip_path)).toBe(true);`.

- [ ] **Step 4: Suites (renderer + orchestrator) green; commit** `feat(edl): clip entries - schema, duration invariants, video rendering`.

---

### Task 4: Enhance — nano banana grade (Python + stage)

**Files:**
- Create: `analysis/darkroom_analysis/enhance.py`, `analysis/enhance_photos.py`, `analysis/tests/test_enhance.py`, `orchestrator/src/stages/enhance.ts`.
- Modify: `orchestrator/src/pipeline.ts` (export nothing yet), `orchestrator/src/cutout-stages.test.ts` or new `orchestrator/src/enhance.test.ts`.

**Interfaces:**
- Produces: Python `enhance.grade_png(client, photo_path) -> bytes | None` (JPEG bytes actually; name `graded_jpeg`), CLI `enhance_photos.py --photos <dir> --ids a,b,c --out-dir <dir> --cache <dir>` printing JSON `{"enhanced": {"id": "file.jpg" | null}}`, `main(argv, edit_fn=None)`; TS `runEnhance(deps, {photosDir, ids}) -> Promise<Map<string, string>>` (id → `assets/enhanced/<file>`), spawns the CLI.

- [ ] **Step 1: Failing Python tests** (`test_enhance.py`, mirrors test_analyze patterns):

```python
def test_enhances_requested_ids_and_caches(tmp_path):  # edit_fn returns tiny jpeg bytes; second run: counter unchanged
def test_failure_not_cached_and_reports_null(tmp_path)  # edit_fn raises -> {"id": None}; rerun retries (counter grows)
def test_missing_photo_reports_null(tmp_path)
```

Exact bodies follow the test_analyze counters/cache-dir pattern; edit_fn signature `(photo_path) -> bytes|None`; outputs `<out-dir>/<id>.jpg`; cache namespace `enhance`, key `cache.file_key(photo) `, value `{"file": "<id>.jpg"}` only on success.

- [ ] **Step 2: Implement `enhance.py`.**

```python
MODEL = "gemini-3.1-flash-image"
PROMPT = ("Regrade this photo with a warm cinematic film look: richer golden tones, "
          "gentle lifted blacks, subtle grain. Keep composition, subjects, and framing "
          "exactly unchanged.")

def make_client(): …genai.Client(vertexai=True, project=PROJECT, location="global")

def graded_jpeg(client, photo_path):
    from google.genai import types
    resp = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=[
            types.Part.from_text(text=PROMPT),
            types.Part.from_bytes(data=Path(photo_path).read_bytes(), mime_type=mime),
        ])],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    for part in resp.candidates[0].content.parts:
        if part.inline_data and part.inline_data.data:
            return part.inline_data.data
    return None
```

(If `response_modalities=["IMAGE"]` 400s on Vertex for this model, retry without config — decided empirically at E2E; both branches coded, flag constant `_USE_MODALITIES`.) CLI `enhance_photos.py` loops ids, cache-first, failure→null-not-cached, prints the JSON map.

- [ ] **Step 3: TS stage `enhance.ts`** (mirror analyze.ts): spawn `analysis/enhance_photos.py` with `--out-dir` = `<repo>/renderer/public/assets/enhanced`, parse stdout JSON, return Map of successes. Test with recording fake spawnPy that prints a canned map: asserts arg wiring + Map contents + missing entries dropped.

- [ ] **Step 4: Suites green; commit** `feat(enhance): nano-banana cinematic grade stage with cache`.

---

### Task 5: Omni — animate + film (Python + stages)

**Files:**
- Create: `analysis/darkroom_analysis/omni_media.py`, `analysis/animate_clip.py`, `analysis/film_video.py`, `analysis/tests/test_omni_media.py`, `orchestrator/src/stages/animate.ts`, `orchestrator/src/stages/film.ts`, `orchestrator/src/omni-stages.test.ts`.

**Interfaces:**
- Produces: Python `omni_media.mp4_duration_ms(path) -> int | None` (pure mvhd parser); `omni_media.generate_video(client, *, task, prompt, image_paths, out_path, aspect='9:16') -> int|None` (returns duration_ms; downloads URI delivery; interactions API); CLIs: `animate_clip.py --source <img> --prompt <txt> --out <mp4> --cache <dir>` and `film_video.py --refs <csv paths> --prompt <txt> --out <mp4>`, each printing `{"duration_ms": N}` or `{"error": "..."}` with exit 4 on generation failure. TS: `runAnimate(deps, {heroes: {id, motionPrompt, sourcePath}[], outDir}) -> Promise<Map<string, {file: string, durationMs: number}>>` (failures silently dropped); `runFilm(deps, {refPaths, prompt, outPath}) -> Promise<{durationMs: number}>` (throws `PipelineError('film','film_failed')`).

- [ ] **Step 1: Failing Python tests.** `mp4_duration_ms`: build a minimal mp4 header in-test (bytes: `ftyp` box + `moov`>`mvhd` v0 with timescale 1000, duration 6200) → expect 6200; garbage bytes → None. CLI tests with injectable `generate_fn` (same pattern): animate cache hit skips (counter), failure exit 4 + nothing cached; film prints duration.

Exact mvhd fixture bytes:

```python
def _mvhd(timescale=1000, duration=6200):
    body = b"\x00" + b"\x00\x00\x00" + b"\x00"*8 + timescale.to_bytes(4,"big") + duration.to_bytes(4,"big") + b"\x00"*80
    mvhd = (8+len(body)).to_bytes(4,"big") + b"mvhd" + body
    moov = (8+len(mvhd)).to_bytes(4,"big") + b"moov" + mvhd
    ftyp = (16).to_bytes(4,"big") + b"ftyp" + b"isom" + b"\x00\x00\x02\x00"
    return ftyp + moov
```

parser walks top-level boxes to `moov`, then children to `mvhd`, reads version (0: 32-bit fields at offsets 12/16 within box payload; 1: 64-bit) → `duration/timescale*1000`.

- [ ] **Step 2: Implement `omni_media.py`.**

```python
MODEL = "gemini-omni-flash-preview"
def make_client(): …location="global"

def generate_video(client, *, task, prompt, image_paths, out_path, aspect="9:16"):
    from google.genai import types
    inputs = [prompt] + [types.Part.from_bytes(data=Path(p).read_bytes(), mime_type=_mime(p)) for p in image_paths]
    interaction = client.interactions.create(
        model=MODEL,
        input=inputs,
        response_format={"type": "video", "aspect_ratio": aspect},
        video_config={"task": task},
        delivery="uri",
    )
    video = _extract_video(interaction)   # poll interaction until video ready if needed
    _download(video, out_path)            # uri -> authorized GET; inline bytes -> write
    return mp4_duration_ms(out_path)
```

`_extract_video/_download` written against SDK 2.11.0's interaction object (`interaction.outputs` / `output_video`; poll via `client.interactions.get(name=...)` while status is in-progress). These two helpers are finalized against the real response during the E2E step — the CLIs and caching around them are fully testable with `generate_fn` injection regardless.

CLI `animate_clip.py`: cache namespace `clip`, key `file_key(source) + sha1(prompt)`; hit + mp4 exists → print cached duration; else call, save, cache `{"duration_ms": N}`; failure/None → exit 4 `{"error": "no_clip"}` and no cache write. `film_video.py`: no cache, straight call.

- [ ] **Step 3: TS stages.** `animate.ts`: sequential loop over heroes → spawnPy animate_clip; code 0 → Map set `{file: '<id>.mp4', durationMs}`; any nonzero → skip hero (log to stdout capture only). `film.ts`: spawnPy film_video; nonzero → `PipelineError('film', 'film_failed', stdout.slice(0,500))`. Tests in `omni-stages.test.ts` with scripted spawnPy fakes (records args; returns canned JSON / exit 4): animate drops failures + arg wiring incl. cache dir; film throws mapped error.

- [ ] **Step 4: Suites green; commit** `feat(omni): animate + film stages via interactions API python workers`.

---

### Task 6: Pipeline wiring — styles end to end

**Files:**
- Modify: `orchestrator/src/pipeline.ts`, `orchestrator/src/contracts.ts` (StageName, RunMeta.derived), `orchestrator/src/stages/direct.ts`, `orchestrator/src/stages/finalize.ts`, `prompts/director_montage.md`, `orchestrator/src/pipeline.test.ts`, `orchestrator/src/direct.test.ts`, `orchestrator/src/test-fixtures.ts` (omni-less deps default).

**Interfaces:**
- Produces: `runPipeline(opts: {photosDir; track; avoid?; runId?; style?: ReelStyle; enhance?: boolean; deps}, onProgress)`; `StageName` += `'enhance' | 'animate' | 'film'`; `RunResult.assetPaths: Record<string, string>`; `RunMeta.derived: {style, enhance, enhanced: Record<string,string>, clips: Record<string, {file: string; duration_ms: number}>}`; finalize patches `clip_path`/`clip_duration_ms`; `revisePipeline` re-directs with persisted derived info; film revise → `PipelineError('direct','film_no_tweaks')`.

- [ ] **Step 1: Failing tests.** pipeline.test additions (scripted transports + fake spawnPys):
  - live style: queue plan-with-heroes + clip EDL; fake spawnPy answers animate calls with durations; expect direct receives pool view containing `clip: {duration_ms}` (assert via transport call text), finalize output entry has `clip_path: 'assets/clips/img0.mp4'`, `assetPaths.img0 === 'assets/clips/img0.mp4'`? NO — assetPaths maps ENTRY assets to their display source: for a clip-hero the still remains the asset image fallback; keep `assetPaths[id]` = enhanced-or-original STILL path; the clip rides only in clip_path. Assert both.
  - enhance on: fake enhance spawnPy prints `{"enhanced": {"img0": "img0.jpg"}}` → `assetPaths.img0 === 'assets/enhanced/img0.jpg'`, others `assets/imgN.jpg`.
  - film style: transports produce film plan (film_prompt) then NO director call; fake film spawnPy prints duration 11000 → result EDL mode 'narrative', single entry kind 'veo', end_ms 11000, audio.track null, `assetPaths.film === 'assets/clips/film-<runId>.mp4'`.
  - classic default: body without style behaves exactly as before (regression: existing tests untouched pass).

- [ ] **Step 2: Implement.**
  - contracts: `StageName = 'analyze' | 'produce' | 'enhance' | 'animate' | 'film' | 'direct' | 'finalize'`; `RunMeta.derived` as above (default classic/false/{}/{}).
  - pipeline.runPipeline: after produce — if `enhance && style !== 'film'` → onProgress enhance + `runEnhance` (ids = plan.selects); if style live → onProgress animate + `runAnimate` (heroes from plan.hero_shots, sourcePath = enhanced file when present else original); if style film → onProgress film + `runFilm(refs = selects' paths, prompt = plan.film_prompt ?? plan.story.read)` then `finalizeFilm`. Direct receives `clips` map; finalize receives `{enhanced, clips, style, enhance}`.
  - direct.ts: `DirectOptions` gains `clips?: Map<string, {file: string; durationMs: number}>`; selected pool view entries for clip ids gain `clip: {duration_ms}`; `checkInvariants(..., {cutoutIds, clipDurations})`; EDL_RESPONSE_SCHEMA kind enum → `['still','clip']`; director_montage.md: hero rule block (use kind "clip" ONLY for assets whose pool record has `clip`; entry length ≤ clip.duration_ms and 2–4 beats; never two clip entries back-to-back; do NOT put a cutout_pop on a clip entry).
  - finalize.ts: patch per entry — cutout (existing); if `clips` has entry.asset and entry.kind==='clip' → `clip_path: 'assets/clips/'+file, clip_duration_ms`; assemble assetPaths for every timeline asset: enhanced→`assets/enhanced/<id>.jpg` else `assets/<pool file>`; persist meta.derived; write result `assetPaths`. New `finalizeFilm(deps, {runId, plan, mediaPool, durationMs, filmFile, usage})` builds the narrative EDL (fps 30, aspect 9:16, duration=durationMs rounded to frame, beat_grid_ms [], mute_render false, track null) and reuses the same persistence.
  - revise: load meta.derived; rebuild clips Map / enhanced for direct+finalize; if `derived.style === 'film'` throw `PipelineError('direct','film_no_tweaks','film takes can only be re-taken')`.

- [ ] **Step 3: Suites green + build; commit** `feat(pipeline): classic/live/film styles with enhance + asset paths`.

---

### Task 7: Server, API client, UI

**Files:**
- Modify: `renderer/server/workbench-server.mjs` (+test), `renderer/app/src/api.ts`, `renderer/app/src/lib/stage-copy.ts` (+test), `renderer/app/src/screens/CreateScreen.tsx`, `renderer/app/src/screens/ReviewScreen.tsx`, `renderer/app/src/App.tsx` (pass style through another-take), `renderer/app/src/styles.css` (segmented control + switch), `renderer/app/src/components/ExportPanel.tsx` (uses assetPaths — no change if props already receive assets map from ReviewScreen).

**Interfaces:**
- Produces: run body `{track, avoid?, style?, enhance?}` forwarded to pipelineImpl; DELETE also removes `enhanced/<id>.jpg` + `clips/<id>.mp4`; api `runPipeline(track, opts?: {avoid?, style?, enhance?})`; `RunResultPayload.assetPaths?: Record<string,string>`; stage copy for enhance/animate/film; Create screen glass segmented Style control + Enhance switch; ReviewScreen uses `result.assetPaths ?? listAssets fallback`, hides TweaksPanel + song switching when `result.edl.mode === 'narrative'`.

- [ ] **Step 1: Failing tests.** server.test: run with `{track:'auto', style:'film', enhance:true}` → pipelineImpl.run received them (record opts). DELETE test extends: create `enhanced/pic.jpg` + `clips/pic.mp4` → gone after DELETE. stage-copy.test: `copyFor('enhance') === 'Giving your photos the darkroom treatment…'`, animate → 'Bringing a moment to life…', film → 'Directing your film…'; `friendlyError('film_failed')` and `('film_no_tweaks')` friendly strings.

- [ ] **Step 2: Implement.** Server run handler: `const {track='auto', avoid, style='classic', enhance=false} = req.body ?? {};` pass through. DELETE: unlink `join(assetsDir,'enhanced',id+'.jpg')` and `join(assetsDir,'clips',id+'.mp4')` when present. api.ts: types + `runPipeline(track, opts)` (update both call sites: CreateScreen `api.runPipeline(choice, {style, enhance})`; App another-take passes `{avoid, style: lastStyle, enhance: lastEnhance}` — lift `lastRun = {style, enhance}` into App state set by CreateScreen via `onStarted({style, enhance})`). stage-copy additions. CreateScreen: below MusicPicker card, a "The look" glass card:

```tsx
<div className="card">
  <h2>The look</h2>
  <div className="seg" role="radiogroup" aria-label="Style">
    {[['classic','Classic montage','photos cut to the beat'],
      ['live','Live moments','a photo or two comes alive'],
      ['film','AI film','one continuous video — uses more magic']].map(([v,label,sub]) => (
      <button key={v} role="radio" aria-checked={style===v}
        className={style===v ? 'seg-item selected' : 'seg-item'} onClick={() => setStyle(v as ReelStyle)}>
        <span>{label}</span><span className="feel">{sub}</span>
      </button>
    ))}
  </div>
  <label className={'switch-row' + (style==='film' ? ' disabled' : '')}>
    <input type="checkbox" checked={enhance && style!=='film'} disabled={style==='film'}
      onChange={(e) => setEnhance(e.target.checked)} />
    <span>Enhance photos <span className="feel">warm cinematic grade</span></span>
  </label>
</div>
```

CSS: `.seg{display:flex;flex-direction:column;gap:8px}` `.seg-item` = music-card styles reused (extend selector `.music-card, .seg-item {…}` or add composedclass) — implement by giving seg-item the same declarations; `.switch-row` glass row with accent-color safelight checkbox; `.switch-row.disabled{opacity:.45}`. ReviewScreen: replace listAssets-derived map with `result.assetPaths` when present (fallback keeps old behavior); `const filmMode = result.edl.mode === 'narrative';` — when filmMode render only PhoneFrame + another-take card + exportSlot (no TweaksPanel). DevelopingScreen needs no change (copyFor covers new stages).

- [ ] **Step 3: Suites green (renderer incl. server + app libs); commit** `feat(app): style picker + enhance toggle, film review mode, derived-asset cleanup`.

---

### Task 8: Lyria seed script

**Files:**
- Create: `analysis/seed_music.py`, `analysis/tests/test_seed_music.py`.

**Interfaces:**
- Produces: `seed_music.main(argv, predict_fn=None, ingest_fn=None) -> int`; CLI `py -3 analysis/seed_music.py --library audio-library --cache out/cache`. `predict_fn(prompt) -> wav_bytes`; `ingest_fn(wav_path) -> track_record` (default wraps `ingest_audio`'s extract+describe). Writes `lyria_<slug>.wav` ×5, rewrites index.json with previous `lyria_*` entries removed first.

- [ ] **Step 1: Failing tests.** With fake predict (tiny valid WAV bytes via `wave` module writing 1s silence) + fake ingest returning canned records: creates exactly 5 files with expected slugs (`golden_hour`, `feel_good`, `late_night`, `cinematic`, `lofi`); index.json contains the 5 + preserves a pre-existing non-lyria entry; re-run replaces lyria entries (still 5, no dupes).

- [ ] **Step 2: Implement.** PROMPTS list of 5 `{slug, prompt}` (warm golden-hour acoustic guitar, sunny feel-good indie pop, moody late-night r&b, sweeping cinematic strings, minimal lofi beat — each ~90-100 BPM phrasing in prompt for montage comfort). Default predict_fn: Vertex `:predict` on `lyria-002` (`instances:[{prompt}]`, `parameters:{sample_count:1}`), decode `predictions[0].bytesBase64Encoded` (fallback key `audioContent`). Default ingest_fn: reuse `ingest_audio.py` main via import with `--describe`.

- [ ] **Step 3: pytest green; commit** `feat(music): lyria seed script - 5-track house library`.

---

### Task 9: Full verification + live E2E

- [ ] **Step 1:** All suites + builds green (pytest / orchestrator vitest+tsc / renderer tsc+vitest).
- [ ] **Step 2:** Seed the real library: `py -3 analysis/seed_music.py --library audio-library --cache out/cache` → 5 tracks in the app's song list with moods.
- [ ] **Step 3:** Restart server; run one reel per style via the app: classic+enhance (enhanced/*.jpg appear, reel uses them), live (a hero clip plays muted inside the beat cut), film (single continuous take with omni audio; review shows no tweaks). Finalize `_extract_video/_download`/`response_modalities` details against real responses here — they're isolated in `omni_media.py`/`enhance.py`.
- [ ] **Step 4:** Export at least the live reel to MP4 and play it. Update memory + commit any adjustments.

## Self-Review

- Spec §1→T1, §2→T7, §3→T2/T5/T6, §4→T2/T6, §5→T3, §6→T4, §7→T5, §8→T8, §9→T7, §10→every task + T9. No gaps.
- Names consistent: `ReelStyle`, `runEnhance/runAnimate/runFilm`, `assetPaths` (TS camel) vs run-record JSON `asset_paths`? — DECISION: TS field `assetPaths`, serialized as-is; api.ts type matches `assetPaths`. (Server passes RunResult through untouched, so the wire name is `assetPaths`.)
- Empirical seams called out (thinkingLevel, response_modalities, interactions response shape) are isolated in single functions with both branches coded; everything around them is fake-injected and fully tested.
