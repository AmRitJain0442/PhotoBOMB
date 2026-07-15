import type {Edl} from './schema.js';

const BEAT_TOLERANCE_MS = 33;

const withHalfBeats = (grid: number[]): number[] =>
  grid.flatMap((v, i) => (i < grid.length - 1 ? [v, (v + grid[i + 1]) / 2] : [v]));

const nearBeat = (ms: number, grid: number[]): boolean =>
  grid.some((g) => Math.abs(g - ms) <= BEAT_TOLERANCE_MS);

// Hard invariants beyond Zod's reach (Tech Spec §6). Returns human-readable
// violations — empty array means valid. Messages are fed back to the Director
// repair loop verbatim, so keep them specific.
export const checkInvariants = (edl: Edl, assetIds: Set<string>): string[] => {
  const errors: string[] = [];
  const t = edl.timeline;

  if (t[0].start_ms !== 0) {
    errors.push(`timeline must start at 0, got ${t[0].start_ms}`);
  }
  for (const [i, e] of t.entries()) {
    if (e.end_ms <= e.start_ms) {
      errors.push(`entry ${i} (${e.asset}): end_ms ${e.end_ms} <= start_ms ${e.start_ms}`);
    }
    if (i > 0 && e.start_ms !== t[i - 1].end_ms) {
      errors.push(
        `gap/overlap: entry ${i} starts at ${e.start_ms} but entry ${i - 1} ends at ${t[i - 1].end_ms}`,
      );
    }
    if (!assetIds.has(e.asset)) {
      errors.push(`entry ${i} references unknown asset "${e.asset}"`);
    }
    if (e.text) {
      const entryLen = e.end_ms - e.start_ms;
      if (e.text.out_ms <= e.text.in_ms || e.text.out_ms > entryLen) {
        errors.push(
          `entry ${i} text window [${e.text.in_ms}, ${e.text.out_ms}] invalid for entry length ${entryLen}`,
        );
      }
    }
  }
  const last = t[t.length - 1];
  if (last.end_ms !== edl.duration_ms) {
    errors.push(`timeline ends at ${last.end_ms} but duration_ms is ${edl.duration_ms}`);
  }

  if (edl.mode !== 'narrative' && edl.audio.beat_grid_ms.length > 0) {
    const grid =
      edl.mode === 'edit' ? withHalfBeats(edl.audio.beat_grid_ms) : edl.audio.beat_grid_ms;
    for (let i = 1; i < t.length; i++) {
      if (!nearBeat(t[i].start_ms, grid)) {
        errors.push(
          `cut at ${t[i].start_ms}ms is not within ${BEAT_TOLERANCE_MS}ms of a beat (${edl.mode} mode)`,
        );
      }
    }
  }

  return errors;
};
