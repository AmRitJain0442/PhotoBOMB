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

  it('defaults rejects/hero_shots/trim_start_ms', () => {
    const {rejects, hero_shots, ...rest} = PLAN;
    const minimalAudio = {track_id: 'songa', reason: 'fits'};
    const parsed = ProductionPlanSchema.parse({...rest, audio: minimalAudio});
    expect(parsed.rejects).toEqual([]);
    expect(parsed.hero_shots).toEqual([]);
    expect(parsed.audio.trim_start_ms).toBe(0);
  });
});
