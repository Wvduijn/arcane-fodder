/**
 * Granted spell casting (GDD §4, M5 Q4): per-spell cooldowns, cast validation, the aim clamp, and
 * spells on their way (Lightning telegraphs, Fireball flights). Pure: it never touches the
 * CombatWorld. Impacts come back as data; the caller resolves each one as an area event
 * (`resolveAreaEvent`, area.ts, with the SpellDef as the blast and `teams: ['enemy']`, so spells
 * never hurt wizards) and checks kegs (reactions.ts).
 *
 * API:
 * - `createCaster(spells)`: every spell's cooldown ready, nothing in flight.
 * - `stepCaster(state, input)`: one frame, before this frame's casts. Cooldowns tick (also for lost
 *   spells; harmless, they can't be cast). Pending strikes count down and strike on the frame their
 *   telegraph has fully elapsed. Fireballs fly (projectile.ts, swept, no tunnelling): one explodes
 *   at the contact point on the first body of `input.hitBodies` it touches (living enemy units,
 *   huts, kegs: whatever the caller lists; wizards are simply not listed, so it passes them), or
 *   exactly at its clamped aim point when it gets there. With `input.collision` (M7) it also
 *   explodes where it enters the first blocker tile (GDD §4: trunks stop it; a hut's footprint
 *   counts as a hit on the hut when the hut is in `hitBodies`). Impacts in pending order (cast
 *   order).
 * - `castSpell(state, request, spells, tuning)`: a press of slot 1 or 2, after `stepCaster`.
 *   In this order:
 *   1. No spell in that slot: `ignored` (`no-spell`).
 *   2. The slot is lost (not available in `request.slots`): `denied`. Emit `spell:denied`; the
 *      cooldown is left alone, nothing is cast.
 *   3. No leader (wiped squad): `ignored` (`no-leader`).
 *   4. No aim yet (pointer never over the game, Q4): `ignored` (`no-aim`).
 *   5. On cooldown: `ignored` (`cooldown`). No shake, the HUD sweep already says why (Q4).
 *   6. Otherwise `cast`: the aim is clamped to `tuning.maxCastRangePx` from the leader, the
 *      cooldown starts (with the frame's carry, cooldown.ts), and a strike or flight is queued
 *      with the leader as its source (kill credit). Emit `spell:cast` with `from` and `at`.
 * - `clampAim(from, aim, maxRangePx)`: the aim point, pulled in along the line to the leader if it
 *   is farther than the range.
 * - `cooldownRemainingMs(state, spell)`: ≥ 0, for the HUD sweep and seconds.
 *
 * Q4: a strike or flight in progress resolves whatever happens to the caster or the slot after the
 * cast; stepping never consults the squad.
 *
 * Decisions: the Fireball is a `projectile.ts` projectile whose range is exactly the cast distance
 * (range factor 1), so expiry is the aim point; its impact is reported at the clamped aim itself,
 * not the float-summed flight position (D2: ≤ 2 px). Hit bodies are passed to the projectile as the
 * squad's opposing team, which is how kegs (neutral) become solid for spells only. A Lightning
 * impact always reports `hitBody: null`; it hits by radius at strike time.
 */
import type {
  EntityId,
  ProjectileAttackDef,
  SpellDef,
  SpellId,
  SpellTuning,
  Vec2,
} from '@core/types';
import type { AreaBody } from '@core/combat/area';
import {
  isReady,
  READY,
  tickCooldown,
  triggerCooldown,
  type Cooldown,
} from '@core/combat/cooldown';
import { createProjectile, stepProjectile, type Projectile } from '@core/combat/projectile';
import type { SpellSlot } from '@core/spells/availability';
import { add, distance, normalize, scale, sub } from '@core/math/vec2';
import type { CollisionGrid } from '@core/world/collisionGrid';

export type SpellDefs = Readonly<Record<SpellId, SpellDef>>;

interface PendingBase {
  /** Cast order; also the Fireball projectile's id. */
  readonly id: EntityId;
  readonly spell: SpellId;
  /** The leader at cast time. */
  readonly sourceId: EntityId;
  /** The clamped aim point. */
  readonly at: Vec2;
}

export interface PendingStrike extends PendingBase {
  readonly kind: 'strike';
  readonly remainingMs: number;
}

export interface PendingFlight extends PendingBase {
  readonly kind: 'projectile';
  readonly projectile: Projectile;
}

export type PendingSpell = PendingStrike | PendingFlight;

export interface CasterState {
  readonly cooldowns: Readonly<Record<SpellId, Cooldown>>;
  /** Ascending id (cast order). */
  readonly pending: readonly PendingSpell[];
}

export interface CasterStepInput {
  /** Bodies a Fireball explodes on (living enemy units, huts, kegs). Dead ones are skipped. */
  readonly hitBodies: readonly AreaBody[];
  readonly dtMs: number;
  /** Blockers (M7): a Fireball explodes on the first one it enters. Absent: open ground. */
  readonly collision?: CollisionGrid;
}

export interface SpellImpact {
  readonly id: EntityId;
  readonly spell: SpellId;
  /** The blast centre: the clamped aim, or the Fireball's contact point. Emit `spell:impact`. */
  readonly at: Vec2;
  readonly sourceId: EntityId;
  /** The body a Fireball touched, or null (reached its aim point, or Lightning). */
  readonly hitBody: EntityId | null;
}

export interface CasterStep {
  readonly state: CasterState;
  readonly impacts: readonly SpellImpact[];
}

