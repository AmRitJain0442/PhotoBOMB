// Human copy for pipeline stages and failures. UI never shows pipeline
// jargon — these are the only strings the Developing screen prints.

const STAGE_COPY: Record<string, string> = {
  analyze: 'Looking at your photos…',
  produce: 'Finding the story…',
  enhance: 'Giving your photos the darkroom treatment…',
  animate: 'Bringing a moment to life…',
  film: 'Directing your film…',
  direct: 'Cutting to the beat…',
  finalize: 'Almost there…',
};

export function copyFor(stage: string | null | undefined): string {
  return (stage && STAGE_COPY[stage]) || 'Developing…';
}

const ERROR_COPY: Record<string, string> = {
  not_enough_photos: 'We need at least 3 clear, sharp photos. Add a few more and try again.',
  too_few_photos: 'A reel needs at least 3 photos.',
  no_music: 'Add a song first — reels need a beat.',
  setup: "Darkroom isn't connected to its AI yet. Check the service key and restart.",
  film_failed: "That film didn't come out — try another take or switch to a montage.",
  film_no_tweaks: 'Films can only be re-taken, not tweaked — try another take.',
};

export function friendlyError(code: string | null | undefined): string {
  return (
    (code && ERROR_COPY[code]) || "That take didn't come out right. Let's try again."
  );
}
