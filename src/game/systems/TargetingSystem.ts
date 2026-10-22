import type { CombatTuning, EntityId, Vec2 } from '@core/types';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { createAutoAttack, stepAutoAttack, type AutoAttackState } from '@core/combat/autoAttack';
import type { CombatWorld } from '@core/combat/world';
import type { TargetCandidate } from '@core/targeting/selectTarget';
import { CLASSES } from '@data/classes';
import { COMBAT } from '@data/combat';
import type { EnemyRoster, StructureRoster } from './EnemyRoster';
import type { SquadHold, SquadSystem } from './SquadSystem';
import type { System } from './System';

/** A wizard shot decided this frame; CombatSystem spawns the projectile. */
export interface WizardShot {
  readonly wizard: EntityId;
  readonly target: EntityId;
  readonly from: Vec2;
  readonly aimAt: Vec2;
}

/**
 * Wizard auto-attack decisions (GDD §3), through core's `stepAutoAttack` per living wizard: the
 * cooldown ticks, the nearest living enemy in the class's range is re-picked every `retargetMs` or
 * at once when the target dies or leaves range, and a ready wizard with a target fires at the
 * target's position now. Shots are queued for CombatSystem, which runs next in the frame. Goblins
 * pick their own targets in their brains.
 */
export class TargetingSystem implements System {
  private readonly states = new Map<EntityId, AutoAttackState>();
  private shots: WizardShot[] = [];

  constructor(
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly world: CombatWorld,
    private readonly hold: SquadHold,
    private readonly tuning: CombatTuning = COMBAT,
    /** Map blockers (M7, CD Q3): a wizard never picks a target it can't see. */
    private readonly collision: CollisionGrid | null = null,
    /** Huts (M7): auto-attacked only when no unit is in range (GDD §3, §12). */
    private readonly structures: StructureRoster | null = null,
  ) {}

  /** The wizard's current target, or null. */
  targetOf(wizard: EntityId): EntityId | null {
    return this.states.get(wizard)?.target ?? null;
  }

  /** Time since the wizard last re-picked (debug). */
  sinceRetargetOf(wizard: EntityId): number {
    return this.states.get(wizard)?.sinceRetargetMs ?? 0;
  }

  /** ms until the wizard can fire again, 0 when ready (debug). */
  cooldownOf(wizard: EntityId): number {
    return Math.max(0, this.states.get(wizard)?.cooldown.remainingMs ?? 0);
  }

  /** This frame's shots, ascending wizard id. Empties the queue. */
  takeShots(): WizardShot[] {
    const shots = this.shots;
    this.shots = [];
    return shots;
  }

  update(dt: number): void {
    // Convergence channel: wizards don't auto-attack (GDD §10); their auto state waits as it is.
    if (this.hold.held) return;
    const candidates = this.candidates();
    const living = new Set<EntityId>();
    const members = [...this.squad.state.members].sort((a, b) => a.id - b.id);
    for (const member of members) {
      if (!this.world.isAlive(member.id)) continue;
      living.add(member.id);
      const step = stepAutoAttack(this.states.get(member.id) ?? createAutoAttack(), {
        position: member.position,
        attack: CLASSES[this.squad.classOf(member.id)].attack,
        retargetMs: this.tuning.retargetMs,
        candidates,
        dtMs: dt,
        ...(this.collision ? { collision: this.collision } : {}),
      });
      this.states.set(member.id, step.state);
      if (step.fire) {
        this.shots.push({ wizard: member.id, from: member.position, ...step.fire });
      }
    }
    // Dead wizards never target or fire (D4).
    for (const id of this.states.keys()) if (!living.has(id)) this.states.delete(id);
  }

  destroy(): void {
    this.states.clear();
    this.shots = [];
  }

  private candidates(): TargetCandidate[] {
    const list: TargetCandidate[] = [];
    for (const id of this.enemies.ids()) {
      const position = this.enemies.positionOf(id);
      if (!position) continue;
      list.push({ id, position, kind: 'unit', alive: this.world.isAlive(id) });
    }
    for (const id of this.structures?.structureIds() ?? []) {
      const position = this.structures?.positionOf(id);
      if (!position) continue;
      list.push({ id, position, kind: 'structure', alive: this.world.isAlive(id) });
    }
    return list;
  }
}
