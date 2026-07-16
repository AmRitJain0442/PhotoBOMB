// Pure frame math for the cutout pop overlay (spec 2026-07-15 §5): the
// outgoing photo's subject starts at the entry's focal point at natural
// scale, blows up to ~1.6x with a ~6 degree twist while drifting halfway
// toward frame center, and fades out in the last quarter (after the cut).
export const POP_SPAN_MS = 200; // overlay covers ±POP_SPAN_MS around the cut
export const SETTLE_MS = 400; // incoming shot settles 1.04 -> 1.0

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export type PopState = {
  scale: number;
  rotateDeg: number;
  cx: number; // 0..1 frame fraction
  cy: number;
  opacity: number;
};

export function cutoutPopAt(progress: number, origin: {cx: number; cy: number}): PopState {
  const raw = clamp01(progress);
  const p = easeOutCubic(raw);
  return {
    scale: 1 + 0.6 * p,
    rotateDeg: 6 * p,
    cx: origin.cx + (0.5 - origin.cx) * 0.5 * p,
    cy: origin.cy + (0.5 - origin.cy) * 0.5 * p,
    opacity: raw < 0.75 ? 1 : clamp01((1 - raw) / 0.25),
  };
}

export function settleScaleAt(progress: number): number {
  return 1.04 - 0.04 * easeOutCubic(clamp01(progress));
}
