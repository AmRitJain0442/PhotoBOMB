import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {Anchor} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {anchorStyle} from '../anchors';
import {kineticWordTimings} from './kinetic-timing';

export const KineticWord: React.FC<{
  content: string;
  inMs: number;
  outMs: number;
  anchor: Anchor;
  beatsMs: number[]; // relative to the entry start, same frame of reference as inMs/outMs
  fps: number;
}> = ({content, inMs, outMs, anchor, beatsMs, fps}) => {
  const frame = useCurrentFrame();
  if (frame > msToFrame(outMs, fps)) return null;
  const timings = kineticWordTimings(content, inMs, outMs, beatsMs);
  const pop = Math.max(1, Math.round(fps * 0.15));
  return (
    <div
      style={{
        ...anchorStyle(anchor),
        color: theme.colors.text,
        fontFamily: theme.fonts.editorial,
        fontSize: 76,
        fontWeight: 700,
        textShadow: `0 2px 28px ${theme.colors.shadow}`,
      }}
    >
      {timings.map(({word, atMs}, i) => {
        const atF = msToFrame(atMs, fps);
        const scale = interpolate(frame, [atF, atF + pop], [1.5, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              marginRight: '0.3em',
              opacity: frame >= atF ? 1 : 0,
              transform: `scale(${scale})`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
