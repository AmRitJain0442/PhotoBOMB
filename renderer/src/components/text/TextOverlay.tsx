import React from 'react';
import type {TextSpec} from '../../edl/schema';
import {CaptionLower} from './CaptionLower';
import {KineticWord} from './KineticWord';
import {QuoteDuotone} from './QuoteDuotone';

// M0 builds 2 of the 5 type styles; the rest fall back to CaptionLower so any
// valid EDL still renders. Later milestones replace the fallback cases.
export const TextOverlay: React.FC<{
  text: TextSpec;
  entryStartMs: number;
  beatGridMs: number[];
  fps: number;
}> = ({text, entryStartMs, beatGridMs, fps}) => {
  if (text.style === 'none') return null;
  if (text.style === 'quote_duotone') {
    // a hand-edited quote has no spans -> single white unemphasized line
    const spans = text.spans ?? [
      {text: text.content, bold: false, underline: false, tone: 'white' as const},
    ];
    return <QuoteDuotone spans={spans} inMs={text.in_ms} outMs={text.out_ms} fps={fps} />;
  }
  if (text.style === 'kinetic_word') {
    const relBeats = beatGridMs.map((b) => b - entryStartMs);
    return (
      <KineticWord
        content={text.content}
        inMs={text.in_ms}
        outMs={text.out_ms}
        anchor={text.anchor}
        beatsMs={relBeats}
        fps={fps}
      />
    );
  }
  return (
    <CaptionLower
      content={text.content}
      inMs={text.in_ms}
      outMs={text.out_ms}
      anchor={text.anchor}
      fps={fps}
    />
  );
};
