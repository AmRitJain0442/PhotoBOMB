import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createApp} from './workbench-server.mjs';

let rendererRoot;
let repoRoot;
let server;
let base;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return {promise, resolve, reject};
};

const fakeResult = (runId) => ({
  runId,
  edl: {mode: 'montage', duration_ms: 2000},
  plan: {selects: ['a', 'b', 'c'], captions: {short: 's', long: 'l'}},
  mediaPool: {pool: [], rejects: []},
  meta: {runId, usage: {}},
});

async function boot({pipelineImpl, ingestImpl, checkCredentials} = {}) {
  rendererRoot = await mkdtemp(path.join(tmpdir(), 'darkroom-renderer-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'darkroom-repo-'));
  await mkdir(path.join(rendererRoot, 'public', 'assets'), {recursive: true});
  await mkdir(path.join(rendererRoot, 'out'), {recursive: true});
  await mkdir(path.join(repoRoot, 'audio-library'), {recursive: true});

  const app = createApp({
    roots: {rendererRoot, repoRoot},
    pipelineImpl: pipelineImpl ?? {
      run: async () => fakeResult('p1'),
      revise: async () => fakeResult('p2'),
    },
    ingestImpl:
      ingestImpl ??
      (async (file) => ({
        id: path.basename(file).replace(/\.[^.]+$/, ''),
        file: path.basename(file),
        bpm: 100,
        beat_grid_ms: [0, 600],
        energy_curve: [0.5],
        duration_ms: 30000,
        mood: 'warm',
        feel: 'steady',
      })),
    checkCredentials: checkCredentials ?? (() => ({ok: true})),
  });
  await new Promise((res) => {
    server = app.listen(0, res);
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  if (server) await new Promise((res) => server.close(res));
  server = null;
  await rm(rendererRoot, {recursive: true, force: true});
  await rm(repoRoot, {recursive: true, force: true});
});

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });

describe('pipeline endpoints', () => {
  it('run -> 202 with runId, status transitions running -> done with result', async () => {
    const gate = deferred();
    let seenRunId;
    await boot({
      pipelineImpl: {
        run: async (opts, onProgress) => {
          seenRunId = opts.runId;
          onProgress('analyze', 'running');
          await gate.promise;
          return fakeResult(opts.runId);
        },
        revise: async () => fakeResult('px'),
      },
    });

    const r = await post('/api/pipeline/run', {track: 'auto'});
    expect(r.status).toBe(202);
    const {runId} = await r.json();
    expect(runId).toMatch(/^p/);

    let status = await (await fetch(base + '/api/pipeline/status')).json();
    expect(status.state).toBe('running');
    expect(status.stage).toBe('analyze');

    gate.resolve();
    await new Promise((res) => setTimeout(res, 50));
    status = await (await fetch(base + '/api/pipeline/status')).json();
    expect(status.state).toBe('done');
    expect(status.runId).toBe(runId);
    expect(seenRunId).toBe(runId);

    const result = await (await fetch(base + `/api/pipeline/result/${runId}`)).json();
    expect(result.runId).toBe(runId);
    expect(result.plan.captions.short).toBe('s');
  });

  it('second run while running -> 409', async () => {
    const gate = deferred();
    await boot({
      pipelineImpl: {
        run: async (opts) => {
          await gate.promise;
          return fakeResult(opts.runId);
        },
        revise: async () => fakeResult('px'),
      },
    });
    expect((await post('/api/pipeline/run', {track: 'auto'})).status).toBe(202);
    expect((await post('/api/pipeline/run', {track: 'auto'})).status).toBe(409);
    gate.resolve();
  });

  it('revise -> 202', async () => {
    await boot();
    const r = await post('/api/pipeline/revise', {runId: 'p1', pin: 'songb'});
    expect(r.status).toBe(202);
  });

  it('missing credentials -> 422 setup', async () => {
    await boot({checkCredentials: () => ({ok: false, message: 'no key file'})});
    const r = await post('/api/pipeline/run', {track: 'auto'});
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe('setup');
  });

  it('failed run surfaces the error code in status', async () => {
    await boot({
      pipelineImpl: {
        run: async () => {
          const err = new Error('not enough');
          err.code = 'not_enough_photos';
          throw err;
        },
        revise: async () => fakeResult('px'),
      },
    });
    await post('/api/pipeline/run', {track: 'auto'});
    await new Promise((res) => setTimeout(res, 50));
    const status = await (await fetch(base + '/api/pipeline/status')).json();
    expect(status.state).toBe('failed');
    expect(status.code).toBe('not_enough_photos');
  });

  it('serves a result from disk when no job holds it', async () => {
    await boot();
    const dir = path.join(repoRoot, 'out', 'pipeline', 'p777');
    await mkdir(dir, {recursive: true});
    await writeFile(path.join(dir, 'edl.json'), JSON.stringify({duration_ms: 7000}));
    await writeFile(path.join(dir, 'production_plan.json'), JSON.stringify({selects: []}));
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({runId: 'p777'}));
    const r = await fetch(base + '/api/pipeline/result/p777');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.edl.duration_ms).toBe(7000);
    expect((await fetch(base + '/api/pipeline/result/nope')).status).toBe(404);
  });
});

describe('asset deletion', () => {
  it('rejects traversal, deletes legit files', async () => {
    await boot();
    const target = path.join(rendererRoot, 'public', 'assets', 'pic.jpg');
    await writeFile(target, 'x');
    const secret = path.join(rendererRoot, 'secret.txt');
    await writeFile(secret, 'keep me');

    const evil = await fetch(base + '/api/assets/..%2F..%2Fsecret.txt', {method: 'DELETE'});
    expect([400, 404]).toContain(evil.status);
    expect(await readFile(secret, 'utf8')).toBe('keep me');

    const ok = await fetch(base + '/api/assets/pic.jpg', {method: 'DELETE'});
    expect(ok.status).toBe(204);
    const list = await (await fetch(base + '/api/assets')).json();
    expect(list.find((a) => a.file === 'pic.jpg')).toBeUndefined();
  });
});

describe('audio library', () => {
  it('GET returns [] when index missing', async () => {
    await boot();
    expect(await (await fetch(base + '/api/audio')).json()).toEqual([]);
  });

  it('POST ingests an upload and lists it', async () => {
    await boot();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([82, 73, 70, 70])]), 'mysong.wav');
    const r = await fetch(base + '/api/audio', {method: 'POST', body: form});
    expect(r.status).toBe(200);
    const list = await (await fetch(base + '/api/audio')).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('mysong');
    expect(list[0].feel).toBe('steady');
  });

  it('POST maps ingest failure to a friendly 422', async () => {
    await boot({
      ingestImpl: async () => {
        throw new Error('librosa exploded');
      },
    });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0])]), 'bad.mp3');
    const r = await fetch(base + '/api/audio', {method: 'POST', body: form});
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.message).toBeTruthy();
  });
});
