# PRD — "Darkroom" : Autonomous Reel Generation Pipeline

**Version:** 1.0 · **Owner:** AmritJain0442 · **Status:** Draft for build
**One-liner:** Dump photos/videos into a folder → receive a finished, stylized Instagram Reel (with music, motion, generated clips, and typography) on Telegram for one-tap approval.

---

## 1. Problem

The owner is a photographer producing strong stills but struggling to consistently convert them into Reels. Manual editing (CapCut/Premiere) costs 45–90 min per reel and requires editorial decisions (which photos, what order, what music, what style) that create friction and inconsistency. Posting frequency suffers, which suppresses reach.

## 2. Goal

A zero-input pipeline: the **only** human actions are (a) dumping media into a folder and (b) tapping ✅ / 🔁 / ❌ on the finished reel. Everything else - curation, story detection, mode selection, music matching, motion design, text, captions, hashtags - is decided and executed by the system.

### Non-goals (v1)
- Multi-user / SaaS. This is a single-operator personal tool.
- Auto-posting without approval (API posting is v2, behind the approve button).
- Using trending/licensed Instagram audio inside the pipeline (legal risk; see §6.4).
- A web UI. Telegram bot is the entire interface.

## 3. User & core flow

Single user (the photographer).

```
1. User drags 10–60 files into GCS `inbox/<batch>/` (or a synced Drive folder)
2. System waits for dump to complete (debounce), then:
   triage → story detection → mode + duration + track selection
   → edit decision list → render (incl. Veo clips + typography)
3. Telegram bot delivers: MP4 + caption + hashtags
4. User taps: ✅ approve · 🔁 regenerate (different interpretation) · ❌ discard
```

Target latency: **≤ 15 minutes** dump-to-delivery (≤ 25 min if Veo clips are generated).

## 4. Features

### F1 — Ingest & triage
- Watch `inbox/` (Eventarc); debounce 5 min after last object write, or a `done` sentinel / bot command "make it".
- Accept JPG/PNG/HEIC/RAW-preview, MP4/MOV. Extract EXIF (timestamp, GPS, lens).
- Deterministic pre-filter: perceptual-hash dedup, blur/exposure rejection (OpenCV). Cheap filters run **before** any LLM call.
- Videos: scene-split (PySceneDetect), transcode scenes to uniform mezzanine format, score each scene.

