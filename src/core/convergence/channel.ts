/**
 * Convergence channel and strike (plan §4.1, GDD §10). Pure: it never touches the CombatWorld.
 * Strikes come back as area events; the caller resolves each one in order through
 * `resolveAreaWithReactions` (so Combust, keg triggers, gib caps and the frame's death flush all
 * apply), and applies each ground-burn tick with `applyAreaStatus` (area.ts).
 *
 * API:
 * - `createConvergence()`: idle, nothing striking or burning.
 * - `startChannel(state, request, spells)`: an R/Space press. In this order:
 *   1. No leader (wiped squad): `ignored` (`no-leader`).
 *   2. A channel runs: `denied` (`channeling`). 3. The meter isn't full: `denied` (`not-full`).
 *      Emit `convergence:denied` for both.
 *   4. No aim yet: `ignored` (`no-aim`).
 *   5. Otherwise `started`: spend the meter (meter.ts `spend`), emit
 *      `convergence:channel-started`.
 *   Strikes of an earlier channel still landing don't block a new one.
 * - `stepConvergence(state, input, ctx)`: one frame. In this order:
 *   1. Strikes already falling advance (`blasts`, time order per strike), then burning ground ticks
 *      (`burns`).
 *   2. The channel: with no leader left (wiped) it is `cancelled` and nothing resolves. Otherwise
 *      the aim tracks `input.aim` (the last aim when null), clamped to `spells.maxCastRangePx` from
 *      the current leader (a new leader after a death: the channel goes on, GDD Q4). On the frame
 *      `channelMs` has fully elapsed it ends: combo and power resolve from `input.livingClasses`
 *      (combo.ts; none → `cancelled`), the aim locks, `released` is set, and the strike starts at
 *      the exact end time: the rest of the frame already runs on its timeline, so release and every
 *      strike land at the same times at any frame rate.
 * - `channelPhase(state)`: `'channeling'` while a channel runs, else `'striking'` while strikes
 *   or burning ground remain, else `'idle'` (debug overlay).
 * - `pendingStrikeCount(state)`: blasts still to land (debug overlay).
 *
 * Strike patterns (data, GDD §15):
 * - `impact`: one blast at the locked aim `fallMs` after release (Meteor), then its `groundBurn`
 *   zone: centred there, ticking every `tickMs` from the impact until `durationMs` (a tick on the
 *   expiry still happens), each tick applying `applies` to the enemy units inside (body rule).
 *   Each tick names its `teams` (`['enemy']`): pass them on, so wizards never catch it. Huts are
 *   enemy-team too (M7): keep them out of the `units` given to `applyAreaStatus` if huts must not
 *   burn.
 * - `barrage`: each strike at `atMs` after release, in time order (data order on a tie, so
 *   Firestorm's meteorlet primes Burning before the bolt at 600 and 1200 ms). Each picks, with the
 *   seeded `rng`, a living body of `input.targets` (enemy units, huts) that the combo's `radiusPx`
 *   ring touches around the locked aim, and strikes at its position; with none, a uniform random
 *   point inside the ring. Picks see `input.targets` as passed this frame: when two strikes land in
 *   one step (Firestorm's meteorlet and bolt at 600 and 1200 ms), the second may pick a goblin the
 *   first just killed, and then strikes where it stood (it still hits whatever else is there, and
 *   lights kegs). Accepted (T5 review m1): resolving picks lazily would need the caller to resolve
 *   each blast mid-step, for a rare overlap that only moves one bolt.
 * Every blast: `damage × power`, rounded to whole HP (halves up, like area.ts); radius, knockback
 * and statuses untouched (GDD §10). Teams `['enemy']`, never wizards. `sourceId` is the run's
 * Convergence id (its hits and Burning never charge the meter); `reactionSourceId` the run's
 * reaction id (the Combusts it causes do, M6 Q3). Burning ground ticks carry the Convergence id.
 */
