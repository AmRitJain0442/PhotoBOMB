// Word-by-word reveal times for kinetic_word: one word per beat inside the
// text window; if the window has fewer beats than words, spread evenly.
export const kineticWordTimings = (
  content: string,
  inMs: number,
  outMs: number,
  beatsMs: number[],
): {word: string; atMs: number}[] => {
  const words = content.split(/\s+/).filter(Boolean);
  const usable = beatsMs.filter((b) => b >= inMs && b < outMs);
  if (usable.length >= words.length) {
    return words.map((word, i) => ({word, atMs: usable[i]}));
  }
  const step = (outMs - inMs) / words.length;
  return words.map((word, i) => ({word, atMs: inMs + i * step}));
};
