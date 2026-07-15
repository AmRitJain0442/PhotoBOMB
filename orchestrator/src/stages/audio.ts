// Track library access + selection of the candidate set for the Producer.
import {readFile} from 'node:fs/promises';

import {PipelineError, type TrackInfo} from '../contracts.js';
import {audioIndexPath} from '../paths.js';

export async function loadTracks(repoRoot: string): Promise<TrackInfo[]> {
  try {
    const raw = await readFile(audioIndexPath(repoRoot), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackInfo[]) : [];
  } catch {
    return [];
  }
}

export function chooseTrackSet(
  tracks: TrackInfo[],
  track: 'auto' | string,
): {tracks: TrackInfo[]; pinned: TrackInfo | null} {
  if (tracks.length === 0) throw new PipelineError('produce', 'no_music');
  if (track === 'auto') return {tracks, pinned: null};
  const found = tracks.find((t) => t.id === track);
  if (!found) {
    throw new PipelineError('produce', 'no_music', `track "${track}" is not in the library`);
  }
  return {tracks: [found], pinned: found};
}
