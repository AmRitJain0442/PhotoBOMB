# Tech Spec — "Darkroom" Autonomous Reel Pipeline

Companion to PRD v1.0. Audience: implementing developer. Stack: **TypeScript (Remotion, orchestrator) + Python (media analysis) + GCP.**

---

## 1. Architecture

```
GCS inbox/<batch>/  ──Eventarc──▶  Orchestrator (Cloud Run service, TS)
                                        │  debounce 5 min / sentinel
                                        ▼
                        ┌── Analysis workers (Python, Cloud Run) ──┐
                        │  • phash dedup, blur/exposure (OpenCV)   │
                        │  • EXIF extraction                       │
                        │  • PySceneDetect + ffmpeg mezzanine      │
                        │  • librosa: beat grid, BPM, energy curve │
                        │  • Gemini (Vertex): per-media analysis   │
                        └───────────────────┬──────────────────────┘
                                            ▼  media_pool.json (cached in GCS)
                                    Producer (1 Gemini call)
                                            ▼  production_plan.json
                                    Director (mode prompt, Gemini)
                                            ▼  edl.json ── Zod validate ──▶ repair loop (×1)
                                            ▼
                    [optional] Veo image-to-video (Vertex) + Gemini QC
                                            ▼
                            Remotion render (Cloud Run Job, Docker)
                                            ▼
                    outputs/<batch>/reel.mp4 + meta.json ──▶ Telegram bot
                                            ▼
                              ✅ approved/   🔁 regen   ❌ discard
```

State machine per batch in **Firestore**: `INGESTING → ANALYZING → PLANNING → DIRECTING → GENERATING → RENDERING → DELIVERED → APPROVED|REGEN|DISCARDED|FAILED`. Bot `status` command reads this.

## 2. GCP services

| Concern | Service | Notes |
|---|---|---|
| Storage | GCS | `inbox/`, `mezzanine/`, `cache/` (analysis JSON), `outputs/`, `approved/`, `audio-library/` |
| Trigger | Eventarc → Cloud Run | object-finalize on `inbox/`; debounce via Cloud Tasks (schedule T+5 min, cancel/reschedule on each new object) |
| Orchestrator | Cloud Run service | TS/Node. Also hosts Telegram webhook |
| Heavy analysis | Cloud Run service (Python) | OpenCV, librosa, PySceneDetect, ffmpeg in image |
| LLM + Veo | Vertex AI | `gemini-2.5-flash` default; `gemini-2.5-pro` for Narrative Director only if Flash underperforms. Veo: current image-to-video model on Vertex (check model garden for latest id at build time) |
| Render | Cloud Run **Job** | 4 vCPU / 8 GB, Remotion + headless Chrome in Docker. 25 s reel ≈ 2–5 min |
| Voiceover | Cloud TTS | Chirp3 voices, only in narrative mode when plan requests it |
| State | Firestore | batch status, cost log per batch |
| Secrets | Secret Manager | Telegram token, (v2) IG Graph token |

**Caching rule:** every analysis artifact (per-file Gemini output, beat grids, phash) is written to `cache/` keyed by content hash. 🔁 regeneration must reuse all of it — regen re-runs only Producer→Director→render.

## 3. Media analysis contracts

Per-file Gemini analysis (batched, many images per call):

```jsonc
// media_pool.json — one entry per surviving asset
{
  "id": "IMG_2041",
  "uri": "gs://.../inbox/b12/IMG_2041.jpg",
  "type": "still" | "clip",
  "exif": { "ts": "2026-06-21T18:42:11+05:30", "gps": [26.91, 75.79] },
  "analysis": {
    "aesthetic_score": 0-10,
    "description": "…",
    "subject": "…",
    "subject_bbox": [x, y, w, h],       // normalized; drives Ken Burns focal point & 9:16 smart crop
    "dominant_colors": ["#hex", …],
    "mood_tags": ["warm", "nostalgic"],
    "energy": "low|mid|high",
    "orientation": "landscape|portrait",
    "quality_flags": ["slight_blur"]     // from OpenCV pass, merged here
  },
  // clips only:
  "clip": { "src_video": "…", "in_ms": 4200, "out_ms": 7100, "has_motion": true }
}
```

