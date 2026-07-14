import React from 'react';
import {Player} from '@remotion/player';
import type {Edl} from '../../../src/edl/schema';
import {msToFrame} from '../../../src/edl/time';
import {Reel} from '../../../src/Reel';

export const PreviewPane: React.FC<{
  edl: Edl | null;
  assets: Record<string, string>;
  stale: boolean;
}> = ({edl, assets, stale}) => {
  if (!edl) {
    return <div className="preview empty">no valid edl yet — fix the errors on the left</div>;
  }
  return (
    <div className={stale ? 'preview stale' : 'preview'} title={stale ? 'showing last valid EDL' : ''}>
      <div className="bezel">
        <Player
          component={Reel}
          inputProps={{edl, assets}}
          durationInFrames={msToFrame(edl.duration_ms, edl.fps)}
          fps={edl.fps}
          compositionWidth={1080}
          compositionHeight={1920}
          controls
          loop
          style={{width: 279, height: 496}}
        />
      </div>
      {stale && <div className="stale-note">edl has errors — showing last valid</div>}
    </div>
  );
};
