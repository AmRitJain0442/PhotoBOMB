import {describe, expect, test} from 'vitest';
import {EdlSchema} from './schema';

const validEdl = {
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 2000,
  audio: {
    track: 'assets/click.wav',
    trim_start_ms: 0,
    beat_grid_ms: [0, 500, 1000, 1500],
    voiceover: null,
    mute_render: false,
  },
  timeline: [
    {
      asset: 'IMG_001',
      kind: 'still',
      start_ms: 0,
      end_ms: 1000,
      motion: {
        type: 'ken_burns',
        from: {zoom: 1.0, cx: 0.5, cy: 0.42},
        to: {zoom: 1.18, cx: 0.55, cy: 0.45},
        easing: 'easeOutCubic',
      },
      effects: [],
      text: {
        content: 'golden hour',
        style: 'caption_lower',
        in_ms: 100,
        out_ms: 900,
        anchor: 'lower_third',
      },
    },
    {asset: 'IMG_002', kind: 'still', start_ms: 1000, end_ms: 2000},
  ],
};

describe('EdlSchema', () => {
  test('accepts a valid montage EDL', () => {
    const parsed = EdlSchema.parse(validEdl);
    expect(parsed.timeline).toHaveLength(2);
    // defaults applied
    expect(parsed.timeline[1].effects).toEqual([]);
    expect(parsed.timeline[1].speed).toBe(1);
  });

  test('rejects an unknown transition type', () => {
    const bad = structuredClone(validEdl) as Record<string, any>;
    bad.timeline[0].transition_out = {type: 'star_wipe', duration_ms: 160};
    expect(() => EdlSchema.parse(bad)).toThrow();
  });

  test('rejects an unknown text style', () => {
    const bad = structuredClone(validEdl) as Record<string, any>;
    bad.timeline[0].text = {
      content: 'x',
      style: 'comic_sans',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
    };
    expect(() => EdlSchema.parse(bad)).toThrow();
  });

  test('rejects wrong aspect or fps', () => {
    expect(() => EdlSchema.parse({...validEdl, aspect: '16:9'})).toThrow();
    expect(() => EdlSchema.parse({...validEdl, fps: 24})).toThrow();
  });

  test('accepts speed ramps on clips', () => {
    const withClip = structuredClone(validEdl) as Record<string, any>;
    withClip.timeline[1] = {
      asset: 'CLIP_001',
      kind: 'clip',
      start_ms: 1000,
      end_ms: 2000,
      speed: [
        {at_ms: 0, rate: 0.5},
        {at_ms: 400, rate: 2},
      ],
    };
    expect(() => EdlSchema.parse(withClip)).not.toThrow();
  });
});
