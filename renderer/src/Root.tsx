import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';

const Placeholder: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: 'black'}} />
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Reel"
    component={Placeholder}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
