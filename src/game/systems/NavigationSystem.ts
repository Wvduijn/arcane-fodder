import type { Vec2 } from '@core/types';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { FlowField, FlowFieldClock } from '@core/world/flowField';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { System } from './System';

/** Where the goblins are heading: every living wizard's feet. */
export interface NavigationGoals {
  readonly goalPositions: readonly Vec2[];
}

/**
 * Enemy navigation (CD Q2): core's {@link FlowField} toward the wizards, rebuilt on a fixed
 * interval (game-designer's rebuild time) and right away after the map's solids change (a keg
 * went off, a hut fell). Runs after the squad step and before the enemy step, which samples it
 * only when a goblin's straight line to its target is blocked.
 */
export class NavigationSystem implements System {
  readonly field: FlowField;
  private readonly clock: FlowFieldClock;
  private builds = 0;
  private ticked = false;

  constructor(
    grid: CollisionGrid,
    private readonly goals: NavigationGoals,
    private readonly bus: EventBus,
    rebuildMs: number,
  ) {
    this.field = new FlowField(grid);
    this.clock = new FlowFieldClock(rebuildMs);
    bus.on('reaction:triggered', this.handleReaction);
    bus.on('hut:destroyed', this.handleSolidsChanged);
  }

  /**
   * The rebuild clock ticked this step (every rebuild interval): the enemy step re-tests its cached
   * straight-line answers only then (core `refreshNavigation`, review M7-T7 m1).
   */
  get tickedThisStep(): boolean {
    return this.ticked;
  }

  /** Field rebuilds this run (debug). */
  get buildCount(): number {
    return this.builds;
  }

  update(dt: number): void {
    this.ticked = this.clock.step(dt);
    if (!this.ticked) return;
    const goals = this.goals.goalPositions;
    // A wiped squad leaves the last field in place: nothing is left to chase.
    if (goals.length === 0) return;
    this.field.build(goals);
    this.builds++;
  }

  destroy(): void {
    this.bus.off('reaction:triggered', this.handleReaction);
    this.bus.off('hut:destroyed', this.handleSolidsChanged);
  }

  private readonly handleReaction: GameEventListener<'reaction:triggered'> = ({ reaction }) => {
    if (reaction === 'kaboom') this.clock.invalidate();
  };

  private readonly handleSolidsChanged = (): void => {
    this.clock.invalidate();
  };
}
