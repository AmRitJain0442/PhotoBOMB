import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PipelineError} from './contracts.js';
import {chooseTrackSet, loadTracks} from './stages/audio.js';
import {ensureYellow, runProduce} from './stages/produce.js';
import {MEDIA_POOL, PLAN, TRACKS, makeDeps, makeRepo, makeTransport} from './test-fixtures.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('style context', () => {
  const run = async (style: 'classic' | 'live' | 'film') => {
    const {transport, calls} = makeTransport([JSON.stringify(PLAN)]);
    const deps = makeDeps(root, transport);
    await runProduce(deps, {mediaPool: MEDIA_POOL, tracks: TRACKS, pinned: null, style});
    return calls[0].parts.map((p) => p.text).join('\n');
  };

  it('tells the Producer the style and the live hero rule', async () => {
    const text = await run('live');
    expect(text).toContain('style: live');
    expect(text).toMatch(/hero_shots/);
    expect(text).toMatch(/motion_prompt/i);
  });

  it('classic forbids heroes; film demands a film_prompt', async () => {
    expect(await run('classic')).toMatch(/hero_shots MUST be \[\]/);
    expect(await run('film')).toMatch(/film_prompt/);
  });
});

describe('ensureYellow', () => {
  const span = (text: string, extra: Partial<{bold: boolean; underline: boolean; tone: 'white' | 'yellow'}> = {}) => ({
    text,
    bold: false,
    underline: false,
    tone: 'white' as const,
    ...extra,
  });

  it('leaves a quote with a yellow span untouched', () => {
    const quote = {lines: [[span('stay'), span('light', {tone: 'yellow'})]]};
    expect(ensureYellow(quote)).toBe(quote);
  });

  it('promotes the last emphasized span when everything is white', () => {
    const quote = {lines: [[span('dusk', {bold: true}), span('settles'), span('softly', {underline: true})]]};
    const fixed = ensureYellow(quote);
    expect(fixed.lines[0].map((s) => s.tone)).toEqual(['white', 'white', 'yellow']);
  });

  it('falls back to the very last span when nothing is emphasized', () => {
    const quote = {lines: [[span('violet')], [span('city'), span('dreams')]]};
    const fixed = ensureYellow(quote);
    expect(fixed.lines[1][1].tone).toBe('yellow');
    expect(fixed.lines[0][0].tone).toBe('white');
  });
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
