import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {Anchor} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {anchorStyle} from '../anchors';

export const CaptionLower: React.FC<{
  content: string;
  inMs: number;
  outMs: number;
  anchor: Anchor;
  fps: number;
}> = ({content, inMs, outMs, anchor, fps}) => {
  const frame = useCurrentFrame();
  const inF = msToFrame(inMs, fps);
  const outF = msToFrame(outMs, fps);
  if (frame < inF || frame > outF) return null;
  const fade = Math.max(1, Math.min(Math.round(fps * 0.2), Math.floor((outF - inF) / 3)));
  const opacity = interpolate(frame, [inF, inF + fade, outF - fade, outF], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        ...anchorStyle(anchor),
        opacity,
        color: theme.colors.text,
        fontFamily: theme.fonts.caption,
        fontSize: 44,
        letterSpacing: '0.14em',
        textTransform: 'lowercase',
        textShadow: `0 2px 24px ${theme.colors.shadow}`,
      }}
    >
      {content}
    </div>
  );
};
