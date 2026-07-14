import React from 'react';
import {CalculateMetadataFunction, Composition} from 'remotion';
import fixture from '../fixtures/montage.json';
import {Reel, ReelProps} from './Reel';
import {EdlSchema} from './edl/schema';
import {checkInvariants} from './edl/invariants';
import {msToFrame} from './edl/time';

// Validation gate: schema + hard invariants run before any frame renders.
// This is the render half of the Zod-validate -> repair-loop contract.
const calculateMetadata: CalculateMetadataFunction<ReelProps> = ({props}) => {
  const edl = EdlSchema.parse(props.edl);
  const errors = checkInvariants(edl, new Set(Object.keys(props.assets)));
  if (errors.length > 0) {
    throw new Error(`EDL invariant violations:\n${errors.join('\n')}`);
  }
  return {
    durationInFrames: msToFrame(edl.duration_ms, edl.fps),
    fps: edl.fps,
    props: {...props, edl},
  };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    durationInFrames={360}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={fixture as unknown as ReelProps}
    calculateMetadata={calculateMetadata}
  />
);
