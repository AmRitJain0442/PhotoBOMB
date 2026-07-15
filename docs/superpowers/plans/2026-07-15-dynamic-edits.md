# Dynamic Edits (Duotone Quotes + Cutout Transitions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every reel gets one Gemini-written duotone (white/yellow) quote with per-word emphasis, and 2–3 "cutout pop" transitions where the outgoing photo's subject (a real transparent PNG cut by a Gemini segmentation mask) pops over the incoming photo.

**Architecture:** Extend the existing single-contract pipeline (spec `docs/superpowers/specs/2026-07-15-dynamic-edits-design.md`, Approach A): the analysis layer grows a segmentation step that caches cutout PNGs under `renderer/public/assets/cutouts/`; the Producer plan gains a required structured `quote`; the EDL vocabulary gains `cutout_pop` / `quote_duotone` (+`spans`) / `quote_card` / `entry.cutout`; the renderer draws all three; finalize patches cutout paths the same way it pins the audio track.

**Tech Stack:** Python (PIL/numpy, google-genai on Vertex), TypeScript + zod 3, Remotion, vitest, pytest, Express.

## Global Constraints

- **Only Gemini/Google models, ever.** Segmentation uses `gemini-2.5-flash` on Vertex (project `project-a2dcdad0-5d65-4d61-846`, `us-central1`) via the existing `google-genai` client.
- No pipeline jargon in any user-facing copy.
- One contract: the EDL drives both preview and export; renderer degrades gracefully (missing cutout → hard cut; missing spans → single white line).
- Microcommits (CLAUDE.md): commit at the end of every task, sometimes mid-task as marked.
- Windows: Python is `py -3`; PowerShell 5.1 has no `&&` — run chained commands separately.
- Never touch `my-product-sa-key.json`, `claude.md`, or `GCP_MODELS_USAGE.md` at repo root.
- Cross-package rule: relative imports inside `renderer/src/edl/*` need `.js` extensions (orchestrator consumes them as ESM).
- Quote colors are fixed: white `#f5efe6`, yellow `#ffd84d` (NOT the UI amber `#e8b04b`).

**Test commands** (all from repo root unless noted):
- Python: `py -3 -m pytest analysis/tests -q`
- Orchestrator: `cd orchestrator` then `npx vitest run` (build: `npm run build`)
- Renderer + app: `cd renderer` then `npx vitest run`

---

### Task 1: Segmentation module (`segment.py`)

**Files:**
- Create: `analysis/darkroom_analysis/segment.py`
- Test: `analysis/tests/test_segment.py`

**Interfaces:**
- Produces: `segment.cutout_png(client, photo_path, subject, subject_bbox) -> bytes | None` (Task 2 calls it), plus pure helpers `segment.first_mask(response_text) -> (box_2d, mask_bytes) | None` and `segment.compose_cutout(photo_path, box_2d, mask_png_bytes) -> bytes | None`.
- Consumes: `gemini_vision.make_client()` (existing).

- [ ] **Step 1: Write the failing tests**

Create `analysis/tests/test_segment.py`:

```python
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from darkroom_analysis import segment  # noqa: E402


def _photo(tmp_path, size=(200, 200)):
    rng = np.random.default_rng(1)
    arr = rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)
    p = tmp_path / "photo.jpg"
    Image.fromarray(arr).save(p)
    return str(p)


def _mask_png(w, h, fill=255):
    buf = io.BytesIO()
    Image.new("L", (w, h), fill).save(buf, format="PNG")
    return buf.getvalue()


def test_compose_produces_cropped_rgba_cutout(tmp_path):
    photo = _photo(tmp_path)
    # box covers the middle 50% x 50% of the frame -> 25% area, inside the gate
    png = segment.compose_cutout(photo, [250, 250, 750, 750], _mask_png(100, 100))
    assert png is not None
    img = Image.open(io.BytesIO(png))
    assert img.mode == "RGBA"
    assert img.size[0] < 200 and img.size[1] < 200  # cropped to the subject
    alpha = np.asarray(img)[:, :, 3]
    assert alpha.max() == 255 and alpha.min() == 0  # real transparency


def test_gate_rejects_tiny_mask(tmp_path):
    photo = _photo(tmp_path)
    # 20x20 px box on 200x200 -> 1% area
    assert segment.compose_cutout(photo, [0, 0, 100, 100], _mask_png(20, 20)) is None


def test_gate_rejects_huge_mask(tmp_path):
    photo = _photo(tmp_path)
    # full-frame box -> 100% area
    assert segment.compose_cutout(photo, [0, 0, 1000, 1000], _mask_png(50, 50)) is None


def test_first_mask_parses_and_strips_data_uri():
    mask_b64 = base64.b64encode(_mask_png(4, 4)).decode()
    text = json.dumps(
        [{"box_2d": [1, 2, 3, 4], "mask": f"data:image/png;base64,{mask_b64}", "label": "dog"}]
    )
    box, mask = segment.first_mask(text)
    assert box == [1, 2, 3, 4]
    assert mask == base64.b64decode(mask_b64)


def test_first_mask_absent_or_malformed():
    assert segment.first_mask("[]") is None
    assert segment.first_mask("not json") is None
    assert segment.first_mask(json.dumps([{"box_2d": [1, 2], "mask": "x"}])) is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `py -3 -m pytest analysis/tests/test_segment.py -q`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` for `segment`.

- [ ] **Step 3: Implement `segment.py`**

Create `analysis/darkroom_analysis/segment.py`:

```python
"""Gemini segmentation -> transparent cutout PNGs (spec 2026-07-15 §2).

cutout_png() makes ONE Gemini call for a photo's known main subject and
returns RGBA PNG bytes cropped to the subject, or None when there is no
usable mask (quality gate: mask must cover 3%-90% of the frame). The pure
helpers (first_mask, compose_cutout) carry the logic and are unit-tested;
the API wrapper stays thin, like gemini_vision.analyze_batch.
"""

import base64
import io
import json
import mimetypes
from pathlib import Path

import numpy as np
from PIL import Image

MODEL = "gemini-2.5-flash"
MIN_AREA_FRAC = 0.03
MAX_AREA_FRAC = 0.90
MASK_THRESHOLD = 127
PAD_PX = 16

_PROMPT = (
    "Give the segmentation mask for the {subject} (the photo's main subject; "
    "its approximate bounding box is {bbox}, normalized 0-1). Output a JSON "
    "list of segmentation masks where each entry contains the 2D bounding box "
    'in the key "box_2d" (normalized 0-1000, [y0, x0, y1, x1]), the base64 '
    'PNG segmentation mask in the key "mask", and the text label in the key '
    '"label".'
)


def first_mask(response_text):
    """Parse the model's JSON -> (box_2d, mask_png_bytes), or None."""
    try:
        items = json.loads(response_text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(items, list) or not items:
        return None
    item = items[0]
    box = item.get("box_2d")
    mask = item.get("mask")
    if not isinstance(box, list) or len(box) != 4 or not isinstance(mask, str):
        return None
    if "," in mask:  # strip a data:image/png;base64, prefix
        mask = mask.split(",", 1)[1]
    try:
        return box, base64.b64decode(mask)
    except Exception:
        return None


def compose_cutout(photo_path, box_2d, mask_png_bytes):
    """Composite mask over photo -> cropped RGBA PNG bytes, or None when the
    mask fails the area gate or cannot be decoded."""
    photo = Image.open(photo_path).convert("RGB")
    w, h = photo.size
    y0, x0, y1, x1 = (int(v) for v in box_2d)  # 0-1000, y-first (Gemini format)
    left, top = int(x0 / 1000 * w), int(y0 / 1000 * h)
    right, bottom = int(x1 / 1000 * w), int(y1 / 1000 * h)
    if right <= left or bottom <= top:
        return None
    try:
        mask_img = Image.open(io.BytesIO(mask_png_bytes)).convert("L")
    except Exception:
        return None
    mask_img = mask_img.resize((right - left, bottom - top))
    box_alpha = np.asarray(mask_img) > MASK_THRESHOLD

    area_frac = box_alpha.sum() / float(w * h)
    if area_frac < MIN_AREA_FRAC or area_frac > MAX_AREA_FRAC:
        return None

    alpha = np.zeros((h, w), dtype=np.uint8)
    alpha[top:bottom, left:right] = box_alpha.astype(np.uint8) * 255

    rgba = np.dstack([np.asarray(photo), alpha])
    ys, xs = np.nonzero(alpha)
    cy0, cy1 = max(0, ys.min() - PAD_PX), min(h, ys.max() + 1 + PAD_PX)
    cx0, cx1 = max(0, xs.min() - PAD_PX), min(w, xs.max() + 1 + PAD_PX)
    out = Image.fromarray(rgba[cy0:cy1, cx0:cx1], "RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def cutout_png(client, photo_path, subject, subject_bbox):
    """One Gemini call -> cutout PNG bytes, or None (no usable mask)."""
    from google.genai import types

    mime = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=_PROMPT.format(subject=subject or "main subject", bbox=subject_bbox)
                    ),
                    types.Part.from_bytes(
                        data=Path(photo_path).read_bytes(), mime_type=mime
                    ),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=8192,
        ),
    )
    parsed = first_mask(response.text)
    if parsed is None:
        return None
    box_2d, mask_bytes = parsed
    return compose_cutout(photo_path, box_2d, mask_bytes)
```

