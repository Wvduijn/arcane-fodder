/**
 * Generic finite state machine for AI brains (M4). The machine object holds only the state
 * definitions, so one instance is shared by every goblin of a kind; the runtime state is the plain
 * {@link MachineState} record the caller stores (one authoritative state per unit).
 *
 * API:
 * - `new StateMachine(defs)`: `defs` maps every state to its optional `enter`/`update`/`exit` hooks.
 * - `machine.start(initial, ctx)`: enters `initial` (calls its `enter`), time in state 0.
 * - `machine.step(state, ctx, dtMs)`: adds dt to the time in state, then calls the current state's
 *   `update(ctx, dtMs, timeInStateMs)`. A returned state name different from the current one is a
 *   transition: `exit` of the old state, `enter` of the new one, time in state reset to 0. The new
 *   state's `update` then runs at once with dt 0, so a chain (chase → windup when already in range)
 *   resolves on the same frame. Returning the current state, or nothing, stays.
 * - `machine.transition(state, to, ctx)`: an outside transition (target lost, death). Same hooks.
 *   Transitioning to the current state is a no-op.
 *
 * Rules:
 * - Timing is frame-granular: the part of a frame after a transition is not credited to the new
 *   state (it starts at 0 and updates with dt 0). A 150 ms state lasts 150 ms plus up to one frame.
 * - A negative or non-finite dt counts as 0.
 * - No loops on one frame: a step never enters the same state twice. A transition back to a state
 *   already entered (or started in) this step is dropped, and the machine stays where it is until
 *   the next step. That bounds a step to one visit per state and keeps it deterministic.
 * - A state name with no definition throws (`start`, `step`, `transition`, or a returned name).
 * - Hooks may mutate `ctx`; the machine itself never keeps anything between calls.
 */

export interface StateDef<TState extends string, TContext> {
  readonly enter?: (ctx: TContext) => void;
  /** Returns the next state, or nothing (or the current state) to stay. */
  readonly update?: (ctx: TContext, dtMs: number, timeInStateMs: number) => TState | undefined;
  readonly exit?: (ctx: TContext) => void;
}

export type StateDefs<TState extends string, TContext> = Readonly<
  Record<TState, StateDef<TState, TContext>>
>;

/** Runtime state of one machine. Immutable: every call returns a new record. */
export interface MachineState<TState extends string> {
  readonly current: TState;
  /** Time since the current state was entered, in ms. */
  readonly timeInStateMs: number;
}

export class StateMachine<TState extends string, TContext> {
  constructor(private readonly defs: StateDefs<TState, TContext>) {}

  /** Enters `initial`: calls its `enter` hook. Time in state starts at 0. */
  start(initial: TState, ctx: TContext): MachineState<TState> {
    this.def(initial).enter?.(ctx);
    return { current: initial, timeInStateMs: 0 };
  }

  /** One frame: advance time in state by `dtMs`, run `update`, and follow any transition chain. */
  step(state: MachineState<TState>, ctx: TContext, dtMs: number): MachineState<TState> {
    const visited = new Set<TState>([state.current]);
    let current = state.current;
    let dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
    let time = state.timeInStateMs + dt;
    for (;;) {
      const next = this.def(current).update?.(ctx, dt, time);
      if (next === undefined || next === current) break;
      this.def(next);
      if (visited.has(next)) break;
      visited.add(next);
      this.swap(current, next, ctx);
      current = next;
      time = 0;
      dt = 0;
    }
    return { current, timeInStateMs: time };
  }

  /** An outside transition: `exit` of the current state, `enter` of `to`. A no-op if `to` is current. */
  transition(state: MachineState<TState>, to: TState, ctx: TContext): MachineState<TState> {
    this.def(to);
    if (to === state.current) return state;
    this.swap(state.current, to, ctx);
    return { current: to, timeInStateMs: 0 };
  }

  private swap(from: TState, to: TState, ctx: TContext): void {
    this.def(from).exit?.(ctx);
    this.def(to).enter?.(ctx);
  }

  private def(state: TState): StateDef<TState, TContext> {
    if (!Object.hasOwn(this.defs, state)) {
      throw new RangeError(`Unknown state "${state}"`);
    }
    return this.defs[state];
  }
}
