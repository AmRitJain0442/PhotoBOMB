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
  type ReelStyle,
  type RunMeta,
  type StageName,
} from './contracts.js';
import {MODELS, type GeminiTransport, type ModelRef} from './gemini.js';
import {runDir} from './paths.js';
import {runAnalyze} from './stages/analyze.js';
import {runAnimate, type HeroClip} from './stages/animate.js';
import {chooseTrackSet, loadTracks} from './stages/audio.js';
import {runDirect} from './stages/direct.js';
import {runEnhance} from './stages/enhance.js';
import {runFilm} from './stages/film.js';
import {runFinalize, runFinalizeFilm} from './stages/finalize.js';
import {runProduce} from './stages/produce.js';

export type {StageName} from './contracts.js';
export type Progress = (stage: StageName, state: 'running' | 'done') => void;

export type PipelineDeps = {
  transport: GeminiTransport;
  repoRoot: string;
  directorModel: ModelRef;
  spawnPy: (script: string, args: string[]) => Promise<{code: number; stdout: string}>;
};

export type RunResult = {
  runId: string;
  edl: Edl;
  plan: ProductionPlan;
  mediaPool: MediaPool;
  meta: RunMeta;
  /** id -> renderer-relative path for every asset the EDL references */
  assetPaths: Record<string, string>;
};

export type Avoid = {track_id?: string; summary?: string};

const newRunId = (): string => `p${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

export function resolveDirectorModel(env: Record<string, string | undefined>): ModelRef {
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

const poolFile = (mediaPool: MediaPool, id: string): string | undefined =>
  mediaPool.pool.find((e) => e.id === id)?.file;

export async function runPipeline(
  opts: {
    photosDir: string;
    track: 'auto' | string;
    avoid?: Avoid;
    runId?: string;
    style?: ReelStyle;
    enhance?: boolean;
    deps: PipelineDeps;
  },
  onProgress: Progress,
): Promise<RunResult> {
  const {deps} = opts;
  const runId = opts.runId ?? newRunId();
  const style = opts.style ?? 'classic';
  const wantEnhance = (opts.enhance ?? false) && style !== 'film';

  onProgress('analyze', 'running');
  const mediaPool = await runAnalyze(deps, opts.photosDir, runId);
  onProgress('analyze', 'done');

  onProgress('produce', 'running');
  const allTracks = await loadTracks(deps.repoRoot);
  const {tracks, pinned} = chooseTrackSet(allTracks, opts.track);
  const produced = await runProduce(deps, {mediaPool, tracks, pinned, style, avoid: opts.avoid});
  const chosen =
    allTracks.find((t) => t.id === produced.plan.audio.track_id) ?? pinned ?? tracks[0];
  onProgress('produce', 'done');

  if (style === 'film') {
    onProgress('film', 'running');
    const refPaths = produced.plan.selects
      .map((id) => poolFile(mediaPool, id))
      .filter((f): f is string => Boolean(f))
      .map((f) => path.join(opts.photosDir, f));
    const film = await runFilm(deps, {
      refPaths,
      prompt: produced.plan.film_prompt ?? produced.plan.story.read,
      runId,
    });
    onProgress('film', 'done');

    onProgress('finalize', 'running');
    const result = await runFinalizeFilm(deps, {
      runId,
      plan: produced.plan,
      mediaPool,
      filmFile: film.file,
      durationMs: film.durationMs,
      usage: {produce: produced.usage},
      avoid: opts.avoid,
    });
    onProgress('finalize', 'done');
    return result;
  }

  let enhanced = new Map<string, string>();
  if (wantEnhance) {
    onProgress('enhance', 'running');
    enhanced = await runEnhance(deps, {photosDir: opts.photosDir, ids: produced.plan.selects});
    onProgress('enhance', 'done');
  }

  let clips = new Map<string, HeroClip>();
  if (style === 'live' && produced.plan.hero_shots.length > 0) {
    onProgress('animate', 'running');
    const heroes = produced.plan.hero_shots.flatMap((hero) => {
      const file = poolFile(mediaPool, hero.id);
      if (!file) return [];
      const enhancedPath = enhanced.get(hero.id);
      const sourcePath = enhancedPath
        ? path.join(deps.repoRoot, 'renderer', 'public', enhancedPath)
        : path.join(opts.photosDir, file);
      return [{id: hero.id, motionPrompt: hero.motion_prompt, sourcePath}];
    });
    clips = await runAnimate(deps, {heroes});
    onProgress('animate', 'done');
  }

  onProgress('direct', 'running');
  const directed = await runDirect(deps, {plan: produced.plan, mediaPool, track: chosen, clips});
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
    enhanced,
    clips,
    style,
    enhance: wantEnhance,
  });
  onProgress('finalize', 'done');
  return result;
}

export async function revisePipeline(
  opts: {
    runId: string;
    pin?: string;
    removeAsset?: string;
    asRunId?: string;
    deps: PipelineDeps;
  },
  onProgress: Progress,
): Promise<RunResult> {
  const {deps} = opts;
  const dir = runDir(deps.repoRoot, opts.runId);
  const [mediaPool, prevPlan, prevMeta] = (await Promise.all([
    readFile(path.join(dir, 'media_pool.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'production_plan.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'meta.json'), 'utf8').then(JSON.parse),
  ])) as [MediaPool, ProductionPlan, RunMeta];

  const derived = prevMeta.derived ?? {style: 'classic', enhance: false, enhanced: {}, clips: {}};
  if (derived.style === 'film') {
    throw new PipelineError('direct', 'film_no_tweaks', 'film takes can only be re-taken');
  }

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

  // rebuild derived media from the previous run, dropping removed selects
  const selectSet = new Set(plan.selects);
  const enhanced = new Map(
    Object.entries(derived.enhanced).filter(([id]) => selectSet.has(id)),
  );
  const clips = new Map(
    Object.entries(derived.clips)
      .filter(([id]) => selectSet.has(id))
      .map(([id, c]) => [id, {file: c.file, durationMs: c.duration_ms}]),
  );

  onProgress('direct', 'running');
  const directed = await runDirect(deps, {plan, mediaPool, track, clips});
  onProgress('direct', 'done');

  onProgress('finalize', 'running');
  const result = await runFinalize(deps, {
    runId: opts.asRunId ?? newRunId(),
    edl: directed.edl,
    plan,
    mediaPool,
    track,
    usage: {direct: directed.usage},
    avoid: prevMeta.avoid ?? undefined,
    enhanced,
    clips,
    style: derived.style,
    enhance: derived.enhance,
  });
  onProgress('finalize', 'done');
  return result;
}
