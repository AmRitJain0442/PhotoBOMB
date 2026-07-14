import {describe, expect, test} from 'vitest';
import type {KenBurnsMotion} from '../edl/schema';
import {kenBurnsAt} from './kenburns-math';

const motion: KenBurnsMotion = {
  type: 'ken_burns',
  from: {zoom: 1.0, cx: 0.5, cy: 0.5},
  to: {zoom: 1.2, cx: 0.6, cy: 0.4},
  easing: 'linear',
};

describe('kenBurnsAt', () => {
  test('progress 0 returns the from state', () => {
    expect(kenBurnsAt(0, motion)).toEqual({zoom: 1.0, txPct: 0, tyPct: 0});
  });

  test('progress 1 returns the to state, pan clamped to coverage limit', () => {
    const r = kenBurnsAt(1, motion);
    expect(r.zoom).toBeCloseTo(1.2);
    // requested pan is -10/+10 but zoom 1.2 only affords 50*(z-1)/z = 8.33%
    const limit = (50 * (1.2 - 1)) / 1.2;
    expect(r.txPct).toBeCloseTo(-limit);
    expect(r.tyPct).toBeCloseTo(limit);
  });

  test('never exposes background: pan is zero at zoom 1', () => {
    const still = kenBurnsAt(0, {
      ...motion,
      from: {zoom: 1.0, cx: 0.3, cy: 0.7}, // extreme focal point, no zoom headroom
    });
    expect(still.txPct).toBe(0);
    expect(still.tyPct).toBe(0);
  });

  test('clamps progress outside [0,1]', () => {
    expect(kenBurnsAt(-0.5, motion)).toEqual(kenBurnsAt(0, motion));
    expect(kenBurnsAt(1.5, motion)).toEqual(kenBurnsAt(1, motion));
  });

  test('easeOutCubic front-loads the motion', () => {
    const eased = kenBurnsAt(0.5, {...motion, easing: 'easeOutCubic'});
    // easeOutCubic(0.5) = 0.875 -> zoom = 1 + 0.875*0.2
    expect(eased.zoom).toBeCloseTo(1.175);
  });
});
