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
  /** Time for the camera to ease to a newly promoted leader (GDD §2). */
  readonly successionEaseMs: number;
}

/** Which side a unit fights for (GDD §0). Powder kegs are neutral. */
export type Team = 'squad' | 'enemy' | 'neutral';

/** Why a unit died. Results and Hat Hill share this list (GDD §15). */
export type DeathCause = 'combat' | 'volunteer' | 'left-behind';

/** Breadcrumb-trail following (GDD §1). All distances are in world pixels. */
export interface TrailTuning {
  readonly breadcrumbSpacingPx: number;
  /** Follower k's slot is k × this far behind the leader, measured along the trail. */
  readonly followerSpacingPx: number;
  readonly separationRadiusPx: number;
  /** Beyond this distance from its slot, a follower moves at squadMoveSpeed × catchUpMultiplier. */
  readonly catchUpDistancePx: number;
  readonly catchUpMultiplier: number;
  /** Inside this distance from its slot, a follower slows down linearly (arrive). */
  readonly arriveRadiusPx: number;
  /** A follower within this distance of a slot at rest stops: no creeping, no jitter. */
  readonly stopRadiusPx: number;
  /** Cap on the separation push speed, as a fraction of squadMoveSpeed. */
  readonly separationMaxSpeedFactor: number;
}

/** Word lists for seeded recruit names, combined as "<first> the <epithet>". */
export interface RecruitNameTable {
  readonly firstNames: readonly string[];
  readonly epithets: readonly string[];
}

/** Dev arena squad, until M7's mission data supplies the roster. */
export interface DevSquadConfig {
  /** Leader plus followers. */
  readonly size: number;
  /** Base seed. Each restart uses base + attempt (GDD Q17). */
  readonly nameSeed: number;
}