`subject_bbox` is mandatory — without it, 9:16 crops of landscape shots zoom into elbows.

## 4. `production_plan.json` (Producer output)

```jsonc
{
  "story": {
    "read": "One-evening rooftop shoot in Jaipur; light progresses golden→blue.",
    "type": "event",                      // event|trip|aesthetic_series|portrait_set|mixed
    "arc_possible": true
  },
  "mode": "narrative",                    // montage|narrative|edit
  "duration_ms": 15000,
  "selects": ["IMG_2041", "IMG_2044", …], // ordered pool of candidates (Director does final order)
  "rejects": [{ "id": "IMG_2050", "reason": "duplicate of 2049, lower sharpness" }],
  "hero_shots": [
    { "id": "IMG_2044", "veo_prompt": "subtle parallax push-in, dust motes in golden backlight, gentle wind in fabric, cinematic, no new objects" }
  ],
  "audio": { "track_id": "lib_037", "reason": "82 BPM, warm/nostalgic embedding match 0.91", "trim_start_ms": 8200 },
  "typography_direction": "editorial_serif, sparse, lowercase english + one devanagari accent word",
  "voiceover": null,                      // or { "script": "…", "voice": "chirp3-…" }
  "captions": { "short": "…", "long": "…" },
  "hashtags": ["…", …]
}
```

## 5. Mode selection heuristics (encoded in Producer prompt)

- `arc_possible && (time or location progression) && ≥6 A-grade assets` → **narrative**
- cohesive mood/color but no progression → **montage**
- `≥30% clips with motion` OR high-energy mood OR high-contrast urban/action set → **edit**
- Duration: `<8 A-grade assets → 7s`, `8–14 → 15s`, `15+ → 30s`. Bias short.
- Ties → montage (safest), and 🔁 regen instruction forces the next-best alternative interpretation.

## 6. `edl.json` (Director output — THE core contract)

```jsonc
{
  "mode": "edit",
  "aspect": "9:16",
  "fps": 30,
  "duration_ms": 15000,
  "audio": {
    "track": "gs://…/audio-library/lib_037.mp3",
    "trim_start_ms": 8200,
    "beat_grid_ms": [0, 366, 732, …],
    "voiceover": null,
    "mute_render": false                  // true = trending-sound workflow (cuts synced, no audio baked)
  },
  "timeline": [
    {
      "asset": "IMG_2041",                // resolved to uri by renderer; may be a veo output
      "kind": "still" | "clip" | "veo",
      "start_ms": 0, "end_ms": 1830,
      "motion": {
        "type": "ken_burns",
        "from": { "zoom": 1.0, "cx": 0.5, "cy": 0.42 },
        "to":   { "zoom": 1.18, "cx": 0.55, "cy": 0.45 },
        "easing": "easeOutCubic"
      },
      "speed": 1.0,                        // clips only; supports ramps: [{at_ms, rate}]
      "transition_out": { "type": "whip_pan", "duration_ms": 160 },
      "effects": ["film_grain"],
      "text": {
        "content": "golden hour",
        "style": "kinetic_word",
        "in_ms": 400, "out_ms": 1600,
        "anchor": "lower_third"
      }
    }
  ]
}
```

**Closed vocabularies (enforce with Zod enums; Director prompt lists them explicitly):**
- `motion.type`: `ken_burns | static | parallax`
- `transition.type`: `cut | crossfade | whip_pan | flash_white | flash_black | zoom_punch | slide`
- `effects`: `film_grain | vignette | chromatic_ab | vhs | bw`
- `text.style`: `caption_lower | editorial_serif | kinetic_word | location_stamp | vhs_timestamp | none`
- `anchor`: `lower_third | center | upper_safe | corner_br` (renderer maps to IG-safe areas: keep text inside 12% top / 20% bottom / 10% right margins)

**Validation:** Zod parse → on failure, send errors back to Director with "fix and re-emit JSON only" (max 1 retry) → hard fail to bot with the Zod message.

**Hard invariants the renderer must also assert:** timeline covers [0, duration] with no gaps/overlaps; every cut in montage/edit mode within ±33 ms of a beat_grid entry (edit mode may also use half-beats); every referenced asset exists.

## 7. Veo integration

