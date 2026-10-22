import type Phaser from 'phaser';
import type { Vec2 } from '@core/types';

/**
 * Shares of `introPanMs`: out to the portal, hold on it, back to the squad. Level doc m01 §2 times
 * them as about 1.4 s out, 0.2 s hold, 1.4 s back of the 3 s pan (review M7-T16 m1). Presentation:
 * the total is PORTAL.introPanMs, so a retuned total keeps the same shape.
 */
const SHARES = { out: 1.4 / 3, hold: 0.2 / 3 } as const;

/**
 * The intro camera pan (GDD §13, APPROVED): start → sealed portal → start before control begins,
 * the mission's only camera hijack. Skippable (any move key or click, M7.md "my calls"); the caller
 * decides when to skip and skips it entirely on restarts after the first attempt. Drives the main
 * camera directly with `centerOn` (Phaser clamps it to the bounds) on the scene's dt.
 */
export class IntroPan {
  private elapsedMs = 0;
  private finished = false;

  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly from: Vec2,
    private readonly to: Vec2,
    private readonly durationMs: number,
  ) {
    camera.centerOn(from.x, from.y);
  }

  get done(): boolean {
    return this.finished;
  }

  /** 0 → 1 over the pan (debug). */
  get progress(): number {
    return Math.min(1, this.elapsedMs / this.durationMs);
  }

  /** @returns true on the step the pan ends. */
  update(dt: number): boolean {
    if (this.finished) return false;
    this.elapsedMs += dt;
    const t = this.progress;
    const outEnd = SHARES.out;
    const holdEnd = SHARES.out + SHARES.hold;
    // 0 at the squad, 1 at the portal.
    const k =
      t < outEnd ? ease(t / outEnd) : t < holdEnd ? 1 : 1 - ease((t - holdEnd) / (1 - holdEnd));
    this.camera.centerOn(
      this.from.x + (this.to.x - this.from.x) * k,
      this.from.y + (this.to.y - this.from.y) * k,
    );
    if (t < 1) return false;
    this.finished = true;
    return true;
  }

  /** Ends now, camera back on the squad. */
  skip(): void {
    if (this.finished) return;
    this.finished = true;
    this.camera.centerOn(this.from.x, this.from.y);
  }
}

/** Ease in and out (smoothstep), so the pan starts and stops gently. */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
