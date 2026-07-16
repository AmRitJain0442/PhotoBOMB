import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PipelineError, type StageName} from './contracts.js';
import {resolveDirectorModel, revisePipeline, runPipeline} from './pipeline.js';
import {
  LIVE_PLAN,
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

// Routes worker scripts: analyze writes the pool, the media workers answer
// with canned JSON so styles can be tested without any API.
const routeSpawnPy =
  (opts: {enhanced?: Record<string, string | null>; clipDuration?: number; filmDuration?: number}) =>
  async (script: string, args: string[]) => {
    if (script.includes('analyze_media')) return fakeSpawnPy()(script, args);
    if (script.includes('enhance_photos')) {
      return {code: 0, stdout: JSON.stringify({enhanced: opts.enhanced ?? {}})};
    }
    if (script.includes('animate_clip')) {
      return opts.clipDuration
        ? {code: 0, stdout: JSON.stringify({duration_ms: opts.clipDuration})}
        : {code: 4, stdout: '{"error":"no_clip"}'};
    }
    if (script.includes('film_video')) {
      return opts.filmDuration
        ? {code: 0, stdout: JSON.stringify({duration_ms: opts.filmDuration})}
        : {code: 4, stdout: '{"error":"no_film"}'};
    }
    return {code: 1, stdout: `unknown script ${script}`};
  };

const liveEdl = () => {
  const edl = goodEdl();
  (edl.timeline[0] as Record<string, unknown>).kind = 'clip';
  return edl;
};

describe('styles', () => {
  it('live: animates heroes, directs with clip info, patches clip paths', async () => {
    const {transport, calls} = makeTransport([
      JSON.stringify(LIVE_PLAN),
      JSON.stringify(liveEdl()),
    ]);
    const deps = {...makeDeps(root, transport), spawnPy: routeSpawnPy({clipDuration: 6200})};
    const {events, onProgress} = collectProgress();

    const result = await runPipeline({photosDir, track: 'auto', style: 'live', deps}, onProgress);

    expect(events).toContain('animate:running');
    const directText = calls[1].parts.map((p) => p.text).join('\n');
    expect(directText).toContain('"duration_ms":6200');
    expect(result.edl.timeline[0].kind).toBe('clip');
    expect(result.edl.timeline[0].clip_path).toBe('assets/clips/img0.mp4');
    expect(result.edl.timeline[0].clip_duration_ms).toBe(6200);
    expect(result.assetPaths.img1).toBe('assets/img1.jpg');
    expect(result.meta.derived.clips.img0).toEqual({file: 'img0.mp4', duration_ms: 6200});
  });

  it('enhance: swaps asset paths to graded files, degrades per photo', async () => {
    const {transport} = makeTransport([JSON.stringify(PLAN), JSON.stringify(goodEdl())]);
    const deps = {
      ...makeDeps(root, transport),
      spawnPy: routeSpawnPy({enhanced: {img0: 'img0.jpg', img1: null}}),
    };
    const {events, onProgress} = collectProgress();

    const result = await runPipeline(
      {photosDir, track: 'auto', enhance: true, deps},
      onProgress,
    );

    expect(events).toContain('enhance:running');
    expect(result.assetPaths.img0).toBe('assets/enhanced/img0.jpg');
    expect(result.assetPaths.img1).toBe('assets/img1.jpg');
    expect(result.meta.derived.enhance).toBe(true);
  });

  it('film: one-entry narrative EDL carrying its own audio', async () => {
    const filmPlan = {...PLAN, film_prompt: 'A dusk story in one take.'};
    const {transport, calls} = makeTransport([JSON.stringify(filmPlan)]);
    const deps = {...makeDeps(root, transport), spawnPy: routeSpawnPy({filmDuration: 11000})};
    const {events, onProgress} = collectProgress();

    const result = await runPipeline({photosDir, track: 'auto', style: 'film', deps}, onProgress);

    expect(events).toContain('film:running');
    expect(events.join(',')).not.toContain('direct');
    expect(calls).toHaveLength(1); // producer only — no director call
    expect(result.edl.mode).toBe('narrative');
    expect(result.edl.audio.track).toBeNull();
    expect(result.edl.audio.mute_render).toBe(false);
    expect(result.edl.timeline).toHaveLength(1);
    expect(result.edl.timeline[0].kind).toBe('veo');
    expect(result.edl.timeline[0].end_ms).toBe(11000);
    expect(result.assetPaths.film).toBe(`assets/clips/film-${result.runId}.mp4`);
    expect(result.meta.derived.style).toBe('film');
  });

  it('film runs cannot be revised — only re-taken', async () => {
    const filmPlan = {...PLAN, film_prompt: 'A dusk story.'};
    const {transport} = makeTransport([JSON.stringify(filmPlan)]);
    const deps = {...makeDeps(root, transport), spawnPy: routeSpawnPy({filmDuration: 11000})};
    const {onProgress} = collectProgress();
    const first = await runPipeline({photosDir, track: 'auto', style: 'film', deps}, onProgress);

    const {transport: t2} = makeTransport([]);
    const deps2 = makeDeps(root, t2);
    await expect(
      revisePipeline({runId: first.runId, pin: 'songb', deps: deps2}, onProgress),
    ).rejects.toSatisfy((e: unknown) => {
      expect((e as PipelineError).code).toBe('film_no_tweaks');
      return true;
    });
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