(No `response_schema` here on purpose — Google's segmentation guidance is JSON mime type only; the mask string is huge and schema enforcement adds nothing.)

- [ ] **Step 4: Run the tests**

Run: `py -3 -m pytest analysis/tests/test_segment.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add analysis/darkroom_analysis/segment.py analysis/tests/test_segment.py
git commit -m "feat(analysis): gemini segmentation -> gated RGBA cutout PNGs"
```

---

### Task 2: `analyze_media.py` grows `--cutouts` + `has_cutout`

**Files:**
- Modify: `analysis/analyze_media.py`
- Test: `analysis/tests/test_analyze.py` (extend AND update existing calls — `--cutouts` is a new REQUIRED arg)

**Interfaces:**
- Consumes: `segment.cutout_png` (Task 1), `cache.get/put` namespace `"cutout"`.
- Produces: `main(argv, analyze_fn=None, segment_fn=None)` where `segment_fn(photo_path, subject, subject_bbox) -> bytes | None`; every pool entry gains top-level `"has_cutout": bool`; PNGs land at `<cutouts_dir>/<photo stem>.png`.

- [ ] **Step 1: Write the failing tests**

In `analysis/tests/test_analyze.py`, add helpers near `_canned`:

```python
def _tiny_png():
    import io

    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _no_segment(path, subject, bbox):
    return None
```

Add new tests at the bottom:

```python
def test_pool_carries_has_cutout_and_writes_pngs(tmp_path):
    photos = _setup_photos(tmp_path)
    cutouts = tmp_path / "cutouts"
    seen = []

    def seg(path, subject, bbox):
        seen.append(Path(path).stem)
        return _tiny_png() if Path(path).stem in {"img0", "img2"} else None

    code = main(
        ["--photos", str(photos), "--cache", str(tmp_path / "cache"),
         "--out", str(tmp_path / "pool.json"), "--cutouts", str(cutouts)],
        analyze_fn=lambda paths: _canned(paths), segment_fn=seg,
    )
    assert code == 0
    pool = json.loads((tmp_path / "pool.json").read_text(encoding="utf-8"))["pool"]
    flags = {e["id"]: e["has_cutout"] for e in pool}
    assert flags == {"img0": True, "img1": False, "img2": True, "img3": False}
    assert (cutouts / "img0.png").exists()
    assert not (cutouts / "img1.png").exists()
    assert sorted(seen) == ["img0", "img1", "img2", "img3"]


def test_cutout_cache_hit_skips_segment_fn(tmp_path):
    photos = _setup_photos(tmp_path)
    cutouts = tmp_path / "cutouts"
    counter = {"n": 0}

    def seg(path, subject, bbox):
        counter["n"] += 1
        return _tiny_png() if Path(path).stem == "img0" else None

    def run(out):
        return main(
            ["--photos", str(photos), "--cache", str(tmp_path / "cache"),
             "--out", str(tmp_path / out), "--cutouts", str(cutouts)],
            analyze_fn=lambda paths: _canned(paths), segment_fn=seg,
        )

    assert run("o1.json") == 0
    assert counter["n"] == 4
    assert run("o2.json") == 0
    assert counter["n"] == 4  # cache hits (true-with-png and false) skip the API
    # deleting a cutout PNG invalidates only that photo's hit
    (cutouts / "img0.png").unlink()
    assert run("o3.json") == 0
    assert counter["n"] == 5
    assert (cutouts / "img0.png").exists()
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `py -3 -m pytest analysis/tests/test_analyze.py -q`
Expected: new tests FAIL (`unrecognized arguments: --cutouts` / `TypeError: main() got an unexpected keyword argument 'segment_fn'`).

- [ ] **Step 3: Implement**

In `analysis/analyze_media.py`:

1. Docstring first line becomes:
   `"""analyze_media.py --photos <dir> --cache <dir> --out <file> --cutouts <dir> [--batch 10]`
2. Below `NAMESPACE = "vision"` add `CUTOUT_NS = "cutout"`.
3. Signature: `def main(argv, analyze_fn=None, segment_fn=None) -> int:`
4. Add the arg: `ap.add_argument("--cutouts", required=True)`
5. After the vision-analysis block (right after the `if uncached:` block finishes) and BEFORE the `pool = []` loop, insert:

```python
    cutouts_dir = Path(args.cutouts)
    cutouts_dir.mkdir(parents=True, exist_ok=True)
    has_cutout = {}
    for p in result.survivors:
        png_path = cutouts_dir / f"{Path(p).stem}.png"
        hit = cache.get(args.cache, keys[p], CUTOUT_NS)
        if hit is not None and (not hit["has_cutout"] or png_path.exists()):
            has_cutout[p] = hit["has_cutout"]
            continue
        if segment_fn is None:
            from darkroom_analysis import gemini_vision, segment

            client = gemini_vision.make_client()
            segment_fn = lambda pp, s, b: segment.cutout_png(client, pp, s, b)  # noqa: E731
        a = analyses[p]
        try:
            png = segment_fn(p, a.get("subject", ""), a.get("subject_bbox", []))
        except Exception:
            png = None  # a failed cutout never fails the pipeline
        if png:
            png_path.write_bytes(png)
        has_cutout[p] = bool(png)
        cache.put(args.cache, keys[p], CUTOUT_NS, {"has_cutout": has_cutout[p]})
```

6. In the pool-building loop, add the flag to each entry dict:

```python
                "type": "still",
                "has_cutout": has_cutout[p],
```

7. Update ALL FOUR existing tests in `test_analyze.py`: append `"--cutouts", str(tmp_path / "cutouts")` to each `main([...])` argv list, and pass `segment_fn=_no_segment` as a kwarg to each call (the exit-3 test keeps its asserting `fake` for `analyze_fn`; `_no_segment` is never reached there because triage exits first).

- [ ] **Step 4: Run the whole Python suite**

Run: `py -3 -m pytest analysis/tests -q`
Expected: all pass (15 old + 5 segment + 2 new = 22).

- [ ] **Step 5: Commit**

```bash
git add analysis/analyze_media.py analysis/tests/test_analyze.py
git commit -m "feat(analysis): cutout pass in analyze_media - has_cutout flags + cached PNGs"
```

---

### Task 3: EDL schema vocabulary (`renderer/src/edl/schema.ts`)

**Files:**
- Modify: `renderer/src/edl/schema.ts`
- Test: `renderer/src/edl/schema.test.ts` (extend)

**Interfaces:**
- Produces: `SpanSchema` (exported zod object: `{text: string min 1, bold default false, underline default false, tone enum white|yellow default white}`), `type QuoteSpan = z.infer<typeof SpanSchema>`; `TransitionTypeEnum` + `'cutout_pop'`; `TextStyleEnum` + `'quote_duotone'`; `EffectEnum` + `'quote_card'`; `TextSchema.spans?: SpanSchema[]`; `TimelineEntrySchema.cutout?: string`. Tasks 4–11 all consume these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `renderer/src/edl/schema.test.ts` inside the `describe`:

```ts
  test('accepts cutout_pop transition and an entry cutout path', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[0].transition_out = {type: 'cutout_pop', duration_ms: 400};
    edl.timeline[0].cutout = 'assets/cutouts/IMG_001.png';
    expect(() => EdlSchema.parse(edl)).not.toThrow();
  });

  test('accepts a duotone quote with spans, applying emphasis defaults', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[1].text = {
      content: 'stay for the light',
      style: 'quote_duotone',
      in_ms: 100,
      out_ms: 900,
      anchor: 'center',
      spans: [{text: 'stay for the'}, {text: 'light', bold: true, tone: 'yellow'}],
    };
    const parsed = EdlSchema.parse(edl);
    expect(parsed.timeline[1].text?.spans?.[0]).toEqual({
      text: 'stay for the',
      bold: false,
      underline: false,
      tone: 'white',
    });
    expect(parsed.timeline[1].text?.spans?.[1].bold).toBe(true);
  });

  test('quote_duotone without spans is valid (plain white fallback)', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[1].text = {
      content: 'stay',
      style: 'quote_duotone',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
    };
    expect(() => EdlSchema.parse(edl)).not.toThrow();
  });

  test('rejects a bad span tone and accepts quote_card effect', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[0].effects = ['quote_card'];
    expect(() => EdlSchema.parse(edl)).not.toThrow();
    edl.timeline[0].text = {
      content: 'x',
      style: 'quote_duotone',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
      spans: [{text: 'x', tone: 'red'}],
    };
    expect(() => EdlSchema.parse(edl)).toThrow();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run (in `renderer/`): `npx vitest run src/edl/schema.test.ts`
Expected: 4 new tests FAIL (enum rejections).

- [ ] **Step 3: Implement**

In `renderer/src/edl/schema.ts`:

```ts
export const TransitionTypeEnum = z.enum([
  'cut',
  'crossfade',
  'whip_pan',
  'flash_white',
  'flash_black',
  'zoom_punch',
  'slide',
  'cutout_pop',
]);
export const EffectEnum = z.enum([
  'film_grain',
  'vignette',
  'chromatic_ab',
  'vhs',
  'bw',
  'quote_card',
]);
export const TextStyleEnum = z.enum([
  'caption_lower',
  'editorial_serif',
  'kinetic_word',
  'location_stamp',
  'vhs_timestamp',
  'quote_duotone',
  'none',
]);

// Duotone quote spans (spec 2026-07-15 §3/§4). Shared with the Producer's
// plan contract — the orchestrator imports this schema.
export const SpanSchema = z.object({
  text: z.string().min(1),
  bold: z.boolean().default(false),
  underline: z.boolean().default(false),
  tone: z.enum(['white', 'yellow']).default('white'),
});
```

`TextSchema` gains, after `anchor`:

```ts
  // quote_duotone only; absent -> renderer draws content as one white line
  spans: z.array(SpanSchema).optional(),
```

`TimelineEntrySchema` gains, after `text`:

```ts
  // cutout PNG path — patched by finalize, never written by the Director
  cutout: z.string().optional(),
```

Type exports gain:

```ts
export type QuoteSpan = z.infer<typeof SpanSchema>;
```

- [ ] **Step 4: Run renderer tests**

Run (in `renderer/`): `npx vitest run src/edl`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/edl/schema.ts renderer/src/edl/schema.test.ts
git commit -m "feat(edl): cutout_pop + quote_duotone spans + quote_card vocabulary"
```

---

### Task 4: Invariant — `cutout_pop` needs a real cutout

**Files:**
- Modify: `renderer/src/edl/invariants.ts`
- Test: `renderer/src/edl/invariants.test.ts` (extend)

**Interfaces:**
- Produces: `checkInvariants(edl: Edl, assetIds: Set<string>, cutoutIds?: Set<string>): string[]` — third arg optional; when omitted the cutout check is skipped (existing call sites stay valid). Task 6 consumes the 3-arg form.

- [ ] **Step 1: Write the failing tests**

Append to `renderer/src/edl/invariants.test.ts`:

```ts
  test('flags cutout_pop from an asset without a cutout', () => {
    const edl = base();
    edl.timeline[0].transition_out = {type: 'cutout_pop', duration_ms: 400};
    expect(checkInvariants(edl, assets, new Set(['B'])).join(' ')).toMatch(/cutout/i);
    expect(checkInvariants(edl, assets, new Set(['A']))).toEqual([]);
  });

  test('cutout_pop is unchecked when no cutout set is provided', () => {
    const edl = base();
    edl.timeline[0].transition_out = {type: 'cutout_pop', duration_ms: 400};
    expect(checkInvariants(edl, assets)).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `renderer/`): `npx vitest run src/edl/invariants.test.ts`
Expected: first new test FAILS (no violation emitted).

- [ ] **Step 3: Implement**

In `renderer/src/edl/invariants.ts`, change the signature and add the check inside the entry loop (after the unknown-asset check):

```ts
export const checkInvariants = (
  edl: Edl,
  assetIds: Set<string>,
  cutoutIds?: Set<string>,
): string[] => {
```

```ts
    if (e.transition_out?.type === 'cutout_pop' && cutoutIds && !cutoutIds.has(e.asset)) {
      errors.push(
        `entry ${i} uses a cutout_pop transition but asset "${e.asset}" has no cutout — use a plain cut there`,
      );
    }
```

- [ ] **Step 4: Run renderer tests**

Run (in `renderer/`): `npx vitest run src/edl`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/edl/invariants.ts renderer/src/edl/invariants.test.ts
git commit -m "feat(edl): invariant - cutout_pop only from assets with cutouts"
```

---

### Task 5: Producer contract + prompt (quote)

**Files:**
- Modify: `orchestrator/src/contracts.ts`, `orchestrator/src/stages/produce.ts`, `orchestrator/src/test-fixtures.ts`, `prompts/producer.md`
- Test: `orchestrator/src/contracts.test.ts` (extend)

**Interfaces:**
- Consumes: `SpanSchema` from `renderer/src/edl/schema.js` (Task 3).
- Produces: `ProductionPlanSchema` with required `quote: {lines: QuoteSpan[][]}` (1–2 lines, each ≥1 span); `MediaEntry.has_cutout: boolean`; fixtures `PLAN.quote` and `MEDIA_POOL[*].has_cutout` (img0/img1 `true`, img2/img3 `false`). Task 6 consumes `has_cutout`; Task 6's Director prompt consumes `plan.quote`.

- [ ] **Step 1: Write the failing tests**

Append to `orchestrator/src/contracts.test.ts`:

```ts
  it('rejects a plan without a quote', () => {
    const {quote: _q, ...rest} = PLAN as Record<string, unknown>;
    expect(() => ProductionPlanSchema.parse(rest)).toThrow();
  });

  it('rejects >2 quote lines, empty lines, and bad tones', () => {
    const line = [{text: 'x'}];
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, quote: {lines: [line, line, line]}}),
    ).toThrow();
    expect(() => ProductionPlanSchema.parse({...PLAN, quote: {lines: []}})).toThrow();
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, quote: {lines: [[{text: 'x', tone: 'red'}]]}}),
    ).toThrow();
  });

  it('defaults span emphasis fields', () => {
    const parsed = ProductionPlanSchema.parse({...PLAN, quote: {lines: [[{text: 'dusk'}]]}});
    expect(parsed.quote.lines[0][0]).toEqual({
      text: 'dusk',
      bold: false,
      underline: false,
      tone: 'white',
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `orchestrator/`): `npx vitest run src/contracts.test.ts`
Expected: FAIL — `quote` unknown (TS error on `PLAN.quote` is expected too; fixtures updated next step).

- [ ] **Step 3: Implement**

`orchestrator/src/contracts.ts`:

```ts
import {SpanSchema} from '../../renderer/src/edl/schema.js';
```

Add to `ProductionPlanSchema` after `typography_direction`:

```ts
  quote: z.object({lines: z.array(z.array(SpanSchema).min(1)).min(1).max(2)}),
```

`MediaEntry` gains, after `type: 'still';`:

```ts
  has_cutout: boolean;
```

`orchestrator/src/test-fixtures.ts` — `MEDIA_POOL` entry gains (after `type: 'still',`):

```ts
    has_cutout: id === 'img0' || id === 'img1',
```

`PLAN` gains (after `typography_direction`):

```ts
  quote: {
    lines: [
      [
        {text: 'stay for the', bold: false, underline: false, tone: 'white' as const},
        {text: 'light', bold: true, underline: false, tone: 'yellow' as const},
      ],
    ],
  },
```

`orchestrator/src/stages/produce.ts` — `PLAN_RESPONSE_SCHEMA.properties` gains:

```ts
    quote: {
      type: 'OBJECT',
      properties: {
        lines: {
          type: 'ARRAY',
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: {type: 'STRING'},
                bold: {type: 'BOOLEAN'},
                underline: {type: 'BOOLEAN'},
                tone: {type: 'STRING', enum: ['white', 'yellow']},
              },
              required: ['text'],
            },
          },
        },
      },
      required: ['lines'],
    },
```

and its `required` array becomes:

```ts
  required: ['story', 'mode', 'duration_ms', 'selects', 'audio', 'quote', 'captions', 'hashtags'],
```

`prompts/producer.md` — add to `## Rules` (before the captions rule):

```markdown
- **quote**: write 1–2 short poetic lines (6 words max per line) grounded in
  what is visibly in the photos — never generic filler ("memories made",
  "good vibes" and the like are banned). Each line is an array of spans
  `{text, bold, underline, tone}`. Emphasize 2–4 words total across the whole
  quote using `bold` and/or `underline`. Set `tone: "yellow"` on exactly one
  word or one contiguous phrase — the emotional center of the quote;
  everything else stays `"white"`.
```

and add to the output template after `"typography_direction": "...",`:

```
  "quote": {"lines": [[{"text": "...", "bold": false, "underline": false, "tone": "white"}]]},
```

- [ ] **Step 4: Run orchestrator tests**

Run (in `orchestrator/`): `npx vitest run`
Expected: all pass (produce/pipeline tests keep working — the shared `PLAN` fixture now carries `quote`).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/contracts.ts orchestrator/src/stages/produce.ts orchestrator/src/test-fixtures.ts orchestrator/src/contracts.test.ts prompts/producer.md
git commit -m "feat(producer): required duotone quote in the production plan"
```

---

### Task 6: Director — cutout rules + vocabulary + prompt

**Files:**
- Modify: `orchestrator/src/stages/direct.ts`, `prompts/director_montage.md`
- Test: `orchestrator/src/direct.test.ts` (extend)

**Interfaces:**
- Consumes: `checkInvariants(edl, assetIds, cutoutIds)` (Task 4), `MediaEntry.has_cutout` (Task 5).
- Produces: Director calls validated against the pool's cutout set; response schema accepts `cutout_pop`, `quote_duotone`, `spans`.

- [ ] **Step 1: Write the failing tests**

Append to `orchestrator/src/direct.test.ts` (inside the `describe`):

```ts
  const withPop = (asset: string) => {
    const edl = goodEdl();
    const timeline = edl.timeline as Array<{asset: string; transition_out?: unknown}>;
    const i = timeline.findIndex((e) => e.asset === asset);
    timeline[i].transition_out = {type: 'cutout_pop', duration_ms: 400};
    return edl;
  };

  it('accepts cutout_pop on an asset that has a cutout', async () => {
    const {transport} = makeTransport([JSON.stringify(withPop('img0'))]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline[0].transition_out?.type).toBe('cutout_pop');
  });

  it('repairs cutout_pop on an asset without a cutout', async () => {
    const {transport, calls} = makeTransport([
      JSON.stringify(withPop('img3')), // img3 has has_cutout: false
      JSON.stringify(withPop('img0')),
    ]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline[3].transition_out).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].parts.map((p) => p.text).join('\n')).toMatch(/cutout/i);
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `orchestrator/`): `npx vitest run src/direct.test.ts`
Expected: "repairs cutout_pop" FAILS — only one transport call is consumed (no violation raised).

- [ ] **Step 3: Implement `direct.ts`**

In `runDirect`, replace the `assetIds` line with:

```ts
  const assetIds = new Set([...opts.plan.selects, opts.track.id]);
  const cutoutIds = new Set(
    opts.mediaPool.pool.filter((e) => e.has_cutout).map((e) => e.id),
  );
```

and the invariant call with:

```ts
    const violations = checkInvariants(res.data, assetIds, cutoutIds);
```

In `EDL_RESPONSE_SCHEMA`:
- `transition_out.properties.type.enum` → `['cut', 'cutout_pop']`
- `text.properties.style.enum` → `['caption_lower', 'kinetic_word', 'quote_duotone', 'none']`
- `text.properties` gains:

```ts
              spans: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    text: {type: 'STRING'},
                    bold: {type: 'BOOLEAN'},
                    underline: {type: 'BOOLEAN'},
                    tone: {type: 'STRING', enum: ['white', 'yellow']},
                  },
                  required: ['text'],
                },
              },
```

- [ ] **Step 4: Update `prompts/director_montage.md`**

Vocabulary section — extend two lines:

```markdown
- `transition.type`: `cut | cutout_pop` (others render as cuts in this milestone)
- `text.style`: `caption_lower | kinetic_word | quote_duotone | none` (only these render)
```

(Replace the existing `transition.type` and the "renderer only draws" sentence accordingly; also add `quote_card` to the mention of usable `effects`.)

Hard rules — add:

```markdown
- **The quote appears exactly once per reel.** The plan gives you `quote.lines`.
  Pick ONE entry — the calmest / most fitting photo — and give it a `text`
  block with `"style": "quote_duotone"`, `"anchor": "center"`. Copy the plan's
  `quote.lines` into `text.spans` verbatim, flattened, inserting a span
  `{"text": "\n"}` between line 1 and line 2 when there are two lines. Set
  `content` to the plain-text join of all span texts (spaces between words,
  a space where the newline span sits). If the photo set is busy, instead put
  the quote on its own entry with `"effects": ["quote_card"]` (the photo
  becomes a darkened backdrop). Give the quote entry 2–4 beats of screen time
  and a text window covering most of the entry (`in_ms` near 0, `out_ms` near
  the entry length).
- **Cutout pops are signature moments.** Place 2–3
  `"transition_out": {"type": "cutout_pop", "duration_ms": 400}` on cuts that
  land at high points of the track's `energy_curve` — ONLY on entries whose
  pool record has `"has_cutout": true`, and never on two consecutive entries.
  All other transitions stay `{"type": "cut", "duration_ms": 0}`.
```

- [ ] **Step 5: Run orchestrator tests**

Run (in `orchestrator/`): `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/stages/direct.ts orchestrator/src/direct.test.ts prompts/director_montage.md
git commit -m "feat(director): quote placement + cutout_pop rules with invariant repair"
```

---

### Task 7: Pipeline plumbing — analyze passes `--cutouts`, finalize patches `entry.cutout`

**Files:**
- Modify: `orchestrator/src/paths.ts`, `orchestrator/src/stages/analyze.ts`, `orchestrator/src/stages/finalize.ts`
- Test: create `orchestrator/src/cutout-stages.test.ts`

**Interfaces:**
- Produces: `rendererCutoutsDir(root: string): string` → `<root>/renderer/public/assets/cutouts`; finalize sets `entry.cutout = "assets/cutouts/<assetId>.png"` on every entry with a `cutout_pop` transition.

- [ ] **Step 1: Write the failing tests**

Create `orchestrator/src/cutout-stages.test.ts`:

```ts
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {EdlSchema} from '../../renderer/src/edl/schema.js';
import {runAnalyze} from './stages/analyze.js';
import {runFinalize} from './stages/finalize.js';
import {
  MEDIA_POOL,
  PLAN,
  TRACKS,
  USAGE,
  fakeSpawnPy,
  goodEdl,
  makeDeps,
  makeRepo,
  makeTransport,
} from './test-fixtures.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('runAnalyze', () => {
  it('passes the renderer cutouts dir to the python analyzer', async () => {
    let seenArgs: string[] = [];
    const spawnPy = async (script: string, args: string[]) => {
      seenArgs = args;
      return fakeSpawnPy()(script, args);
    };
    const deps = {...makeDeps(root, makeTransport([]).transport), spawnPy};
    await runAnalyze(deps, path.join(root, 'photos'), 'r1');
    const i = seenArgs.indexOf('--cutouts');
    expect(i).toBeGreaterThan(-1);
    expect(seenArgs[i + 1]).toBe(path.join(root, 'renderer', 'public', 'assets', 'cutouts'));
  });
});

describe('runFinalize', () => {
  it('patches entry.cutout for every cutout_pop transition', async () => {
    const raw = goodEdl();
    (raw.timeline[1] as Record<string, unknown>).transition_out = {
      type: 'cutout_pop',
      duration_ms: 400,
    };
    const edl = EdlSchema.parse(raw);
    const deps = makeDeps(root, makeTransport([]).transport);
    const res = await runFinalize(deps, {
      runId: 'r2',
      edl,
      plan: PLAN,
      mediaPool: MEDIA_POOL,
      track: TRACKS[0],
      usage: {direct: USAGE},
    });
    expect(res.edl.timeline[1].cutout).toBe('assets/cutouts/img1.png');
    expect(res.edl.timeline[0].cutout).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `orchestrator/`): `npx vitest run src/cutout-stages.test.ts`
Expected: both FAIL (`--cutouts` index -1; `cutout` undefined).

- [ ] **Step 3: Implement**

`orchestrator/src/paths.ts` — add:

```ts
export const rendererCutoutsDir = (root: string): string =>
  path.join(root, 'renderer', 'public', 'assets', 'cutouts');
```

`orchestrator/src/stages/analyze.ts` — import `rendererCutoutsDir` from `'../paths.js'` and extend the spawn args:

```ts
  const {code, stdout} = await deps.spawnPy(path.join('analysis', 'analyze_media.py'), [
    '--photos',
    photosDir,
    '--cache',
    cacheDir(deps.repoRoot),
    '--out',
    outFile,
    '--cutouts',
    rendererCutoutsDir(deps.repoRoot),
  ]);
```

`orchestrator/src/stages/finalize.ts` — replace the `const edl: Edl = ...` block with:

```ts
  // the renderer resolves paths relative to public/ — pin the audio track and
  // cutout paths regardless of what the Director wrote
  const edl: Edl = {
    ...opts.edl,
    audio: {...opts.edl.audio, track: `assets/audio/${opts.track.file}`},
    timeline: opts.edl.timeline.map((e) =>
      e.transition_out?.type === 'cutout_pop'
        ? {...e, cutout: `assets/cutouts/${e.asset}.png`}
        : e,
    ),
  };
```

- [ ] **Step 4: Run orchestrator tests + build**

Run (in `orchestrator/`): `npx vitest run` then `npm run build`
Expected: all tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/paths.ts orchestrator/src/stages/analyze.ts orchestrator/src/stages/finalize.ts orchestrator/src/cutout-stages.test.ts
git commit -m "feat(pipeline): route cutouts dir to analysis + patch entry.cutout in finalize"
```

---

### Task 8: Server — deleting a photo deletes its cutout

**Files:**
- Modify: `renderer/server/workbench-server.mjs` (DELETE `/api/assets/:file` handler)
- Test: `renderer/server/server.test.mjs` (extend the `asset deletion` describe)

- [ ] **Step 1: Write the failing test**

Add to the `asset deletion` describe in `renderer/server/server.test.mjs`:

```js
  it('deletes the photo cutout alongside the photo', async () => {
    await boot();
    const assets = path.join(rendererRoot, 'public', 'assets');
    await writeFile(path.join(assets, 'pic.jpg'), 'x');
    await mkdir(path.join(assets, 'cutouts'), {recursive: true});
    await writeFile(path.join(assets, 'cutouts', 'pic.png'), 'cutout');
    const r = await fetch(base + '/api/assets/pic.jpg', {method: 'DELETE'});
    expect(r.status).toBe(204);
    await expect(readFile(path.join(assets, 'cutouts', 'pic.png'))).rejects.toThrow();
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `renderer/`): `npx vitest run server/server.test.mjs`
Expected: new test FAILS (cutout file still readable).

- [ ] **Step 3: Implement**

In the DELETE handler, after `unlinkSync(p);`:

```js
    const cutout = join(assetsDir, 'cutouts', `${f.replace(/\.[^.]+$/, '')}.png`);
    if (existsSync(cutout)) unlinkSync(cutout);
```

- [ ] **Step 4: Run server tests**

Run (in `renderer/`): `npx vitest run server/server.test.mjs`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add renderer/server/workbench-server.mjs renderer/server/server.test.mjs
git commit -m "feat(server): remove a photo's cutout PNG when the photo is deleted"
```

---

### Task 9: Renderer — QuoteDuotone + quote_card backdrop

**Files:**
- Create: `renderer/src/components/text/quote-timing.ts`, `renderer/src/components/text/QuoteDuotone.tsx`, `renderer/src/components/QuoteCardBackdrop.tsx`
- Modify: `renderer/src/components/text/TextOverlay.tsx`, `renderer/src/Reel.tsx` (Shot only)
- Test: create `renderer/src/components/text/quote-timing.test.ts`

**Interfaces:**
- Consumes: `QuoteSpan` from `../../edl/schema` (Task 3), `msToFrame`, `theme`.
- Produces: `wordReveal(tMs, inMs, outMs, wordIndex, wordCount): {opacity: number; rise: number}`; `spansToLines(spans: QuoteSpan[]): (QuoteSpan & {wordIndex: number})[][]`; `<QuoteDuotone spans inMs outMs fps />`; `<QuoteCardBackdrop src durationInFrames />`.

- [ ] **Step 1: Write the failing tests**

Create `renderer/src/components/text/quote-timing.test.ts`:

```ts
import {describe, expect, test} from 'vitest';
import {spansToLines, wordReveal} from './quote-timing';

describe('wordReveal', () => {
  test('hidden at window start, fully visible by the end of the first third', () => {
    expect(wordReveal(1000, 1000, 4000, 0, 5).opacity).toBe(0);
    for (let w = 0; w < 5; w++) {
      const r = wordReveal(2000, 1000, 4000, w, 5); // first third ends at 2000
      expect(r.opacity).toBe(1);
      expect(r.rise).toBe(0);
    }
  });

  test('later words reveal later', () => {
    const early = wordReveal(1100, 1000, 4000, 0, 5).opacity;
    const late = wordReveal(1100, 1000, 4000, 4, 5).opacity;
    expect(early).toBeGreaterThan(late);
  });

  test('a single word fades without stagger', () => {
    expect(wordReveal(1000, 1000, 1600, 0, 1).opacity).toBe(0);
    expect(wordReveal(1600, 1000, 1600, 0, 1).opacity).toBe(1);
  });

  test('deterministic frame math', () => {
    expect(wordReveal(1234, 1000, 4000, 2, 6)).toEqual(wordReveal(1234, 1000, 4000, 2, 6));
  });
});

describe('spansToLines', () => {
  test('splits on newline spans and assigns global word indices', () => {
    const lines = spansToLines([
      {text: 'stay for the', bold: false, underline: false, tone: 'white'},
      {text: 'light', bold: true, underline: false, tone: 'yellow'},
      {text: '\n', bold: false, underline: false, tone: 'white'},
      {text: 'a little longer', bold: false, underline: true, tone: 'white'},
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((w) => w.text)).toEqual(['stay', 'for', 'the', 'light']);
    expect(lines[0][3]).toMatchObject({tone: 'yellow', bold: true, wordIndex: 3});
    expect(lines[1].map((w) => w.wordIndex)).toEqual([4, 5, 6]);
    expect(lines[1][0].underline).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `renderer/`): `npx vitest run src/components/text/quote-timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `quote-timing.ts`**

```ts
import type {QuoteSpan} from '../../edl/schema';

// Deterministic word-reveal math for the duotone quote (spec 2026-07-15 §5):
// words stagger in (~80ms apart, compressed for short windows) across the
// first third of the text window, then hold fully visible.
export const WORD_STAGGER_MS = 80;
export const WORD_FADE_MS = 180;

export type WordReveal = {opacity: number; rise: number}; // rise 1 -> 0

export function wordReveal(
  tMs: number,
  inMs: number,
  outMs: number,
  wordIndex: number,
  wordCount: number,
): WordReveal {
  const window = Math.max(1, outMs - inMs);
  const revealSpan = window / 3;
  // last word starts by 60% of the reveal span and fades within the rest,
  // so every word is fully on by the one-third mark
  const stagger =
    wordCount > 1 ? Math.min(WORD_STAGGER_MS, (revealSpan * 0.6) / (wordCount - 1)) : 0;
  const fade = Math.min(WORD_FADE_MS, revealSpan * 0.4);
  const start = inMs + wordIndex * stagger;
  const p = Math.min(1, Math.max(0, (tMs - start) / Math.max(1, fade)));
  return {opacity: p, rise: 1 - p};
}

export type QuoteWord = QuoteSpan & {wordIndex: number};

/** Split spans into lines on "\n" spans, then into per-word chunks keeping
 * each span's emphasis. wordIndex is global (reading order) for the stagger. */
export function spansToLines(spans: QuoteSpan[]): QuoteWord[][] {
  const lines: QuoteWord[][] = [[]];
  let wordIndex = 0;
  for (const span of spans) {
    if (span.text === '\n') {
      lines.push([]);
      continue;
    }
    for (const word of span.text.split(/\s+/).filter(Boolean)) {
      lines[lines.length - 1].push({...span, text: word, wordIndex: wordIndex++});
    }
  }
  return lines.filter((l) => l.length > 0);
}
```

- [ ] **Step 4: Run the timing tests**

Run (in `renderer/`): `npx vitest run src/components/text/quote-timing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the pure math**

```bash
git add renderer/src/components/text/quote-timing.ts renderer/src/components/text/quote-timing.test.ts
git commit -m "feat(renderer): quote word-reveal timing + span line splitting"
```

- [ ] **Step 6: Create `QuoteDuotone.tsx`**

```tsx
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {QuoteSpan} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {spansToLines, wordReveal} from './quote-timing';

// Spec 2026-07-15 §5: vivid duotone, deliberately NOT the muted UI amber.
const TONE = {white: '#f5efe6', yellow: '#ffd84d'} as const;

export const QuoteDuotone: React.FC<{
  spans: QuoteSpan[];
  inMs: number;
  outMs: number;
  fps: number;
}> = ({spans, inMs, outMs, fps}) => {
  const frame = useCurrentFrame();
  const inF = msToFrame(inMs, fps);
  const outF = msToFrame(outMs, fps);
  if (frame < inF || frame > outF) return null;
  const tMs = (frame / fps) * 1000;
  const lines = spansToLines(spans);
  const wordCount = lines.reduce((n, l) => n + l.length, 0);
  return (
    <div
      style={{
        position: 'absolute',
        left: '10%',
        right: '12%',
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign: 'center',
        fontFamily: theme.fonts.editorial,
        fontSize: 76,
        lineHeight: 1.3,
        textShadow: `0 2px 32px ${theme.colors.shadow}`,
      }}
    >
      {lines.map((line, li) => (
        <div key={li}>
          {line.map((w) => {
            const {opacity, rise} = wordReveal(tMs, inMs, outMs, w.wordIndex, wordCount);
            return (
              <span
                key={w.wordIndex}
                style={{
                  display: 'inline-block',
                  margin: '0 0.18em',
                  color: TONE[w.tone],
                  fontWeight: w.bold ? 800 : 500,
                  borderBottom: w.underline ? '6px solid currentColor' : undefined,
                  paddingBottom: w.underline ? 4 : 0,
                  transform: `translateY(${12 * rise}px) ${w.underline ? 'rotate(-0.6deg)' : ''}`,
                  opacity,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 7: Wire into `TextOverlay.tsx`**

Add the import and a branch BEFORE the `kinetic_word` branch:

```tsx
import {QuoteDuotone} from './QuoteDuotone';
```

```tsx
  if (text.style === 'quote_duotone') {
    // a hand-edited quote has no spans -> single white unemphasized line
    const spans = text.spans ?? [
      {text: text.content, bold: false, underline: false, tone: 'white' as const},
    ];
    return <QuoteDuotone spans={spans} inMs={text.in_ms} outMs={text.out_ms} fps={fps} />;
  }
```

- [ ] **Step 8: Create `QuoteCardBackdrop.tsx` and use it in Shot**

`renderer/src/components/QuoteCardBackdrop.tsx`:

```tsx
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';

// quote_card effect (spec §5): the photo becomes a darkened backdrop for the
// quote — brightness ~0.35 with a slow push-in.
export const QuoteCardBackdrop: React.FC<{src: string; durationInFrames: number}> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'brightness(0.35)',
          transform: `scale(${1 + 0.06 * progress})`,
        }}
      />
    </AbsoluteFill>
  );
};
```

In `renderer/src/Reel.tsx`, import it and change Shot's image block to:

```tsx
      {entry.effects.includes('quote_card') ? (
        <QuoteCardBackdrop src={src} durationInFrames={durF} />
      ) : entry.motion && entry.motion.type === 'ken_burns' ? (
        <KenBurns src={src} motion={entry.motion} durationInFrames={durF} />
      ) : (
        <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      )}
```

- [ ] **Step 9: Typecheck + full renderer suite**

Run (in `renderer/`): `npx tsc --noEmit` then `npx vitest run`
Expected: clean, all pass.

- [ ] **Step 10: Commit**

```bash
git add renderer/src/components/text/QuoteDuotone.tsx renderer/src/components/text/TextOverlay.tsx renderer/src/components/QuoteCardBackdrop.tsx renderer/src/Reel.tsx
git commit -m "feat(renderer): duotone quote overlay + quote_card backdrop"
```

---

### Task 10: Renderer — CutoutPop transition

**Files:**
- Create: `renderer/src/components/cutout-pop-math.ts`, `renderer/src/components/CutoutPop.tsx`
- Modify: `renderer/src/Reel.tsx`, `renderer/fixtures/montage.json`
- Test: create `renderer/src/components/cutout-pop-math.test.ts`; extend `renderer/src/edl/fixture.test.ts`

**Interfaces:**
- Consumes: `entry.cutout`, `entry.motion.to` (Task 3), `msToFrame`.
- Produces: `POP_SPAN_MS = 200`, `SETTLE_MS = 400`, `cutoutPopAt(progress, origin): {scale, rotateDeg, cx, cy, opacity}`, `settleScaleAt(progress): number`, `<CutoutPop src origin durationInFrames />`.

- [ ] **Step 1: Write the failing math tests**

Create `renderer/src/components/cutout-pop-math.test.ts`:

```ts
import {describe, expect, test} from 'vitest';
import {cutoutPopAt, settleScaleAt} from './cutout-pop-math';

describe('cutoutPopAt', () => {
  test('starts at the origin at natural scale, fully opaque', () => {
    expect(cutoutPopAt(0, {cx: 0.3, cy: 0.7})).toEqual({
      scale: 1,
      rotateDeg: 0,
      cx: 0.3,
      cy: 0.7,
      opacity: 1,
    });
  });

  test('ends enlarged, twisted, drifted toward center, faded out', () => {
    const s = cutoutPopAt(1, {cx: 0.3, cy: 0.7});
    expect(s.scale).toBeCloseTo(1.6);
    expect(s.rotateDeg).toBeCloseTo(6);
    expect(s.cx).toBeCloseTo(0.4); // halfway toward 0.5
    expect(s.cy).toBeCloseTo(0.6);
    expect(s.opacity).toBe(0);
  });

  test('scale grows monotonically', () => {
    let prev = 0;
    for (let p = 0; p <= 1.001; p += 0.1) {
      const {scale} = cutoutPopAt(p, {cx: 0.5, cy: 0.5});
      expect(scale).toBeGreaterThanOrEqual(prev);
      prev = scale;
    }
  });

  test('stays fully opaque through the cut (first three quarters)', () => {
    expect(cutoutPopAt(0.5, {cx: 0.5, cy: 0.5}).opacity).toBe(1);
    expect(cutoutPopAt(0.74, {cx: 0.5, cy: 0.5}).opacity).toBe(1);
  });
});

describe('settleScaleAt', () => {
  test('eases the incoming shot from 1.04 to 1.0', () => {
    expect(settleScaleAt(0)).toBeCloseTo(1.04);
    expect(settleScaleAt(1)).toBeCloseTo(1.0);
    expect(settleScaleAt(0.5)).toBeLessThan(1.04);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `renderer/`): `npx vitest run src/components/cutout-pop-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cutout-pop-math.ts`**

```ts
// Pure frame math for the cutout pop overlay (spec 2026-07-15 §5): the
// outgoing photo's subject starts at the entry's focal point at natural
// scale, blows up to ~1.6x with a ~6 degree twist while drifting halfway
// toward frame center, and fades out in the last quarter (after the cut).
export const POP_SPAN_MS = 200; // overlay covers ±POP_SPAN_MS around the cut
export const SETTLE_MS = 400; // incoming shot settles 1.04 -> 1.0

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export type PopState = {
  scale: number;
  rotateDeg: number;
  cx: number; // 0..1 frame fraction
  cy: number;
  opacity: number;
};

export function cutoutPopAt(progress: number, origin: {cx: number; cy: number}): PopState {
  const raw = clamp01(progress);
  const p = easeOutCubic(raw);
  return {
    scale: 1 + 0.6 * p,
    rotateDeg: 6 * p,
    cx: origin.cx + (0.5 - origin.cx) * 0.5 * p,
    cy: origin.cy + (0.5 - origin.cy) * 0.5 * p,
    opacity: raw < 0.75 ? 1 : clamp01((1 - raw) / 0.25),
  };
}

export function settleScaleAt(progress: number): number {
  return 1.04 - 0.04 * easeOutCubic(clamp01(progress));
}
```

- [ ] **Step 4: Run the math tests, then commit the math**

Run (in `renderer/`): `npx vitest run src/components/cutout-pop-math.test.ts` — PASS.

```bash
git add renderer/src/components/cutout-pop-math.ts renderer/src/components/cutout-pop-math.test.ts
git commit -m "feat(renderer): cutout pop + settle frame math"
```

- [ ] **Step 5: Create `CutoutPop.tsx`**

```tsx
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {cutoutPopAt} from './cutout-pop-math';

export const CutoutPop: React.FC<{
  src: string;
  origin: {cx: number; cy: number};
  durationInFrames: number;
}> = ({src, origin, durationInFrames}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  const s = cutoutPopAt(progress, origin);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <Img
        src={src}
        style={{
          position: 'absolute',
          left: `${s.cx * 100}%`,
          top: `${s.cy * 100}%`,
          maxWidth: '55%',
          maxHeight: '45%',
          transform: `translate(-50%, -50%) scale(${s.scale}) rotate(${s.rotateDeg}deg)`,
          opacity: s.opacity,
          filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.5))',
        }}
      />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Wire overlays + settle into `Reel.tsx`**

Full new `Reel.tsx` (replaces the file — Shot gains `settleIn` + frame hook, Reel gains the pop overlay layer; a missing `entry.cutout` silently degrades to a hard cut):

```tsx
import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';
import type {Edl, TimelineEntry} from './edl/schema';
import {msToFrame} from './edl/time';
import {KenBurns} from './components/KenBurns';
import {CutoutPop} from './components/CutoutPop';
import {POP_SPAN_MS, SETTLE_MS, settleScaleAt} from './components/cutout-pop-math';
import {QuoteCardBackdrop} from './components/QuoteCardBackdrop';
import {TextOverlay} from './components/text/TextOverlay';

export type ReelProps = {
  edl: Edl;
  assets: Record<string, string>;
};

const Shot: React.FC<{
  entry: TimelineEntry;
  src: string;
  beatGridMs: number[];
  fps: number;
  settleIn: boolean;
}> = ({entry, src, beatGridMs, fps, settleIn}) => {
  const frame = useCurrentFrame();
  const durF = msToFrame(entry.end_ms, fps) - msToFrame(entry.start_ms, fps);
  const settleF = msToFrame(SETTLE_MS, fps);
  const scale = settleIn ? settleScaleAt(settleF <= 0 ? 1 : Math.min(1, frame / settleF)) : 1;
  return (
    <AbsoluteFill style={{transform: `scale(${scale})`}}>
      {entry.effects.includes('quote_card') ? (
        <QuoteCardBackdrop src={src} durationInFrames={durF} />
      ) : entry.motion && entry.motion.type === 'ken_burns' ? (
        <KenBurns src={src} motion={entry.motion} durationInFrames={durF} />
      ) : (
        <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      )}
      {entry.text ? (
        <TextOverlay
          text={entry.text}
          entryStartMs={entry.start_ms}
          beatGridMs={beatGridMs}
          fps={fps}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({edl, assets}) => {
  const fps = edl.fps;
  const popDurF = msToFrame(2 * POP_SPAN_MS, fps);
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {edl.timeline.map((entry, i) => {
        const from = msToFrame(entry.start_ms, fps);
        const durF = msToFrame(entry.end_ms, fps) - from;
        const prev = edl.timeline[i - 1];
        const settleIn = prev?.transition_out?.type === 'cutout_pop' && Boolean(prev?.cutout);
        return (
          <Sequence key={`${entry.asset}-${entry.start_ms}`} from={from} durationInFrames={durF}>
            <Shot
              entry={entry}
              src={staticFile(assets[entry.asset])}
              beatGridMs={edl.audio.beat_grid_ms}
              fps={fps}
              settleIn={settleIn}
            />
          </Sequence>
        );
      })}
      {edl.timeline.map((entry) =>
        entry.transition_out?.type === 'cutout_pop' && entry.cutout ? (
          <Sequence
            key={`pop-${entry.asset}-${entry.end_ms}`}
            from={Math.max(0, msToFrame(entry.end_ms - POP_SPAN_MS, fps))}
            durationInFrames={popDurF}
          >
            <CutoutPop
              src={staticFile(entry.cutout)}
              origin={
                entry.motion
                  ? {cx: entry.motion.to.cx, cy: entry.motion.to.cy}
                  : {cx: 0.5, cy: 0.5}
              }
              durationInFrames={popDurF}
            />
          </Sequence>
        ) : null,
      )}
      {edl.audio.track && !edl.audio.mute_render ? (
        <Audio
          src={staticFile(edl.audio.track)}
          trimBefore={msToFrame(edl.audio.trim_start_ms, fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 7: Update the golden fixture + its test**

In `renderer/fixtures/montage.json` (open it; entries are objects in `edl.timeline`):
1. Pick the timeline entry at index 2. Add to its object (with `LEN` = that entry's `end_ms - start_ms`):

```json
"text": {
  "content": "stay for the light",
  "style": "quote_duotone",
  "in_ms": 0,
  "out_ms": LEN,
  "anchor": "center",
  "spans": [
    {"text": "stay for the", "bold": false, "underline": false, "tone": "white"},
    {"text": "light", "bold": true, "underline": false, "tone": "yellow"}
  ]
}
```

(If entry 2 already has a `text` block, replace it.)

2. Pick the timeline entry at index 5 (with asset id `A5`). Set on it:

```json
"transition_out": {"type": "cutout_pop", "duration_ms": 400},
"cutout": "assets/cutouts/A5.png"
```

(replacing `A5` with that entry's actual `asset` value).

Append to `renderer/src/edl/fixture.test.ts`:

```ts
test('fixture exercises the dynamic-edit vocabulary', () => {
  const edl = EdlSchema.parse(fixture.edl);
  expect(edl.timeline.some((e) => e.text?.style === 'quote_duotone' && e.text.spans)).toBe(true);
  expect(edl.timeline.some((e) => e.transition_out?.type === 'cutout_pop' && e.cutout)).toBe(
    true,
  );
});
```

- [ ] **Step 8: Typecheck + full renderer suite**

Run (in `renderer/`): `npx tsc --noEmit` then `npx vitest run`
Expected: clean, all pass (a missing cutout PNG is fine — the fixture test only validates the contract).

- [ ] **Step 9: Commit**

```bash
git add renderer/src/components/CutoutPop.tsx renderer/src/Reel.tsx renderer/fixtures/montage.json renderer/src/edl/fixture.test.ts
git commit -m "feat(renderer): cutout pop transition overlay + incoming settle"
```

---

### Task 11: Review screen — rewording a quote goes plain white

**Files:**
- Modify: `renderer/app/src/lib/edl-tweaks.ts` (`setText`)
- Test: `renderer/app/src/lib/edl-tweaks.test.ts` (extend)

**Interfaces:**
- Consumes: `TextSchema.spans` (Task 3).
- Produces: `setText` replaces `spans` with one white unemphasized span whenever the target text has spans; `listTexts` needs no change (quote entries already appear because their style is not `'none'`).

- [ ] **Step 1: Write the failing test**

Append to `renderer/app/src/lib/edl-tweaks.test.ts` (inside the `setText` describe):

```ts
  it('rewording a quote collapses spans to a single white span', () => {
    const edl = makeEdl();
    const quote = {
      ...edl,
      timeline: edl.timeline.map((e, i) =>
        i === 1
          ? {
              ...e,
              text: {
                content: 'stay for the light',
                style: 'quote_duotone' as const,
                in_ms: 0,
                out_ms: 400,
                anchor: 'center' as const,
                spans: [
                  {text: 'stay for the', bold: false, underline: false, tone: 'white' as const},
                  {text: 'light', bold: true, underline: false, tone: 'yellow' as const},
                ],
              },
            }
          : e,
      ),
    };
    const next = setText(quote, 1, 'blue hour again');
    expect(next.timeline[1].text?.content).toBe('blue hour again');
    expect(next.timeline[1].text?.spans).toEqual([
      {text: 'blue hour again', bold: false, underline: false, tone: 'white'},
    ]);
    expect(() => EdlSchema.parse(next)).not.toThrow();
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `renderer/`): `npx vitest run app/src/lib/edl-tweaks.test.ts`
Expected: FAIL — spans keep the old two-span array.

- [ ] **Step 3: Implement**

In `setText` in `renderer/app/src/lib/edl-tweaks.ts`, replace the final return inside the map with:

```ts
    // emphasis is the model's job — a hand-edited quote goes plain white
    return {
      ...entry,
      text: {
        ...entry.text,
        content: trimmed,
        ...(entry.text.spans
          ? {spans: [{text: trimmed, bold: false, underline: false, tone: 'white' as const}]}
          : {}),
      },
    };
```

- [ ] **Step 4: Run the app-lib tests**

Run (in `renderer/`): `npx vitest run app/src/lib`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/src/lib/edl-tweaks.ts renderer/app/src/lib/edl-tweaks.test.ts
git commit -m "feat(app): rewording the quote resets emphasis to plain white"
```

---

### Task 12: Full verification + live E2E

**Files:** none new — build, run everything, then a real run.

- [ ] **Step 1: All three suites + builds**

From repo root, each in its own command (no `&&` in PowerShell 5.1):
1. `py -3 -m pytest analysis/tests -q` → all pass
2. `cd orchestrator` → `npm run build` → clean; `npx vitest run` → all pass
3. `cd renderer` → `npx tsc --noEmit` → clean; `npx vitest run` → all pass

- [ ] **Step 2: Live E2E (needs `my-product-sa-key.json` in repo root)**

1. Start both servers (background): in `renderer/`, `node server/workbench-server.mjs` and `npx vite --config app/vite.config.ts`.
2. Open `http://localhost:5799`, run a reel on the sunset test set (photos already in `renderer/public/assets`, song `warm_rooftops` in the library).
3. Verify: `renderer/public/assets/cutouts/` gains PNGs (open one — transparent background); the EDL (`out/pipeline/<runId>/edl.json`) has exactly one `quote_duotone` text with `spans` and one yellow-tone span, and 2–3 `cutout_pop` transitions only on `has_cutout` assets, never consecutive; the preview shows the duotone quote with word reveal and the cutout pops on beats; rewording the quote in Tweaks shows it plain white; export the MP4 and play it.
4. Second run with the same photos: analyze stage is fast (cutout cache hits — no new segmentation calls in the server log).

- [ ] **Step 3: Final commit (if any stragglers) — do NOT push**

Stop here and use superpowers:finishing-a-development-branch.

---

## Self-Review (done at planning time)

- **Spec coverage:** §2 → Tasks 1–2; §3 → Task 5; §4 → Tasks 3, 4, 6, 7, 8; §5 → Tasks 9, 10; §6 → Task 11; §7 → tests inside every task + Task 12; §8 respected (no edit mode, no manual emphasis UI).
- **Type consistency:** `SpanSchema`/`QuoteSpan` defined once in `renderer/src/edl/schema.ts`, imported by contracts (Task 5) and components (Task 9); `has_cutout` on `MediaEntry` (Task 5) consumed in Task 6; `checkInvariants` 3-arg form (Task 4) consumed in Task 6; `POP_SPAN_MS`/`SETTLE_MS`/`settleScaleAt` (Task 10 math) consumed in Task 10 Reel.
- **Known breakage order:** Task 2 changes a required CLI arg — its Step 3 updates all existing Python tests in the same commit. Task 5 adds a required plan field — the shared `PLAN` fixture is updated in the same commit, keeping produce/pipeline tests green.
