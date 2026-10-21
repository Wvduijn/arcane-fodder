import Phaser from 'phaser';

/** One shake request in logical px (readability.md §5, §5c). */
export interface ShakeSpec {
  readonly px: number;
  readonly durationMs: number;
}

/**
 * The one screen shake of a scene run (readability.md §5c "Shake rule"): at most 3 px anywhere, a
 * new shake replaces the running one only if its amplitude is at least the running one's, and
 * shakes never stack. So a stream of 1 px meteorlet shakes never cuts into a 3 px Meteor or a 2 px
 * Kaboom. Every FX view shakes through it. Phaser's shake holds its intensity for the whole
 * duration, so the running amplitude is the one it was started with.
 */
export class ScreenShake {
  private static readonly MAX_PX = 3;
  private runningPx = 0;
  private started = 0;
  private skipped = 0;

  constructor(private readonly camera: Phaser.Cameras.Scene2D.Camera) {}

  /** Shakes started and refused this run (debug). */
  get stats(): { readonly started: number; readonly skipped: number } {
    return { started: this.started, skipped: this.skipped };
  }

  shake({ px, durationMs }: ShakeSpec): boolean {
    const amplitude = Math.min(px, ScreenShake.MAX_PX);
    if (this.camera.shakeEffect.isRunning && amplitude < this.runningPx) {
      this.skipped++;
      return false;
    }
    this.runningPx = amplitude;
    this.camera.shake(
      durationMs,
      new Phaser.Math.Vector2(amplitude / this.camera.width, amplitude / this.camera.height),
      true,
    );
    this.started++;
    return true;
  }
}
