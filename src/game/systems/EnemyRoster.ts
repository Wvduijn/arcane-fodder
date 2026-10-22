import type {
  DrawnProjectileAttackDef,
  EnemyDef,
  EntityId,
  MeleeAttackDef,
  TargetId,
  Vec2,
} from '@core/types';
import type { AreaBody } from '@core/combat/area';
import type { UnitLookup } from '../entities/Positioned';

/** An attack a goblin brain released this frame. CombatSystem resolves it. */
export type EnemyAttackIntent =
  /** Swing released with the target still in range (a whiff produces no intent). */
  | {
      readonly kind: 'melee';
      readonly attacker: EntityId;
      readonly target: EntityId;
      readonly attack: MeleeAttackDef;
    }
  /** Draw finished: an arrow from `from` toward the aim locked at draw start. */
  | {
      readonly kind: 'shoot';
      readonly attacker: EntityId;
      readonly from: Vec2;
      readonly aimAt: Vec2;
      readonly attack: DrawnProjectileAttackDef;
    };

/** What the combat side needs from the enemies (EnemyAiSystem implements it). */
export interface EnemyRoster extends UnitLookup {
  /** Living enemies, ascending id. */
  ids(): readonly EntityId[];
  defOf(id: EntityId): EnemyDef | undefined;
  /** This frame's released attacks, in ascending attacker id. Empties the queue. */
  takeIntents(): EnemyAttackIntent[];
  /** Starts an eased push (no-op for dead ids or `takesKnockback: false`). */
  knockBack(id: EntityId, direction: Vec2, distancePx: number): void;
  /** Despawns a dead enemy; its last position stays readable through `positionOf`. */
  remove(id: EntityId): void;
}

/**
 * Structures in the combat world (huts, SpawnerSystem): hit bodies for shots and area events,
 * auto-attack fallback targets, and the target id the death flush puts on `hut:destroyed`.
 */
export interface StructureRoster extends UnitLookup {
  /** Living structures, ascending id. */
  structureIds(): readonly EntityId[];
  /** What a destroy objective counts this structure as. Undefined for unknown ids. */
  targetOf(id: EntityId): TargetId | undefined;
  /** Living structures as area bodies with their square footprint (core area.ts, T11b). */
  areaBodies(): AreaBody[];
}
