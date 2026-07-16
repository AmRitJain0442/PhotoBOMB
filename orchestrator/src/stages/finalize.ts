// Stage: pin renderer-relative paths (audio track, cutouts, clips), assemble
// the asset map for preview/export, persist the run record.
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {EdlSchema, type Edl} from '../../../renderer/src/edl/schema.js';
import type {
  DerivedMedia,
  MediaPool,
  ProductionPlan,
  ReelStyle,
  RunMeta,
  TrackInfo,
} from '../contracts.js';
import type {GeminiUsage} from '../gemini.js';
import {audioLibraryDir, rendererAudioDir, runDir} from '../paths.js';
import type {PipelineDeps, RunResult} from '../pipeline.js';

type HeroClip = {file: string; durationMs: number};

export type FinalizeOptions = {
  runId: string;
  edl: Edl;
  plan: ProductionPlan;
  mediaPool: MediaPool;
  track: TrackInfo;
  usage: Record<string, GeminiUsage>;
  avoid?: {track_id?: string; summary?: string};
  enhanced?: Map<string, string>;
  clips?: Map<string, HeroClip>;
  style?: ReelStyle;
  enhance?: boolean;
};

const toDerived = (
  style: ReelStyle,
  enhance: boolean,
  enhanced: Map<string, string>,
  clips: Map<string, HeroClip>,
): DerivedMedia => ({
  style,
  enhance,
  enhanced: Object.fromEntries(enhanced),
  clips: Object.fromEntries(
    [...clips].map(([id, c]) => [id, {file: c.file, duration_ms: c.durationMs}]),
  ),
});

const buildAssetPaths = (
  edl: Edl,
  mediaPool: MediaPool,
  enhanced: Map<string, string>,
): Record<string, string> => {
  const fileById = new Map(mediaPool.pool.map((p) => [p.id, p.file]));
  const assetPaths: Record<string, string> = {};
  for (const e of edl.timeline) {
    if (assetPaths[e.asset]) continue;
    const file = fileById.get(e.asset);
    if (file) assetPaths[e.asset] = enhanced.get(e.asset) ?? `assets/${file}`;
  }
  return assetPaths;
};

async function persist(
  deps: PipelineDeps,
  opts: {
    runId: string;
    edl: Edl;
    plan: ProductionPlan;
    mediaPool: MediaPool;
    trackId: string;
    usage: Record<string, GeminiUsage>;
    avoid?: {track_id?: string; summary?: string};
    derived: DerivedMedia;
    assetPaths: Record<string, string>;
  },
): Promise<RunResult> {
  const meta: RunMeta = {
    runId: opts.runId,
    created_at: new Date().toISOString(),
    track_id: opts.trackId,
    director_model: deps.directorModel.id,
    usage: opts.usage,
    avoid: opts.avoid ?? null,
    derived: opts.derived,
  };

  const dir = runDir(deps.repoRoot, opts.runId);
  await mkdir(dir, {recursive: true});
  await Promise.all([
    writeFile(path.join(dir, 'media_pool.json'), JSON.stringify(opts.mediaPool, null, 2), 'utf8'),
    writeFile(path.join(dir, 'production_plan.json'), JSON.stringify(opts.plan, null, 2), 'utf8'),
    writeFile(path.join(dir, 'edl.json'), JSON.stringify(opts.edl, null, 2), 'utf8'),
    writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'),
  ]);

  return {
    runId: opts.runId,
    edl: opts.edl,
    plan: opts.plan,
    mediaPool: opts.mediaPool,
    meta,
    assetPaths: opts.assetPaths,
  };
}

export async function runFinalize(deps: PipelineDeps, opts: FinalizeOptions): Promise<RunResult> {
  const enhanced = opts.enhanced ?? new Map<string, string>();
  const clips = opts.clips ?? new Map<string, HeroClip>();

  const audioDir = rendererAudioDir(deps.repoRoot);
  await mkdir(audioDir, {recursive: true});
  await copyFile(
    path.join(audioLibraryDir(deps.repoRoot), opts.track.file),
    path.join(audioDir, opts.track.file),
  );

  // the renderer resolves paths relative to public/ — pin the audio track,
  // cutout, and clip paths regardless of what the Director wrote
  const edl: Edl = {
    ...opts.edl,
    audio: {...opts.edl.audio, track: `assets/audio/${opts.track.file}`},
    timeline: opts.edl.timeline.map((e) => {
      let entry = e;
      if (entry.transition_out?.type === 'cutout_pop') {
        entry = {...entry, cutout: `assets/cutouts/${entry.asset}.png`};
      }
      const clip = clips.get(entry.asset);
      if ((entry.kind === 'clip' || entry.kind === 'veo') && clip) {
        entry = {...entry, clip_path: `assets/clips/${clip.file}`, clip_duration_ms: clip.durationMs};
      }
      return entry;
    }),
  };

  return persist(deps, {
    runId: opts.runId,
    edl,
    plan: opts.plan,
    mediaPool: opts.mediaPool,
    trackId: opts.track.id,
    usage: opts.usage,
    avoid: opts.avoid,
    derived: toDerived(opts.style ?? 'classic', opts.enhance ?? false, enhanced, clips),
    assetPaths: buildAssetPaths(edl, opts.mediaPool, enhanced),
  });
}

export type FinalizeFilmOptions = {
  runId: string;
  plan: ProductionPlan;
  mediaPool: MediaPool;
  filmFile: string;
  durationMs: number;
  usage: Record<string, GeminiUsage>;
  avoid?: {track_id?: string; summary?: string};
};

/** AI-film finalize: a one-entry narrative EDL that carries omni's own audio
 * (no library track, beat invariants don't apply to narrative mode). */
export async function runFinalizeFilm(
  deps: PipelineDeps,
  opts: FinalizeFilmOptions,
): Promise<RunResult> {
  const clipPath = `assets/clips/${opts.filmFile}`;
  const edl = EdlSchema.parse({
    mode: 'narrative',
    aspect: '9:16',
    fps: 30,
    duration_ms: opts.durationMs,
    audio: {
      track: null,
      trim_start_ms: 0,
      beat_grid_ms: [],
      voiceover: null,
      mute_render: false,
    },
    timeline: [
      {
        asset: 'film',
        kind: 'veo',
        start_ms: 0,
        end_ms: opts.durationMs,
        clip_path: clipPath,
        clip_duration_ms: opts.durationMs,
      },
    ],
  });

  return persist(deps, {
    runId: opts.runId,
    edl,
    plan: opts.plan,
    mediaPool: opts.mediaPool,
    trackId: '',
    usage: opts.usage,
    avoid: opts.avoid,
    derived: {
      style: 'film',
      enhance: false,
      enhanced: {},
      clips: {film: {file: opts.filmFile, duration_ms: opts.durationMs}},
    },
    assetPaths: {film: clipPath},
  });
}
