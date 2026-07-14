import {describe, expect, test} from 'vitest';
import {anchorStyle} from './anchors';

// IG safe areas: 12% top / 20% bottom / 10% right must stay clear.
describe('anchorStyle', () => {
  test('lower_third clears the 20% bottom margin', () => {
    const s = anchorStyle('lower_third');
    expect(parseFloat(String(s.bottom))).toBeGreaterThanOrEqual(20);
  });
  test('upper_safe clears the 12% top margin', () => {
    const s = anchorStyle('upper_safe');
    expect(parseFloat(String(s.top))).toBeGreaterThanOrEqual(12);
  });
  test('every anchor clears the 10% right margin', () => {
    for (const a of ['lower_third', 'center', 'upper_safe', 'corner_br'] as const) {
      expect(parseFloat(String(anchorStyle(a).right))).toBeGreaterThanOrEqual(10);
    }
  });
});
