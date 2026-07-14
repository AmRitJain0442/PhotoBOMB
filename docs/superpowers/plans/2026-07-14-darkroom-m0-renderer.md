# Darkroom M0 — Remotion Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Remotion project where a hand-written `edl.json` (the pipeline's core contract, Tech Spec §6) renders a 1080×1920@30fps montage MP4 with `<KenBurns>` motion, cuts snapped to a beat grid, and 2 typography styles (`caption_lower`, `kinetic_word`).

**Architecture:** A `renderer/` package (the repo will later grow `orchestrator/`, `analysis/`, `prompts/` siblings). The EDL is validated twice: Zod schema (shape + closed vocabularies) then invariant checks (timeline coverage, beat snapping, asset existence) — both run inside the composition's `calculateMetadata`, so an invalid EDL fails before a single frame renders. Pure math (easing, word timing, ms→frame) lives in plain `.ts` files with unit tests; React components stay thin and are eyeballed in Remotion Studio via a generated golden fixture.

**Tech Stack:** TypeScript, Remotion 4 (`remotion`, `@remotion/cli`), Zod 3, Vitest, Node ≥ 18. No other runtime deps.

## Global Constraints

- Output: 1080×1920 (9:16), 30 fps, H.264 (Remotion default codec for .mp4).
- EDL closed vocabularies exactly as Tech Spec §6: `motion.type`: `ken_burns|static|parallax`; `transition.type`: `cut|crossfade|whip_pan|flash_white|flash_black|zoom_punch|slide`; `effects`: `film_grain|vignette|chromatic_ab|vhs|bw`; `text.style`: `caption_lower|editorial_serif|kinetic_word|location_stamp|vhs_timestamp|none`; `anchor`: `lower_third|center|upper_safe|corner_br`.
- IG safe areas: text must stay inside 12% top / 20% bottom / 10% right margins.
- Beat-snap invariant: in `montage`/`edit` mode every internal cut within ±33 ms of a `beat_grid_ms` entry (edit mode may also use half-beats).
- Hard rule from spec §13: determinism in code, intelligence in prompts. M0 is all determinism — no LLM calls anywhere.
- M0 renderer scope: transitions other than `cut` render as a hard cut; text styles other than the 2 built ones fall back to `caption_lower`; `effects` are accepted by the schema but not rendered. Schema/invariants accept the FULL vocabulary so later milestones only add components, never change the contract.
- All commands below run from `renderer/` unless a path says otherwise. Windows/PowerShell-safe commands only.

## File Structure

```
renderer/
  package.json, tsconfig.json, remotion.config.ts, .gitignore
  scripts/make-fixtures.mjs      # generates placeholder SVGs, click-track WAV, golden EDL
  fixtures/montage.json          # golden fixture (committed): {edl, assets}
  public/assets/                 # generated media (gitignored; run `npm run fixtures`)
  src/
    index.ts                     # registerRoot
    Root.tsx                     # <Composition id="Reel"> + calculateMetadata (validate + duration)
    Reel.tsx                     # EDL timeline -> <Sequence> per entry + <Audio>
    theme.ts                     # fonts/colors (brand kit slot)
    edl/
      schema.ts                  # Zod schema + TS types (THE contract)
      schema.test.ts
      invariants.ts              # coverage / beat-snap / asset checks
      invariants.test.ts
      time.ts                    # msToFrame
      time.test.ts
      fixture.test.ts            # golden fixture passes schema + invariants
    components/
      kenburns-math.ts           # pure easing/interpolation
      kenburns-math.test.ts
      KenBurns.tsx
      anchors.ts                 # anchor -> IG-safe CSS
      anchors.test.ts
      text/
        kinetic-timing.ts        # word -> beat assignment (pure)
        kinetic-timing.test.ts
        CaptionLower.tsx
        KineticWord.tsx
        TextOverlay.tsx          # style dispatch
```

---

### Task 1: Scaffold the renderer package

**Files:**
- Create: `renderer/package.json`, `renderer/tsconfig.json`, `renderer/remotion.config.ts`, `renderer/.gitignore`, `renderer/src/index.ts`, `renderer/src/Root.tsx` (placeholder), `renderer/src/theme.ts`

**Interfaces:**
- Produces: npm scripts `test`, `studio`, `render`, `fixtures`; `theme` object `{fonts: {caption, editorial}, colors: {text, shadow}}` used by all text components.

- [ ] **Step 1: Create `renderer/package.json`**

```json
{
  "name": "darkroom-renderer",
  "private": true,
  "scripts": {
    "studio": "remotion studio",
    "render": "remotion render Reel out/reel.mp4 --props=fixtures/montage.json",
    "fixtures": "node scripts/make-fixtures.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@remotion/cli": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "remotion": "^4.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `renderer/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["DOM", "ES2022"]
  },
  "include": ["src", "fixtures"]
}
```

- [ ] **Step 3: Create `renderer/remotion.config.ts`**

```ts
import {Config} from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
```

- [ ] **Step 4: Create `renderer/.gitignore`**

```
node_modules/
out/
public/assets/
```

- [ ] **Step 5: Create `renderer/src/theme.ts`**

```ts
// Brand kit lives here (PRD §8 Q3): swap fonts/colors once, everywhere follows.
export const theme = {
  fonts: {
    caption: "'Helvetica Neue', Arial, sans-serif",
    editorial: "Georgia, 'Times New Roman', serif",
  },
  colors: {
    text: '#ffffff',
    shadow: 'rgba(0,0,0,0.45)',
  },
} as const;
```

- [ ] **Step 6: Create placeholder `renderer/src/Root.tsx` and `renderer/src/index.ts`**

`src/Root.tsx` (temporary — Task 7 replaces it):

```tsx
import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';

const Placeholder: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: 'black'}} />
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Reel"
    component={Placeholder}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
