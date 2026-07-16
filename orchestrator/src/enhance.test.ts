import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {runEnhance} from './stages/enhance.js';
import {MODELS} from './gemini.js';
import {makeTransport} from './test-fixtures.js';
import type {PipelineDeps} from './pipeline.js';

const depsWith = (spawnPy: PipelineDeps['spawnPy']): PipelineDeps => ({
  transport: makeTransport([]).transport,
  repoRoot: 'C:\\repo',
  directorModel: MODELS.flash,
  spawnPy,
});

describe('runEnhance', () => {
  it('maps successes to enhanced paths and drops failures', async () => {
    let seenArgs: string[] = [];
    const deps = depsWith(async (_script, args) => {
      seenArgs = args;
      return {code: 0, stdout: JSON.stringify({enhanced: {img0: 'img0.jpg', img1: null}}) + '\n'};
    });
    const map = await runEnhance(deps, {photosDir: 'photos', ids: ['img0', 'img1']});
    expect(map.get('img0')).toBe('assets/enhanced/img0.jpg');
    expect(map.has('img1')).toBe(false);
    expect(seenArgs[seenArgs.indexOf('--ids') + 1]).toBe('img0,img1');
    expect(seenArgs[seenArgs.indexOf('--out-dir') + 1]).toBe(
      path.join('C:\\repo', 'renderer', 'public', 'assets', 'enhanced'),
    );
  });

  it('returns an empty map on worker failure or empty input', async () => {
    const deps = depsWith(async () => ({code: 1, stdout: 'boom'}));
    expect((await runEnhance(deps, {photosDir: 'p', ids: ['img0']})).size).toBe(0);
    let called = false;
    const deps2 = depsWith(async () => {
      called = true;
      return {code: 0, stdout: '{}'};
    });
    expect((await runEnhance(deps2, {photosDir: 'p', ids: []})).size).toBe(0);
    expect(called).toBe(false);
  });
});
