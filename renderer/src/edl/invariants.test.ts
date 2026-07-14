import {describe, expect, test} from 'vitest';
import type {Edl} from './schema';
import {checkInvariants} from './invariants';

const base = (overrides: Partial<Edl> = {}): Edl => ({
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 2000,
  audio: {
    track: null,
    trim_start_ms: 0,
    beat_grid_ms: [0, 500, 1000, 1500, 2000],
    voiceover: null,
    mute_render: true,
  },
  timeline: [
    {asset: 'A', kind: 'still', start_ms: 0, end_ms: 1000, speed: 1, effects: []},
    {asset: 'B', kind: 'still', start_ms: 1000, end_ms: 2000, speed: 1, effects: []},
  ],
  ...overrides,
});

const assets = new Set(['A', 'B']);

describe('checkInvariants', () => {
  test('valid EDL returns no errors', () => {
    expect(checkInvariants(base(), assets)).toEqual([]);
  });

  test('detects gap between entries', () => {
    const edl = base();
    edl.timeline[1].start_ms = 1100;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/gap|overlap/i);
  });

  test('detects overlap between entries', () => {
    const edl = base();
    edl.timeline[1].start_ms = 900;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/gap|overlap/i);
  });

  test('detects timeline not ending at duration_ms', () => {
    const edl = base();
    edl.timeline[1].end_ms = 1900;
    expect(checkInvariants(edl, assets).length).toBeGreaterThan(0);
  });

  test('detects off-beat cut in montage mode', () => {
    const edl = base();
    edl.timeline[0].end_ms = 940; // nearest beat 1000 -> off by 60ms > 33ms
    edl.timeline[1].start_ms = 940;
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/beat/i);
  });

  test('allows cut within 33ms of a beat', () => {
    const edl = base();
    edl.timeline[0].end_ms = 1020;
    edl.timeline[1].start_ms = 1020;
    expect(checkInvariants(edl, assets)).toEqual([]);
  });

  test('edit mode allows half-beat cuts, montage does not', () => {
    const edl = base({mode: 'edit'});
    edl.timeline[0].end_ms = 750; // half-beat between 500 and 1000
    edl.timeline[1].start_ms = 750;
    expect(checkInvariants(edl, assets)).toEqual([]);
    const montage = base();
    montage.timeline[0].end_ms = 750;
    montage.timeline[1].start_ms = 750;
    expect(checkInvariants(montage, assets).join(' ')).toMatch(/beat/i);
  });

  test('narrative mode skips beat snapping', () => {
    const edl = base({mode: 'narrative'});
    edl.timeline[0].end_ms = 940;
    edl.timeline[1].start_ms = 940;
    expect(checkInvariants(edl, assets)).toEqual([]);
  });

  test('detects unknown asset reference', () => {
    const edl = base();
    edl.timeline[0].asset = 'MISSING';
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/MISSING/);
  });

  test('detects text overrunning its entry', () => {
    const edl = base();
    edl.timeline[0].text = {
      content: 'x',
      style: 'caption_lower',
      in_ms: 100,
      out_ms: 1200,
      anchor: 'center',
    };
    expect(checkInvariants(edl, assets).join(' ')).toMatch(/text/i);
  });
});