```

`src/index.ts`:

```ts
import {registerRoot} from 'remotion';
import {RemotionRoot} from './Root';

registerRoot(RemotionRoot);
```

- [ ] **Step 7: Install and verify**

Run (in `renderer/`): `npm install`
Then: `npx remotion versions` — Expected: prints matching 4.x versions for remotion packages, no mismatch warning.
Then: `npm run typecheck` — Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add renderer
git commit -m "feat(renderer): scaffold Remotion project for Darkroom M0"
```

---

### Task 2: EDL Zod schema (the core contract)

**Files:**
- Create: `renderer/src/edl/schema.ts`
- Test: `renderer/src/edl/schema.test.ts`

**Interfaces:**
- Produces: `EdlSchema` (Zod object), types `Edl`, `TimelineEntry`, `TextSpec`, `KenBurnsMotion` (`z.infer`), enums `AnchorEnum`, `TextStyleEnum`, `EasingEnum`. Full Tech Spec §6 vocabulary — no M0 narrowing.

- [ ] **Step 1: Write the failing test `src/edl/schema.test.ts`**

```ts
import {describe, expect, test} from 'vitest';
import {EdlSchema} from './schema';

const validEdl = {
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 2000,
  audio: {
    track: 'assets/click.wav',
    trim_start_ms: 0,
    beat_grid_ms: [0, 500, 1000, 1500],
    voiceover: null,
    mute_render: false,
  },
  timeline: [
    {
      asset: 'IMG_001',
      kind: 'still',
      start_ms: 0,
      end_ms: 1000,
      motion: {
        type: 'ken_burns',
        from: {zoom: 1.0, cx: 0.5, cy: 0.42},
        to: {zoom: 1.18, cx: 0.55, cy: 0.45},
        easing: 'easeOutCubic',
      },
      effects: [],
      text: {
        content: 'golden hour',
        style: 'caption_lower',
        in_ms: 100,
        out_ms: 900,
        anchor: 'lower_third',
      },
    },
    {asset: 'IMG_002', kind: 'still', start_ms: 1000, end_ms: 2000},
  ],
};

describe('EdlSchema', () => {
  test('accepts a valid montage EDL', () => {
    const parsed = EdlSchema.parse(validEdl);
    expect(parsed.timeline).toHaveLength(2);
    // defaults applied
    expect(parsed.timeline[1].effects).toEqual([]);
    expect(parsed.timeline[1].speed).toBe(1);
  });

  test('rejects an unknown transition type', () => {
    const bad = structuredClone(validEdl) as Record<string, unknown>;
    (bad.timeline as Array<Record<string, unknown>>)[0].transition_out = {
      type: 'star_wipe',
      duration_ms: 160,
    };
    expect(() => EdlSchema.parse(bad)).toThrow();
  });

  test('rejects an unknown text style', () => {
    const bad = structuredClone(validEdl) as Record<string, unknown>;
    (bad.timeline as Array<Record<string, unknown>>)[0].text = {
      content: 'x',
      style: 'comic_sans',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
    };
    expect(() => EdlSchema.parse(bad)).toThrow();
  });

  test('rejects wrong aspect or fps', () => {
    expect(() => EdlSchema.parse({...validEdl, aspect: '16:9'})).toThrow();
    expect(() => EdlSchema.parse({...validEdl, fps: 24})).toThrow();
  });

  test('accepts speed ramps on clips', () => {
    const withClip = structuredClone(validEdl) as ReturnType<typeof structuredClone>;
    (withClip as any).timeline[1] = {
      asset: 'CLIP_001',
      kind: 'clip',
      start_ms: 1000,
      end_ms: 2000,
      speed: [{at_ms: 0, rate: 0.5}, {at_ms: 400, rate: 2}],
    };
    expect(() => EdlSchema.parse(withClip)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/edl/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write `src/edl/schema.ts`**

```ts
import {z} from 'zod';

// Closed vocabularies — Tech Spec §6. Directors' prompts list these verbatim.
export const MotionTypeEnum = z.enum(['ken_burns', 'static', 'parallax']);
export const TransitionTypeEnum = z.enum([
  'cut', 'crossfade', 'whip_pan', 'flash_white', 'flash_black', 'zoom_punch', 'slide',
]);
export const EffectEnum = z.enum(['film_grain', 'vignette', 'chromatic_ab', 'vhs', 'bw']);
export const TextStyleEnum = z.enum([
  'caption_lower', 'editorial_serif', 'kinetic_word', 'location_stamp', 'vhs_timestamp', 'none',
]);
export const AnchorEnum = z.enum(['lower_third', 'center', 'upper_safe', 'corner_br']);
export const EasingEnum = z.enum(['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic']);

const CamPointSchema = z.object({
  zoom: z.number().min(0.5).max(3),
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
});

export const MotionSchema = z.object({
  type: MotionTypeEnum,
  from: CamPointSchema,
  to: CamPointSchema,
  easing: EasingEnum,
});

export const TextSchema = z.object({
  content: z.string().min(1),
  style: TextStyleEnum,
  // relative to the entry's start
  in_ms: z.number().int().nonnegative(),
  out_ms: z.number().int().positive(),
  anchor: AnchorEnum,
});

const SpeedRampSchema = z.array(
  z.object({at_ms: z.number().int().nonnegative(), rate: z.number().positive()}),
);

export const TimelineEntrySchema = z.object({
  asset: z.string().min(1),
  kind: z.enum(['still', 'clip', 'veo']),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  motion: MotionSchema.optional(),
  speed: z.union([z.number().positive(), SpeedRampSchema]).default(1),
  transition_out: z
    .object({type: TransitionTypeEnum, duration_ms: z.number().int().nonnegative()})
    .optional(),
  effects: z.array(EffectEnum).default([]),
  text: TextSchema.optional(),
});

