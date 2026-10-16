/**
 * Goblin brains (GDD §12), on the generic StateMachine. A brain only decides: where it wants to
 * walk (a unit direction, or zero) and which attacks it releases. enemyMovement.ts moves the body,
 * the combat code applies the attacks.
 *
 * Grunt (`swarm`): idle → chase → windup → recover → chase …
 * - idle: aggro on the nearest living wizard within `aggroRadiusPx` (≤, centre to centre).
 * - chase: walks at the target until the bodies touch. When the target is within `attack.rangePx`
 *   and the cooldown is ready, the wind-up starts (on the same frame).
 * - windup: stands still for `windupMs` (the tell). The cooldown starts when the wind-up starts.
 *   At release, the swing lands only if the target is alive and still within range; otherwise it
 *   whiffs (M4 Q2: a grunt knocked back during its wind-up whiffs and the cooldown is spent).
 * - recover: chases like `chase` until the cooldown is ready, then goes back to `chase`.
 * Archer (`keep-range`): idle → keep-range → draw → keep-range …
 * - keep-range: steps away below `retreatBelowPx`, in above `advanceAbovePx`, holds in between.
 *   When the target is within `attack.rangePx`, not closer than `retreatBelowPx`, and the cooldown
 *   is ready, the draw starts. A pushed archer (target closer than `retreatBelowPx`) retreats and
 *   never starts a draw, even when cornered (GDD §12 "Pushed archers don't shoot").
 * - draw: stands still for `drawMs`; the aim is locked to the target's position at draw start
 *   (no lead, GDD §12). A started draw always finishes and shoots there, even if the target closed
 *   in or died meanwhile, so the tell never lies.
 *
 * Targets: after aggro there is no leash. The brain re-picks the nearest living wizard (any range)
 * every `retargetMs`, or at once when its target is dead or gone, except while committed to a
 * wind-up or draw. With no living wizard left, it goes back to idle.
 *
 * API:
 * - `createGoblinBrain(def)`: an idle brain with a ready cooldown.
 * - `stepGoblin(brain, input)`: one frame → `{ brain, moveDirection, actions }`. A dead goblin
 *   (`input.self.alive` false) returns its brain unchanged, no move and no actions (D4).
 * - `GoblinAction`: `melee` (target id, `landed`) or `shoot` (from, aimAt). Ascending enemy id order
 *   is the caller's job (stepEnemies does it).
 */
import type { EnemyDef, EntityId, Vec2 } from '@core/types';
import { StateMachine, type MachineState } from '@core/ai/stateMachine';
import {
  isReady,
  READY,
  tickCooldown,
  triggerCooldown,
  type Cooldown,
} from '@core/combat/cooldown';
import { distance, normalize, sub } from '@core/math/vec2';
import { selectTarget, shouldRetarget, type TargetCandidate } from '@core/targeting/selectTarget';

export type GruntStateId = 'idle' | 'chase' | 'windup' | 'recover';
export type ArcherStateId = 'idle' | 'keep-range' | 'draw';

interface BrainBase {
  readonly target: EntityId | null;
  readonly sinceRetargetMs: number;
  readonly cooldown: Cooldown;
}

export type GoblinBrain =
  | (BrainBase & { readonly kind: 'swarm'; readonly machine: MachineState<GruntStateId> })
  | (BrainBase & {
      readonly kind: 'keep-range';
      readonly machine: MachineState<ArcherStateId>;
      /** Locked at draw start; null outside a draw. */
      readonly aim: Vec2 | null;
    });

/** A wizard as the brain sees it. */
export interface WizardView {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly bodyRadiusPx: number;
  readonly alive: boolean;
}

export interface GoblinInput {
  readonly def: EnemyDef;
  readonly self: {
    readonly id: EntityId;
    readonly position: Vec2;
    readonly alive: boolean;
  };
  readonly wizards: readonly WizardView[];
  readonly dtMs: number;
}

