// Live-moments stage: one omni clip per hero shot. A hero that fails to
// animate is silently dropped — the Director simply never hears about it.
import path from 'node:path';

import {rendererClipsDir} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

export type HeroClip = {file: string; durationMs: number};

export async function runAnimate(
  deps: PipelineDeps,
  opts: {heroes: Array<{id: string; motionPrompt: string; sourcePath: string}>},
): Promise<Map<string, HeroClip>> {
  const clips = new Map<string, HeroClip>();
  for (const hero of opts.heroes) {
    const outFile = path.join(rendererClipsDir(deps.repoRoot), `${hero.id}.mp4`);
    const {code, stdout} = await deps.spawnPy(path.join('analysis', 'animate_clip.py'), [
      '--source',
      hero.sourcePath,
      '--prompt',
      hero.motionPrompt,
      '--out',
      outFile,
      '--cache',
      path.join(deps.repoRoot, 'out', 'cache'),
    ]);
    if (code !== 0) continue;
    try {
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as {
        duration_ms?: number;
      };
      if (parsed.duration_ms && parsed.duration_ms > 0) {
        clips.set(hero.id, {file: `${hero.id}.mp4`, durationMs: parsed.duration_ms});
      }
    } catch {
      // unparseable worker output — drop this hero
    }
  }
  return clips;
}