export const EdlSchema = z.object({
  mode: z.enum(['montage', 'narrative', 'edit']),
  aspect: z.literal('9:16'),
  fps: z.literal(30),
  duration_ms: z.number().int().positive(),
  audio: z.object({
    track: z.string().nullable(),
    trim_start_ms: z.number().int().nonnegative().default(0),
    beat_grid_ms: z.array(z.number().nonnegative()),
    voiceover: z.object({script: z.string(), voice: z.string()}).nullable(),
    mute_render: z.boolean(),
  }),
  timeline: z.array(TimelineEntrySchema).min(1),
});

export type Edl = z.infer<typeof EdlSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type TextSpec = z.infer<typeof TextSchema>;
export type KenBurnsMotion = z.infer<typeof MotionSchema>;
export type Anchor = z.infer<typeof AnchorEnum>;
export type EasingName = z.infer<typeof EasingEnum>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/edl/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/src/edl
git commit -m "feat(renderer): EDL Zod schema with closed vocabularies"
```

---

### Task 3: Time helpers + EDL invariants

**Files:**
- Create: `renderer/src/edl/time.ts`, `renderer/src/edl/invariants.ts`
- Test: `renderer/src/edl/time.test.ts`, `renderer/src/edl/invariants.test.ts`

**Interfaces:**
- Consumes: `Edl` from `./schema`.
- Produces: `msToFrame(ms: number, fps: number): number`; `checkInvariants(edl: Edl, assetIds: Set<string>): string[]` (empty array = valid; each string is one human-readable violation — these go verbatim to the Director repair loop / Telegram later).

- [ ] **Step 1: Write failing tests**

`src/edl/time.test.ts`:

```ts
import {expect, test} from 'vitest';
import {msToFrame} from './time';

test('msToFrame rounds to nearest frame at 30fps', () => {
  expect(msToFrame(0, 30)).toBe(0);
  expect(msToFrame(1000, 30)).toBe(30);
  expect(msToFrame(1830, 30)).toBe(55); // 54.9 -> 55
  expect(msToFrame(33, 30)).toBe(1); // 0.99 -> 1
});
```

`src/edl/invariants.test.ts`:

```ts
import {describe, expect, test} from 'vitest';
import type {Edl} from './schema';
import {checkInvariants} from './invariants';

const base = (overrides: Partial<Edl> = {}): Edl => ({
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 2000,
  audio: {
    track: null,
    trim_start_ms: 0,
    beat_grid_ms: [0, 500, 1000, 1500, 2000],
    voiceover: null,
    mute_render: true,
  },
  timeline: [
    {asset: 'A', kind: 'still', start_ms: 0, end_ms: 1000, speed: 1, effects: []},
    {asset: 'B', kind: 'still', start_ms: 1000, end_ms: 2000, speed: 1, effects: []},
  ],
  ...overrides,
});

const assets = new Set(['A', 'B']);

describe('checkInvariants', () => {
  test('valid EDL returns no errors', () => {
    expect(checkInvariants(base(), assets)).toEqual([]);
  });

  test('detects gap between entries', () => {
    const edl = base();
    edl.timeline[1].start_ms = 1100;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/gap|overlap/i);
  });

  test('detects overlap between entries', () => {
    const edl = base();
    edl.timeline[1].start_ms = 900;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/gap|overlap/i);
  });

  test('detects timeline not ending at duration_ms', () => {
    const edl = base();
    edl.timeline[1].end_ms = 1900;
    expect(checkInvariants(edl, assets).length).toBeGreaterThan(0);
  });

  test('detects off-beat cut in montage mode', () => {
    const edl = base();
    edl.timeline[0].end_ms = 940; // nearest beat 1000 -> off by 60ms > 33ms
    edl.timeline[1].start_ms = 940;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/beat/i);
  });

  test('allows cut within 33ms of a beat', () => {
    const edl = base();
    edl.timeline[0].end_ms = 1020;
    edl.timeline[1].start_ms = 1020;
    expect(checkInvariants(edl, assets)).toEqual([]);
  });

  test('edit mode allows half-beat cuts, montage does not', () => {
    const edl = base({mode: 'edit'});
    edl.timeline[0].end_ms = 750; // half-beat between 500 and 1000
    edl.timeline[1].start_ms = 750;
    expect(checkInvariants(edl, assets)).toEqual([]);
    const montage = base();
    montage.timeline[0].end_ms = 750;
    montage.timeline[1].start_ms = 750;
    expect(checkInvariants(montage, assets).join(' ')).toMatch(/beat/i);
  });

  test('narrative mode skips beat snapping', () => {
    const edl = base({mode: 'narrative'});
    edl.timeline[0].end_ms = 940;
    edl.timeline[1].start_ms = 940;
    expect(checkInvariants(edl, assets)).toEqual([]);
  });

  test('detects unknown asset reference', () => {
    const edl = base();
    edl.timeline[0].asset = 'MISSING';
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/MISSING/);
  });

  test('detects text overrunning its entry', () => {
    const edl = base();
    edl.timeline[0].text = {
      content: 'x', style: 'caption_lower', in_ms: 100, out_ms: 1200, anchor: 'center',
    };
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/text/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/edl/time.test.ts src/edl/invariants.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/edl/time.ts`:

```ts
export const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms / 1000) * fps);
```

`src/edl/invariants.ts`:

```ts
import type {Edl} from './schema';

const BEAT_TOLERANCE_MS = 33;

const withHalfBeats = (grid: number[]): number[] =>
  grid.flatMap((v, i) => (i < grid.length - 1 ? [v, (v + grid[i + 1]) / 2] : [v]));

const nearBeat = (ms: number, grid: number[]): boolean =>
  grid.some((g) => Math.abs(g - ms) <= BEAT_TOLERANCE_MS);