import type {
  AreaBlastDef,
  ConvergenceDef,
  ConvergenceId,
  ConvergenceTuning,
  DamageElement,
  EntityId,
  GroundBurnDef,
  MageClassId,
  SpellTuning,
  StatusId,
  Team,
  Vec2,
} from '@core/types';
import { bodiesInRadius, type AreaBody, type AreaEvent } from '@core/combat/area';
import { resolveCombo, type ComboClasses } from '@core/convergence/combo';
import type { Rng } from '@core/rng/rng';
import { clampAim } from '@core/spells/caster';

/** The run's two Convergence credit ids (from the run's id allocator). */
export interface ConvergenceIds {
  /** Strikes, the Burning they apply and burning ground. Pass the same id to the meter. */
  readonly sourceId: EntityId;
  /** The reactions strikes cause. Must differ from `sourceId`. */
  readonly reactionSourceId: EntityId;
}

export interface Channel {
  readonly elapsedMs: number;
  /** The clamped aim, tracking until release. */
  readonly aim: Vec2;
}

export interface ActiveStrike {
  readonly combo: ConvergenceDef;
  readonly power: number;
  /** The locked aim. */
  readonly at: Vec2;
  readonly elapsedMs: number;
  /** Timeline entries already landed. */
  readonly landed: number;
}

export interface BurnZone {
  readonly at: Vec2;
  readonly def: GroundBurnDef;
  readonly elapsedMs: number;
  readonly ticks: number;
}

export interface ConvergenceState {
  readonly channel: Channel | null;
  /** Release order. */
  readonly strikes: readonly ActiveStrike[];
  /** Creation order. */
  readonly zones: readonly BurnZone[];
}

export interface ChannelRequest {
  readonly meterFull: boolean;
  readonly leader: { readonly id: EntityId; readonly position: Vec2 } | null;
  /** World-space aim, or null before the first pointer. */
  readonly aim: Vec2 | null;
}

export type ChannelOutcome =
  | { readonly kind: 'started'; readonly leader: EntityId; readonly aim: Vec2 }
  | { readonly kind: 'denied'; readonly reason: 'channeling' | 'not-full' }
  | { readonly kind: 'ignored'; readonly reason: 'no-leader' | 'no-aim' };

export interface ConvergenceStepInput {
  readonly dtMs: number;
  /** The current leader, or null when the squad is wiped. */
  readonly leader: { readonly id: EntityId; readonly position: Vec2 } | null;
  readonly aim: Vec2 | null;
  /** Classes of the wizards alive now, in the squad. */
  readonly livingClasses: readonly MageClassId[];
  /** What a barrage strike may pick: living enemy units and huts. Dead ones are skipped. */
  readonly targets: readonly AreaBody[];
}

export interface ConvergenceContext {
  readonly defs: readonly ConvergenceDef[];
  readonly classes: ComboClasses;
  readonly tuning: ConvergenceTuning;
  readonly spells: SpellTuning;
  readonly ids: ConvergenceIds;
  readonly rng: Rng;
}

export interface Release {
  readonly combo: ConvergenceId;
  readonly power: number;
  readonly at: Vec2;
}

/**
 * One blast of a strike. Emit `convergence:impact` with `combo`, `element`, `at: event.centre` and
 * `radiusPx: event.blast.radiusPx`, then resolve `event`.
 */
export interface ConvergenceBlast {
  readonly combo: ConvergenceId;
  /** `event.blast.element`: a Firestorm meteorlet (fire) or bolt (storm). */
  readonly element: DamageElement;
  readonly event: AreaEvent;
}

/** One burning-ground tick: apply `status` to enemy units in range (`applyAreaStatus`). */
export interface GroundBurnTick {
  readonly centre: Vec2;
  readonly radiusPx: number;
  readonly status: StatusId;
  readonly sourceId: EntityId;
  /** Always `['enemy']`: never wizards. */
  readonly teams: readonly Team[];
}

export interface ConvergenceStep {
  readonly state: ConvergenceState;
  /** Emit `convergence:released`. */
  readonly released: Release | null;
  /** Emit `convergence:cancelled`. */
  readonly cancelled: boolean;
  readonly blasts: readonly ConvergenceBlast[];
  readonly burns: readonly GroundBurnTick[];
}

