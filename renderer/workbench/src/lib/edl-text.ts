import type {Edl} from '../../../src/edl/schema';
import {EdlSchema} from '../../../src/edl/schema';
import {checkInvariants} from '../../../src/edl/invariants';

export const assetsFromFiles = (files: string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const file of files) {
    map[file.replace(/\.[^.]+$/, '')] = `assets/${file}`;
  }
  return map;
};

// parse -> schema -> invariants; edl is non-null only when fully valid.
export const edlFromText = (
  text: string,
  assetIds: Set<string>,
): {edl: Edl | null; errors: string[]} => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {edl: null, errors: [`JSON: ${(e as Error).message}`]};
  }
  const parsed = EdlSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      edl: null,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  const errors = checkInvariants(parsed.data, assetIds);
  return {edl: errors.length ? null : parsed.data, errors};
};
