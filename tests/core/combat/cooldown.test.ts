import { describe, expect, it } from 'vitest';
import {
  isReady,
  READY,
  tickCooldown,
  triggerCooldown,
  type Cooldown,
} from '@core/combat/cooldown';
import { CLASSES } from '@data/classes';

const FPS = [30, 60, 144] as const;

/** Fires whenever ready for `durationMs`, at a fixed frame rate. Returns the fire times. */
function fireTimes(cooldownMs: number, fps: number, durationMs: number): number[] {
  const dt = 1000 / fps;
  const times: number[] = [];
  let cd: Cooldown = READY;
  for (let i = 0; i * dt <= durationMs; i++) {
    if (i > 0) cd = tickCooldown(cd, dt);
    if (isReady(cd)) {
      times.push(i * dt);
      cd = triggerCooldown(cd, cooldownMs);
    }
  }
  return times;
}

describe('cooldown', () => {
  it('starts ready, so the first attack fires on acquisition (GDD §3)', () => {
    expect(isReady(READY)).toBe(true);
  });

  it('is not ready right after firing, and ready again after cooldownMs', () => {
    let cd = triggerCooldown(READY, 900);
    expect(isReady(cd)).toBe(false);
    cd = tickCooldown(cd, 899);
    expect(isReady(cd)).toBe(false);
    cd = tickCooldown(cd, 1);
    expect(isReady(cd)).toBe(true);
  });

  it('ignores dt <= 0', () => {
    const cd = triggerCooldown(READY, 400);
    expect(tickCooldown(cd, 0)).toBe(cd);
    expect(tickCooldown(cd, -10)).toBe(cd);
  });

  it('carries the overshoot into a trigger on the frame it runs out', () => {
    let cd = triggerCooldown(READY, 400);
    cd = tickCooldown(cd, 450);
    expect(cd.remainingMs).toBe(-50);
    expect(triggerCooldown(cd, 400).remainingMs).toBe(350);
  });

  it('never banks shots while it sits ready, and drops a stale carry', () => {
    let cd = triggerCooldown(READY, 400);
    cd = tickCooldown(cd, 450);
    for (let i = 0; i < 100; i++) cd = tickCooldown(cd, 100);
    expect(cd.remainingMs).toBe(0);
    cd = triggerCooldown(cd, 400);
    expect(cd.remainingMs).toBe(400);
    expect(isReady(cd)).toBe(false);
  });

  it.each(FPS)('fires at the data rate at %i fps (Pyromancer 900, Stormcaller 400)', (fps) => {
    // 9500 ms: Pyromancer at 0, 900, ..., 9000 = 11 shots; Stormcaller at 0, 400, ..., 9200 = 24.
    expect(fireTimes(CLASSES.pyromancer.attack.cooldownMs, fps, 9500)).toHaveLength(11);
    expect(fireTimes(CLASSES.stormcaller.attack.cooldownMs, fps, 9500)).toHaveLength(24);
  });

  it.each(FPS)('keeps every shot within one frame of its ideal time at %i fps', (fps) => {
    const dt = 1000 / fps;
    const cooldown = CLASSES.pyromancer.attack.cooldownMs;
    fireTimes(cooldown, fps, 20_000).forEach((t, k) => {
      expect(t).toBeGreaterThanOrEqual(k * cooldown - 1e-6);
      expect(t).toBeLessThan(k * cooldown + dt + 1e-6);
    });
  });
});
