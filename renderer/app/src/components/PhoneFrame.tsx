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
  <div
    style={{
      background: 'var(--tray)',
      border: '1px solid var(--tray-edge)',
      borderRadius: 28,
      padding: 12,
      width: 'fit-content',
      opacity: dimmed ? 0.45 : 1,
      transition: 'opacity 0.2s ease',
    }}
  >
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
