import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PipelineError} from './contracts.js';
import {chooseTrackSet, loadTracks} from './stages/audio.js';
import {runProduce} from './stages/produce.js';
import {MEDIA_POOL, PLAN, TRACKS, makeDeps, makeRepo, makeTransport} from './test-fixtures.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('audio stage', () => {
  it('loads tracks from index.json and empty when missing', async () => {
    expect(await loadTracks(root)).toHaveLength(2);
    expect(await loadTracks(path.join(root, 'nowhere'))).toEqual([]);
  });

  it('throws no_music when library is empty', () => {
    expect(() => chooseTrackSet([], 'auto')).toThrowError(PipelineError);
    try {
      chooseTrackSet([], 'auto');
    } catch (e) {
      expect((e as PipelineError).code).toBe('no_music');
    }
  });

  it('pins a specific track by id', () => {
    const {tracks, pinned} = chooseTrackSet(TRACKS, 'songb');
    expect(pinned?.id).toBe('songb');
    expect(tracks).toHaveLength(1);
  });
});

describe('runProduce', () => {
  it('parses a valid plan on first try', async () => {
    const {transport, calls} = makeTransport([JSON.stringify(PLAN)]);
    const deps = makeDeps(root, transport);
    const res = await runProduce(deps, {mediaPool: MEDIA_POOL, tracks: TRACKS, pinned: null});
    expect(res.plan.audio.track_id).toBe('songa');
    expect(res.repaired).toBe(false);
    expect(calls[0].system).toContain('producer system prompt');
    expect(calls[0].parts.map((p) => p.text).join('\n')).toContain('img0');
  });

  it('repairs after one bad response', async () => {
    const {transport, calls} = makeTransport(['{nope', JSON.stringify(PLAN)]);
    const deps = makeDeps(root, transport);
    const res = await runProduce(deps, {mediaPool: MEDIA_POOL, tracks: TRACKS, pinned: null});
    expect(res.repaired).toBe(true);
    expect(res.plan.mode).toBe('montage');
    expect(calls).toHaveLength(2);
  });

  it('passes the avoid note through to the model', async () => {
    const {transport, calls} = makeTransport([JSON.stringify(PLAN)]);
    const deps = makeDeps(root, transport);
    await runProduce(deps, {
      mediaPool: MEDIA_POOL,
      tracks: TRACKS,
      pinned: null,
      avoid: {track_id: 'songa', summary: 'a warm evening set'},
    });
    const allText = calls[0].parts.map((p) => p.text).join('\n');
    expect(allText).toContain('songa');
    expect(allText.toLowerCase()).toContain('different');
  });
});
