import type {
  ConvergenceId,
  DamageElement,
  DeathCause,
  DeathVariantId,
  EntityId,
  ReactionId,
  SpellId,
  StatusId,
  Team,
  Vec2,
} from '@core/types';

/** Typed game event map (plan.md §7.4). Producer-owned contract: propose changes by message. */
export interface GameEvents {
  /**
   * `amount` is the HP actually lost (clamped to remaining HP, GDD §9). For a status tick, `source` is
   * the unit that applied the status (it may have died since; a refresh replaces it). For Kaboom,
   * `source` is the keg's id; it counts as squad-side (GDD §0 kill credit).
   */
  'unit:damaged': {
    readonly id: EntityId;
    readonly team: Team;
    readonly amount: number;
    readonly source: EntityId | null;
    readonly element: DamageElement;
  };
  /** Wizards always carry `blood`/`false`; their death stays non-gory (GDD §12a). */
  'unit:died': {
    readonly id: EntityId;
    readonly team: Team;
    readonly cause: DeathCause;
    readonly deathVariant: DeathVariantId;
    readonly gibbed: boolean;
  };
  'squad:leader-changed': { readonly id: EntityId };
  'status:applied': { readonly id: EntityId; readonly status: StatusId };
  /** Ran out. Not emitted on death (`unit:died` already removes every status). */
  'status:expired': { readonly id: EntityId; readonly status: StatusId };
  /** `at` is the clamped aim point; `from` is the leader at cast time (GDD Q11). */
  'spell:cast': { readonly spell: SpellId; readonly from: Vec2; readonly at: Vec2 };
  /** Fireball explodes or Lightning strikes. */
  'spell:impact': { readonly spell: SpellId; readonly at: Vec2 };
  /** The last wizard of the granting class left the squad. Once per spell per mission (GDD §5). */
  'spell:lost': { readonly spell: SpellId };
  /** A lost spell was pressed: no cooldown, no FX, the HUD slot shakes (GDD §4). */
  'spell:denied': { readonly spell: SpellId };
  /**
   * Combust: `origin` is the burning unit, `spreadTo` the units that caught or refreshed Burning
   * (ember arcs).
   * Kaboom: `origin` is the keg, `spreadTo` is empty.
   */
  'reaction:triggered': {
    readonly reaction: ReactionId;
    readonly at: Vec2;
    readonly origin: EntityId;
    readonly spreadTo: readonly EntityId[];
  };
  /** A keg was triggered; the 72 px ring shows until Kaboom. */
  'keg:fuse-started': { readonly id: EntityId; readonly at: Vec2 };
  /** The Convergence meter reached max. Once per fill. */
  'convergence:charged': Record<string, never>;
  /** R/Space with a full meter: the meter is spent and the channel starts. */
  'convergence:channel-started': { readonly leader: EntityId };
  /** R/Space without a full meter, or while a channel runs: the HUD meter shakes. */
  'convergence:denied': Record<string, never>;
  /** Channel ended: combo and power resolved from the squad alive now (GDD Q5); `at` is locked. */
  'convergence:released': {
    readonly combo: ConvergenceId;
    readonly power: number;
    readonly at: Vec2;
  };
  /** One blast of the strike (Meteor's impact, each meteorlet or bolt). For FX. */
  'convergence:impact': {
    readonly combo: ConvergenceId;
    /** The blast's element: tells a Firestorm meteorlet (fire) from a bolt (storm). */
    readonly element: DamageElement;
    readonly at: Vec2;
    readonly radiusPx: number;
  };
  /** The squad was wiped mid-channel: nothing resolves (GDD §10). */
  'convergence:cancelled': Record<string, never>;
  /** F accepted: `id` left the squad and sprints toward `at`; `bark` is the line shown. */
  'volunteer:started': {
    readonly id: EntityId;
    readonly name: string;
    readonly bark: string;
    readonly at: Vec2;
  };
  /** F refused (cooldown, only the leader left, channel running): the HUD indicator shakes. */
  'volunteer:denied': Record<string, never>;
  /** Arcane Detonation. `unit:died` with cause `volunteer` follows in the same flush. */
  'volunteer:detonated': { readonly id: EntityId; readonly name: string; readonly at: Vec2 };
}

export type GameEventName = keyof GameEvents;