export type GoblinAction =
  | { readonly kind: 'melee'; readonly target: EntityId; readonly landed: boolean }
  | { readonly kind: 'shoot'; readonly from: Vec2; readonly aimAt: Vec2 };

export interface GoblinStep {
  readonly brain: GoblinBrain;
  /** Unit vector, or {0,0} to stand. Speed is `def.moveSpeed`. */
  readonly moveDirection: Vec2;
  readonly actions: readonly GoblinAction[];
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** Mutable per-step scratch the state hooks read and write. */
interface Ctx {
  readonly def: EnemyDef;
  readonly self: Vec2;
  readonly wizards: readonly WizardView[];
  target: EntityId | null;
  sinceRetargetMs: number;
  cooldown: Cooldown;
  aim: Vec2 | null;
  move: Vec2;
  actions: GoblinAction[];
}

export function createGoblinBrain(def: EnemyDef): GoblinBrain {
  const base = { target: null, sinceRetargetMs: 0, cooldown: READY };
  if (def.behaviour.kind === 'swarm') {
    return { ...base, kind: 'swarm', machine: { current: 'idle', timeInStateMs: 0 } };
  }
  return { ...base, kind: 'keep-range', machine: { current: 'idle', timeInStateMs: 0 }, aim: null };
}

export function stepGoblin(brain: GoblinBrain, input: GoblinInput): GoblinStep {
  if (!input.self.alive) return { brain, moveDirection: ZERO, actions: [] };
  const dt = Math.max(0, input.dtMs);
  const ctx: Ctx = {
    def: input.def,
    self: input.self.position,
    wizards: input.wizards,
    target: brain.target,
    sinceRetargetMs: brain.sinceRetargetMs + dt,
    cooldown: tickCooldown(brain.cooldown, dt),
    aim: brain.kind === 'keep-range' ? brain.aim : null,
    move: ZERO,
    actions: [],
  };
  let next: GoblinBrain;
  if (brain.kind === 'swarm') {
    const machine = GRUNT.step(brain.machine, ctx, dt);
    next = { kind: 'swarm', machine, ...common(ctx) };
  } else {
    const machine = ARCHER.step(brain.machine, ctx, dt);
    next = { kind: 'keep-range', machine, aim: ctx.aim, ...common(ctx) };
  }
  return { brain: next, moveDirection: ctx.move, actions: ctx.actions };
}

function common(ctx: Ctx): BrainBase {
  return { target: ctx.target, sinceRetargetMs: ctx.sinceRetargetMs, cooldown: ctx.cooldown };
}

const candidates = (wizards: readonly WizardView[]): TargetCandidate[] =>
  wizards.map((w) => ({ id: w.id, position: w.position, kind: 'unit', alive: w.alive }));

function targetOf(ctx: Ctx): WizardView | null {
  if (ctx.target === null) return null;
  return ctx.wizards.find((w) => w.id === ctx.target && w.alive) ?? null;
}

/** Idle aggro: the nearest living wizard within the aggro radius. */
function aggro(ctx: Ctx): boolean {
  const target = selectTarget(ctx.self, ctx.def.aggroRadiusPx, candidates(ctx.wizards));
  if (target === null) return false;
  ctx.target = target;
  ctx.sinceRetargetMs = 0;
  return true;
}

/** No leash: re-pick the nearest living wizard when due. Returns the target, or null if none. */
function retarget(ctx: Ctx): WizardView | null {
  if (shouldRetarget(ctx.sinceRetargetMs, ctx.def.retargetMs, targetOf(ctx) !== null)) {
    ctx.target = selectTarget(ctx.self, Number.POSITIVE_INFINITY, candidates(ctx.wizards));
    ctx.sinceRetargetMs = 0;
  }
  return targetOf(ctx);
}

const toward = (from: Vec2, to: Vec2): Vec2 => normalize(sub(to, from));

/** Walk at the target until the bodies touch. */
function closeIn(ctx: Ctx, target: WizardView): void {
  const contact = ctx.def.bodyRadiusPx + target.bodyRadiusPx;
  ctx.move =
    distance(ctx.self, target.position) > contact ? toward(ctx.self, target.position) : ZERO;
}

function canStrike(ctx: Ctx, target: WizardView): boolean {
  return isReady(ctx.cooldown) && distance(ctx.self, target.position) <= ctx.def.attack.rangePx;
}

/** Shared by chase and recover: retarget, close in, report whether a strike can start. */
function pursue(ctx: Ctx): 'idle' | 'strike' | 'stay' {
  const target = retarget(ctx);
  if (!target) return 'idle';
  if (canStrike(ctx, target)) return 'strike';
  closeIn(ctx, target);
  return 'stay';
}

const GRUNT = new StateMachine<GruntStateId, Ctx>({
  idle: {
    update: (ctx) => (aggro(ctx) ? 'chase' : undefined),
  },
  chase: {
    update: (ctx) => {
      const decision = pursue(ctx);
      if (decision === 'idle') return 'idle';
      return decision === 'strike' ? 'windup' : undefined;
    },
  },
  windup: {
    enter: (ctx) => {
      ctx.cooldown = triggerCooldown(ctx.cooldown, ctx.def.attack.cooldownMs);
    },
    update: (ctx, _dt, timeInStateMs) => {
      const attack = ctx.def.attack;
      if (attack.kind !== 'melee' || timeInStateMs < attack.windupMs) return undefined;
      const target = targetOf(ctx);
      if (ctx.target !== null) {
        const landed = target !== null && distance(ctx.self, target.position) <= attack.rangePx;
        ctx.actions.push({ kind: 'melee', target: ctx.target, landed });
      }
      return 'recover';
    },
  },
  recover: {
    update: (ctx) => {
      const decision = pursue(ctx);
      if (decision === 'idle') return 'idle';
      return isReady(ctx.cooldown) ? 'chase' : undefined;
    },
  },
});

const ARCHER = new StateMachine<ArcherStateId, Ctx>({
  idle: {
    update: (ctx) => (aggro(ctx) ? 'keep-range' : undefined),
  },
  'keep-range': {
    update: (ctx) => {
      const target = retarget(ctx);
      if (!target) return 'idle';
      if (canStrike(ctx, target) && !isPushed(ctx, target)) return 'draw';
      ctx.move = keepRange(ctx, target);
      return undefined;
    },
  },
  draw: {
    enter: (ctx) => {
      ctx.cooldown = triggerCooldown(ctx.cooldown, ctx.def.attack.cooldownMs);
      ctx.aim = targetOf(ctx)?.position ?? null;
    },
    update: (ctx, _dt, timeInStateMs) => {
      const attack = ctx.def.attack;
      if (attack.kind !== 'projectile' || timeInStateMs < attack.drawMs) return undefined;
      if (ctx.aim) ctx.actions.push({ kind: 'shoot', from: ctx.self, aimAt: ctx.aim });
      ctx.aim = null;
      return 'keep-range';
    },
  },
});

/** Target closer than `retreatBelowPx`: the archer backs off instead of drawing. */
function isPushed(ctx: Ctx, target: WizardView): boolean {
  const behaviour = ctx.def.behaviour;
  return (
    behaviour.kind === 'keep-range' &&
    distance(ctx.self, target.position) < behaviour.retreatBelowPx
  );
}

function keepRange(ctx: Ctx, target: WizardView): Vec2 {
  const behaviour = ctx.def.behaviour;
  if (behaviour.kind !== 'keep-range') return ZERO;
  const d = distance(ctx.self, target.position);
  if (isPushed(ctx, target)) return toward(target.position, ctx.self);
  if (d > behaviour.advanceAbovePx) return toward(ctx.self, target.position);
  return ZERO;
}