// Hard invariants beyond Zod's reach (Tech Spec §6). Returns human-readable
// violations — empty array means valid. Messages are fed back to the Director
// repair loop verbatim, so keep them specific.
export const checkInvariants = (edl: Edl, assetIds: Set<string>): string[] => {
  const errors: string[] = [];
  const t = edl.timeline;

  if (t[0].start_ms !== 0) {
    errors.push(`timeline must start at 0, got ${t[0].start_ms}`);
  }
  for (const [i, e] of t.entries()) {
    if (e.end_ms <= e.start_ms) {
      errors.push(`entry ${i} (${e.asset}): end_ms ${e.end_ms} <= start_ms ${e.start_ms}`);
    }
    if (i > 0 && e.start_ms !== t[i - 1].end_ms) {
      errors.push(
        `gap/overlap: entry ${i} starts at ${e.start_ms} but entry ${i - 1} ends at ${t[i - 1].end_ms}`,
      );
    }
    if (!assetIds.has(e.asset)) {
      errors.push(`entry ${i} references unknown asset "${e.asset}"`);
    }
    if (e.text) {
      const entryLen = e.end_ms - e.start_ms;
      if (e.text.out_ms <= e.text.in_ms || e.text.out_ms > entryLen) {
        errors.push(
          `entry ${i} text window [${e.text.in_ms}, ${e.text.out_ms}] invalid for entry length ${entryLen}`,
        );
      }
    }
  }
  const last = t[t.length - 1];
  if (last.end_ms !== edl.duration_ms) {
    errors.push(`timeline ends at ${last.end_ms} but duration_ms is ${edl.duration_ms}`);
  }

  if (edl.mode !== 'narrative' && edl.audio.beat_grid_ms.length > 0) {
    const grid =
      edl.mode === 'edit' ? withHalfBeats(edl.audio.beat_grid_ms) : edl.audio.beat_grid_ms;
    for (let i = 1; i < t.length; i++) {
      if (!nearBeat(t[i].start_ms, grid)) {
        errors.push(
          `cut at ${t[i].start_ms}ms is not within ${BEAT_TOLERANCE_MS}ms of a beat (${edl.mode} mode)`,
        );
      }
    }
  }

  return errors;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/edl/time.test.ts src/edl/invariants.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/src/edl
git commit -m "feat(renderer): EDL hard invariants (coverage, beat snap, assets) + time helpers"
```

---

### Task 4: Fixture generator (placeholder media, click track, golden montage EDL)

**Files:**
- Create: `renderer/scripts/make-fixtures.mjs`
- Create (generated, committed): `renderer/fixtures/montage.json`
- Create (generated, gitignored): `renderer/public/assets/IMG_001.svg` … `IMG_012.svg`, `renderer/public/assets/click_120bpm.wav`
- Test: `renderer/src/edl/fixture.test.ts`

**Interfaces:**
- Produces: `fixtures/montage.json` with shape `{edl: Edl, assets: Record<string, string>}` where asset values are `staticFile`-relative paths (e.g. `"assets/IMG_001.svg"`). This is exactly the props shape the `Reel` composition consumes (Task 7). 12 s montage, 120 BPM (beats every 500 ms), 12 shots × 1000 ms, all cuts on beats, `caption_lower` text on shot 1, `kinetic_word` on shot 7.

- [ ] **Step 1: Write `scripts/make-fixtures.mjs`**

```js
// Generates deterministic placeholder media + the golden montage fixture.
// Run: npm run fixtures  (from renderer/)
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'public', 'assets');
const fixturesDir = join(root, 'fixtures');
mkdirSync(assetsDir, {recursive: true});
mkdirSync(fixturesDir, {recursive: true});

// ---- 12 gradient placeholder stills (1080x1920 SVG) ----
const palette = [
  ['#f5b971', '#8c3b4a'], ['#2b4b6f', '#0e1c2b'], ['#d98e73', '#5a2a3b'],
  ['#7fb7a3', '#2a4a44'], ['#e0c26e', '#7a4a2a'], ['#9a8ec7', '#3b2a5a'],
  ['#c76e6e', '#4a1f2b'], ['#6ea3c7', '#1f3b4a'], ['#c7b06e', '#4a3b1f'],
  ['#8cc76e', '#2b4a1f'], ['#c76ea3', '#4a1f3b'], ['#6ec7c0', '#1f4a47'],
];
const svg = (i, [c1, c2]) => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="1080" height="1920" fill="url(#g)"/>
<circle cx="${280 + (i % 3) * 260}" cy="${640 + (i % 4) * 180}" r="150" fill="rgba(255,255,255,0.22)"/>
<text x="540" y="1010" font-size="230" font-family="Arial" font-weight="bold"
 fill="rgba(255,255,255,0.9)" text-anchor="middle">${String(i + 1).padStart(2, '0')}</text>
