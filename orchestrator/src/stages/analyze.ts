// Stage 1: spawn the Python analyzer, read back the media pool.
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {PipelineError, type MediaPool} from '../contracts.js';
import {cacheDir, rendererCutoutsDir, runDir} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

export async function runAnalyze(
  deps: PipelineDeps,
  photosDir: string,
  runId: string,
): Promise<MediaPool> {
  const outFile = path.join(runDir(deps.repoRoot, runId), 'media_pool.json');
  await mkdir(path.dirname(outFile), {recursive: true});

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

  if (code === 3) throw new PipelineError('analyze', 'not_enough_photos');
  if (code !== 0) throw new PipelineError('analyze', 'analyze_failed', stdout.slice(0, 2000));

  return JSON.parse(await readFile(outFile, 'utf8')) as MediaPool;
}
