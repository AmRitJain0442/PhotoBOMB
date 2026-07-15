import {describe, expect, it} from 'vitest';

import {ProductionPlanSchema} from './contracts.js';
import {PLAN} from './test-fixtures.js';

describe('ProductionPlanSchema', () => {
  it('accepts a valid montage plan', () => {
    const parsed = ProductionPlanSchema.parse(PLAN);
    expect(parsed.mode).toBe('montage');
    expect(parsed.selects).toHaveLength(4);
  });

  it('rejects non-empty hero_shots (M1 has no veo)', () => {
    const bad = {...PLAN, hero_shots: [{id: 'img0', veo_prompt: 'push in'}]};
    expect(() => ProductionPlanSchema.parse(bad)).toThrow();
  });

  it('rejects any mode other than montage', () => {
    const bad = {...PLAN, mode: 'edit'};
    expect(() => ProductionPlanSchema.parse(bad)).toThrow();
  });

  it('rejects fewer than 3 selects', () => {
    const bad = {...PLAN, selects: ['img0', 'img1']};
    expect(() => ProductionPlanSchema.parse(bad)).toThrow();
  });

  it('rejects a plan without a quote', () => {
    const {quote: _q, ...rest} = PLAN as Record<string, unknown>;
    expect(() => ProductionPlanSchema.parse(rest)).toThrow();
  });

  it('rejects >2 quote lines, empty lines, and bad tones', () => {
    const line = [{text: 'x'}];
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, quote: {lines: [line, line, line]}}),
    ).toThrow();
    expect(() => ProductionPlanSchema.parse({...PLAN, quote: {lines: []}})).toThrow();
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, quote: {lines: [[{text: 'x', tone: 'red'}]]}}),
    ).toThrow();
  });

  it('rejects an all-white quote (the emotional center must be yellow)', () => {
    expect(() =>
      ProductionPlanSchema.parse({
        ...PLAN,
        quote: {lines: [[{text: 'dusk settles', tone: 'white'}]]},
      }),
    ).toThrow();
  });

  it('defaults span emphasis fields', () => {
    const parsed = ProductionPlanSchema.parse({
      ...PLAN,
      quote: {lines: [[{text: 'dusk'}, {text: 'glows', tone: 'yellow'}]]},
    });
    expect(parsed.quote.lines[0][0]).toEqual({
      text: 'dusk',
      bold: false,
      underline: false,
      tone: 'white',
    });
  });

  it('defaults rejects/hero_shots/trim_start_ms', () => {
    const {rejects, hero_shots, ...rest} = PLAN;
    const minimalAudio = {track_id: 'songa', reason: 'fits'};
    const parsed = ProductionPlanSchema.parse({...rest, audio: minimalAudio});
    expect(parsed.rejects).toEqual([]);
    expect(parsed.hero_shots).toEqual([]);
    expect(parsed.audio.trim_start_ms).toBe(0);
  });
});
