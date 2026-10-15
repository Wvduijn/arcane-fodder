/** Shared core contracts. Producer-owned: propose changes by message, never edit directly. */

/** Unique id for any runtime entity (wizard, enemy, structure, projectile). */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** Immutable 2D vector in world pixels. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Axis-aligned rectangle in world pixels (world bounds, camera bounds, deadzones).
 * `x`/`y` is the top-left corner (Phaser's convention), not the centre.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Squad movement tuning (GDD §1, Q9: one squad speed). */
export interface MovementTuning {
  /** px/s */
  readonly squadMoveSpeed: number;
  /** Keeps the wizard's body circle inside world bounds. */
  readonly wizardBodyRadiusPx: number;
}

/** Camera follow tuning. All distances are in world pixels (the 640×360 logical view, before Scale.FIT). */
export interface CameraTuning {
  readonly deadzoneWidthPx: number;
  readonly deadzoneHeightPx: number;
  /** Time to close half the gap to the target. Frame-rate independent. */
  readonly followHalfLifeMs: number;
  /** How far ahead of the leader, in the movement direction, the camera aims. */
  readonly lookAheadPx: number;
  /** Time for the look-ahead offset to close half the gap when direction changes or movement stops. */
  readonly lookAheadHalfLifeMs: number;
}