</svg>`;

const assets = {};
for (let i = 0; i < 12; i++) {
  const id = `IMG_${String(i + 1).padStart(3, '0')}`;
  writeFileSync(join(assetsDir, `${id}.svg`), svg(i, palette[i]));
  assets[id] = `assets/${id}.svg`;
}

// ---- click track: 120 BPM, 24 beats = 12s, downbeat accent every 4th ----
const sampleRate = 44100;
const bpm = 120;
const beats = 24;
const beatMs = 60000 / bpm;
const totalSamples = Math.ceil(((beats * beatMs) / 1000) * sampleRate);
const pcm = new Int16Array(totalSamples);
for (let b = 0; b < beats; b++) {
  const start = Math.floor(((b * beatMs) / 1000) * sampleRate);
  const freq = b % 4 === 0 ? 1320 : 880;
  const clickLen = Math.floor(0.04 * sampleRate);
  for (let n = 0; n < clickLen && start + n < totalSamples; n++) {
    const env = Math.exp(-n / (clickLen / 5));
    pcm[start + n] = Math.round(0.6 * 32767 * env * Math.sin((2 * Math.PI * freq * n) / sampleRate));
  }
}
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
Buffer.from(pcm.buffer).copy(wav, 44);
writeFileSync(join(assetsDir, 'click_120bpm.wav'), wav);
assets['click_120bpm'] = 'assets/click_120bpm.wav';

// ---- golden montage EDL: 12 shots x 1000ms, cuts on beats ----
const shotMs = 1000;
const timeline = Array.from({length: 12}, (_, i) => {
  const zoomIn = i % 2 === 0;
  const entry = {
    asset: `IMG_${String(i + 1).padStart(3, '0')}`,
    kind: 'still',
    start_ms: i * shotMs,
    end_ms: (i + 1) * shotMs,
    motion: {
      type: 'ken_burns',
      from: {zoom: zoomIn ? 1.0 : 1.22, cx: 0.5, cy: 0.45},
      to: {zoom: zoomIn ? 1.18 : 1.02, cx: zoomIn ? 0.56 : 0.44, cy: 0.4},
      easing: 'easeOutCubic',
    },
    effects: [],
  };
  if (i === 0) {
    entry.text = {content: 'golden hour', style: 'caption_lower', in_ms: 100, out_ms: 900, anchor: 'lower_third'};
  }
  if (i === 6) {
    entry.text = {content: 'slow light', style: 'kinetic_word', in_ms: 0, out_ms: 1000, anchor: 'center'};
  }
  return entry;
});

const edl = {
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 12000,
  audio: {
    track: 'assets/click_120bpm.wav',
    trim_start_ms: 0,
    beat_grid_ms: Array.from({length: beats}, (_, i) => i * beatMs),
    voiceover: null,
    mute_render: false,
  },
  timeline,
};

writeFileSync(join(fixturesDir, 'montage.json'), JSON.stringify({edl, assets}, null, 2));
console.log('fixtures written: 12 SVGs, click_120bpm.wav, fixtures/montage.json');
```

- [ ] **Step 2: Run the generator**

Run: `npm run fixtures`
Expected: `fixtures written: 12 SVGs, click_120bpm.wav, fixtures/montage.json`; files exist under `public/assets/` and `fixtures/`.

- [ ] **Step 3: Write the failing golden-fixture test `src/edl/fixture.test.ts`**

```ts
import {expect, test} from 'vitest';
import fixture from '../../fixtures/montage.json';
import {EdlSchema} from './schema';
import {checkInvariants} from './invariants';

test('golden montage fixture passes schema + invariants', () => {
  const edl = EdlSchema.parse(fixture.edl);
  const errors = checkInvariants(edl, new Set(Object.keys(fixture.assets)));
  expect(errors).toEqual([]);
  expect(edl.duration_ms).toBe(12000);
  expect(edl.timeline).toHaveLength(12);
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/edl/fixture.test.ts`
Expected: PASS. (If it fails, the generator or invariants have a bug — fix the generator, not the test.)

- [ ] **Step 5: Commit**

```bash
git add renderer/scripts/make-fixtures.mjs renderer/fixtures/montage.json renderer/src/edl/fixture.test.ts
git commit -m "feat(renderer): fixture generator + golden montage EDL"
```

---

### Task 5: KenBurns math + component

**Files:**
- Create: `renderer/src/components/kenburns-math.ts`, `renderer/src/components/KenBurns.tsx`
- Test: `renderer/src/components/kenburns-math.test.ts`

**Interfaces:**
- Consumes: `KenBurnsMotion`, `EasingName` from `../edl/schema`.
- Produces: `kenBurnsAt(progress: number, motion: KenBurnsMotion): {zoom: number; txPct: number; tyPct: number}` (txPct/tyPct are percentage translations that center the focal point `cx,cy`); `<KenBurns src motion durationInFrames>` React component.

- [ ] **Step 1: Write the failing test `src/components/kenburns-math.test.ts`**

```ts
import {describe, expect, test} from 'vitest';
import type {KenBurnsMotion} from '../edl/schema';
import {kenBurnsAt} from './kenburns-math';

const motion: KenBurnsMotion = {
  type: 'ken_burns',
  from: {zoom: 1.0, cx: 0.5, cy: 0.5},
  to: {zoom: 1.2, cx: 0.6, cy: 0.4},
  easing: 'linear',
};

describe('kenBurnsAt', () => {
  test('progress 0 returns the from state', () => {
    expect(kenBurnsAt(0, motion)).toEqual({zoom: 1.0, txPct: 0, tyPct: 0});
  });

  test('progress 1 returns the to state', () => {
    const r = kenBurnsAt(1, motion);
    expect(r.zoom).toBeCloseTo(1.2);
    expect(r.txPct).toBeCloseTo((0.5 - 0.6) * 100); // -10
    expect(r.tyPct).toBeCloseTo((0.5 - 0.4) * 100); // +10
  });

  test('clamps progress outside [0,1]', () => {
    expect(kenBurnsAt(-0.5, motion)).toEqual(kenBurnsAt(0, motion));
    expect(kenBurnsAt(1.5, motion)).toEqual(kenBurnsAt(1, motion));
  });

  test('easeOutCubic front-loads the motion', () => {
    const eased = kenBurnsAt(0.5, {...motion, easing: 'easeOutCubic'});
    // easeOutCubic(0.5) = 0.875 -> zoom = 1 + 0.875*0.2
    expect(eased.zoom).toBeCloseTo(1.175);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/kenburns-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/components/kenburns-math.ts`:

