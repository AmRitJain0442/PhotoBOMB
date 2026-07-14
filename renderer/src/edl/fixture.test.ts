import {expect, test} from 'vitest';
import fixture from '../../fixtures/montage.json';
import {EdlSchema} from './schema';
import {checkInvariants} from './invariants';

test('golden montage fixture passes schema + invariants', () => {
  const edl = EdlSchema.parse(fixture.edl);
  const errors = checkInvariants(edl, new Set(Object.keys(fixture.assets)));
  expect(errors).toEqual([]);
  expect(edl.duration_ms).toBe(12000);
  expect(edl.timeline).toHaveLength(12);
});