export function createConvergence(): ConvergenceState {
  return { channel: null, strikes: [], zones: [] };
}

export function startChannel(
  state: ConvergenceState,
  request: ChannelRequest,
  spells: SpellTuning,
): { readonly state: ConvergenceState; readonly outcome: ChannelOutcome } {
  const { leader, aim } = request;
  if (!leader) return { state, outcome: { kind: 'ignored', reason: 'no-leader' } };
  if (state.channel) return { state, outcome: { kind: 'denied', reason: 'channeling' } };
  if (!request.meterFull) return { state, outcome: { kind: 'denied', reason: 'not-full' } };
  if (!aim) return { state, outcome: { kind: 'ignored', reason: 'no-aim' } };
  const clamped = clampAim(leader.position, aim, spells.maxCastRangePx);
  return {
    state: { ...state, channel: { elapsedMs: 0, aim: clamped } },
    outcome: { kind: 'started', leader: leader.id, aim: clamped },
  };
}

export function stepConvergence(
  state: ConvergenceState,
  input: ConvergenceStepInput,
  ctx: ConvergenceContext,
): ConvergenceStep {
  const { dtMs } = input;
  if (dtMs <= 0) return { state, released: null, cancelled: false, blasts: [], burns: [] };
  const targets = input.targets.filter((t) => t.alive);
  const blasts: ConvergenceBlast[] = [];
  const burns: GroundBurnTick[] = [];
  const strikes: ActiveStrike[] = [];
  const zones: BurnZone[] = [];

  const runStrike = (strike: ActiveStrike, ms: number) => {
    const r = advanceStrike(strike, ms, targets, ctx);
    blasts.push(...r.blasts);
    if (r.strike) strikes.push(r.strike);
    for (const z of r.zones) runZone(z.zone, z.ms);
  };
  const runZone = (zone: BurnZone, ms: number) => {
    const r = advanceZone(zone, ms, ctx.ids.sourceId);
    burns.push(...r.burns);
    if (r.zone) zones.push(r.zone);
  };

  for (const z of state.zones) runZone(z, dtMs);
  for (const s of state.strikes) runStrike(s, dtMs);

  let channel = state.channel;
  let released: Release | null = null;
  let cancelled = false;
  if (channel) {
    const { leader } = input;
    if (!leader) {
      channel = null;
      cancelled = true;
    } else {
      const aim = clampAim(leader.position, input.aim ?? channel.aim, ctx.spells.maxCastRangePx);
      const elapsedMs = channel.elapsedMs + dtMs;
      if (elapsedMs < ctx.tuning.channelMs - EPSILON_MS) {
        channel = { elapsedMs, aim };
      } else {
        channel = null;
        const resolved = resolveCombo(
          input.livingClasses,
          ctx.classes,
          ctx.defs,
          ctx.tuning.scaling,
        );
        if (!resolved) {
          cancelled = true;
        } else {
          released = { combo: resolved.combo.id, power: resolved.power, at: aim };
          const strike: ActiveStrike = { ...resolved, at: aim, elapsedMs: 0, landed: 0 };
          runStrike(strike, Math.max(0, elapsedMs - ctx.tuning.channelMs));
        }
      }
    }
  }

  return { state: { channel, strikes, zones }, released, cancelled, blasts, burns };
}

export type ChannelPhase = 'idle' | 'channeling' | 'striking';

export function channelPhase(state: ConvergenceState): ChannelPhase {
  if (state.channel) return 'channeling';
  return state.strikes.length > 0 || state.zones.length > 0 ? 'striking' : 'idle';
}

export function pendingStrikeCount(state: ConvergenceState): number {
  return state.strikes.reduce((n, s) => n + timelineOf(s.combo).length - s.landed, 0);
}

const ENEMY_ONLY: readonly Team[] = ['enemy'];

/** Float slack for timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

interface TimelineEntry {
  readonly atMs: number;
  readonly blast: AreaBlastDef;
  /** At the locked aim (impact), or at a picked target (barrage). */
  readonly aimed: boolean;
}

const timelines = new WeakMap<ConvergenceDef, readonly TimelineEntry[]>();

