// Optional stage: nano-banana cinematic grade for the plan's selects.
// Failures degrade silently — a photo that can't be enhanced stays original.
import path from 'node:path';

import {rendererEnhancedDir} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

export async function runEnhance(
  deps: PipelineDeps,
  opts: {photosDir: string; ids: string[]},
): Promise<Map<string, string>> {
  const enhanced = new Map<string, string>();
  if (opts.ids.length === 0) return enhanced;

  const {code, stdout} = await deps.spawnPy(path.join('analysis', 'enhance_photos.py'), [
    '--photos',
    opts.photosDir,
    '--ids',
    opts.ids.join(','),
    '--out-dir',
    rendererEnhancedDir(deps.repoRoot),
    '--cache',
    path.join(deps.repoRoot, 'out', 'cache'),
  ]);
  if (code !== 0) return enhanced; // decoration never fails the reel

  try {
    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as {
      enhanced?: Record<string, string | null>;
    };
    for (const [id, file] of Object.entries(parsed.enhanced ?? {})) {
      if (file) enhanced.set(id, `assets/enhanced/${file}`);
    }
  } catch {
    // unparseable output — treat as "nothing enhanced"
  }
  return enhanced;
}
