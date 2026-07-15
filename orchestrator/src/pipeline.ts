// The M1 pipeline: analyze → produce → direct → finalize, plus revise
// (pin a track / remove a photo → re-direct only).
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import type {Edl} from '../../renderer/src/edl/schema.js';
import {
  PipelineError,
  type MediaPool,
  type ProductionPlan,
  type RunMeta,
  type StageName,
} from './contracts.js';
import {MODELS, type GeminiTransport} from './gemini.js';
import {runDir} from './paths.js';
import {runAnalyze} from './stages/analyze.js';
import {chooseTrackSet, loadTracks} from './stages/audio.js';
import {runDirect} from './stages/direct.js';
import {runFinalize} from './stages/finalize.js';
import {runProduce} from './stages/produce.js';

export type {StageName} from './contracts.js';
export type Progress = (stage: StageName, state: 'running' | 'done') => void;

export type PipelineDeps = {
  transport: GeminiTransport;
  repoRoot: string;
  directorModel: string;
  spawnPy: (script: string, args: string[]) => Promise<{code: number; stdout: string}>;
};

export type RunResult = {
  runId: string;
  edl: Edl;
  plan: ProductionPlan;
  mediaPool: MediaPool;
  meta: RunMeta;
};

export type Avoid = {track_id?: string; summary?: string};

const newRunId = (): string => `p${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

export function resolveDirectorModel(env: Record<string, string | undefined>): string {
  return env.DARKROOM_DIRECTOR_MODEL === 'pro' ? MODELS.pro : MODELS.flash;
}

/** Real spawnPy: `py -3 <script> ...` with `python` fallback, cwd repoRoot. */
export function makeSpawnPy(repoRoot: string): PipelineDeps['spawnPy'] {
  const tryRun = (cmd: string, args: string[]) =>
    new Promise<{code: number; stdout: string}>((resolve, reject) => {
      const child = spawn(cmd, args, {cwd: repoRoot, windowsHide: true});
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({code: code ?? 1, stdout: out}));
    });
  return async (script, args) => {
    try {
      return await tryRun('py', ['-3', script, ...args]);
    } catch {
      return tryRun('python', [script, ...args]);
    }
  };
}

export async function runPipeline(
  opts: {photosDir: string; track: 'auto' | string; avoid?: Avoid; deps: PipelineDeps},
  onProgress: Progress,
): Promise<RunResult> {
  const {deps} = opts;
  const runId = newRunId();

  onProgress('analyze', 'running');
  const mediaPool = await runAnalyze(deps, opts.photosDir, runId);
  onProgress('analyze', 'done');

  onProgress('produce', 'running');
  const allTracks = await loadTracks(deps.repoRoot);
  const {tracks, pinned} = chooseTrackSet(allTracks, opts.track);
  const produced = await runProduce(deps, {mediaPool, tracks, pinned, avoid: opts.avoid});
  const chosen =
    allTracks.find((t) => t.id === produced.plan.audio.track_id) ?? pinned ?? tracks[0];
  onProgress('produce', 'done');

  onProgress('direct', 'running');
  const directed = await runDirect(deps, {plan: produced.plan, mediaPool, track: chosen});
  onProgress('direct', 'done');

  onProgress('finalize', 'running');
  const result = await runFinalize(deps, {
    runId,
    edl: directed.edl,
    plan: produced.plan,
    mediaPool,
    track: chosen,
    usage: {produce: produced.usage, direct: directed.usage},
    avoid: opts.avoid,
  });
  onProgress('finalize', 'done');
  return result;
}

export async function revisePipeline(
  opts: {runId: string; pin?: string; removeAsset?: string; deps: PipelineDeps},
  onProgress: Progress,
): Promise<RunResult> {
  const {deps} = opts;
  const dir = runDir(deps.repoRoot, opts.runId);
  const [mediaPool, prevPlan, prevMeta] = (await Promise.all([
    readFile(path.join(dir, 'media_pool.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'production_plan.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'meta.json'), 'utf8').then(JSON.parse),
  ])) as [MediaPool, ProductionPlan, RunMeta];

  let plan: ProductionPlan = prevPlan;
  if (opts.pin) {
    plan = {
      ...plan,
      audio: {...plan.audio, track_id: opts.pin, reason: 'picked by the user'},
    };
  }
  if (opts.removeAsset) {
    const selects = plan.selects.filter((id) => id !== opts.removeAsset);
    if (selects.length < 3) {
      throw new PipelineError('direct', 'too_few_photos', 'a reel needs at least 3 photos');
    }
    plan = {...plan, selects};
  }

  const allTracks = await loadTracks(deps.repoRoot);
  const track = allTracks.find((t) => t.id === plan.audio.track_id);
  if (!track) {
    throw new PipelineError(
      'produce',
      'no_music',
      `track "${plan.audio.track_id}" is not in the library`,
    );
  }

  onProgress('direct', 'running');
  const directed = await runDirect(deps, {plan, mediaPool, track});
  onProgress('direct', 'done');

  onProgress('finalize', 'running');
  const result = await runFinalize(deps, {
    runId: newRunId(),
    edl: directed.edl,
    plan,
    mediaPool,
    track,
    usage: {direct: directed.usage},
    avoid: prevMeta.avoid ?? undefined,
  });
  onProgress('finalize', 'done');
  return result;
}
