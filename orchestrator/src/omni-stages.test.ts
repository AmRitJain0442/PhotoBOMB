import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {PipelineError} from './contracts.js';
import {MODELS} from './gemini.js';
import {runAnimate} from './stages/animate.js';
import {runFilm} from './stages/film.js';
import {makeTransport} from './test-fixtures.js';
import type {PipelineDeps} from './pipeline.js';

type Call = {script: string; args: string[]};

const depsWith = (
  respond: (script: string, args: string[]) => {code: number; stdout: string},
  calls: Call[] = [],
): PipelineDeps => ({
  transport: makeTransport([]).transport,
  repoRoot: 'C:\\repo',
  directorModel: MODELS.flash,
  spawnPy: async (script, args) => {
    calls.push({script, args});
    return respond(script, args);
  },
});

describe('runAnimate', () => {
  it('collects clips per hero and wires args', async () => {
    const calls: Call[] = [];
    const deps = depsWith(
      (_s, args) =>
        args[args.indexOf('--source') + 1].includes('img0')
          ? {code: 0, stdout: '{"duration_ms": 6200}'}
          : {code: 4, stdout: '{"error": "no_clip"}'},
      calls,
    );
    const clips = await runAnimate(deps, {
      heroes: [
        {id: 'img0', motionPrompt: 'drift up', sourcePath: 'photos/img0.jpg'},
        {id: 'img2', motionPrompt: 'lights on', sourcePath: 'photos/img2.jpg'},
      ],
    });
    expect(clips.get('img0')).toEqual({file: 'img0.mp4', durationMs: 6200});
    expect(clips.has('img2')).toBe(false); // failed hero silently dropped
    expect(calls).toHaveLength(2);
    const first = calls[0].args;
    expect(first[first.indexOf('--out') + 1]).toBe(
      path.join('C:\\repo', 'renderer', 'public', 'assets', 'clips', 'img0.mp4'),
    );
    expect(first[first.indexOf('--prompt') + 1]).toBe('drift up');
  });
});

describe('runFilm', () => {
  it('returns the film file + duration', async () => {
    const calls: Call[] = [];
    const deps = depsWith(() => ({code: 0, stdout: '{"duration_ms": 11000}'}), calls);
    const res = await runFilm(deps, {
      refPaths: ['a.jpg', 'b.jpg'],
      prompt: 'a dusk story',
      runId: 'r9',
    });
    expect(res).toEqual({file: 'film-r9.mp4', durationMs: 11000});
    const args = calls[0].args;
    expect(args[args.indexOf('--refs') + 1]).toBe('a.jpg,b.jpg');
  });

  it('maps failure to PipelineError film_failed', async () => {
    const deps = depsWith(() => ({code: 4, stdout: '{"error": "no_film"}'}));
    await expect(
      runFilm(deps, {refPaths: ['a.jpg'], prompt: 'p', runId: 'r1'}),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).code).toBe('film_failed');
      return true;
    });
  });
});
