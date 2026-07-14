import {z} from 'zod';

// Closed vocabularies — Tech Spec §6. Directors' prompts list these verbatim.
export const MotionTypeEnum = z.enum(['ken_burns', 'static', 'parallax']);
export const TransitionTypeEnum = z.enum([
  'cut',
  'crossfade',
  'whip_pan',
  'flash_white',
  'flash_black',
  'zoom_punch',
  'slide',
]);
export const EffectEnum = z.enum(['film_grain', 'vignette', 'chromatic_ab', 'vhs', 'bw']);
export const TextStyleEnum = z.enum([
  'caption_lower',
  'editorial_serif',
  'kinetic_word',
  'location_stamp',
  'vhs_timestamp',
  'none',
]);
export const AnchorEnum = z.enum(['lower_third', 'center', 'upper_safe', 'corner_br']);
export const EasingEnum = z.enum(['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic']);

const CamPointSchema = z.object({
  zoom: z.number().min(0.5).max(3),
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
});

export const MotionSchema = z.object({
  type: MotionTypeEnum,
  from: CamPointSchema,
  to: CamPointSchema,
  easing: EasingEnum,
});

export const TextSchema = z.object({
  content: z.string().min(1),
  style: TextStyleEnum,
  // relative to the entry's start
  in_ms: z.number().int().nonnegative(),
  out_ms: z.number().int().positive(),
  anchor: AnchorEnum,
});

const SpeedRampSchema = z.array(
  z.object({at_ms: z.number().int().nonnegative(), rate: z.number().positive()}),
);

export const TimelineEntrySchema = z.object({
  asset: z.string().min(1),
  kind: z.enum(['still', 'clip', 'veo']),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  motion: MotionSchema.optional(),
  speed: z.union([z.number().positive(), SpeedRampSchema]).default(1),
  transition_out: z
    .object({type: TransitionTypeEnum, duration_ms: z.number().int().nonnegative()})
    .optional(),
  effects: z.array(EffectEnum).default([]),
  text: TextSchema.optional(),
});

export const EdlSchema = z.object({
  mode: z.enum(['montage', 'narrative', 'edit']),
  aspect: z.literal('9:16'),
  fps: z.literal(30),
  duration_ms: z.number().int().positive(),
  audio: z.object({
    track: z.string().nullable(),
    trim_start_ms: z.number().int().nonnegative().default(0),
    beat_grid_ms: z.array(z.number().nonnegative()),
    voiceover: z.object({script: z.string(), voice: z.string()}).nullable(),
    mute_render: z.boolean(),
  }),
  timeline: z.array(TimelineEntrySchema).min(1),
});

export type Edl = z.infer<typeof EdlSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type TextSpec = z.infer<typeof TextSchema>;
export type KenBurnsMotion = z.infer<typeof MotionSchema>;
export type Anchor = z.infer<typeof AnchorEnum>;
export type EasingName = z.infer<typeof EasingEnum>;
