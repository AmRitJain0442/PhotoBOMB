import {expect, test} from 'vitest';
import {msToFrame} from './time';

test('msToFrame rounds to nearest frame at 30fps', () => {
  expect(msToFrame(0, 30)).toBe(0);
  expect(msToFrame(1000, 30)).toBe(30);
  expect(msToFrame(1830, 30)).toBe(55); // 54.9 -> 55
  expect(msToFrame(33, 30)).toBe(1); // 0.99 -> 1
});
