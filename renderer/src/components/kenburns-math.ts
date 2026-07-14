import type {EasingName, KenBurnsMotion} from '../edl/schema';

const easings: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeInCubic: (t) => t ** 3,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
};

export const kenBurnsAt = (
  progress: number,
  motion: KenBurnsMotion,
): {zoom: number; txPct: number; tyPct: number} => {
  const p = Math.min(1, Math.max(0, progress));
  const e = easings[motion.easing](p);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  const zoom = lerp(motion.from.zoom, motion.to.zoom);
  const cx = lerp(motion.from.cx, motion.to.cx);
  const cy = lerp(motion.from.cy, motion.to.cy);
  // translate so the focal point (cx, cy) sits at frame center, but never
  // beyond the coverage limit: |pan| <= 50*(zoom-1)/zoom keeps the scaled
  // image covering the full frame (no background bars).
  const maxPan = zoom > 1 ? (50 * (zoom - 1)) / zoom : 0;
  const clamp = (v: number) => Math.min(maxPan, Math.max(-maxPan, v)) + 0;
  return {zoom, txPct: clamp((0.5 - cx) * 100), tyPct: clamp((0.5 - cy) * 100)};
};