```ts
import type {EasingName, KenBurnsMotion} from '../edl/schema';

const easings: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeInCubic: (t) => t ** 3,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
};

export const kenBurnsAt = (
  progress: number,
  motion: KenBurnsMotion,
): {zoom: number; txPct: number; tyPct: number} => {
  const p = Math.min(1, Math.max(0, progress));
  const e = easings[motion.easing](p);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  const zoom = lerp(motion.from.zoom, motion.to.zoom);
  const cx = lerp(motion.from.cx, motion.to.cx);
  const cy = lerp(motion.from.cy, motion.to.cy);
  // translate so the focal point (cx, cy) sits at frame center
  return {zoom, txPct: (0.5 - cx) * 100, tyPct: (0.5 - cy) * 100};
};
```

`src/components/KenBurns.tsx`:

```tsx
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import type {KenBurnsMotion} from '../edl/schema';
import {kenBurnsAt} from './kenburns-math';

export const KenBurns: React.FC<{
  src: string;
  motion: KenBurnsMotion;
  durationInFrames: number;
}> = ({src, motion, durationInFrames}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  const {zoom, txPct, tyPct} = kenBurnsAt(progress, motion);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${zoom}) translate(${txPct}%, ${tyPct}%)`,
        }}
      />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/kenburns-math.test.ts` — Expected: PASS (4 tests).
Run: `npm run typecheck` — Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/components
git commit -m "feat(renderer): KenBurns motion (tested math + component)"
```

---

### Task 6: Anchors + type styles (CaptionLower, KineticWord)

**Files:**
- Create: `renderer/src/components/anchors.ts`, `renderer/src/components/text/kinetic-timing.ts`, `renderer/src/components/text/CaptionLower.tsx`, `renderer/src/components/text/KineticWord.tsx`, `renderer/src/components/text/TextOverlay.tsx`
- Test: `renderer/src/components/anchors.test.ts`, `renderer/src/components/text/kinetic-timing.test.ts`

**Interfaces:**
- Consumes: `Anchor`, `TextSpec` from `../edl/schema`; `msToFrame` from `../edl/time`; `theme`.
- Produces: `anchorStyle(anchor: Anchor): React.CSSProperties`; `kineticWordTimings(content: string, inMs: number, outMs: number, beatsMs: number[]): {word: string; atMs: number}[]`; `<TextOverlay text={TextSpec} entryStartMs entryDurationMs beatGridMs fps>` — the single entry point Task 7's `Shot` uses (it dispatches by `text.style`; unknown styles fall back to `CaptionLower`, `none` renders nothing).

- [ ] **Step 1: Write failing tests**

`src/components/anchors.test.ts`:

```ts
import {describe, expect, test} from 'vitest';
import {anchorStyle} from './anchors';

// IG safe areas: 12% top / 20% bottom / 10% right must stay clear.
describe('anchorStyle', () => {
  test('lower_third clears the 20% bottom margin', () => {
    const s = anchorStyle('lower_third');
    expect(parseFloat(String(s.bottom))).toBeGreaterThanOrEqual(20);
  });
  test('upper_safe clears the 12% top margin', () => {
    const s = anchorStyle('upper_safe');
    expect(parseFloat(String(s.top))).toBeGreaterThanOrEqual(12);
  });
  test('every anchor clears the 10% right margin', () => {
    for (const a of ['lower_third', 'center', 'upper_safe', 'corner_br'] as const) {
      expect(parseFloat(String(anchorStyle(a).right))).toBeGreaterThanOrEqual(10);
    }
  });
});
```

`src/components/text/kinetic-timing.test.ts`:

```ts
import {describe, expect, test} from 'vitest';
import {kineticWordTimings} from './kinetic-timing';

describe('kineticWordTimings', () => {
  test('assigns words to consecutive beats when enough beats exist', () => {
    const r = kineticWordTimings('slow light', 0, 1000, [0, 500, 1000, 1500]);
    expect(r).toEqual([
      {word: 'slow', atMs: 0},
      {word: 'light', atMs: 500},
    ]);
  });

  test('ignores beats outside the [in, out) window', () => {
    const r = kineticWordTimings('slow light', 200, 1000, [0, 500, 1000]);
    expect(r).toEqual([{word: 'slow', atMs: 500}, {word: 'light', atMs: 600}]);
    // only 1 usable beat for 2 words -> falls back to even spread from inMs
  });

  test('falls back to even spread when beats are insufficient', () => {
    const r = kineticWordTimings('one two three four', 0, 1000, []);
    expect(r.map((x) => x.atMs)).toEqual([0, 250, 500, 750]);
  });

  test('collapses whitespace', () => {
    expect(kineticWordTimings('  a   b ', 0, 1000, [0, 500]).map((x) => x.word)).toEqual(['a', 'b']);
  });
});
```

Note the second test's expectation: with 2 words and only 1 usable beat, the function uses the even-spread fallback across `[in, out)` → `200 + 0*400 = 200`? No — spread is `(1000-200)/2 = 400`, giving `[200, 600]`. **The expected value for the first word is `200`, not `500`.** Write the test as:

```ts
  test('ignores beats outside the [in, out) window', () => {
    const r = kineticWordTimings('slow light', 200, 1000, [0, 500, 1000]);
    // beats in window: [500] — insufficient for 2 words -> even spread
    expect(r).toEqual([{word: 'slow', atMs: 200}, {word: 'light', atMs: 600}]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/anchors.test.ts src/components/text/kinetic-timing.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/components/anchors.ts`:

```ts
import type React from 'react';
import type {Anchor} from '../edl/schema';

// IG UI margins: 12% top / 20% bottom / 10% right (PRD F5). Values chosen
// to sit just inside those margins.
export const anchorStyle = (anchor: Anchor): React.CSSProperties => {
  switch (anchor) {
    case 'lower_third':
      return {position: 'absolute', left: '8%', right: '12%', bottom: '22%', textAlign: 'left'};
    case 'center':
      return {
        position: 'absolute', left: '10%', right: '12%', top: '50%',
        transform: 'translateY(-50%)', textAlign: 'center',
      };
    case 'upper_safe':
      return {position: 'absolute', left: '8%', right: '12%', top: '14%', textAlign: 'left'};
    case 'corner_br':
      return {position: 'absolute', right: '12%', bottom: '22%', textAlign: 'right'};
  }
};
```

