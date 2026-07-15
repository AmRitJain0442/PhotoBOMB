// Stage 4: stage the audio file for the renderer, pin the EDL's track path,
// persist the run record to out/pipeline/<runId>/.
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {Edl} from '../../../renderer/src/edl/schema.js';
import type {MediaPool, ProductionPlan, RunMeta, TrackInfo} from '../contracts.js';
import type {GeminiUsage} from '../gemini.js';
import {audioLibraryDir, rendererAudioDir, runDir} from '../paths.js';
import type {PipelineDeps, RunResult} from '../pipeline.js';

export type FinalizeOptions = {
  runId: string;
  edl: Edl;
  plan: ProductionPlan;
  mediaPool: MediaPool;
  track: TrackInfo;
  usage: Record<string, GeminiUsage>;
  avoid?: {track_id?: string; summary?: string};
};

export async function runFinalize(deps: PipelineDeps, opts: FinalizeOptions): Promise<RunResult> {
  const audioDir = rendererAudioDir(deps.repoRoot);
  await mkdir(audioDir, {recursive: true});
  await copyFile(
    path.join(audioLibraryDir(deps.repoRoot), opts.track.file),
    path.join(audioDir, opts.track.file),
  );

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

  const meta: RunMeta = {
    runId: opts.runId,
    created_at: new Date().toISOString(),
    track_id: opts.track.id,
    director_model: deps.directorModel,
    usage: opts.usage,
    avoid: opts.avoid ?? null,
  };

  const dir = runDir(deps.repoRoot, opts.runId);
  await mkdir(dir, {recursive: true});
  await Promise.all([
    writeFile(path.join(dir, 'media_pool.json'), JSON.stringify(opts.mediaPool, null, 2), 'utf8'),
    writeFile(
      path.join(dir, 'production_plan.json'),
      JSON.stringify(opts.plan, null, 2),
      'utf8',
    ),
    writeFile(path.join(dir, 'edl.json'), JSON.stringify(edl, null, 2), 'utf8'),
    writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'),
  ]);

  return {runId: opts.runId, edl, plan: opts.plan, mediaPool: opts.mediaPool, meta};
}
