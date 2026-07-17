import React from 'react';
import {Player} from '@remotion/player';

import type {Edl} from '../../../src/edl/schema';
import {msToFrame} from '../../../src/edl/time';
import {Reel} from '../../../src/Reel';

export const PhoneFrame: React.FC<{
  edl: Edl;
  assets: Record<string, string>;
  dimmed?: boolean;
}> = ({edl, assets, dimmed}) => (
  <div className="phone-frame" style={{opacity: dimmed ? 0.45 : 1}}>
    <Player
      component={Reel}
      inputProps={{edl, assets}}
      durationInFrames={msToFrame(edl.duration_ms, edl.fps)}
      fps={edl.fps}
      compositionWidth={1080}
      compositionHeight={1920}
      controls
      loop
      style={{width: 300, height: 533, borderRadius: 18, overflow: 'hidden'}}
    />
  </div>
);
