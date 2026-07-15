import {describe, expect, it} from 'vitest';

import {canCreate} from './gating';

describe('canCreate', () => {
  it('needs at least 3 photos', () => {
    const gate = canCreate({photoCount: 2, trackCount: 5, choice: 'auto'});
    expect(gate.ok).toBe(false);
    expect(gate.hint).toBe('Add at least 3 photos to make a reel.');
  });

  it('auto choice needs a non-empty library', () => {
    const gate = canCreate({photoCount: 5, trackCount: 0, choice: 'auto'});
    expect(gate.ok).toBe(false);
    expect(gate.hint).toBe('Add a song first — drop an MP3 in.');
  });

  it('a specific chosen track works with an otherwise empty count', () => {
    expect(canCreate({photoCount: 5, trackCount: 1, choice: 'songa'}).ok).toBe(true);
  });

  it('ok when photos and music are ready', () => {
    const gate = canCreate({photoCount: 3, trackCount: 1, choice: 'auto'});
    expect(gate).toEqual({ok: true});
  });
});
