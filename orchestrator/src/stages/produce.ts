// Stage 2: the Producer — media pool + track candidates → production plan.
import {readFile} from 'node:fs/promises';

import {
  ProductionPlanSchema,
  type MediaPool,
  type ProductionPlan,
  type TrackInfo,
} from '../contracts.js';
import {MODELS, generateJson, type GeminiUsage} from '../gemini.js';
import {promptPath} from '../paths.js';
import type {PipelineDeps} from '../pipeline.js';

const PLAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    story: {
      type: 'OBJECT',
      properties: {
        read: {type: 'STRING'},
        type: {type: 'STRING'},
        arc_possible: {type: 'BOOLEAN'},
      },
      required: ['read', 'type', 'arc_possible'],
    },
    mode: {type: 'STRING', enum: ['montage']},
    duration_ms: {type: 'INTEGER'},
    selects: {type: 'ARRAY', items: {type: 'STRING'}},
    rejects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {id: {type: 'STRING'}, reason: {type: 'STRING'}},
        required: ['id', 'reason'],
      },
    },
    hero_shots: {type: 'ARRAY', items: {type: 'STRING'}},
    audio: {
      type: 'OBJECT',
      properties: {
        track_id: {type: 'STRING'},
        reason: {type: 'STRING'},
        trim_start_ms: {type: 'INTEGER'},
      },
      required: ['track_id', 'reason'],
    },
    typography_direction: {type: 'STRING'},
    voiceover: {type: 'STRING', nullable: true},
    captions: {
      type: 'OBJECT',
      properties: {short: {type: 'STRING'}, long: {type: 'STRING'}},
      required: ['short', 'long'],
    },
    hashtags: {type: 'ARRAY', items: {type: 'STRING'}},
  },
  required: ['story', 'mode', 'duration_ms', 'selects', 'audio', 'captions', 'hashtags'],
};

export type ProduceOptions = {
  mediaPool: MediaPool;
  tracks: TrackInfo[];
  pinned: TrackInfo | null;
  avoid?: {track_id?: string; summary?: string};
};

export async function runProduce(
  deps: PipelineDeps,
  opts: ProduceOptions,
): Promise<{plan: ProductionPlan; usage: GeminiUsage; repaired: boolean}> {
  const system = await readFile(promptPath(deps.repoRoot, 'producer.md'), 'utf8');

  const parts = [
    {text: `media_pool:\n${JSON.stringify(opts.mediaPool)}`},
    opts.pinned
      ? {text: `Pinned track — you MUST use this one:\n${JSON.stringify(opts.pinned)}`}
      : {text: `Available tracks:\n${JSON.stringify(opts.tracks)}`},
  ];
  if (opts.avoid) {
    parts.push({
      text:
        `avoid note: the user rejected the previous take` +
        (opts.avoid.track_id ? ` (track "${opts.avoid.track_id}")` : '') +
        (opts.avoid.summary ? ` with story "${opts.avoid.summary}"` : '') +
        `. Deliver a genuinely different take.`,
    });
  }

  const {data, usage, repaired} = await generateJson({
    transport: deps.transport,
    model: MODELS.flash,
    system,
    parts,
    zodSchema: ProductionPlanSchema,
    responseSchema: PLAN_RESPONSE_SCHEMA,
    maxOutputTokens: 16384,
    repairNote: 'Return the production_plan JSON only, no prose.',
  });
  return {plan: data, usage, repaired};
}
