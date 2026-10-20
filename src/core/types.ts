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
  /** Class of each recruit, leader first (GDD Q18: P,S,P,S). Squad size = its length. */
  readonly classes: readonly MageClassId[];
  /** Base seed. Each restart uses base + attempt (GDD Q17). */
  readonly nameSeed: number;
}

/** Element a mage class feeds into Convergence (plan §3.1). MVP classes only. */
export type Element = 'fire' | 'storm';

/** Element of a damage source (GDD §0). Reactions key off it. */
export type DamageElement = 'fire' | 'storm' | 'arcane' | 'physical';

export type MageClassId = 'pyromancer' | 'stormcaller';
export type EnemyId = 'goblin-grunt' | 'goblin-archer';
/** Granted spells (plan §3.1). */
export type SpellId = 'fireball' | 'lightning';
export type ReactionId = 'combust' | 'kaboom';
export type StructureId = 'powder-keg';
export type StatusId = 'burning';
/** How an enemy death looks, from the killing blow (GDD §12a). */
export type DeathVariantId = 'charred' | 'electrified' | 'blood';

/** Anything that deals damage (GDD §12a, §15). */
export interface DamageSourceDef {
  readonly element: DamageElement;
  readonly damage: number;
  /** 0 for none. Eased over CombatTuning.knockbackMs. */
  readonly knockbackPx: number;
  /** Can a big enough killing hit from this source gib (GDD §12a)? */
  readonly canGib: boolean;
  /** Overrides the element → variant mapping (Kaboom → blood, M5). */
  readonly deathVariant?: DeathVariantId;
  readonly applies?: StatusId;
}

/** A straight, non-homing projectile aimed at the target's position at fire time (GDD §3). */
export interface ProjectileAttackDef extends DamageSourceDef {
  readonly kind: 'projectile';
  readonly rangePx: number;
  readonly cooldownMs: number;
  /** px/s */
  readonly projectileSpeed: number;
  /** Hit circle (GDD §0: bolt, spark and arrow 4 px). */
  readonly projectileRadiusPx: number;
}

/** Melee swing: wind-up tell, then a hit if the target is still in range (GDD §12, M4 Q2). */
export interface MeleeAttackDef extends DamageSourceDef {
  readonly kind: 'melee';
  /** Centre to centre. */
  readonly rangePx: number;
  readonly cooldownMs: number;
  /** Tell before the swing (readability §3: ≥ 100 ms). */
  readonly windupMs: number;
}

/** Archer shot: draw tell, aimed at the target's position at draw start (GDD §12). */
export interface DrawnProjectileAttackDef extends ProjectileAttackDef {
  readonly drawMs: number;
}

export interface ClassDef {
  readonly id: MageClassId;
  readonly role: 'damage';
  readonly element: Element;
  readonly maxHp: number;
  /** Per class for post-MVP; the squad moves at MovementTuning.squadMoveSpeed (GDD Q9). */
  readonly moveSpeed: number;
  readonly attack: ProjectileAttackDef;
  readonly grantsSpell: SpellId;
}

export type EnemyBehaviour =
  | { readonly kind: 'swarm' }
  /** Step back below retreatBelowPx, step in above advanceAbovePx, hold in between. */
  | {
      readonly kind: 'keep-range';
      readonly retreatBelowPx: number;
      readonly advanceAbovePx: number;
    };

export interface EnemyDef {
  readonly id: EnemyId;
  readonly maxHp: number;
  /** px/s */
  readonly moveSpeed: number;
  readonly bodyRadiusPx: number;
  readonly aggroRadiusPx: number;
  /** Re-pick the nearest wizard this often, or at once when the target dies. */
  readonly retargetMs: number;
  readonly takesKnockback: boolean;
  readonly behaviour: EnemyBehaviour;
  readonly attack: MeleeAttackDef | DrawnProjectileAttackDef;
}

