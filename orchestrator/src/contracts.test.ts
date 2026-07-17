import {describe, expect, it} from 'vitest';

import {ProductionPlanSchema} from './contracts.js';
import {PLAN} from './test-fixtures.js';

describe('ProductionPlanSchema', () => {
  it('accepts a valid montage plan', () => {
    const parsed = ProductionPlanSchema.parse(PLAN);
    expect(parsed.mode).toBe('montage');
    expect(parsed.selects).toHaveLength(4);
  });

  it('accepts up to 2 hero shots with motion prompts', () => {
    const parsed = ProductionPlanSchema.parse({
      ...PLAN,
      hero_shots: [
        {id: 'img0', motion_prompt: 'the balloon drifts gently upward'},
        {id: 'img2', motion_prompt: 'city lights flicker on at dusk'},
      ],
    });
    expect(parsed.hero_shots).toHaveLength(2);
  });

  it('rejects 3 hero shots and heroes without motion prompts', () => {
    const hero = {id: 'img0', motion_prompt: 'drift'};
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, hero_shots: [hero, hero, hero]}),
    ).toThrow();
    expect(() =>
      ProductionPlanSchema.parse({...PLAN, hero_shots: [{id: 'img0', motion_prompt: ''}]}),
    ).toThrow();
  });

  it('accepts an optional film_prompt', () => {
    const parsed = ProductionPlanSchema.parse({
      ...PLAN,
      film_prompt: 'A dusk-to-dark city story told through balloons and rooftops.',
    });
    expect(parsed.film_prompt).toContain('dusk-to-dark');
    expect(ProductionPlanSchema.parse(PLAN).film_prompt).toBeUndefined();
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
