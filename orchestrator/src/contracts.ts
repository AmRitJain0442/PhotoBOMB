// Data contracts between the analysis layer, Gemini stages, and the server.
import {z} from 'zod';

import {SpanSchema} from '../../renderer/src/edl/schema.js';
import type {GeminiUsage} from './gemini.js';

export type ReelStyle = 'classic' | 'live' | 'film';

export const HeroShotSchema = z.object({
  id: z.string(),
  motion_prompt: z.string().min(1),
});

export const ProductionPlanSchema = z.object({
  story: z.object({read: z.string(), type: z.string(), arc_possible: z.boolean()}),
  mode: z.literal('montage'),
  duration_ms: z.number().int().positive(),
  selects: z.array(z.string()).min(3),
  rejects: z.array(z.object({id: z.string(), reason: z.string()})).default([]),
  hero_shots: z.array(HeroShotSchema).max(2).default([]),
  film_prompt: z.string().optional(),
  audio: z.object({
    track_id: z.string(),
    reason: z.string(),
    trim_start_ms: z.number().int().min(0).default(0),
  }),
  typography_direction: z.string().default(''),
  quote: z.object({lines: z.array(z.array(SpanSchema).min(1)).min(1).max(2)}),
  voiceover: z.null().default(null),
  captions: z.object({short: z.string(), long: z.string()}),
  hashtags: z.array(z.string()).min(1),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

export type MediaEntry = {
  id: string;
  file: string;
  type: 'still';
  has_cutout: boolean;
  exif: {ts: string | null; gps: number[] | null};
  analysis: {
    aesthetic_score: number;
    description: string;
    subject: string;
    subject_bbox: number[];
    dominant_colors: string[];
    mood_tags: string[];
    energy: string;
    orientation: string;
    quality_flags: string[];
  };
};

export type MediaPool = {
  pool: MediaEntry[];
  rejects: {file: string; reason: string}[];
};

export type TrackInfo = {
  id: string;
  file: string;
  bpm: number;
  beat_grid_ms: number[];
  energy_curve: number[];
  duration_ms: number;
  mood: string;
  feel: string;
};

export type StageName =
  | 'analyze'
  | 'produce'
  | 'enhance'
  | 'animate'
  | 'film'
  | 'direct'
  | 'finalize';

export type RunMeta = {
  runId: string;
  created_at: string;
  track_id: string;
  director_model: string;
  usage: Record<string, GeminiUsage>;
  avoid: {track_id?: string; summary?: string} | null;
};

export class PipelineError extends Error {
  constructor(
    public readonly stage: StageName,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PipelineError';
  }
}
