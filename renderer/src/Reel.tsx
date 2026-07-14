import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, staticFile} from 'remotion';
import type {Edl, TimelineEntry} from './edl/schema';
import {msToFrame} from './edl/time';
import {KenBurns} from './components/KenBurns';
import {TextOverlay} from './components/text/TextOverlay';

export type ReelProps = {
  edl: Edl;
  assets: Record<string, string>;
};

const Shot: React.FC<{
  entry: TimelineEntry;
  src: string;
  beatGridMs: number[];
  fps: number;
}> = ({entry, src, beatGridMs, fps}) => {
  const durF = msToFrame(entry.end_ms, fps) - msToFrame(entry.start_ms, fps);
  return (
    <AbsoluteFill>
      {entry.motion && entry.motion.type === 'ken_burns' ? (
        <KenBurns src={src} motion={entry.motion} durationInFrames={durF} />
      ) : (
        <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      )}
      {entry.text ? (
        <TextOverlay
          text={entry.text}
          entryStartMs={entry.start_ms}
          beatGridMs={beatGridMs}
          fps={fps}
        />
      ) : null}
    </AbsoluteFill>
  );
};

// M0: transitions are hard cuts (transition_out ignored); effects not rendered.
export const Reel: React.FC<ReelProps> = ({edl, assets}) => {
  const fps = edl.fps;
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {edl.timeline.map((entry) => {
        const from = msToFrame(entry.start_ms, fps);
        const durF = msToFrame(entry.end_ms, fps) - from;
        return (
          <Sequence key={`${entry.asset}-${entry.start_ms}`} from={from} durationInFrames={durF}>
            <Shot
              entry={entry}
              src={staticFile(assets[entry.asset])}
              beatGridMs={edl.audio.beat_grid_ms}
              fps={fps}
            />
          </Sequence>
        );
      })}
      {edl.audio.track && !edl.audio.mute_render ? (
        <Audio
          src={staticFile(edl.audio.track)}
          trimBefore={msToFrame(edl.audio.trim_start_ms, fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
