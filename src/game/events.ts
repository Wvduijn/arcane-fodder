import type {
  DamageElement,
  DeathCause,
  DeathVariantId,
  EntityId,
  StatusId,
  Team,
} from '@core/types';

/** Typed game event map (plan.md §7.4). Producer-owned contract: propose changes by message. */
export interface GameEvents {
  /**
   * `amount` is the HP actually lost (clamped to remaining HP, GDD §9). For a status tick, `source` is
   * the unit that applied the status (it may have died since; a refresh replaces it).
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
}

export type GameEventName = keyof GameEvents;
