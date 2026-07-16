import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type {Edl, TimelineEntry} from './edl/schema';
import {msToFrame} from './edl/time';
import {KenBurns} from './components/KenBurns';
import {CutoutPop} from './components/CutoutPop';
import {POP_SPAN_MS, SETTLE_MS, settleScaleAt} from './components/cutout-pop-math';
import {QuoteCardBackdrop} from './components/QuoteCardBackdrop';
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
  settleIn: boolean;
  edlHasTrack: boolean;
}> = ({entry, src, beatGridMs, fps, settleIn, edlHasTrack}) => {
  const frame = useCurrentFrame();
  const durF = msToFrame(entry.end_ms, fps) - msToFrame(entry.start_ms, fps);
  const settleF = msToFrame(SETTLE_MS, fps);
  const scale = settleIn ? settleScaleAt(settleF <= 0 ? 1 : Math.min(1, frame / settleF)) : 1;
  return (
    <AbsoluteFill style={{transform: `scale(${scale})`}}>
      {(entry.kind === 'clip' || entry.kind === 'veo') && entry.clip_path ? (
        // generated clip; the song owns the soundtrack unless the EDL has none
        <OffthreadVideo
          src={staticFile(entry.clip_path)}
          muted={edlHasTrack}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      ) : entry.effects.includes('quote_card') ? (
        <QuoteCardBackdrop src={src} durationInFrames={durF} />
      ) : entry.motion && entry.motion.type === 'ken_burns' ? (
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

// Transitions: cutout_pop renders as an overlay around the cut (degrading to
// a hard cut when the cutout PNG is missing); all other types are hard cuts.
export const Reel: React.FC<ReelProps> = ({edl, assets}) => {
  const fps = edl.fps;
  const popDurF = msToFrame(2 * POP_SPAN_MS, fps);
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {edl.timeline.map((entry, i) => {
        const from = msToFrame(entry.start_ms, fps);
        const durF = msToFrame(entry.end_ms, fps) - from;
        const prev = edl.timeline[i - 1];
        const settleIn = prev?.transition_out?.type === 'cutout_pop' && Boolean(prev?.cutout);
        return (
          <Sequence key={`${entry.asset}-${entry.start_ms}`} from={from} durationInFrames={durF}>
            <Shot
              entry={entry}
              src={staticFile(assets[entry.asset])}
              beatGridMs={edl.audio.beat_grid_ms}
              fps={fps}
              settleIn={settleIn}
              edlHasTrack={edl.audio.track !== null}
            />
          </Sequence>
        );
      })}
      {edl.timeline.map((entry) =>
        entry.transition_out?.type === 'cutout_pop' && entry.cutout ? (
          <Sequence
            key={`pop-${entry.asset}-${entry.end_ms}`}
            from={Math.max(0, msToFrame(entry.end_ms - POP_SPAN_MS, fps))}
            durationInFrames={popDurF}
          >
            <CutoutPop
              src={staticFile(entry.cutout)}
              origin={
                entry.motion
                  ? {cx: entry.motion.to.cx, cy: entry.motion.to.cy}
                  : {cx: 0.5, cy: 0.5}
              }
              durationInFrames={popDurF}
            />
          </Sequence>
        ) : null,
      )}
      {edl.audio.track && !edl.audio.mute_render ? (
        <Audio
          src={staticFile(edl.audio.track)}
          trimBefore={msToFrame(edl.audio.trim_start_ms, fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
