/**
 * Flash safety (readability.md §1.9): at most 3 impact flashes per second anywhere. Every FX with a
 * near-white core asks before drawing it, giving the core's radius: only a near-white area of
 * radius ≥ 16 px counts as an impact flash (Fireball and Kaboom cores today); smaller ones (the
 * Combust pop, the Lightning ground flash) always play and are never counted, and any new FX that
 * reaches 16 px joins the budget automatically. Past the budget, only the core is dropped; the FX
 * still draws in its edge colours. Sprite hit flashes and the keg blink are exempt (CD 2026-10-16)
 * and never ask. Time is the scene's dt sum.
 */
import type { System } from '../systems/System';

const FLASH_SAFETY = {
  maxFlashes: 3,
  windowMs: 1000,
  /** Near-white radius (logical px) from which a core counts as an impact flash (§1.9). */
  minFlashRadiusPx: 16,
} as const;

/** One per scene run, shared by every FX view; updated before them. */
export class FlashBudget implements System {
  private nowMs = 0;
  private readonly recent: number[] = [];
  private granted = 0;
  private refused = 0;

  /** Flashes allowed and refused this run (debug). */
  get stats(): { readonly granted: number; readonly refused: number } {
    return { granted: this.granted, refused: this.refused };
  }

  update(dt: number): void {
    this.nowMs += dt;
    while (this.recent.length > 0 && (this.recent[0] ?? 0) <= this.nowMs - FLASH_SAFETY.windowMs) {
      this.recent.shift();
    }
  }

  destroy(): void {
    this.recent.length = 0;
  }

  /**
   * May a near-white core of this radius play now? Below the §1.9 threshold: always, uncounted.
   * At or above it: if the budget allows, and then it counts.
   */
  tryFlash(nearWhiteRadiusPx: number): boolean {
    if (nearWhiteRadiusPx < FLASH_SAFETY.minFlashRadiusPx) return true;
    if (this.recent.length >= FLASH_SAFETY.maxFlashes) {
      this.refused++;
      return false;
    }
    this.recent.push(this.nowMs);
    this.granted++;
    return true;
  }
}
