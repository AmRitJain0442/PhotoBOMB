// AI-film stage: one continuous omni take from the selected photos.
// Unlike decoration stages, a film failure IS a reel failure.
import path from 'node:path';

import {PipelineError} from '../contracts.js';
import {rendererClipsDir} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

export async function runFilm(
  deps: PipelineDeps,
  opts: {refPaths: string[]; prompt: string; runId: string},
): Promise<{file: string; durationMs: number}> {
  const file = `film-${opts.runId}.mp4`;
  const {code, stdout} = await deps.spawnPy(path.join('analysis', 'film_video.py'), [
    '--refs',
    opts.refPaths.join(','),
    '--prompt',
    opts.prompt,
    '--out',
    path.join(rendererClipsDir(deps.repoRoot), file),
  ]);
  if (code !== 0) {
    throw new PipelineError('film', 'film_failed', stdout.slice(0, 500));
  }
  try {
    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as {duration_ms?: number};
    if (parsed.duration_ms && parsed.duration_ms > 0) {
      return {file, durationMs: parsed.duration_ms};
    }
  } catch {
    // fall through to the error below
  }
  throw new PipelineError('film', 'film_failed', stdout.slice(0, 500));
}