1. Producer flags ≤2 hero stills with a per-shot `veo_prompt` (motion only — instruct "no new objects/people; preserve composition").
2. Orchestrator calls Vertex Veo image-to-video (input: still + prompt; request 4–8 s, 9:16 if supported, else generate wider and center-crop via subject_bbox).
3. **QC pass:** send the generated clip to Gemini: "does this preserve the subject, avoid artifacts/warping/extra limbs, match mood X? PASS/FAIL + reason." FAIL → use the original still with ken_burns fallback (Director's EDL must always include the fallback motion spec for hero entries).
4. Store generated clips in `cache/veo/` keyed by (image hash + prompt hash) — regens must not regenerate.
5. Config: `VEO_ENABLED`, `VEO_MAX_CLIPS=2`, per-batch cost ceiling. Log cost per batch to Firestore.

## 8. Remotion renderer

- Project layout: one `<Reel>` composition; maps EDL timeline → `<Sequence>` per entry; `<TransitionSeries>` for transitions.
- Components to build: `KenBurns` (transform interpolation from motion spec, focal point = subject_bbox center), `SmartCrop` (9:16 from bbox), `WhipPan`, `FlashFrame`, `ZoomPunch`, `SpeedRamp` (clips), `Grain/Vignette/VHS` (overlay assets, not CSS filters — cheaper), `VeoClip` (`<OffthreadVideo>`), and the 5 `TypeStyle` components.
- Fonts: self-host in the container (license-check any commercial font). Brand kit (fonts/colors/watermark) in a single `theme.ts`.
- Local dev: `npx remotion studio` with fixture EDLs in `fixtures/` — this is the primary design-iteration loop; keep 1 golden fixture per mode and eyeball on every renderer change.
- Prod: Docker image with node + chrome-headless-shell; Cloud Run Job invoked with `{edl_uri, out_uri}`; render via `@remotion/renderer` `renderMedia()`; concurrency = vCPUs.
- Output: H.264 high profile, CRF ~18, 1080×1920, AAC 192k (unless `mute_render`).

## 9. Audio library

- One-time ingest script: for each track → librosa `beat_track` + onset envelope + RMS energy curve; Gemini text-embedding of a mood description; store `audio-library/index.json`.
- Producer matches pool mood → track via embedding cosine similarity, filtered by BPM range per mode (montage 70–100, narrative 60–90, edit 100–140 as defaults).
- Licensing rule (hard): only tracks the owner has license to redistribute inside rendered video. Trending IG sounds: `mute_render=true` path only.

## 10. Telegram bot

- Webhook on orchestrator. Sends MP4 (≤50 MB bot limit — 15–30 s 1080p H.264 is fine), caption options, hashtags, and the Producer's one-line "why".
- Inline buttons → callback → Firestore state change. 🔁 passes `{regen: true, avoid: {mode, track_id}}` to Producer.
- Optional overrides: `mode edit`, `track lib_042`, `text off` as message commands.

## 11. Cost & latency budget (per 15 s reel, order-of-magnitude)

| Step | Latency | Cost |
|---|---|---|
| Analysis (40 photos, Flash, batched) | 1–2 min | ~$0.03–0.08 |
| Video scene analysis (if any) | 2–5 min | ~$0.05–0.30 |
| Producer + Director calls | <1 min | ~$0.01–0.05 |
| Veo ×2 clips | 2–8 min | ~$0.20–0.50 (verify current pricing) |
| Render (Cloud Run Job) | 2–5 min | ~$0.01–0.03 |

Log actuals per batch; alert if a batch exceeds 2× budget.

## 12. Failure handling

- Any stage failure → Firestore `FAILED` + bot message with stage + human-readable reason.
- Veo failure → silent fallback to still (log it).
- Render failure → retry once; then deliver EDL + error to bot for manual inspection.
- Poison batches (repeat failures) → move to `quarantine/`, never auto-retry forever.

## 13. Build order

Mirrors PRD milestones M0–M5. Rule of thumb throughout: **intelligence goes in prompt files (`prompts/producer.md`, `prompts/director_{mode}.md`), determinism goes in code.** If you're writing complex heuristics in TS/Python that a prompt could own, stop and move it to the prompt; if the LLM is doing something a library does deterministically (dedup, beat detection, validation), move it to code.
