// Stage 2: the Producer — media pool + track candidates → production plan.
import {readFile} from 'node:fs/promises';

import {
  ProductionPlanSchema,
  type MediaPool,
  type ProductionPlan,
  type ReelStyle,
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
    hero_shots: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {id: {type: 'STRING'}, motion_prompt: {type: 'STRING'}},
        required: ['id', 'motion_prompt'],
      },
    },
    film_prompt: {type: 'STRING'},
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
    quote: {
      type: 'OBJECT',
      properties: {
        lines: {
          type: 'ARRAY',
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: {type: 'STRING'},
                bold: {type: 'BOOLEAN'},
                underline: {type: 'BOOLEAN'},
                tone: {type: 'STRING', enum: ['white', 'yellow']},
              },
              required: ['text'],
            },
          },
        },
      },
      required: ['lines'],
    },
    voiceover: {type: 'STRING', nullable: true},
    captions: {
      type: 'OBJECT',
      properties: {short: {type: 'STRING'}, long: {type: 'STRING'}},
      required: ['short', 'long'],
    },
    hashtags: {type: 'ARRAY', items: {type: 'STRING'}},
  },
  required: ['story', 'mode', 'duration_ms', 'selects', 'audio', 'quote', 'captions', 'hashtags'],
};

/** The duotone contract wants exactly one yellow emotional center, but the
 * model sometimes emits an all-white quote no matter what the prompt says.
 * Rather than failing the reel over a color, promote the most emphasized
 * span (last bold/underlined, else the last span) to yellow. */
export function ensureYellow(quote: ProductionPlan['quote']): ProductionPlan['quote'] {
  const spans = quote.lines.flat();
  if (spans.some((s) => s.tone === 'yellow')) return quote;
  const emphasized = spans.filter((s) => s.bold || s.underline);
  const target = (emphasized.length > 0 ? emphasized : spans)[
    (emphasized.length > 0 ? emphasized : spans).length - 1
  ];
  return {
    lines: quote.lines.map((line) =>
      line.map((s) => (s === target ? {...s, tone: 'yellow' as const} : s)),
    ),
  };
}

// What each reel style demands of the plan — appended to the prompt context.
const STYLE_RULES: Record<ReelStyle, string> = {
  classic: 'hero_shots MUST be [] and film_prompt MUST be omitted.',
  live:
    'Pick 1-2 hero_shots: the photos that most deserve motion. Each motion_prompt is one ' +
    'grounded sentence describing subtle, realistic motion for THAT photo (camera drift, ' +
    'subject movement, atmosphere). film_prompt MUST be omitted.',
  film:
    'hero_shots MUST be []. Write film_prompt: a 3-5 sentence brief for a single continuous ' +
    '10-12 second vertical film made from these photos — subjects, arc, mood, pacing. ' +
    'Ground it ONLY in what the photos show.',
};

export type ProduceOptions = {
  mediaPool: MediaPool;
  tracks: TrackInfo[];
  pinned: TrackInfo | null;
  style?: ReelStyle;
  avoid?: {track_id?: string; summary?: string};
};

export async function runProduce(
  deps: PipelineDeps,
  opts: ProduceOptions,
): Promise<{plan: ProductionPlan; usage: GeminiUsage; repaired: boolean}> {
  const system = await readFile(promptPath(deps.repoRoot, 'producer.md'), 'utf8');

  const style = opts.style ?? 'classic';
  const parts = [
    {text: `style: ${style}\n${STYLE_RULES[style]}`},
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
  return {plan: {...data, quote: ensureYellow(data.quote)}, usage, repaired};
}
