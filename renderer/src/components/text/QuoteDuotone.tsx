import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {QuoteSpan} from '../../edl/schema';
import {msToFrame} from '../../edl/time';
import {theme} from '../../theme';
import {spansToLines, wordReveal} from './quote-timing';

// Spec 2026-07-15 §5: vivid duotone, deliberately NOT the muted UI amber.
const TONE = {white: '#f5efe6', yellow: '#ffd84d'} as const;

export const QuoteDuotone: React.FC<{
  spans: QuoteSpan[];
  inMs: number;
  outMs: number;
  fps: number;
}> = ({spans, inMs, outMs, fps}) => {
  const frame = useCurrentFrame();
  const inF = msToFrame(inMs, fps);
  const outF = msToFrame(outMs, fps);
  if (frame < inF || frame > outF) return null;
  const tMs = (frame / fps) * 1000;
  const lines = spansToLines(spans);
  const wordCount = lines.reduce((n, l) => n + l.length, 0);
  return (
    <div
      style={{
        position: 'absolute',
        left: '10%',
        right: '12%',
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign: 'center',
        fontFamily: theme.fonts.editorial,
        fontSize: 76,
        lineHeight: 1.3,
        textShadow: `0 2px 32px ${theme.colors.shadow}`,
      }}
    >
      {lines.map((line, li) => (
        <div key={li}>
          {line.map((w) => {
            const {opacity, rise} = wordReveal(tMs, inMs, outMs, w.wordIndex, wordCount);
            return (
              <span
                key={w.wordIndex}
                style={{
                  display: 'inline-block',
                  margin: '0 0.18em',
                  color: TONE[w.tone],
                  fontWeight: w.bold ? 800 : 500,
                  borderBottom: w.underline ? '6px solid currentColor' : undefined,
                  paddingBottom: w.underline ? 4 : 0,
                  transform: `translateY(${12 * rise}px) ${w.underline ? 'rotate(-0.6deg)' : ''}`,
                  opacity,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
