// Pure helpers for the Review screen's basic tweaks. All edits are
// immutable and keep the EDL renderer-valid.
import type {Edl} from '../../../src/edl/schema';

export type TextRef = {entryIndex: number; content: string};

export function listTexts(edl: Edl): TextRef[] {
  return edl.timeline.flatMap((entry, entryIndex) =>
    entry.text && entry.text.style !== 'none'
      ? [{entryIndex, content: entry.text.content}]
      : [],
  );
}

/** Reword an overlay; an empty string removes it entirely. */
export function setText(edl: Edl, entryIndex: number, content: string): Edl {
  const timeline = edl.timeline.map((entry, i) => {
    if (i !== entryIndex || !entry.text) return entry;
    const trimmed = content.trim();
    if (trimmed === '') {
      const {text: _dropped, ...rest} = entry;
      return rest;
    }
    return {...entry, text: {...entry.text, content: trimmed}};
  });
  return {...edl, timeline};
}

/** Photo ids in timeline order, deduplicated. */
export function usedPhotoIds(edl: Edl): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of edl.timeline) {
    if (!seen.has(entry.asset)) {
      seen.add(entry.asset);
      ids.push(entry.asset);
    }
  }
  return ids;
}
