import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';

// quote_card effect (spec 2026-07-15 §5): the photo becomes a darkened
// backdrop for the quote — brightness ~0.35 with a slow push-in.
export const QuoteCardBackdrop: React.FC<{src: string; durationInFrames: number}> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'brightness(0.35)',
          transform: `scale(${1 + 0.06 * progress})`,
        }}
      />
    </AbsoluteFill>
  );
};
