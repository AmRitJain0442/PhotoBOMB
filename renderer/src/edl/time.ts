export const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms / 1000) * fps);
