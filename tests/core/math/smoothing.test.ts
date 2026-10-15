import { describe, expect, it } from 'vitest';
import { dampFactor } from '@core/math/smoothing';
import { lerp } from '@core/math/vec2';

describe('dampFactor', () => {
  it('closes exactly half the gap after one half-life', () => {
    expect(dampFactor(90, 90)).toBeCloseTo(0.5);
    expect(dampFactor(90, 180)).toBeCloseTo(0.75);
  });

  it('stays within 0..1', () => {
    for (const dt of [0.001, 1, 8, 16, 33, 100, 1000, 1e6]) {
      const f = dampFactor(90, dt);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('grows with dt', () => {
    expect(dampFactor(90, 16)).toBeGreaterThan(dampFactor(90, 8));
  });

  it('is frame-rate independent: two 8 ms steps equal one 16 ms step', () => {
    const target = 100;
    let twoSteps = 0;
    twoSteps = lerp(twoSteps, target, dampFactor(90, 8));
    twoSteps = lerp(twoSteps, target, dampFactor(90, 8));
    const oneStep = lerp(0, target, dampFactor(90, 16));
    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('is frame-rate independent over a second at different frame rates', () => {
    const run = (dt: number, frames: number): number => {
      let pos = 0;
      for (let i = 0; i < frames; i++) pos = lerp(pos, 500, dampFactor(90, dt));
      return pos;
    };
    expect(run(1000 / 30, 30)).toBeCloseTo(run(1000 / 144, 144), 6);
  });

  it('snaps (returns 1) for halfLife <= 0', () => {
    expect(dampFactor(0, 16)).toBe(1);
    expect(dampFactor(-10, 16)).toBe(1);
  });

  it('returns 0 for dt <= 0', () => {
    expect(dampFactor(90, 0)).toBe(0);
    expect(dampFactor(90, -16)).toBe(0);
  });

  it('returns 0 for dt <= 0 even when halfLife <= 0', () => {
    expect(dampFactor(0, 0)).toBe(0);
  });
});
