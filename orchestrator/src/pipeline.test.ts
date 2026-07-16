import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PipelineError, type StageName} from './contracts.js';
import {resolveDirectorModel, revisePipeline, runPipeline} from './pipeline.js';
import {
  MEDIA_POOL,
  PLAN,
  fakeSpawnPy,
  goodEdl,
  makeDeps,
  makeRepo,
  makeTransport,
} from './test-fixtures.js';

let root: string;
let photosDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'darkroom-'));
  await makeRepo(root);
  photosDir = path.join(root, 'renderer', 'public', 'assets');
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

// EDL over the remaining 3 photos after img3 is removed (cuts on the grid)
const threeShotEdl = () => {
  const edl = goodEdl();
  edl.timeline = [
    {asset: 'img0', kind: 'still', start_ms: 0, end_ms: 500, effects: []},
    {asset: 'img1', kind: 'still', start_ms: 500, end_ms: 1000, effects: []},
    {asset: 'img2', kind: 'still', start_ms: 1000, end_ms: 2000, effects: []},
  ];
  return edl;
};

const collectProgress = () => {
  const events: string[] = [];
  return {
    events,
    onProgress: (stage: StageName, state: 'running' | 'done') => {
      events.push(`${stage}:${state}`);
    },
  };
};

describe('runPipeline', () => {
  it('runs all stages in order and writes the run record', async () => {
    const {transport} = makeTransport([JSON.stringify(PLAN), JSON.stringify(goodEdl())]);
    const deps = makeDeps(root, transport);
    const {events, onProgress} = collectProgress();

    const result = await runPipeline({photosDir, track: 'auto', deps}, onProgress);

    expect(events).toEqual([
      'analyze:running',
      'analyze:done',
      'produce:running',
      'produce:done',
      'direct:running',
      'direct:done',
      'finalize:running',
      'finalize:done',
    ]);
    expect(result.runId).toMatch(/^p/);
    expect(result.edl.audio.track).toBe('assets/audio/songa.wav');
    expect(result.meta.usage.produce.inputTokens).toBe(10);
    expect(result.meta.usage.direct.inputTokens).toBe(10);

    const runDir = path.join(root, 'out', 'pipeline', result.runId);
    for (const f of ['media_pool.json', 'production_plan.json', 'edl.json', 'meta.json']) {
      await expect(access(path.join(runDir, f))).resolves.toBeUndefined();
    }
    // track staged for the renderer
    const staged = path.join(root, 'renderer', 'public', 'assets', 'audio', 'songa.wav');
    expect(await readFile(staged, 'utf8')).toBe('RIFFfake');
  });

  it('maps analyze exit 3 to not_enough_photos', async () => {
    const {transport} = makeTransport([]);
    const deps = makeDeps(root, transport, fakeSpawnPy(MEDIA_POOL, 3));
    const {onProgress} = collectProgress();
    await expect(runPipeline({photosDir, track: 'auto', deps}, onProgress)).rejects.toSatisfy(
      (e: unknown) => {
        expect(e).toBeInstanceOf(PipelineError);
        expect((e as PipelineError).code).toBe('not_enough_photos');
        return true;
      },
    );
  });

  it('throws no_music when the library is empty and track is auto', async () => {
    await rm(path.join(root, 'audio-library', 'index.json'));
    const {transport} = makeTransport([]);
    const deps = makeDeps(root, transport);
    const {onProgress} = collectProgress();
    await expect(runPipeline({photosDir, track: 'auto', deps}, onProgress)).rejects.toSatisfy(
      (e: unknown) => {
        expect((e as PipelineError).code).toBe('no_music');
        return true;
      },
    );
  });
});

describe('revisePipeline', () => {
  const runOnce = async () => {
    const {transport} = makeTransport([JSON.stringify(PLAN), JSON.stringify(goodEdl())]);
    const deps = makeDeps(root, transport);
    const {onProgress} = collectProgress();
    return runPipeline({photosDir, track: 'auto', deps}, onProgress);
  };

  it('pin swaps the track and skips produce (director call only)', async () => {
    const first = await runOnce();
    const {transport, calls} = makeTransport([
      JSON.stringify(goodEdl('assets/audio/songb.wav')),
    ]);
    const deps = makeDeps(root, transport);
    const {events, onProgress} = collectProgress();

    const revised = await revisePipeline({runId: first.runId, pin: 'songb', deps}, onProgress);

    expect(calls).toHaveLength(1); // no produce call
    expect(calls[0].system).toContain('director system prompt');
    expect(revised.plan.audio.track_id).toBe('songb');
    expect(revised.edl.audio.track).toBe('assets/audio/songb.wav');
    expect(revised.runId).not.toBe(first.runId);
    expect(events).toEqual(['direct:running', 'direct:done', 'finalize:running', 'finalize:done']);
  });

  it('removeAsset filters selects and re-directs', async () => {
    const first = await runOnce();
    const {transport, calls} = makeTransport([JSON.stringify(threeShotEdl())]);
    const deps = makeDeps(root, transport);
    const {onProgress} = collectProgress();

    const revised = await revisePipeline(
      {runId: first.runId, removeAsset: 'img3', deps},
      onProgress,
    );
    expect(revised.plan.selects).toEqual(['img0', 'img1', 'img2']);
    const sent = calls[0].parts.map((p) => p.text).join('\n');
    expect(sent).not.toContain('"img3"');
  });

  it('errors when removal would leave fewer than 3 photos', async () => {
    const first = await runOnce();
    // remove down to 3 first
    const {transport} = makeTransport([JSON.stringify(threeShotEdl())]);
    const deps = makeDeps(root, transport);
    const {onProgress} = collectProgress();
    const second = await revisePipeline(
      {runId: first.runId, removeAsset: 'img3', deps},
      onProgress,
    );

    const {transport: t2} = makeTransport([]);
    const deps2 = makeDeps(root, t2);
    await expect(
      revisePipeline({runId: second.runId, removeAsset: 'img2', deps: deps2}, onProgress),
    ).rejects.toSatisfy((e: unknown) => {
      expect((e as PipelineError).code).toBe('too_few_photos');
      return true;
    });
  });
});

describe('resolveDirectorModel', () => {
  it('defaults to flash, pro on env opt-in', () => {
    expect(resolveDirectorModel({})).toEqual({id: 'gemini-3-flash-preview', location: 'global'});
    expect(resolveDirectorModel({DARKROOM_DIRECTOR_MODEL: 'pro'})).toEqual({
      id: 'gemini-2.5-pro',
      location: 'us-central1',
    });
  });
});
