import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import type {KenBurnsMotion} from '../edl/schema';
import {kenBurnsAt} from './kenburns-math';

export const KenBurns: React.FC<{
  src: string;
  motion: KenBurnsMotion;
  durationInFrames: number;
}> = ({src, motion, durationInFrames}) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  const {zoom, txPct, tyPct} = kenBurnsAt(progress, motion);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${zoom}) translate(${txPct}%, ${tyPct}%)`,
        }}
      />
    </AbsoluteFill>
  );
};
