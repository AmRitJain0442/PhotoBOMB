import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {EdlSchema} from '../../renderer/src/edl/schema.js';
import {runAnalyze} from './stages/analyze.js';
import {runFinalize} from './stages/finalize.js';
import {
  MEDIA_POOL,
  PLAN,
  TRACKS,
  USAGE,
  fakeSpawnPy,
  goodEdl,
  makeDeps,
  makeRepo,
  makeTransport,
} from './test-fixtures.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('runAnalyze', () => {
  it('passes the renderer cutouts dir to the python analyzer', async () => {
    let seenArgs: string[] = [];
    const spawnPy = async (script: string, args: string[]) => {
      seenArgs = args;
      return fakeSpawnPy()(script, args);
    };
    const deps = {...makeDeps(root, makeTransport([]).transport), spawnPy};
    await runAnalyze(deps, path.join(root, 'photos'), 'r1');
    const i = seenArgs.indexOf('--cutouts');
    expect(i).toBeGreaterThan(-1);
    expect(seenArgs[i + 1]).toBe(path.join(root, 'renderer', 'public', 'assets', 'cutouts'));
  });
});

describe('runFinalize', () => {
  it('patches entry.cutout for every cutout_pop transition', async () => {
    const raw = goodEdl();
    (raw.timeline[1] as Record<string, unknown>).transition_out = {
      type: 'cutout_pop',
      duration_ms: 400,
    };
    const edl = EdlSchema.parse(raw);
    const deps = makeDeps(root, makeTransport([]).transport);
    const res = await runFinalize(deps, {
      runId: 'r2',
      edl,
      plan: PLAN,
      mediaPool: MEDIA_POOL,
      track: TRACKS[0],
      usage: {direct: USAGE},
    });
    expect(res.edl.timeline[1].cutout).toBe('assets/cutouts/img1.png');
    expect(res.edl.timeline[0].cutout).toBeUndefined();
  });
});
