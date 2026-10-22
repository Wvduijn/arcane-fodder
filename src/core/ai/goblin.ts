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
 * Aggro (M7, GDD §13, ADR 0007): a brain made with `aggro: 'always'` (the final surge) ignores
 * `aggroRadiusPx`: its idle state picks the nearest living wizard at any range on its first step.
 * `alertGoblin(brain)` switches a brain to `'always'` (trigger event `alert-group`).
 *
 * Archer post (M7, tiled-conventions §4.1): with `input.post`, an idle archer that stands farther
 * than `holdRadiusPx` from its post walks back to it; within it, it stands still. Once aggroed it
 * keeps range freely (the hold is only "until the squad is spotted").
 *
 * Sight (M7, CD Q3): with `input.lineOfSight`, an archer prefers the nearest wizard it can see when
 * it (re)targets, and only starts a draw at a target it can see; a hidden target is approached
 * (the enemy step then routes round the blocker, flowField.ts). Aggro ignores sight (goblins hear
 * you). Grunts don't use it: their swing needs contact range anyway.
 *
 * Targets: after aggro there is no leash. The brain re-picks the nearest living wizard (any range)
 * every `retargetMs`, or at once when its target is dead or gone, except while committed to a
 * wind-up or draw. With no living wizard left, it goes back to idle.
 *
 * API:
 * - `createGoblinBrain(def, options)`: an idle brain with a ready cooldown; `options.aggro`
 *   defaults to `'radius'`.
 * - `stepGoblin(brain, input)`: one frame → `{ brain, moveDirection, actions }`. A dead goblin
 *   (`input.self.alive` false) returns its brain unchanged, no move and no actions (D4).
 * - `GoblinAction`: `melee` (target id, `landed`) or `shoot` (from, aimAt). Ascending enemy id order
 *   is the caller's job (stepEnemies does it).
 */
import type { EnemyDef, EntityId, Vec2, WaveAggro } from '@core/types';
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
  /** `'always'`: no aggro radius (surge, alerted groups). */
  readonly aggro: WaveAggro;
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
  /** Where an archer holds until aggro (archer-post). */
  readonly post?: GoblinPost;
  /** Can `from` see `to`? Absent: everything is visible (open ground). */
  readonly lineOfSight?: (from: Vec2, to: Vec2) => boolean;
}

export interface GoblinPost {
  readonly position: Vec2;
  readonly holdRadiusPx: number;
}

export interface GoblinOptions {
  readonly aggro?: WaveAggro;
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
  readonly aggro: WaveAggro;
  readonly post: GoblinPost | null;
  readonly sees: (to: Vec2) => boolean;
  target: EntityId | null;
  sinceRetargetMs: number;
  cooldown: Cooldown;
  aim: Vec2 | null;
  move: Vec2;
  actions: GoblinAction[];
}

export function createGoblinBrain(def: EnemyDef, options: GoblinOptions = {}): GoblinBrain {
  const base = {
    aggro: options.aggro ?? 'radius',
    target: null,
    sinceRetargetMs: 0,
    cooldown: READY,
  };
  if (def.behaviour.kind === 'swarm') {
    return { ...base, kind: 'swarm', machine: { current: 'idle', timeInStateMs: 0 } };
  }
  return { ...base, kind: 'keep-range', machine: { current: 'idle', timeInStateMs: 0 }, aim: null };
}

export function stepGoblin(brain: GoblinBrain, input: GoblinInput): GoblinStep {
  if (!input.self.alive) return { brain, moveDirection: ZERO, actions: [] };
  const dt = Math.max(0, input.dtMs);
  const self = input.self.position;
  const sight = input.lineOfSight;
  const ctx: Ctx = {
    def: input.def,
    self,
    wizards: input.wizards,
    aggro: brain.aggro,
    post: input.post ?? null,
    sees: sight ? (to) => sight(self, to) : () => true,
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
  return {
    aggro: ctx.aggro,
    target: ctx.target,
    sinceRetargetMs: ctx.sinceRetargetMs,
    cooldown: ctx.cooldown,
  };
}

/** The brain from now on aggroes at any range (trigger `alert-group`). */
export function alertGoblin(brain: GoblinBrain): GoblinBrain {
  return brain.aggro === 'always' ? brain : { ...brain, aggro: 'always' };
}

const candidates = (wizards: readonly WizardView[]): TargetCandidate[] =>
  wizards.map((w) => ({ id: w.id, position: w.position, kind: 'unit', alive: w.alive }));

function targetOf(ctx: Ctx): WizardView | null {
  if (ctx.target === null) return null;
  return ctx.wizards.find((w) => w.id === ctx.target && w.alive) ?? null;
}

/** Idle aggro: the nearest living wizard within the aggro radius (any range for `'always'`). */
function aggro(ctx: Ctx): boolean {
  const range = ctx.aggro === 'always' ? Number.POSITIVE_INFINITY : ctx.def.aggroRadiusPx;
  const target = selectTarget(ctx.self, range, candidates(ctx.wizards));
  if (target === null) return false;
  ctx.target = target;
  ctx.sinceRetargetMs = 0;
  return true;
}

/** Idle: an archer off its post walks back; otherwise stand. */
function holdPost(ctx: Ctx): void {
  const post = ctx.post;
  if (post && distance(ctx.self, post.position) > post.holdRadiusPx) {
    ctx.move = toward(ctx.self, post.position);
  }
}

/**
 * No leash: re-pick the nearest living wizard when due. Archers prefer one they can see. Returns
 * the target, or null if none.
 */
function retarget(ctx: Ctx): WizardView | null {
  if (shouldRetarget(ctx.sinceRetargetMs, ctx.def.retargetMs, targetOf(ctx) !== null)) {
    const all = candidates(ctx.wizards);
    const anyRange = Number.POSITIVE_INFINITY;
    ctx.target =
      (ctx.def.behaviour.kind === 'keep-range'
        ? selectTarget(ctx.self, anyRange, all, (c) => ctx.sees(c.position))
        : null) ?? selectTarget(ctx.self, anyRange, all);
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
    update: (ctx) => {
      if (aggro(ctx)) return 'keep-range';
      holdPost(ctx);
      return undefined;
    },
  },
  'keep-range': {
    update: (ctx) => {
      const target = retarget(ctx);
      if (!target) return 'idle';
      if (!ctx.sees(target.position)) {
        ctx.move = toward(ctx.self, target.position);
        return undefined;
      }
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
