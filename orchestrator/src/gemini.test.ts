import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {GeminiJsonError, generateJson, type GeminiTransport, type GeminiUsage} from './gemini.js';

const usage: GeminiUsage = {inputTokens: 10, outputTokens: 5, thoughtsTokens: 2};
const OkSchema = z.object({ok: z.boolean()});
const okResponseSchema = {type: 'OBJECT', properties: {ok: {type: 'BOOLEAN'}}, required: ['ok']};

const baseOpts = {
  model: {id: 'gemini-2.5-flash', location: 'us-central1'},
  system: 'test system',
  parts: [{text: 'give me ok'}],
  zodSchema: OkSchema,
  responseSchema: okResponseSchema,
};

describe('generateJson', () => {
  it('returns parsed data on first valid response', async () => {
    const transport: GeminiTransport = vi.fn(async () => ({text: '{"ok": true}', usage}));
    const res = await generateJson({...baseOpts, transport});
    expect(res.data).toEqual({ok: true});
    expect(res.repaired).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('retries once on invalid JSON, sending the error back', async () => {
    const transport = vi
      .fn<GeminiTransport>()
      .mockResolvedValueOnce({text: 'not json {', usage})
      .mockResolvedValueOnce({text: '{"ok": false}', usage});
    const res = await generateJson({...baseOpts, transport});
    expect(res.data).toEqual({ok: false});
    expect(res.repaired).toBe(true);
    const retryReq = transport.mock.calls[1][0];
    const retryText = retryReq.parts.map((p) => p.text).join('\n');
    expect(retryText).toContain('not json {');
    expect(retryText).toMatch(/JSON/);
  });

  it('retries when JSON parses but fails the zod schema', async () => {
    const transport = vi
      .fn<GeminiTransport>()
      .mockResolvedValueOnce({text: '{"ok": "yes"}', usage})
      .mockResolvedValueOnce({text: '{"ok": true}', usage});
    const res = await generateJson({...baseOpts, transport});
    expect(res.data).toEqual({ok: true});
    expect(res.repaired).toBe(true);
  });

  it('throws GeminiJsonError after two failures', async () => {
    const transport = vi
      .fn<GeminiTransport>()
      .mockResolvedValueOnce({text: 'garbage', usage})
      .mockResolvedValueOnce({text: 'still garbage', usage});
    await expect(generateJson({...baseOpts, transport})).rejects.toBeInstanceOf(GeminiJsonError);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('accumulates usage across the retry', async () => {
    const transport = vi
      .fn<GeminiTransport>()
      .mockResolvedValueOnce({text: 'bad', usage})
      .mockResolvedValueOnce({text: '{"ok": true}', usage});
    const res = await generateJson({...baseOpts, transport});
    expect(res.usage).toEqual({inputTokens: 20, outputTokens: 10, thoughtsTokens: 4});
  });
});
