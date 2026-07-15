import type {QuoteSpan} from '../../edl/schema';

// Deterministic word-reveal math for the duotone quote (spec 2026-07-15 §5):
// words stagger in (~80ms apart, compressed for short windows) across the
// first third of the text window, then hold fully visible.
export const WORD_STAGGER_MS = 80;
export const WORD_FADE_MS = 180;

export type WordReveal = {opacity: number; rise: number}; // rise 1 -> 0

export function wordReveal(
  tMs: number,
  inMs: number,
  outMs: number,
  wordIndex: number,
  wordCount: number,
): WordReveal {
  const window = Math.max(1, outMs - inMs);
  const revealSpan = window / 3;
  // last word starts by 60% of the reveal span and fades within the rest,
  // so every word is fully on by the one-third mark
  const stagger =
    wordCount > 1 ? Math.min(WORD_STAGGER_MS, (revealSpan * 0.6) / (wordCount - 1)) : 0;
  const fade = Math.min(WORD_FADE_MS, revealSpan * 0.4);
  const start = inMs + wordIndex * stagger;
  const p = Math.min(1, Math.max(0, (tMs - start) / Math.max(1, fade)));
  return {opacity: p, rise: 1 - p};
}

export type QuoteWord = QuoteSpan & {wordIndex: number};

/** Split spans into lines on "\n" spans, then into per-word chunks keeping
 * each span's emphasis. wordIndex is global (reading order) for the stagger. */
export function spansToLines(spans: QuoteSpan[]): QuoteWord[][] {
  const lines: QuoteWord[][] = [[]];
  let wordIndex = 0;
  for (const span of spans) {
    if (span.text === '\n') {
      lines.push([]);
      continue;
    }
    for (const word of span.text.split(/\s+/).filter(Boolean)) {
      lines[lines.length - 1].push({...span, text: word, wordIndex: wordIndex++});
    }
  }
  return lines.filter((l) => l.length > 0);
}
