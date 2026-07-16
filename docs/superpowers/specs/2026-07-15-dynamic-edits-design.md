# Dynamic Edits: Duotone Quotes + Cutout Transitions — Design

Date: 2026-07-15. Extends M1 (spec `2026-07-14-m1-intelligence-pipeline-design.md`, built on `feature/m1-pipeline`). User decisions: poetic lines about the user's own photos; overlay or dedicated card at the Director's choice; real cutouts via Gemini segmentation masks; "signature moments" energy (2–3 cutout pops per reel).

Hard constraints carried over: only Gemini/Google models; no pipeline jargon in user-facing copy; one contract (the EDL) drives both preview and export.

## 1. Goal

Two upgrades to the edit itself:

1. **Auto-generated quotes** — Gemini writes 1–2 short poetic lines grounded in the actual photos, rendered as a duotone (white + yellow) typographic moment with per-word emphasis (bold, underline, tone switch).
2. **Cutout transitions** — at 2–3 high-energy beats, the outgoing photo's subject pops out as a real cutout (transparent PNG from a Gemini segmentation mask) over the incoming photo.

## 2. Segmentation (analysis layer)

New module `analysis/darkroom_analysis/segment.py`:

- `cutout_png(client, photo_path, subject, subject_bbox) -> bytes | None` — one Gemini call (`gemini-2.5-flash`, structured JSON with `box_2d` + base64 `mask` per Google's segmentation output format) asking for a mask of the photo's known main subject. Composite mask over the photo → RGBA PNG cropped to the mask's bounding box (plus small padding).
- **Quality gate:** returns `None` (no cutout) when the model returns no mask, or mask area < 3% or > 90% of the frame.
- Caching: keyed by `cache.file_key(photo)` in namespace `cutout`. The cache stores `{has_cutout, box}` metadata; the PNG itself is written to `renderer/public/assets/cutouts/<photoId>.png`. A cache hit with an existing PNG skips the API entirely.

`analyze_media.py` changes:

- New required arg `--cutouts <dir>` (the pipeline passes `renderer/public/assets/cutouts`).
- After vision analysis, run segmentation for every survivor (injectable `segment_fn` for tests, same pattern as `analyze_fn`).
- Each pool entry gains `"has_cutout": true|false`.

## 3. Producer (plan contract)

`ProductionPlanSchema` gains a required `quote`:

```ts
const SpanSchema = z.object({
  text: z.string().min(1),
  bold: z.boolean().default(false),
  underline: z.boolean().default(false),
  tone: z.enum(['white', 'yellow']).default('white'),
});
quote: z.object({lines: z.array(z.array(SpanSchema).min(1)).min(1).max(2)});
```

`prompts/producer.md` additions: write 1–2 short lines (≤ 6 words each) grounded in what is visibly in the photos — never generic filler; emphasize 2–4 words total across the quote via `bold`/`underline`; use `tone: "yellow"` on exactly one word or contiguous phrase (the emotional center); everything else stays white.

## 4. Director + EDL schema

Three vocabulary extensions in `renderer/src/edl/schema.ts`:

1. `TransitionTypeEnum` adds `'cutout_pop'`.
2. `TextStyleEnum` adds `'quote_duotone'`; `TextSchema` gains optional `spans: z.array(SpanSchema)`. Zod keeps `spans` optional for every style; when a `quote_duotone` entry has no spans the renderer draws `content` as a single white unemphasized line (this is exactly what a hand-edited quote becomes). `content` always remains the plain-text join and the edit target.
3. `EffectEnum` adds `'quote_card'` (photo becomes a darkened backdrop for the quote).
4. `TimelineEntrySchema` gains optional `cutout: z.string()` — the cutout PNG path, **patched by finalize**, never written by the Director.

`prompts/director_montage.md` additions:

- The quote appears **exactly once** per reel: either `quote_duotone` text overlaid on the calmest/most fitting photo, or the same style on an entry carrying `effects: ["quote_card"]` (dedicated card) — Director's choice based on how busy the set is. Copy the plan's `quote.lines` into `text.spans` verbatim (flattened, with a `text: "\n"` span between lines); `content` = plain-text join.
- Place **2–3** `transition_out: {type: "cutout_pop", duration_ms: 400}` on cuts landing at high points of the energy curve; only on entries whose pool record has `has_cutout: true`; never two pops in a row.
- Give the quote entry 2–4 beats of screen time; quote text window covers most of the entry.

**Validation:** `checkInvariants` gains an optional third argument `cutoutIds: Set<string>`; a `cutout_pop` out of an entry whose asset is not in the set is a violation (fed into the existing single repair retry). The direct stage passes the set from the media pool.

**Finalize:** for every entry with a `cutout_pop` transition, set `entry.cutout = "assets/cutouts/<assetId>.png"` (same patch pattern as `audio.track`).

**Server:** `DELETE /api/assets/:file` also removes `public/assets/cutouts/<id>.png` when present. No other endpoint changes.

## 5. Renderer

Two components in `renderer/src/`:

- **`QuoteDuotone`** (new TypeStyle): spans render large, centered in the IG-safe area, white `#f5efe6` default; `tone: "yellow"` → `#ffd84d` (vivid pop, deliberately NOT the muted UI amber); `bold` → weight 800; `underline` → 6px hand-drawn-feel underline offset below the word. Words reveal sequentially (stagger ≈ 80 ms, fade + 12px rise) across the first third of the text window; fully visible thereafter; exits with the window. Reduced motion not applicable (video render), but the reveal must be deterministic frame math like the other type styles.
- **`quote_card` effect** (in the entry renderer): photo drawn at brightness ≈ 0.35 with a slight slow zoom; quote renders above it. No other effects change.
- **`CutoutPop`** transition: an overlay `Sequence` spanning ±200 ms around the cut. The outgoing entry's `cutout` PNG originates at the outgoing entry's `motion.to` focal point (`cx`, `cy` — which the Director already aims at the subject) at scale 1.0, scales to ≈ 1.6 with ≈ 6° rotation drifting toward frame center, and eases out after the cut while the incoming entry runs beneath (incoming gets a subtle 1.04 → 1.0 settle). If the outgoing entry has no `motion`, the pop originates at frame center. If `cutout` is missing at render time the transition degrades to a hard cut (never crashes).
- `ReelProps` unchanged — cutout paths ride inside the EDL (`entry.cutout`), resolved via `staticFile` like everything else.

## 6. Review screen behavior

- `listTexts` includes the quote entry (its plain `content`). Rewording it replaces `spans` with a single white unemphasized span — emphasis is the model's job; a hand-edited quote goes plain. Clearing it removes the overlay (existing behavior).
- Song switch / photo removal / another take are untouched; revise re-runs the Director, which re-validates cutout rules automatically.

## 7. Testing

- **Python** (`test_segment.py`, extend `test_analyze.py`): quality gate rejects tiny/huge/absent masks; accepted mask produces a PNG with a real alpha channel; cache hit skips `segment_fn` (call counter); pool entries carry `has_cutout`.
- **Orchestrator**: plan schema accepts/rejects quote spans (missing quote, > 2 lines, bad tone); invariants flag `cutout_pop` from a non-cutout asset; repair loop fixes it; finalize patches `entry.cutout` paths.
- **Renderer** (vitest): fixture EDL updated with one `quote_duotone` entry + one `cutout_pop`; schema round-trips; `edl-tweaks` reword-quote produces a single white span and stays schema-valid.
- **Live E2E**: fresh run on the sunset set — verify quote renders duotone with emphasis, 2–3 cutout pops land on beats, export MP4 plays.

## 8. Out of scope

Full Tech Spec §6 "edit mode" (whip pans, speed ramps, half-beat cuts), per-word manual emphasis editing in the UI, cutouts for photos without a confident mask, animated quote cards beyond the darkened-photo treatment.
