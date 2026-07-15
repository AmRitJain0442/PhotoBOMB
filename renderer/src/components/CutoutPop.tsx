import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {cutoutPopAt} from './cutout-pop-math';

export const CutoutPop: React.FC<{
  src: string;
  origin: {cx: number; cy: number};
  durationInFrames: number;
}> = ({src, origin, durationInFrames}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  const s = cutoutPopAt(progress, origin);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <Img
        src={src}
        style={{
          position: 'absolute',
          left: `${s.cx * 100}%`,
          top: `${s.cy * 100}%`,
          maxWidth: '55%',
          maxHeight: '45%',
          transform: `translate(-50%, -50%) scale(${s.scale}) rotate(${s.rotateDeg}deg)`,
          opacity: s.opacity,
          filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.5))',
        }}
      />
    </AbsoluteFill>
  );
};
