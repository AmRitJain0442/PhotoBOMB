import {describe, expect, it} from 'vitest';

import {copyFor, friendlyError} from './stage-copy';

describe('copyFor', () => {
  it('maps each stage to its line', () => {
    expect(copyFor('analyze')).toBe('Looking at your photos…');
    expect(copyFor('produce')).toBe('Finding the story…');
    expect(copyFor('direct')).toBe('Cutting to the beat…');
    expect(copyFor('finalize')).toBe('Almost there…');
  });

  it('covers the dynamic-media stages', () => {
    expect(copyFor('enhance')).toBe('Giving your photos the darkroom treatment…');
    expect(copyFor('animate')).toBe('Bringing a moment to life…');
    expect(copyFor('film')).toBe('Directing your film…');
    expect(friendlyError('film_failed')).toMatch(/film/i);
    expect(friendlyError('film_no_tweaks')).toMatch(/re-taken/i);
  });

  it('falls back for unknown or missing stages', () => {
    expect(copyFor('warp')).toBe('Developing…');
    expect(copyFor(null)).toBe('Developing…');
  });
});

describe('friendlyError', () => {
  it('maps known codes', () => {
    expect(friendlyError('not_enough_photos')).toBe(
      'We need at least 3 clear, sharp photos. Add a few more and try again.',
    );
    expect(friendlyError('no_music')).toBe('Add a song first — reels need a beat.');
    expect(friendlyError('setup')).toBe(
      "Darkroom isn't connected to its AI yet. Check the service key and restart.",
    );
  });

  it('defaults to the gentle retry line', () => {
    expect(friendlyError('invariants')).toBe("That take didn't come out right. Let's try again.");
    expect(friendlyError(null)).toBe("That take didn't come out right. Let's try again.");
  });
});
