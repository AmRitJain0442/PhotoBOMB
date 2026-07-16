// Shared fixtures for orchestrator tests: a fake repo on disk, a scripted
// transport, canned media pool / plan / EDL payloads.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {MediaPool, ProductionPlan, TrackInfo} from './contracts.js';
import type {GeminiRequest, GeminiTransport, GeminiUsage} from './gemini.js';
import type {PipelineDeps} from './pipeline.js';

export const USAGE: GeminiUsage = {inputTokens: 10, outputTokens: 5, thoughtsTokens: 2};

export const TRACKS: TrackInfo[] = [
  {
    id: 'songa',
    file: 'songa.wav',
    bpm: 120,
    beat_grid_ms: [0, 500, 1000, 1500, 2000],
    energy_curve: [0.4, 0.8],
    duration_ms: 12000,
    mood: 'warm',
    feel: 'steady pulse',
  },
  {
    id: 'songb',
    file: 'songb.wav',
    bpm: 84,
    beat_grid_ms: [0, 714, 1428, 2142],
    energy_curve: [0.3, 0.5],
    duration_ms: 20000,
    mood: 'calm',
    feel: 'soft and slow',
  },
];

export const MEDIA_POOL: MediaPool = {
  pool: ['img0', 'img1', 'img2', 'img3'].map((id) => ({
    id,
    file: `${id}.jpg`,
    type: 'still',
    has_cutout: id === 'img0' || id === 'img1',
    exif: {ts: null, gps: null},
    analysis: {
      aesthetic_score: 8,
      description: `photo ${id}`,
      subject: 'texture',
      subject_bbox: [0.4, 0.4, 0.6, 0.6],
      dominant_colors: ['#888888'],
      mood_tags: ['warm'],
      energy: 'medium',
      orientation: 'portrait',
      quality_flags: [],
    },
  })),
  rejects: [{file: 'img9.jpg', reason: 'too blurry'}],
};

export const PLAN: ProductionPlan = {
  story: {read: 'a warm evening set', type: 'aesthetic_series', arc_possible: false},
  mode: 'montage',
  duration_ms: 2000,
  selects: ['img0', 'img1', 'img2', 'img3'],
  rejects: [],
  hero_shots: [],
  audio: {track_id: 'songa', reason: '120 bpm, warm', trim_start_ms: 0},
  typography_direction: 'sparse lowercase',
  quote: {
    lines: [
      [
        {text: 'stay for the', bold: false, underline: false, tone: 'white' as const},
        {text: 'light', bold: true, underline: false, tone: 'yellow' as const},
      ],
    ],
  },
  voiceover: null,
  captions: {short: 'golden hour', long: 'A warm evening in four frames.'},
  hashtags: ['goldenhour'],
};

export const goodEdl = (track = 'assets/audio/songa.wav') => ({
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 2000,
  audio: {
    track,
    trim_start_ms: 0,
    beat_grid_ms: [0, 500, 1000, 1500, 2000],
    voiceover: null,
    mute_render: false,
  },
  timeline: ['img0', 'img1', 'img2', 'img3'].map((asset, i) => ({
    asset,
    kind: 'still',
    start_ms: i * 500,
    end_ms: (i + 1) * 500,
    effects: [],
  })),
});

// cut at 940 — 60ms off the 500ms grid (invariant violation, schema-valid)
export const offBeatEdl = () => {
  const edl = goodEdl();
  edl.timeline = [
    {asset: 'img0', kind: 'still', start_ms: 0, end_ms: 940, effects: []},
    {asset: 'img1', kind: 'still', start_ms: 940, end_ms: 2000, effects: []},
  ];
  return edl;
};

/** Scripted transport: returns queued texts in order, records every request. */
export const makeTransport = (texts: string[]) => {
  const calls: GeminiRequest[] = [];
  const transport: GeminiTransport = async (req) => {
    calls.push(req);
    const text = texts.shift();
    if (text === undefined) throw new Error('transport queue exhausted');
    return {text, usage: {...USAGE}};
  };
  return {transport, calls};
};

/** Fake spawnPy: pretends analyze_media ran and writes MEDIA_POOL to --out. */
export const fakeSpawnPy =
  (pool: MediaPool = MEDIA_POOL, code = 0) =>
  async (_script: string, args: string[]) => {
    if (code !== 0) return {code, stdout: JSON.stringify({error: 'not_enough_photos'})};
    const out = args[args.indexOf('--out') + 1];
    await mkdir(path.dirname(out), {recursive: true});
    await writeFile(out, JSON.stringify(pool), 'utf8');
    return {code: 0, stdout: ''};
  };

/** Fake repo scaffold: prompts, audio library + files, renderer audio dir. */
export async function makeRepo(root: string, tracks: TrackInfo[] = TRACKS): Promise<void> {
  await mkdir(path.join(root, 'prompts'), {recursive: true});
  await writeFile(path.join(root, 'prompts', 'producer.md'), 'producer system prompt', 'utf8');
  await writeFile(
    path.join(root, 'prompts', 'director_montage.md'),
    'director system prompt',
    'utf8',
  );
  await mkdir(path.join(root, 'audio-library'), {recursive: true});
  await writeFile(path.join(root, 'audio-library', 'index.json'), JSON.stringify(tracks), 'utf8');
  for (const t of tracks) {
    await writeFile(path.join(root, 'audio-library', t.file), 'RIFFfake', 'utf8');
  }
  await mkdir(path.join(root, 'renderer', 'public', 'assets', 'audio'), {recursive: true});
}

export const makeDeps = (
  root: string,
  transport: GeminiTransport,
  spawnPy = fakeSpawnPy(),
): PipelineDeps => ({
  transport,
  repoRoot: root,
  directorModel: 'gemini-2.5-flash',
  spawnPy,
});