### F2 — Producer (the autonomous brain)
One multimodal Gemini call over the surviving media pool + EXIF that returns a single `production_plan.json` (schema in Tech Spec §4):
- **Story read:** event / trip / aesthetic series / portrait set / mixed; recurring subjects; time or location progression.
- **Mode selection:** `montage` | `narrative` | `edit` (rules in Tech Spec §5).
- **Duration selection:** 7 / 15 / 30 s based on quantity of A-grade material. Prefer shorter and denser.
- **Track selection:** mood-embedding match against the local pre-analyzed audio library.
- **Hero shot selection:** 1–2 images flagged for Veo motion generation (F4).
- **Rejects with reasons** (for the bot's transparency report).
- All Producer intelligence lives in a **prompt file**, not code. Iteration = editing the prompt.

### F3 — Directors (3 modes, 1 output contract)
Each mode is a system prompt that consumes the production plan + beat grid and emits a validated **EDL JSON** (Tech Spec §6):
- **Montage:** 10–15 shots, cuts snapped to downbeats, ordering by visual rhythm (color flow, wide→tight alternation).
- **Narrative:** story arc (hook ≤ 1.5 s, build, payoff), semantic shot order, per-shot on-screen text, optional Cloud TTS voiceover, slower holds.
- **Edit:** sub-beat cuts, speed-ramped motion, flash frames, shake/whip transitions, density mapped to the track's energy/onset curve.

### F4 — Generative motion (Veo image-to-video)
- For flagged hero shots, call **Veo on Vertex AI** (image-to-video) to generate a 4–8 s clip from the still (subtle parallax, atmosphere, camera drift — prompt written by the Producer per shot, matched to the reel's mood).
- Generated clips are treated as normal video entries in the EDL.
- Guardrails: max 2 Veo clips per reel (cost/latency); always keep the original still as fallback if generation fails or output is off-brand (Gemini QC pass judges the generated clip before use).
- v1 ships with Veo behind a config flag; enable once F1–F3+F6 are stable.

### F5 — Stylized typography system
On-screen text is a first-class design element, not an afterthought:
- 4–6 pre-built **type styles** in the renderer (e.g. `caption_lower` minimal lowercase, `editorial_serif` large serif with letter-spacing animation, `kinetic_word` word-by-word beat-synced pops, `location_stamp` GPS-derived corner tag, `vhs_timestamp`).
- Directors choose style + timing per text element; renderer owns fonts, safe areas (respect IG UI margins: ~12% top, ~20% bottom, ~10% right), animation curves.
- All copy written by the Director in the owner's voice (few-shot examples in prompt from owner's past captions).

### F6 — Renderer
- **Remotion** (React) rendering 1080×1920 @ 30fps H.264, executed as a **Cloud Run Job** in a container.
- One React component per EDL primitive: `<KenBurns>`, `<BeatCut>`, `<WhipTransition>`, `<FlashFrame>`, `<SpeedRamp>`, `<Grain>`, `<TypeStyle.*>`, `<VeoClip>`.
- EDL is validated (Zod) before render; invalid EDL → one automatic repair round-trip to the Director → hard fail to bot with error.

### F7 — Delivery & approval (Telegram bot)
- Sends MP4 + auto-written caption + hashtags + a 1-line "why" (mode chosen, story read, track).
- Buttons: ✅ approve (v1: marks approved + moves MP4 to `approved/`; v2: publishes via Instagram Graph API) · 🔁 regenerate (re-runs Producer with "different interpretation", reusing cached analysis — target < 3 min) · ❌ discard.
- Bot also accepts commands: `make it`, `status`, `mode narrative` (optional override — the escape hatch, not the default path).

### F8 — Captions & hashtags
Producer writes 2 caption options (short punchy / longer storytelling) + 15–20 hashtags mixed head/mid/niche, in the owner's voice.

## 5. Success metrics
- **Time-to-reel:** ≤ 15 min p50, ≤ 25 min with Veo.
- **Approval rate:** ≥ 60% of first renders approved without 🔁 by week 4 of usage.
- **Cost:** ≤ ₹60 (~$0.70) per delivered reel including Veo; ≤ ₹15 without.
- **Posting cadence:** owner posts ≥ 3 reels/week within a month of v1.

## 6. Risks & mitigations
1. **Generic-looking output.** Mitigate with 3–4 strong per-mode "recipes", the typography system, and Veo hero clips. Review outputs weekly; iterate on prompts, not code.
2. **LLM emits invalid EDL.** Zod validation + one auto-repair loop + hard-fail path.
3. **Veo cost/latency/quality variance.** Cap 2 clips/reel, QC pass, still-image fallback, config flag.
4. **Music licensing.** Pipeline uses only the owned royalty-free library. If the owner wants a trending IG sound, the renderer supports a `--no-audio` output whose cuts are synced to a beat grid extracted from that sound; audio is added in the IG app. Never bundle licensed audio into rendered files.
5. **Premature trigger on partial dumps.** Debounce + sentinel + bot command.
6. **Bad reel auto-posted.** Approval gate is mandatory in v1; auto-post only behind explicit per-reel ✅.

## 7. Milestones
- **M0 (wk 1):** Remotion project; hand-written EDL renders a montage locally with `<KenBurns>` + beat cuts + 2 type styles. *Proves the hardest part.*
- **M1 (wk 2):** librosa beat/energy extraction; Gemini media analysis; Montage Director; local folder→reel works end-to-end.
- **M2 (wk 3):** GCP deploy (Eventarc, Cloud Run service + Job, Firestore state), Telegram bot with ✅/🔁/❌.
- **M3 (wk 4):** Narrative + Edit Directors; typography styles 3–6; caption/hashtag generation.
- **M4 (wk 5):** Video ingestion (scene split/scoring); Veo integration behind flag + QC pass.
- **M5 (wk 6):** Polish: regen loop speed, cost logging, prompt iteration from first 20 real reels.

## 8. Open questions for owner
1. Which royalty-free music source (Artlist / Epidemic / free libraries) — affects library ingestion tooling.
2. Instagram account type (Business/Creator + linked FB page?) — gates v2 auto-publish.
3. Brand kit: fonts, color accents, watermark/logo? Renderer should encode these once.
4. RAW files in dumps, or only exported JPGs? (RAW support adds a conversion step.)
