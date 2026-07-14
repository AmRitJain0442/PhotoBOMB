import {describe, expect, test} from 'vitest';
import {kineticWordTimings} from './kinetic-timing';

describe('kineticWordTimings', () => {
  test('assigns words to consecutive beats when enough beats exist', () => {
    const r = kineticWordTimings('slow light', 0, 1000, [0, 500, 1000, 1500]);
    expect(r).toEqual([
      {word: 'slow', atMs: 0},
      {word: 'light', atMs: 500},
    ]);
  });

  test('ignores beats outside the [in, out) window', () => {
    const r = kineticWordTimings('slow light', 200, 1000, [0, 500, 1000]);
    // beats in window: [500] — insufficient for 2 words -> even spread
    expect(r).toEqual([
      {word: 'slow', atMs: 200},
      {word: 'light', atMs: 600},
    ]);
  });

  test('falls back to even spread when beats are insufficient', () => {
    const r = kineticWordTimings('one two three four', 0, 1000, []);
    expect(r.map((x) => x.atMs)).toEqual([0, 250, 500, 750]);
  });

  test('collapses whitespace', () => {
    expect(kineticWordTimings('  a   b ', 0, 1000, [0, 500]).map((x) => x.word)).toEqual([
      'a',
      'b',
    ]);
  });
});
