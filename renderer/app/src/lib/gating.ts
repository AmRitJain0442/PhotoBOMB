// Create-button gating: what's missing before a reel can be made.
export type CreateGate = {ok: boolean; hint?: string};

export function canCreate(opts: {
  photoCount: number;
  trackCount: number;
  choice: 'auto' | string;
}): CreateGate {
  if (opts.photoCount < 3) {
    return {ok: false, hint: 'Add at least 3 photos to make a reel.'};
  }
  if (opts.choice === 'auto' && opts.trackCount === 0) {
    return {ok: false, hint: 'Add a song first — drop an MP3 in.'};
  }
  return {ok: true};
}