/** A combo's blasts in time order (stable: data order on a tie). Cached per def. */
function timelineOf(def: ConvergenceDef): readonly TimelineEntry[] {
  const cached = timelines.get(def);
  if (cached) return cached;
  const { pattern } = def;
  const list: TimelineEntry[] =
    pattern.kind === 'impact'
      ? [{ atMs: pattern.fallMs, blast: pattern.blast, aimed: true }]
      : pattern.strikes
          .map((s) => ({ atMs: s.atMs, blast: s.blast, aimed: false }))
          .sort((a, b) => a.atMs - b.atMs);
  timelines.set(def, list);
  return list;
}

function advanceStrike(
  strike: ActiveStrike,
  dtMs: number,
  targets: readonly AreaBody[],
  ctx: ConvergenceContext,
): {
  readonly strike: ActiveStrike | null;
  readonly blasts: readonly ConvergenceBlast[];
  readonly zones: readonly { readonly zone: BurnZone; readonly ms: number }[];
} {
  const timeline = timelineOf(strike.combo);
  const elapsedMs = strike.elapsedMs + dtMs;
  const blasts: ConvergenceBlast[] = [];
  const zones: { zone: BurnZone; ms: number }[] = [];
  let landed = strike.landed;
  for (let entry = timeline[landed]; entry && entry.atMs <= elapsedMs + EPSILON_MS;) {
    const centre = entry.aimed ? strike.at : pickCentre(strike, targets, ctx.rng);
    blasts.push({
      combo: strike.combo.id,
      element: entry.blast.element,
      event: {
        centre,
        blast: { ...entry.blast, damage: Math.round(entry.blast.damage * strike.power) },
        sourceId: ctx.ids.sourceId,
        reactionSourceId: ctx.ids.reactionSourceId,
        teams: ['enemy'],
      },
    });
    const { pattern } = strike.combo;
    if (pattern.kind === 'impact' && pattern.groundBurn) {
      zones.push({
        zone: { at: strike.at, def: pattern.groundBurn, elapsedMs: 0, ticks: 0 },
        ms: Math.max(0, elapsedMs - entry.atMs),
      });
    }
    landed++;
    entry = timeline[landed];
  }
  const done = landed >= timeline.length;
  return { strike: done ? null : { ...strike, elapsedMs, landed }, blasts, zones };
}

function advanceZone(
  zone: BurnZone,
  dtMs: number,
  sourceId: EntityId,
): { readonly zone: BurnZone | null; readonly burns: readonly GroundBurnTick[] } {
  const { def } = zone;
  if (!(def.tickMs > 0)) throw new RangeError(`Ground burn tickMs must be positive`);
  const elapsedMs = zone.elapsedMs + dtMs;
  const total = Math.floor((def.durationMs + EPSILON_MS) / def.tickMs);
  const burns: GroundBurnTick[] = [];
  let ticks = zone.ticks;
  while (ticks < total && (ticks + 1) * def.tickMs <= elapsedMs + EPSILON_MS) {
    burns.push({
      centre: zone.at,
      radiusPx: def.radiusPx,
      status: def.applies,
      sourceId,
      teams: ENEMY_ONLY,
    });
    ticks++;
  }
  const done = ticks >= total || elapsedMs >= def.durationMs - EPSILON_MS;
  return { zone: done ? null : { ...zone, elapsedMs, ticks }, burns };
}

/** A barrage strike's centre: a random target the ring touches, else a random point inside it. */
function pickCentre(strike: ActiveStrike, targets: readonly AreaBody[], rng: Rng): Vec2 {
  const ids = bodiesInRadius(strike.at, strike.combo.radiusPx, targets);
  if (ids.length > 0) {
    const picked = rng.pick(ids);
    const body = targets.find((t) => t.id === picked);
    if (body) return body.position;
  }
  const r = strike.combo.radiusPx * Math.sqrt(rng.next());
  const angle = 2 * Math.PI * rng.next();
  return { x: strike.at.x + r * Math.cos(angle), y: strike.at.y + r * Math.sin(angle) };
}
