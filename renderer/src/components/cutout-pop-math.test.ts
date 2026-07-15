import {describe, expect, test} from 'vitest';
import {cutoutPopAt, settleScaleAt} from './cutout-pop-math';

describe('cutoutPopAt', () => {
  test('starts at the origin at natural scale, fully opaque', () => {
    expect(cutoutPopAt(0, {cx: 0.3, cy: 0.7})).toEqual({
      scale: 1,
      rotateDeg: 0,
      cx: 0.3,
      cy: 0.7,
      opacity: 1,
    });
  });

  test('ends enlarged, twisted, drifted toward center, faded out', () => {
    const s = cutoutPopAt(1, {cx: 0.3, cy: 0.7});
    expect(s.scale).toBeCloseTo(1.6);
    expect(s.rotateDeg).toBeCloseTo(6);
    expect(s.cx).toBeCloseTo(0.4); // halfway toward 0.5
    expect(s.cy).toBeCloseTo(0.6);
    expect(s.opacity).toBe(0);
  });

  test('scale grows monotonically', () => {
    let prev = 0;
    for (let p = 0; p <= 1.001; p += 0.1) {
      const {scale} = cutoutPopAt(p, {cx: 0.5, cy: 0.5});
      expect(scale).toBeGreaterThanOrEqual(prev);
      prev = scale;
    }
  });

  test('stays fully opaque through the cut (first three quarters)', () => {
    expect(cutoutPopAt(0.5, {cx: 0.5, cy: 0.5}).opacity).toBe(1);
    expect(cutoutPopAt(0.74, {cx: 0.5, cy: 0.5}).opacity).toBe(1);
  });
});

describe('settleScaleAt', () => {
  test('eases the incoming shot from 1.04 to 1.0', () => {
    expect(settleScaleAt(0)).toBeCloseTo(1.04);
    expect(settleScaleAt(1)).toBeCloseTo(1.0);
    expect(settleScaleAt(0.5)).toBeLessThan(1.04);
  });
});
