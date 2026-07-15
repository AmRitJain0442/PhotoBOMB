// Stage 3: the Montage Director — plan + beat grid → renderer-valid EDL.
// generateJson already repairs malformed JSON/schema; this stage adds one
// more repair round for the renderer's hard invariants (beat snap, coverage).
import {readFile} from 'node:fs/promises';

import {checkInvariants} from '../../../renderer/src/edl/invariants.js';
import {EdlSchema, type Edl} from '../../../renderer/src/edl/schema.js';
import {PipelineError, type MediaPool, type ProductionPlan, type TrackInfo} from '../contracts.js';
import {generateJson, type GeminiUsage} from '../gemini.js';
import {promptPath} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

const EDL_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: {type: 'STRING', enum: ['montage']},
    aspect: {type: 'STRING', enum: ['9:16']},
    fps: {type: 'INTEGER'},
    duration_ms: {type: 'INTEGER'},
    audio: {
      type: 'OBJECT',
      properties: {
        track: {type: 'STRING'},
        trim_start_ms: {type: 'INTEGER'},
        beat_grid_ms: {type: 'ARRAY', items: {type: 'NUMBER'}},
        voiceover: {type: 'STRING', nullable: true},
        mute_render: {type: 'BOOLEAN'},
      },
      required: ['track', 'beat_grid_ms', 'mute_render'],
    },
    timeline: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          asset: {type: 'STRING'},
          kind: {type: 'STRING', enum: ['still']},
          start_ms: {type: 'INTEGER'},
          end_ms: {type: 'INTEGER'},
          motion: {
            type: 'OBJECT',
            properties: {
              type: {type: 'STRING', enum: ['ken_burns', 'static']},
              from: {
                type: 'OBJECT',
                properties: {
                  zoom: {type: 'NUMBER'},
                  cx: {type: 'NUMBER'},
                  cy: {type: 'NUMBER'},
                },
                required: ['zoom', 'cx', 'cy'],
              },
              to: {
                type: 'OBJECT',
                properties: {
                  zoom: {type: 'NUMBER'},
                  cx: {type: 'NUMBER'},
                  cy: {type: 'NUMBER'},
                },
                required: ['zoom', 'cx', 'cy'],
              },
              easing: {
                type: 'STRING',
                enum: ['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic'],
              },
            },
            required: ['type', 'from', 'to', 'easing'],
          },
          transition_out: {
            type: 'OBJECT',
            properties: {
              type: {type: 'STRING', enum: ['cut']},
              duration_ms: {type: 'INTEGER'},
            },
            required: ['type', 'duration_ms'],
          },
          effects: {type: 'ARRAY', items: {type: 'STRING'}},
          text: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              content: {type: 'STRING'},
              style: {type: 'STRING', enum: ['caption_lower', 'kinetic_word', 'none']},
              in_ms: {type: 'INTEGER'},
              out_ms: {type: 'INTEGER'},
              anchor: {
                type: 'STRING',
                enum: ['lower_third', 'center', 'upper_safe', 'corner_br'],
              },
            },
            required: ['content', 'style', 'in_ms', 'out_ms', 'anchor'],
          },
        },
        required: ['asset', 'kind', 'start_ms', 'end_ms'],
      },
    },
  },
  required: ['mode', 'aspect', 'fps', 'duration_ms', 'audio', 'timeline'],
};

export type DirectOptions = {
  plan: ProductionPlan;
  mediaPool: MediaPool;
  track: TrackInfo;
};

export async function runDirect(
  deps: PipelineDeps,
  opts: DirectOptions,
): Promise<{edl: Edl; usage: GeminiUsage}> {
  const system = await readFile(promptPath(deps.repoRoot, 'director_montage.md'), 'utf8');

  const selects = new Set(opts.plan.selects);
  const selectedPool = opts.mediaPool.pool.filter((e) => selects.has(e.id));
  const trackForDirector = {
    track: `assets/audio/${opts.track.file}`,
    bpm: opts.track.bpm,
    beat_grid_ms: opts.track.beat_grid_ms,
    duration_ms: opts.track.duration_ms,
    trim_start_ms: opts.plan.audio.trim_start_ms,
  };
  const baseParts = [
    {text: `production_plan:\n${JSON.stringify(opts.plan)}`},
    {text: `selected photos (with subject_bbox for focal points):\n${JSON.stringify(selectedPool)}`},
    {text: `track:\n${JSON.stringify(trackForDirector)}`},
  ];

  const assetIds = new Set([...opts.plan.selects, opts.track.id]);
  const usage: GeminiUsage = {inputTokens: 0, outputTokens: 0, thoughtsTokens: 0};
  let repairParts: {text: string}[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateJson({
      transport: deps.transport,
      model: deps.directorModel,
      system,
      parts: [...baseParts, ...repairParts],
      zodSchema: EdlSchema,
      responseSchema: EDL_RESPONSE_SCHEMA,
      maxOutputTokens: 16384,
      repairNote: 'Return the EDL JSON only, no prose.',
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.thoughtsTokens += res.usage.thoughtsTokens;

    const violations = checkInvariants(res.data, assetIds);
    if (violations.length === 0) return {edl: res.data, usage};
    if (attempt === 1) {
      throw new PipelineError('direct', 'invariants', violations.join('\n'));
    }
    repairParts = [
      {
        text:
          `Your previous EDL violated hard rules:\n${violations.join('\n')}\n` +
          `Previous EDL:\n${JSON.stringify(res.data)}\n` +
          `Fix every violation and re-emit the full corrected EDL JSON only.`,
      },
    ];
  }
  throw new PipelineError('direct', 'invariants'); // unreachable
}
