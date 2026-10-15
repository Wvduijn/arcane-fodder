import type { DeathCause, EntityId, Team } from '@core/types';

/** Typed game event map (plan.md §7.4). Producer-owned contract: propose changes by message. */
export interface GameEvents {
  'unit:died': { readonly id: EntityId; readonly team: Team; readonly cause: DeathCause };
  'squad:leader-changed': { readonly id: EntityId };
}

export type GameEventName = keyof GameEvents;
