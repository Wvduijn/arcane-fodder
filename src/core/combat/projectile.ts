/**
 * Straight, non-homing projectiles (GDD §0, §3, §12): fire bolt, spark, arrow.
 *
 * API:
 * - `createProjectile(spec)`: aimed at `aimAt` (the target's position at fire time, or the
 *   archer's draw-start aim), flying from `from` at the attack's speed. It expires after
 *   `rangePx × rangeFactor` of travel. One rule for every projectile: wizard autos and arrows
 *   alike take `CombatTuning.projectileRangeFactor` (GDD §3 gives 1.2 for autos; arrows use the same
 *   factor, GDD §12). If `aimAt` equals `from`, it flies along +x.
 * - `stepProjectile(p, dtMs, bodies)`: one frame. The move is swept as a segment, so no speed or
 *   frame rate tunnels through a body. It hits the first body of the opposing team it overlaps
 *   along the way (circle vs circle, projectile radius + body radius); bodies touched at the same
 *   point of the path resolve by lowest EntityId (GDD §0). Squad shots hit `enemy` bodies, enemy
 *   shots hit `squad` bodies; own team and `neutral` (kegs) are passed through, and dead bodies are
 *   never hit (D4). On a hit the projectile stops at the contact point.
 *
 * The shooter is not consulted after creation: a projectile from a dead shooter still resolves
 * (GDD §3), carrying the shooter's id as the hit's source. Collision tiles come with M7's tilemap.
 */
import type { DamageSourceDef, EntityId, ProjectileAttackDef, Team, Vec2 } from '@core/types';
import { add, normalize, scale, sub } from '@core/math/vec2';

export interface Projectile {
  readonly id: EntityId;
  readonly ownerId: EntityId;
  /** The shooter's team at fire time. */
  readonly team: Team;
  readonly position: Vec2;
  /** Unit vector. */
  readonly direction: Vec2;
  readonly speedPxPerS: number;
  readonly radiusPx: number;
  readonly travelledPx: number;
  readonly maxTravelPx: number;
  /** What the hit does (damage, element, knockback, status). */
  readonly source: DamageSourceDef;
}

export interface ProjectileSpec {
  readonly id: EntityId;
  readonly ownerId: EntityId;
  readonly team: Team;
  readonly from: Vec2;
  readonly aimAt: Vec2;
  readonly attack: ProjectileAttackDef;
  /** CombatTuning.projectileRangeFactor. */
  readonly rangeFactor: number;
}

export interface ProjectileBody {
  readonly id: EntityId;
  readonly team: Team;
  readonly position: Vec2;
  readonly bodyRadiusPx: number;
  readonly alive: boolean;
}

export interface ProjectileStep {
  readonly projectile: Projectile;
  /** The body hit this step, or null. Remove the projectile on a hit. */
  readonly hit: EntityId | null;
  /** Reached max travel without hitting. Remove the projectile. */
  readonly expired: boolean;
}

/** Float slack when comparing contact distances along the path (not a tuning value). */
const EPSILON_PX = 1e-9;
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

export function createProjectile(spec: ProjectileSpec): Projectile {
  const aim = sub(spec.aimAt, spec.from);
  const direction = aim.x === 0 && aim.y === 0 ? FALLBACK_DIRECTION : normalize(aim);
  return {
    id: spec.id,
    ownerId: spec.ownerId,
    team: spec.team,
    position: spec.from,
    direction,
    speedPxPerS: spec.attack.projectileSpeed,
    radiusPx: spec.attack.projectileRadiusPx,
    travelledPx: 0,
    maxTravelPx: spec.attack.rangePx * spec.rangeFactor,
    source: spec.attack,
  };
}

/** One frame of flight. See the module comment for the hit rules. */
export function stepProjectile(
  p: Projectile,
  dtMs: number,
  bodies: readonly ProjectileBody[],
): ProjectileStep {
  const stepPx = Math.max(
    0,
    Math.min((p.speedPxPerS * dtMs) / 1000, p.maxTravelPx - p.travelledPx),
  );
  let hit: EntityId | null = null;
  let hitAt = Number.POSITIVE_INFINITY;
  const opposing = opposingTeam(p.team);
  for (const body of bodies) {
    if (!body.alive || body.team !== opposing) continue;
    const t = contactAlong(
      p.position,
      p.direction,
      stepPx,
      body.position,
      p.radiusPx + body.bodyRadiusPx,
    );
    if (t === null) continue;
    if (
      t < hitAt - EPSILON_PX ||
      (Math.abs(t - hitAt) <= EPSILON_PX && hit !== null && body.id < hit)
    ) {
      hit = body.id;
      hitAt = t;
    }
  }
  const moved = hit === null ? stepPx : hitAt;
  const projectile: Projectile = {
    ...p,
    position: add(p.position, scale(p.direction, moved)),
    travelledPx: p.travelledPx + moved,
  };
  return {
    projectile,
    hit,
    expired: hit === null && projectile.travelledPx >= p.maxTravelPx - EPSILON_PX,
  };
}

/** Squad shots hit enemies and enemy shots hit the squad. Neutral shooters hit nothing. */
function opposingTeam(team: Team): Team | null {
  if (team === 'squad') return 'enemy';
  if (team === 'enemy') return 'squad';
  return null;
}

/**
 * Distance along the ray (origin, unit dir) at which a point comes within `reach` of `centre`, if
 * that happens within [0, maxPx]. 0 when it already overlaps at the start.
 */
function contactAlong(
  origin: Vec2,
  dir: Vec2,
  maxPx: number,
  centre: Vec2,
  reach: number,
): number | null {
  const f = sub(origin, centre);
  const c = f.x * f.x + f.y * f.y - reach * reach;
  if (c <= 0) return 0;
  const b = f.x * dir.x + f.y * dir.y;
  if (b >= 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t <= maxPx ? t : null;
}