`src/components/text/kinetic-timing.ts`:

```ts
// Word-by-word reveal times for kinetic_word: one word per beat inside the
// text window; if the window has fewer beats than words, spread evenly.
export const kineticWordTimings = (
  content: string,
  inMs: number,
  outMs: number,
  beatsMs: number[],
): {word: string; atMs: number}[] => {
  const words = content.split(/\s+/).filter(Boolean);
  const usable = beatsMs.filter((b) => b >= inMs && b < outMs);
  if (usable.length >= words.length) {
    return words.map((word, i) => ({word, atMs: usable[i]}));
  }
  const step = (outMs - inMs) / words.length;
  return words.map((word, i) => ({word, atMs: inMs + i * step}));
};
```

`src/components/text/CaptionLower.tsx`:

```tsx
import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {Anchor} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {anchorStyle} from '../anchors';

export const CaptionLower: React.FC<{
  content: string;
  inMs: number;
  outMs: number;
  anchor: Anchor;
  fps: number;
}> = ({content, inMs, outMs, anchor, fps}) => {
  const frame = useCurrentFrame();
  const inF = msToFrame(inMs, fps);
  const outF = msToFrame(outMs, fps);
  if (frame < inF || frame > outF) return null;
  const fade = Math.max(1, Math.min(Math.round(fps * 0.2), Math.floor((outF - inF) / 3)));
  const opacity = interpolate(frame, [inF, inF + fade, outF - fade, outF], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        ...anchorStyle(anchor),
        opacity,
        color: theme.colors.text,
        fontFamily: theme.fonts.caption,
        fontSize: 44,
        letterSpacing: '0.14em',
        textTransform: 'lowercase',
        textShadow: `0 2px 24px ${theme.colors.shadow}`,
      }}
    >
      {content}
    </div>
  );
};
```

`src/components/text/KineticWord.tsx`:

```tsx
import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {Anchor} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {anchorStyle} from '../anchors';
import {kineticWordTimings} from './kinetic-timing';

export const KineticWord: React.FC<{
  content: string;
  inMs: number;
  outMs: number;
  anchor: Anchor;
  beatsMs: number[]; // relative to the entry start, same frame of reference as inMs/outMs
  fps: number;
}> = ({content, inMs, outMs, anchor, beatsMs, fps}) => {
  const frame = useCurrentFrame();
  if (frame > msToFrame(outMs, fps)) return null;
  const timings = kineticWordTimings(content, inMs, outMs, beatsMs);
  const pop = Math.max(1, Math.round(fps * 0.15));
  return (
    <div
      style={{
        ...anchorStyle(anchor),
        color: theme.colors.text,
        fontFamily: theme.fonts.editorial,
        fontSize: 76,
        fontWeight: 700,
        textShadow: `0 2px 28px ${theme.colors.shadow}`,
      }}
    >
      {timings.map(({word, atMs}, i) => {
        const atF = msToFrame(atMs, fps);
        const scale = interpolate(frame, [atF, atF + pop], [1.5, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              marginRight: '0.3em',
              opacity: frame >= atF ? 1 : 0,
              transform: `scale(${scale})`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
```

`src/components/text/TextOverlay.tsx`:

