// Repo-relative path helpers shared by the pipeline stages.
import path from 'node:path';

export const audioLibraryDir = (root: string): string => path.join(root, 'audio-library');
export const audioIndexPath = (root: string): string =>
  path.join(audioLibraryDir(root), 'index.json');
export const cacheDir = (root: string): string => path.join(root, 'out', 'cache');
export const runDir = (root: string, runId: string): string =>
  path.join(root, 'out', 'pipeline', runId);
export const promptPath = (root: string, name: string): string =>
  path.join(root, 'prompts', name);
export const rendererAudioDir = (root: string): string =>
  path.join(root, 'renderer', 'public', 'assets', 'audio');
