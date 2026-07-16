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
    expect(calls[0].model).toEqual({id: 'gemini-3-flash-preview', location: 'global'});
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

  const withPop = (asset: string) => {
    const edl = goodEdl();
    const timeline = edl.timeline as Array<{asset: string; transition_out?: unknown}>;
    const i = timeline.findIndex((e) => e.asset === asset);
    timeline[i].transition_out = {type: 'cutout_pop', duration_ms: 400};
    return edl;
  };

  it('accepts cutout_pop on an asset that has a cutout', async () => {
    const {transport} = makeTransport([JSON.stringify(withPop('img0'))]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline[0].transition_out?.type).toBe('cutout_pop');
  });

  it('repairs cutout_pop on an asset without a cutout', async () => {
    const {transport, calls} = makeTransport([
      JSON.stringify(withPop('img3')), // img3 has has_cutout: false
      JSON.stringify(withPop('img0')),
    ]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(res.edl.timeline[3].transition_out).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].parts.map((p) => p.text).join('\n')).toMatch(/cutout/i);
  });

  it('stamps the plan quote spans onto the quote entry verbatim', async () => {
    const edl = goodEdl();
    (edl.timeline[2] as Record<string, unknown>).text = {
      content: 'model wrote something else',
      style: 'quote_duotone',
      in_ms: 0,
      out_ms: 400,
      anchor: 'center',
      spans: [{text: 'model wrote something else', tone: 'white'}],
    };
    const {transport} = makeTransport([JSON.stringify(edl)]);
    const deps = makeDeps(root, transport);
    const res = await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    const t = res.edl.timeline[2].text;
    expect(t?.content).toBe('stay for the light');
    expect(t?.spans).toEqual(PLAN.quote.lines[0]);
  });

  it('uses the configured director model', async () => {
    const {transport, calls} = makeTransport([JSON.stringify(goodEdl())]);
    const deps = {
      ...makeDeps(root, transport),
      directorModel: {id: 'gemini-2.5-pro', location: 'us-central1'},
    };
    await runDirect(deps, {plan: PLAN, mediaPool: MEDIA_POOL, track: TRACKS[0]});
    expect(calls[0].model).toEqual({id: 'gemini-2.5-pro', location: 'us-central1'});
  });
});
