// One-off live auth check: node scripts/smoke.mjs (run from orchestrator/ after npm run build)
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {z} from 'zod';
import {generateJson, MODELS, resolveCredentials, vertexTransport} from '../dist/gemini.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cred = resolveCredentials(repoRoot);
if (!cred.ok) {
  console.error(cred.message);
  process.exit(1);
}
console.log('credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

const res = await generateJson({
  transport: vertexTransport,
  model: MODELS.flash,
  system: 'You are a health check. Respond with JSON only.',
  parts: [{text: 'Return exactly {"ok": true}'}],
  zodSchema: z.object({ok: z.boolean()}),
  responseSchema: {type: 'OBJECT', properties: {ok: {type: 'BOOLEAN'}}, required: ['ok']},
});
console.log('response:', res.data, 'usage:', res.usage, 'repaired:', res.repaired);
