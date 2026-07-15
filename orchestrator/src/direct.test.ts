import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PipelineError} from './contracts.js';
import {runDirect} from './stages/direct.js';
import {
  MEDIA_POOL,
  PLAN,
  TRACKS,
  goodEdl,
  makeDeps,
  makeRepo,
  makeTransport,
  offBeatEdl,
} from './test-fixtures.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('runDirect', () => {
  it('returns a schema+invariant valid EDL', async () => {
    const {transport, calls} = makeTransport([JSON.stringify(goodEdl())]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline).toHaveLength(4);
    expect(calls[0].system).toContain('director system prompt');
    expect(calls[0].model).toBe('gemini-2.5-flash');
  });

  it('repairs an invariant-violating EDL (cut off the beat grid)', async () => {
    const {transport, calls} = makeTransport([
      JSON.stringify(offBeatEdl()),
      JSON.stringify(goodEdl()),
    ]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline).toHaveLength(4);
    expect(calls).toHaveLength(2);
    // repair request carries the violation text back to the model
    const repairText = calls[1].parts.map((p) => p.text).join('\n');
    expect(repairText).toContain('940');
    // usage accumulated across both calls
    expect(res.usage.inputTokens).toBe(20);
  });

  it('fails with violation text after two bad takes', async () => {
    const {transport} = makeTransport([
      JSON.stringify(offBeatEdl()),
      JSON.stringify(offBeatEdl()),
    ]);
    const deps = makeDeps(root, transport);
    await expect(
      runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]}),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).code).toBe('invariants');
      expect((e as PipelineError).message).toContain('940');
      return true;
    });
  });

  it('uses the configured director model', async () => {
    const {transport, calls} = makeTransport([JSON.stringify(goodEdl())]);
    const deps = {...makeDeps(root, transport), directorModel: 'gemini-2.5-pro'};
    await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(calls[0].model).toBe('gemini-2.5-pro');
  });
});
