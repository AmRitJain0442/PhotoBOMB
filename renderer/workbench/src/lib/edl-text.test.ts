import {describe, expect, test} from 'vitest';
import fixture from '../../../fixtures/montage.json';
import {assetsFromFiles, edlFromText} from './edl-text';

const fixtureText = JSON.stringify(fixture.edl);
const fixtureIds = new Set(Object.keys(fixture.assets));

describe('assetsFromFiles', () => {
  test('maps filenames to ids and staticFile paths', () => {
    expect(assetsFromFiles(['IMG_001.svg', 'me.beach.jpg'])).toEqual({
      IMG_001: 'assets/IMG_001.svg',
      'me.beach': 'assets/me.beach.jpg',
    });
  });
});

describe('edlFromText', () => {
  test('valid EDL returns edl and no errors', () => {
    const r = edlFromText(fixtureText, fixtureIds);
    expect(r.errors).toEqual([]);
    expect(r.edl?.duration_ms).toBe(12000);
  });

  test('JSON syntax error reported, edl null', () => {
    const r = edlFromText('{not json', fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors[0]).toMatch(/^JSON:/);
  });

  test('schema error reported with path', () => {
    const bad = JSON.parse(fixtureText);
    bad.timeline[0].kind = 'hologram';
    const r = edlFromText(JSON.stringify(bad), fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors.join(' ')).toMatch(/timeline.0.kind/);
  });

  test('invariant error reported, edl null', () => {
    const bad = JSON.parse(fixtureText);
    bad.timeline[0].end_ms = 940;
    bad.timeline[1].start_ms = 940;
    const r = edlFromText(JSON.stringify(bad), fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors.join(' ')).toMatch(/beat/i);
  });
});