```tsx
import React from 'react';
import type {TextSpec} from '../../edl/schema';
import {CaptionLower} from './CaptionLower';
import {KineticWord} from './KineticWord';

// M0 builds 2 of the 5 type styles; the rest fall back to CaptionLower so any
// valid EDL still renders. Later milestones replace the fallback cases.
export const TextOverlay: React.FC<{
  text: TextSpec;
  entryStartMs: number;
  beatGridMs: number[];
  fps: number;
}> = ({text, entryStartMs, beatGridMs, fps}) => {
  if (text.style === 'none') return null;
  if (text.style === 'kinetic_word') {
    const relBeats = beatGridMs.map((b) => b - entryStartMs);
    return (
      <KineticWord
        content={text.content}
        inMs={text.in_ms}
        outMs={text.out_ms}
        anchor={text.anchor}
        beatsMs={relBeats}
        fps={fps}
      />
    );
  }
  return (
    <CaptionLower
      content={text.content}
      inMs={text.in_ms}
      outMs={text.out_ms}
      anchor={text.anchor}
      fps={fps}
    />
  );
};
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components` — Expected: PASS (anchors 3, kinetic-timing 4, kenburns-math 4).
Run: `npm run typecheck` — Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/components
git commit -m "feat(renderer): anchors + caption_lower and kinetic_word type styles"
```

---

### Task 7: Reel composition + Root wiring with validation

**Files:**
- Create: `renderer/src/Reel.tsx`
- Modify: `renderer/src/Root.tsx` (replace the Task 1 placeholder entirely)

**Interfaces:**
- Consumes: everything above. Props shape: `{edl: Edl, assets: Record<string, string>}` — exactly `fixtures/montage.json`.
- Produces: registered composition `id="Reel"`, 1080×1920; `calculateMetadata` Zod-parses the EDL, runs `checkInvariants`, throws with joined messages on failure, and derives `durationInFrames` from `edl.duration_ms`.

- [ ] **Step 1: Write `src/Reel.tsx`**

```tsx
import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, staticFile} from 'remotion';
import type {Edl, TimelineEntry} from './edl/schema';
import {msToFrame} from './edl/time';
import {KenBurns} from './components/KenBurns';
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
}> = ({entry, src, beatGridMs, fps}) => {
  const durF = msToFrame(entry.end_ms, fps) - msToFrame(entry.start_ms, fps);
  return (
    <AbsoluteFill>
      {entry.motion && entry.motion.type === 'ken_burns' ? (
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

// M0: transitions are hard cuts (transition_out ignored); effects not rendered.
export const Reel: React.FC<ReelProps> = ({edl, assets}) => {
  const fps = edl.fps;
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {edl.timeline.map((entry) => {
        const from = msToFrame(entry.start_ms, fps);
        const durF = msToFrame(entry.end_ms, fps) - from;
        return (
          <Sequence key={`${entry.asset}-${entry.start_ms}`} from={from} durationInFrames={durF}>
            <Shot
              entry={entry}
              src={staticFile(assets[entry.asset])}
              beatGridMs={edl.audio.beat_grid_ms}
              fps={fps}
            />
          </Sequence>
        );
      })}
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

- [ ] **Step 2: Replace `src/Root.tsx`**

```tsx
import React from 'react';
import {CalculateMetadataFunction, Composition} from 'remotion';
import fixture from '../fixtures/montage.json';
import {Reel, ReelProps} from './Reel';
import {EdlSchema} from './edl/schema';
import {checkInvariants} from './edl/invariants';
import {msToFrame} from './edl/time';

// Validation gate: schema + hard invariants run before any frame renders.
// This is the render half of the Zod-validate -> repair-loop contract.
const calculateMetadata: CalculateMetadataFunction<ReelProps> = ({props}) => {
  const edl = EdlSchema.parse(props.edl);
  const errors = checkInvariants(edl, new Set(Object.keys(props.assets)));
  if (errors.length > 0) {
    throw new Error(`EDL invariant violations:\n${errors.join('\n')}`);
  }
  return {
    durationInFrames: msToFrame(edl.duration_ms, edl.fps),
    fps: edl.fps,
    props: {...props, edl},
  };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    durationInFrames={360}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={fixture as ReelProps}
    calculateMetadata={calculateMetadata}
  />
);
```

- [ ] **Step 3: Typecheck and run all tests**

Run: `npm run typecheck` — Expected: exits 0. (If the JSON import type doesn't satisfy `ReelProps`, keep the `as ReelProps` cast — runtime safety comes from the Zod parse in `calculateMetadata`.)
Run: `npm test` — Expected: all tests PASS.

- [ ] **Step 4: Eyeball in Studio**

Run: `npm run studio` (leave running, open the printed URL).
Expected: the `Reel` composition loads at 1080×1920, 360 frames; scrubbing shows gradient stills with slow zoom/drift, "golden hour" caption on shot 1, "slow light" popping word-by-word on shot 7, click track audible on beats/cuts. Stop the studio after checking.

- [ ] **Step 5: Commit**

```bash
git add renderer/src
git commit -m "feat(renderer): Reel composition mapping EDL to sequences with validation gate"
```

---

### Task 8: Render the golden fixture to MP4 (M0 exit criterion)

**Files:**
- Create: `renderer/out/reel.mp4` (build artifact, gitignored)

**Interfaces:**
- Consumes: everything above via `npm run render`.

- [ ] **Step 1: Prove the validation gate rejects a broken EDL**

Create a throwaway broken props file `renderer/out/broken.json` by copying `fixtures/montage.json` and changing the first entry's `end_ms` from `1000` to `940` (and the second entry's `start_ms` to `940`).
Run: `npx remotion render Reel out/should-fail.mp4 --props=out/broken.json`
Expected: render FAILS with `EDL invariant violations` mentioning the off-beat cut. Delete `out/broken.json` afterwards.

- [ ] **Step 2: Render the golden fixture**

Run: `npm run render`
Expected: progress bar completes; `out/reel.mp4` created.

- [ ] **Step 3: Verify the output file**

Run (PowerShell, from `renderer/`): `Get-Item out/reel.mp4 | Select-Object Length`
Expected: Length > 100000 (non-trivial file). The render log must show 360 frames at 1080×1920.

- [ ] **Step 4: Watch it**

Open `out/reel.mp4` in a player. Expected: 12 s montage, cuts land on the click, KenBurns drift on every shot, both text styles visible, text inside safe areas.

- [ ] **Step 5: Commit**

```bash
git add renderer
git commit -m "feat(renderer): M0 complete - golden montage EDL renders to MP4"
```

---

## Self-Review

1. **Spec coverage (M0 = PRD §7 M0 + Tech Spec §6/§8 subset):** Remotion project ✓ (Task 1); hand-written EDL ✓ (Task 4 golden fixture); `<KenBurns>` ✓ (Task 5); beat cuts ✓ (Tasks 3 invariant + 4 fixture + 8 audible verification); 2 type styles ✓ (Task 6); Zod validation + hard invariants before render ✓ (Tasks 2, 3, 7); 1080×1920@30 H.264 ✓ (Tasks 7, 8); fixtures as the design-iteration loop ✓ (Tech Spec §8, Tasks 4, 7). Deliberately out of M0 scope (later milestones): transitions beyond cut, effects overlays, remaining 3 type styles, clips/speed ramps, Veo, Director repair loop, GCP/Telegram — schema already covers their vocabulary so the contract won't change.
2. **Placeholder scan:** none — every code step has complete code; fallback behaviors (non-cut transitions → cut, unknown text styles → CaptionLower) are explicit decisions, not TODOs.
3. **Type consistency:** `msToFrame(ms, fps)` used identically in Tasks 3/6/7; `kenBurnsAt` returns `{zoom, txPct, tyPct}` in both Task 5 files; `TextOverlay` props (`text, entryStartMs, beatGridMs, fps`) match between Task 6 definition and Task 7 usage; props shape `{edl, assets}` identical in Task 4 fixture, Task 7 Root, and the render command.
