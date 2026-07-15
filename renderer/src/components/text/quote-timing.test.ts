import {describe, expect, test} from 'vitest';
import {spansToLines, wordReveal} from './quote-timing';

describe('wordReveal', () => {
  test('hidden at window start, fully visible by the end of the first third', () => {
    expect(wordReveal(1000, 1000, 4000, 0, 5).opacity).toBe(0);
    for (let w = 0; w < 5; w++) {
      const r = wordReveal(2000, 1000, 4000, w, 5); // first third ends at 2000
      expect(r.opacity).toBe(1);
      expect(r.rise).toBe(0);
    }
  });

  test('later words reveal later', () => {
    const early = wordReveal(1100, 1000, 4000, 0, 5).opacity;
    const late = wordReveal(1100, 1000, 4000, 4, 5).opacity;
    expect(early).toBeGreaterThan(late);
  });

  test('a single word fades without stagger', () => {
    expect(wordReveal(1000, 1000, 1600, 0, 1).opacity).toBe(0);
    expect(wordReveal(1600, 1000, 1600, 0, 1).opacity).toBe(1);
  });

  test('deterministic frame math', () => {
    expect(wordReveal(1234, 1000, 4000, 2, 6)).toEqual(wordReveal(1234, 1000, 4000, 2, 6));
  });
});

describe('spansToLines', () => {
  test('splits on newline spans and assigns global word indices', () => {
    const lines = spansToLines([
      {text: 'stay for the', bold: false, underline: false, tone: 'white'},
      {text: 'light', bold: true, underline: false, tone: 'yellow'},
      {text: '\n', bold: false, underline: false, tone: 'white'},
      {text: 'a little longer', bold: false, underline: true, tone: 'white'},
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((w) => w.text)).toEqual(['stay', 'for', 'the', 'light']);
    expect(lines[0][3]).toMatchObject({tone: 'yellow', bold: true, wordIndex: 3});
    expect(lines[1].map((w) => w.wordIndex)).toEqual([4, 5, 6]);
    expect(lines[1][0].underline).toBe(true);
  });
});
