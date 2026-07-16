import {describe, expect, it} from 'vitest';

import {EdlSchema, type Edl} from '../../../src/edl/schema';
import {listTexts, setText, usedPhotoIds} from './edl-tweaks';

const makeEdl = (): Edl =>
  EdlSchema.parse({
    mode: 'montage',
    aspect: '9:16',
    fps: 30,
    duration_ms: 2000,
    audio: {
      track: 'assets/audio/song.wav',
      trim_start_ms: 0,
      beat_grid_ms: [0, 500, 1000, 1500, 2000],
      voiceover: null,
      mute_render: false,
    },
    timeline: [
      {
        asset: 'img0',
        kind: 'still',
        start_ms: 0,
        end_ms: 500,
        text: {content: 'golden hour', style: 'caption_lower', in_ms: 0, out_ms: 400, anchor: 'lower_third'},
      },
      {asset: 'img1', kind: 'still', start_ms: 500, end_ms: 1000},
      {
        asset: 'img2',
        kind: 'still',
        start_ms: 1000,
        end_ms: 1500,
        text: {content: 'x', style: 'none', in_ms: 0, out_ms: 100, anchor: 'center'},
      },
      {asset: 'img0', kind: 'still', start_ms: 1500, end_ms: 2000},
    ],
  });

describe('listTexts', () => {
  it('returns visible overlays only (skips style none)', () => {
    expect(listTexts(makeEdl())).toEqual([{entryIndex: 0, content: 'golden hour'}]);
  });
});

describe('setText', () => {
  it('rewords immutably', () => {
    const edl = makeEdl();
    const next = setText(edl, 0, 'blue hour');
    expect(next.timeline[0].text?.content).toBe('blue hour');
    expect(edl.timeline[0].text?.content).toBe('golden hour');
    expect(() => EdlSchema.parse(next)).not.toThrow();
  });

  it('rewording a quote collapses spans to a single white span', () => {
    const edl = makeEdl();
    const quote = {
      ...edl,
      timeline: edl.timeline.map((e, i) =>
        i === 1
          ? {
              ...e,
              text: {
                content: 'stay for the light',
                style: 'quote_duotone' as const,
                in_ms: 0,
                out_ms: 400,
                anchor: 'center' as const,
                spans: [
                  {text: 'stay for the', bold: false, underline: false, tone: 'white' as const},
                  {text: 'light', bold: true, underline: false, tone: 'yellow' as const},
                ],
              },
            }
          : e,
      ),
    };
    const next = setText(quote, 1, 'blue hour again');
    expect(next.timeline[1].text?.content).toBe('blue hour again');
    expect(next.timeline[1].text?.spans).toEqual([
      {text: 'blue hour again', bold: false, underline: false, tone: 'white'},
    ]);
    expect(() => EdlSchema.parse(next)).not.toThrow();
  });

  it('empty string removes the overlay and stays schema-valid', () => {
    const next = setText(makeEdl(), 0, '   ');
    expect(next.timeline[0].text).toBeUndefined();
    expect(listTexts(next)).toEqual([]);
    expect(() => EdlSchema.parse(next)).not.toThrow();
  });
});

describe('usedPhotoIds', () => {
  it('keeps timeline order and dedups', () => {
    expect(usedPhotoIds(makeEdl())).toEqual(['img0', 'img1', 'img2']);
  });
});
