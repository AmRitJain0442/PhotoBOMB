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

  test('accepts cutout_pop transition and an entry cutout path', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[0].transition_out = {type: 'cutout_pop', duration_ms: 400};
    edl.timeline[0].cutout = 'assets/cutouts/IMG_001.png';
    expect(() => EdlSchema.parse(edl)).not.toThrow();
  });

  test('accepts a duotone quote with spans, applying emphasis defaults', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[1].text = {
      content: 'stay for the light',
      style: 'quote_duotone',
      in_ms: 100,
      out_ms: 900,
      anchor: 'center',
      spans: [{text: 'stay for the'}, {text: 'light', bold: true, tone: 'yellow'}],
    };
    const parsed = EdlSchema.parse(edl);
    expect(parsed.timeline[1].text?.spans?.[0]).toEqual({
      text: 'stay for the',
      bold: false,
      underline: false,
      tone: 'white',
    });
    expect(parsed.timeline[1].text?.spans?.[1].bold).toBe(true);
  });

  test('quote_duotone without spans is valid (plain white fallback)', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[1].text = {
      content: 'stay',
      style: 'quote_duotone',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
    };
    expect(() => EdlSchema.parse(edl)).not.toThrow();
  });

  test('rejects a bad span tone and accepts quote_card effect', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[0].effects = ['quote_card'];
    expect(() => EdlSchema.parse(edl)).not.toThrow();
    edl.timeline[0].text = {
      content: 'x',
      style: 'quote_duotone',
      in_ms: 0,
      out_ms: 500,
      anchor: 'center',
      spans: [{text: 'x', tone: 'red'}],
    };
    expect(() => EdlSchema.parse(edl)).toThrow();
  });

  test('accepts a clip entry with clip_path and duration; rejects zero duration', () => {
    const edl = structuredClone(validEdl) as Record<string, any>;
    edl.timeline[1] = {
      asset: 'IMG_002',
      kind: 'clip',
      start_ms: 1000,
      end_ms: 2000,
      clip_path: 'assets/clips/IMG_002.mp4',
      clip_duration_ms: 6000,
    };
    const parsed = EdlSchema.parse(edl);
    expect(parsed.timeline[1].clip_path).toBe('assets/clips/IMG_002.mp4');
    edl.timeline[1].clip_duration_ms = 0;
    expect(() => EdlSchema.parse(edl)).toThrow();
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
