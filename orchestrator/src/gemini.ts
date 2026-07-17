import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {z} from 'zod';

// Every model carries its own Vertex location: Gemini 3 lives at `global`,
// the 2.5 family at us-central1.
export type ModelRef = {id: string; location: string};

export const MODELS = {
  flash: {id: 'gemini-3-flash-preview', location: 'global'},
  pro: {id: 'gemini-2.5-pro', location: 'us-central1'},
} as const;
export const VERTEX = {project: 'project-a2dcdad0-5d65-4d61-846'} as const;

export type GeminiUsage = {inputTokens: number; outputTokens: number; thoughtsTokens: number};

export type GeminiRequest = {
  model: ModelRef;
  system: string;
  parts: Array<{text: string}>;
  responseSchema: object;
  maxOutputTokens: number;
};

export type GeminiTransport = (req: GeminiRequest) => Promise<{text: string; usage: GeminiUsage}>;

export class GeminiJsonError extends Error {
  constructor(message: string, public readonly lastText: string) {
    super(message);
    this.name = 'GeminiJsonError';
  }
}

const addUsage = (a: GeminiUsage, b: GeminiUsage): GeminiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  thoughtsTokens: a.thoughtsTokens + b.thoughtsTokens,
});

const tryParse = <T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): {data: T} | {error: string} => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {error: `Invalid JSON: ${(e as Error).message}`};
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return {error: `Schema violations: ${issues}`};
  }
  return {data: parsed.data};
};

export async function generateJson<T>(opts: {
  transport: GeminiTransport;
  model: ModelRef;
  system: string;
  parts: Array<{text: string}>;
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  responseSchema: object;
  maxOutputTokens?: number;
  repairNote?: string;
}): Promise<{data: T; usage: GeminiUsage; repaired: boolean}> {
  const maxOutputTokens = opts.maxOutputTokens ?? 8192;
  const repairNote = opts.repairNote ?? 'Fix the JSON and re-emit ONLY valid JSON.';

  const first = await opts.transport({
    model: opts.model,
    system: opts.system,
    parts: opts.parts,
    responseSchema: opts.responseSchema,
    maxOutputTokens,
  });
  let usage = first.usage;
  const attempt1 = tryParse(first.text, opts.zodSchema);
  if ('data' in attempt1) return {data: attempt1.data, usage, repaired: false};

  const second = await opts.transport({
    model: opts.model,
    system: opts.system,
    parts: [
      ...opts.parts,
      {
        text:
          `Your previous response was rejected.\n` +
          `Previous response:\n${first.text}\n` +
          `Problem: ${attempt1.error}\n${repairNote}`,
      },
    ],
    responseSchema: opts.responseSchema,
    maxOutputTokens,
  });
  usage = addUsage(usage, second.usage);
  const attempt2 = tryParse(second.text, opts.zodSchema);
  if ('data' in attempt2) return {data: attempt2.data, usage, repaired: true};

  throw new GeminiJsonError(
    `Model failed to produce valid JSON after repair attempt. ${attempt2.error}`,
    second.text,
  );
}

/** Point GOOGLE_APPLICATION_CREDENTIALS at the repo SA key when unset. */
export function resolveCredentials(repoRoot: string): {ok: boolean; message?: string} {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return {ok: true};
  const keyPath = join(repoRoot, 'my-product-sa-key.json');
  if (existsSync(keyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
    return {ok: true};
  }
  return {
    ok: false,
    message:
      'No Google credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or place my-product-sa-key.json at the repo root.',
  };
}

/** Real Vertex transport via @google/genai. Lazy per-location clients so
 * tests never touch them. */
const clients = new Map<string, import('@google/genai').GoogleGenAI>();

export const vertexTransport: GeminiTransport = async (req) => {
  let client = clients.get(req.model.location);
  if (!client) {
    const {GoogleGenAI} = await import('@google/genai');
    client = new GoogleGenAI({
      vertexai: true,
      project: VERTEX.project,
      location: req.model.location,
    });
    clients.set(req.model.location, client);
  }
  const isGemini3 = req.model.id.startsWith('gemini-3');
  const response = await client.models.generateContent({
    model: req.model.id,
    contents: [{role: 'user', parts: req.parts}],
    config: {
      systemInstruction: req.system,
      responseMimeType: 'application/json',
      responseSchema: req.responseSchema,
      maxOutputTokens: req.maxOutputTokens,
      // Gemini 3 paces reasoning by level, not token budget; LOW keeps the
      // structured-output stages fast without starving them.
      ...(isGemini3 ? {thinkingConfig: {thinkingLevel: 'LOW' as never}} : {}),
    },
  });
  const meta = response.usageMetadata;
  return {
    text: response.text ?? '',
    usage: {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      thoughtsTokens: meta?.thoughtsTokenCount ?? 0,
    },
  };
};