/** Damage-over-time status (GDD §6). Its ticks resolve deaths by `element`. */
export interface StatusDef {
  readonly id: StatusId;
  readonly element: DamageElement;
  readonly tickDamage: number;
  readonly tickMs: number;
  readonly durationMs: number;
}

/** Shared combat tuning. */
export interface CombatTuning {
  /** Wizard auto-attack retarget interval (GDD §3). */
  readonly retargetMs: number;
  /** Every projectile (wizard autos and arrows) expires after rangePx × this much travel (GDD §3, §12: 1.2). */
  readonly projectileRangeFactor: number;
  /** Knockback displacement is eased over this long (no teleport). */
  readonly knockbackMs: number;
  /** Gameplay dt is clamped to this (tab switches, hitches). */
  readonly maxFrameDtMs: number;
}

/** Gib resolution in core (GDD §12a). The visual gib keys come with art in M8. */
export interface GibTuning {
  /** Gib when the killing hit's raw damage ≥ this × target maxHp. */
  readonly overkillRatio: number;
  readonly maxGibbedPerEvent: number;
}

/** One enemy in the dev encounter, placed relative to the squad's spawn. Until M7's waves. */
export interface DevEncounterSpawn {
  readonly enemy: EnemyId;
  readonly offset: Vec2;
}

/** How a spell reaches its aim point (GDD §4, §15). */
export type SpellDelivery =
  /** Flies from the leader; explodes on the first enemy unit, hut or keg it touches, or at the aim point. */
  | { readonly kind: 'projectile'; readonly speed: number; readonly projectileRadiusPx: number }
  /** Telegraph at the aim point, then strikes whatever is in range at strike time. */
  | { readonly kind: 'strike'; readonly telegraphMs: number };

/** A player-cast area spell (GDD §4). Never damages wizards. */
export interface SpellDef extends DamageSourceDef {
  readonly id: SpellId;
  /** Input and HUD slot (spell1/spell2), fixed by class order in data (GDD §4). */
  readonly slot: 1 | 2;
  readonly radiusPx: number;
  readonly cooldownMs: number;
  readonly delivery: SpellDelivery;
}

export interface SpellTuning {
  /** The aim point is clamped to this distance from the leader (GDD §4). */
  readonly maxCastRangePx: number;
}

/** An instant area blast, ring drawn at radiusPx, hits by the body rule (GDD §0). */
export interface AreaBlastDef extends DamageSourceDef {
  readonly radiusPx: number;
}

/** Combust (GDD §7): a `triggerElement` hit on a unit that has `status`. */
export interface CombustDef {
  readonly id: 'combust';
  readonly status: StatusId;
  readonly triggerElement: DamageElement;
  /** GDD Q15: the origin loses the status. */
  readonly consumesStatus: boolean;
  /**
   * Damages enemy units and huts only; kegs in range are triggered (the blast is fire, GDD §7).
   * `applies` spreads to every unit hit except the origin.
   */
  readonly blast: AreaBlastDef;
}

/** Kaboom (GDD §8): a powder keg hit by any `triggerElements` source. */
export interface KaboomDef {
  readonly id: 'kaboom';
  readonly triggerElements: readonly DamageElement[];
  readonly fuseMs: number;
  /** Hits everything in range, other kegs included. `applies` lands on enemy units and huts only. */
  readonly blast: AreaBlastDef;
  /** Wizards take blast damage × this (GDD Q2: 0.5). */
  readonly squadDamageMultiplier: number;
}

export type ReactionDef = CombustDef | KaboomDef;

/** Powder keg (GDD §8, readability §4). Neutral, never auto-targeted, has no HP. */
export interface KegDef {
  readonly id: StructureId;
  readonly bodyRadiusPx: number;
  /** Square collision footprint side; solid from M7's collision layer (M5 Q1). */
  readonly footprintPx: number;
}

/** One keg in the dev arena, relative to the squad's spawn. Until M7's map. */
export interface DevKegSpawn {
  readonly offset: Vec2;
}