export interface CastRequest {
  readonly slot: SpellDef['slot'];
  /** The current derivation (availability.ts). */
  readonly slots: readonly SpellSlot[];
  readonly leader: { readonly id: EntityId; readonly position: Vec2 } | null;
  /** World-space aim (already re-projected through the camera), or null before the first pointer. */
  readonly aim: Vec2 | null;
  /** Id for the strike or flight; used only on `cast`. */
  readonly nextId: () => EntityId;
}

export type CastOutcome =
  | { readonly kind: 'cast'; readonly spell: SpellId; readonly from: Vec2; readonly at: Vec2 }
  | { readonly kind: 'denied'; readonly spell: SpellId }
  | {
      readonly kind: 'ignored';
      readonly spell: SpellId | null;
      readonly reason: 'no-spell' | 'no-leader' | 'no-aim' | 'cooldown';
    };

export interface CastResult {
  readonly state: CasterState;
  readonly outcome: CastOutcome;
}

export function createCaster(spells: SpellDefs): CasterState {
  const cooldowns = {} as Record<SpellId, Cooldown>;
  for (const def of Object.values(spells)) cooldowns[def.id] = READY;
  return { cooldowns, pending: [] };
}

export function stepCaster(state: CasterState, input: CasterStepInput): CasterStep {
  const { dtMs } = input;
  if (dtMs <= 0) return { state, impacts: [] };
  const cooldowns = {} as Record<SpellId, Cooldown>;
  for (const spell of Object.keys(state.cooldowns) as SpellId[]) {
    cooldowns[spell] = tickCooldown(state.cooldowns[spell], dtMs);
  }
  const bodies = input.hitBodies.map((b) => ({ ...b, team: 'enemy' as const }));
  const pending: PendingSpell[] = [];
  const impacts: SpellImpact[] = [];
  for (const p of state.pending) {
    if (p.kind === 'strike') {
      const remainingMs = p.remainingMs - dtMs;
      if (remainingMs > EPSILON_MS) pending.push({ ...p, remainingMs });
      else impacts.push(impactOf(p, p.at, null));
      continue;
    }
    const s = stepProjectile(p.projectile, dtMs, bodies, input.collision);
    if (s.hit !== null || s.blocked) impacts.push(impactOf(p, s.projectile.position, s.hit));
    else if (s.expired) impacts.push(impactOf(p, p.at, null));
    else pending.push({ ...p, projectile: s.projectile });
  }
  return { state: { cooldowns, pending }, impacts };
}

export function castSpell(
  state: CasterState,
  request: CastRequest,
  spells: SpellDefs,
  tuning: SpellTuning,
): CastResult {
  const slot = request.slots.find((s) => s.slot === request.slot);
  if (!slot) return ignored(state, null, 'no-spell');
  const { spell } = slot;
  if (!slot.available) return { state, outcome: { kind: 'denied', spell } };
  const { leader, aim } = request;
  if (!leader) return ignored(state, spell, 'no-leader');
  if (!aim) return ignored(state, spell, 'no-aim');
  const cooldown = state.cooldowns[spell];
  if (!isReady(cooldown)) return ignored(state, spell, 'cooldown');

  const def = spells[spell];
  const from = leader.position;
  const at = clampAim(from, aim, tuning.maxCastRangePx);
  const base = { id: request.nextId(), spell, sourceId: leader.id, at };
  const queued: PendingSpell =
    def.delivery.kind === 'strike'
      ? { ...base, kind: 'strike', remainingMs: def.delivery.telegraphMs }
      : {
          ...base,
          kind: 'projectile',
          projectile: createProjectile({
            id: base.id,
            ownerId: leader.id,
            team: 'squad',
            from,
            aimAt: at,
            attack: flightOf(def, def.delivery, distance(from, at)),
            rangeFactor: 1,
          }),
        };
  return {
    state: {
      cooldowns: { ...state.cooldowns, [spell]: triggerCooldown(cooldown, def.cooldownMs) },
      pending: [...state.pending, queued],
    },
    outcome: { kind: 'cast', spell, from, at },
  };
}

export function clampAim(from: Vec2, aim: Vec2, maxRangePx: number): Vec2 {
  const d = distance(from, aim);
  if (d <= maxRangePx) return aim;
  return add(from, scale(normalize(sub(aim, from)), maxRangePx));
}

export function cooldownRemainingMs(state: CasterState, spell: SpellId): number {
  return Math.max(0, state.cooldowns[spell].remainingMs);
}

/** Float slack for telegraph timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

function impactOf(p: PendingSpell, at: Vec2, hitBody: EntityId | null): SpellImpact {
  return { id: p.id, spell: p.spell, at, sourceId: p.sourceId, hitBody };
}

function ignored(
  state: CasterState,
  spell: SpellId | null,
  reason: 'no-spell' | 'no-leader' | 'no-aim' | 'cooldown',
): CastResult {
  return { state, outcome: { kind: 'ignored', spell, reason } };
}

/** A Fireball as a projectile whose range ends at the aim point. */
function flightOf(
  def: SpellDef,
  delivery: Extract<SpellDef['delivery'], { kind: 'projectile' }>,
  rangePx: number,
): ProjectileAttackDef {
  return {
    kind: 'projectile',
    element: def.element,
    damage: def.damage,
    knockbackPx: def.knockbackPx,
    canGib: def.canGib,
    rangePx,
    cooldownMs: def.cooldownMs,
    projectileSpeed: delivery.speed,
    projectileRadiusPx: delivery.projectileRadiusPx,
  };
}
