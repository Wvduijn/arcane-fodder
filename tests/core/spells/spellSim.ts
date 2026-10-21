/**
 * Headless M5 spell sim (D3, D4, D5): the dev squad in the dev arena with DEV_ENCOUNTER,
 * DEV_KEG_PACK and DEV_KEGS, driven by a script instead of a player. Same core functions and the
 * same frame order as the scene (M5.md "Frame order"):
 *   squad (leader walks to the script's target) → Spell (caster step, then this frame's press;
 *   impacts resolved through reactions, kegs lit `beforeStep`) → Keg (fuses, Kaboom, cascade) →
 *   knockback → the frame's deaths as one ascending-id batch → slot derivation and `spell:lost`.
 * Enemies stand still and wizard autos are off, so every effect in a run comes from the script.
 * The sim records what the scene would emit (casts, denials, impacts, reactions, fuses, losses).
 * M6 (convergenceSim.ts) extends it through `hooks` (SpellSimHooks): `held` and `beforeSpells` (the
 * Convergence and Volunteer steps sit between squad and spell), `extraUnits` (a sprinting
 * volunteer is a unit outside the squad), and `credit` / `onDeaths` (what the meter reads from
 * `unit:damaged` / `unit:died`).
 */
import type {
  EnemyId,
  EntityId,
  MageClassId,
  ProjectileAttackDef,
  SpellId,
  Vec2,
} from '@core/types';
import type { UnitPosition } from '@core/combat/area';
import type { Hit, HitResult } from '@core/combat/damage';
import { killUnit, resolveFrameDeaths, type DeathRecord } from '@core/combat/death';
import {
  resolveAreaWithReactions,
  resolveKaboom,
  resolveUnitHit,
  type ReactionContext,
  type ReactionOutcome,
  type ReactionResults,
} from '@core/combat/reactions';
import { applyStatus } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import { createEnemy, knockEnemy, moveEnemies, type EnemyState } from '@core/enemies/enemyMovement';
import { createIdAllocator } from '@core/ids';
import { clampToRect, insetRect } from '@core/math/movement';
import { add, distance, normalize, scale, sub } from '@core/math/vec2';
import { createSpellSlotReader, lostSpells, type SpellSlot } from '@core/spells/availability';
import {
  castSpell,
  createCaster,
  stepCaster,
  type CasterState,
  type CastOutcome,
  type SpellImpact,
} from '@core/spells/caster';
import { stepSquad } from '@core/squad/follow';
import {
  createSquad,
  killSquadMembers,
  knockSquadMember,
  type SquadState,
} from '@core/squad/squad';
import { createKeg, kegBodies, stepKegs, triggerKeg, type KegState } from '@core/structures/keg';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { DEV_ARENA, DEV_ENCOUNTER, DEV_KEG_PACK, DEV_KEGS, DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
import { SPELLS, SPELL_TUNING } from '@data/spells';
import { STATUSES } from '@data/statuses';
import { KEG } from '@data/structures';
import { TRAIL } from '@data/trail';

export interface FrameInput {
  /** Where the leader walks this frame (at squad speed); null holds still. */
  readonly moveTo?: Vec2 | null;
  /** A spell key press this frame, aimed at a world point (null: pointer never over the game). */
  readonly press?: { readonly slot: 1 | 2; readonly aim: Vec2 | null };
}

/** Extension points for the M6 sim (see the module comment). */
export interface SpellSimHooks {
  /** The squad stands still this frame (Convergence channel). */
  readonly held?: () => boolean;
  /** Steps between squad and spell (Convergence, Volunteer!). */
  readonly beforeSpells?: (dtMs: number) => void;
  /** Units outside the squad and the enemy list (a sprinting volunteer). */
  readonly extraUnits?: () => UnitPosition[];
  /** `unit:damaged` for hits with their credit (the meter). */
  readonly credit?: (hits: readonly HitResult[], source: EntityId | null) => void;
  /** `unit:died` for the frame's resolved deaths (the meter). */
  readonly onDeaths?: (deaths: readonly DeathRecord[]) => void;
}

export interface Timed<T> {
  readonly t: number;
  readonly value: T;
}

export class SpellSim {
  readonly world = new CombatWorld();
  readonly ids = createIdAllocator();
  readonly spawn: Vec2 = {
    x: DEV_ARENA.x + DEV_ARENA.width / 2,
    y: DEV_ARENA.y + DEV_ARENA.height / 2,
  };
  readonly dtMs: number;
  t = 0;
  squad: SquadState;
  enemies: EnemyState[];
  kegs: KegState[];
  caster: CasterState;
  slots: readonly SpellSlot[];

  readonly casts: Timed<CastOutcome>[] = [];
  readonly impacts: Timed<SpellImpact>[] = [];
  readonly reactions: Timed<ReactionOutcome>[] = [];
  readonly fuses: Timed<EntityId>[] = [];
  readonly deaths: Timed<DeathRecord>[] = [];
  readonly lost: Timed<SpellId>[] = [];

  protected hooks: SpellSimHooks = {};
  protected readonly classes = new Map<EntityId, MageClassId>();
  private readonly readSlots = createSpellSlotReader(CLASSES, SPELLS);
  protected readonly walkable = insetRect(DEV_ARENA, {
    top: MOVEMENT.wizardBodyRadiusPx,
    right: MOVEMENT.wizardBodyRadiusPx,
    bottom: MOVEMENT.wizardBodyRadiusPx,
    left: MOVEMENT.wizardBodyRadiusPx,
  });
  /** Deaths resolved this frame, flushed once at its end. */
  protected pendingDeaths: DeathRecord[] = [];

  /**
   * `classes`: the squad, leader first (default DEV_SQUAD's P,S,P,S). `enemyMaxHp`: per-kind HP
   * overrides (M6: 300 HP grunts stand in for M7's huts).
   */
  constructor(
    dtMs: number,
    classes: readonly MageClassId[] = DEV_SQUAD.classes,
    enemyMaxHp: Partial<Record<EnemyId, number>> = {},
  ) {
    this.dtMs = dtMs;
    const wizardIds = classes.map((cls) => {
      const id = this.ids.next();
      this.classes.set(id, cls);
      this.world.add({
        id,
        team: 'squad',
        maxHp: CLASSES[cls].maxHp,
        bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
      });
      return id;
    });
    this.squad = createSquad(
      { ids: wizardIds, leaderPosition: this.spawn, behind: { x: 0, y: 1 } },
      TRAIL,
    );
    this.enemies = [...DEV_ENCOUNTER, ...DEV_KEG_PACK].map((s) => {
      const id = this.ids.next();
      const def = ENEMIES[s.enemy];
      const maxHp = enemyMaxHp[s.enemy] ?? def.maxHp;
      this.world.add({ id, team: 'enemy', maxHp, bodyRadiusPx: def.bodyRadiusPx });
      return createEnemy(id, def, add(this.spawn, s.offset));
    });
    this.kegs = DEV_KEGS.map((k) => createKeg(this.ids.next(), add(this.spawn, k.offset)));
    this.caster = createCaster(SPELLS);
    this.slots = this.readSlots(this.livingClasses());
  }

  /** World point at an offset from the squad's spawn. */
  at(offset: Vec2): Vec2 {
    return add(this.spawn, offset);
  }

  get leader(): { readonly id: EntityId; readonly position: Vec2 } | null {
    return this.squad.members[0] ?? null;
  }

  enemyAt(offset: Vec2): EnemyState {
    const p = this.at(offset);
    const e = this.enemies.find((x) => distance(x.position, p) < 1e-6);
    if (!e) throw new Error(`No living enemy at ${JSON.stringify(offset)}`);
    return e;
  }

  kegAt(offset: Vec2): KegState {
    const p = this.at(offset);
    const k = this.kegs.find((x) => distance(x.position, p) < 1e-6);
    if (!k) throw new Error(`No keg at ${JSON.stringify(offset)}`);
    return k;
  }

  /** One frame in the scene's order. Returns the press outcome, if any. */
  frame(input: FrameInput = {}): CastOutcome | null {
    const dt = this.dtMs;
    this.t += dt;

    // Squad: the leader walks toward the target at squad speed.
    const leader = this.squad.members[0];
    if (leader) {
      let leaderPosition = leader.position;
      if (input.moveTo) {
        const gap = distance(leader.position, input.moveTo);
        const step = Math.min(gap, (MOVEMENT.squadMoveSpeed * dt) / 1000);
        if (gap > 0) {
          const dir = normalize(sub(input.moveTo, leader.position));
          leaderPosition = add(leader.position, scale(dir, step));
        }
      }
      leaderPosition = clampToRect(leaderPosition, this.walkable, 0);
      this.squad = stepSquad(
        this.squad,
        { leaderPosition, walkable: this.walkable, dtMs: dt, held: this.hooks.held?.() ?? false },
        TRAIL,
        MOVEMENT,
      );
    }

    this.hooks.beforeSpells?.(dt);

    // Spell: flights and strikes, then this frame's press.
    const step = stepCaster(this.caster, {
      hitBodies: [
        ...this.enemies.map((e) => ({
          id: e.id,
          position: e.position,
          bodyRadiusPx: ENEMIES[e.enemy].bodyRadiusPx,
          alive: this.world.isAlive(e.id),
        })),
        ...kegBodies(this.kegs, KEG, { solidOnly: true }),
      ],
      dtMs: dt,
    });
    this.caster = step.state;
    for (const impact of step.impacts) {
      this.impacts.push({ t: this.t, value: impact });
      const r = resolveAreaWithReactions(
        {
          centre: impact.at,
          blast: SPELLS[impact.spell],
          sourceId: impact.sourceId,
          teams: ['enemy'],
        },
        this.ctx(),
      );
      this.hooks.credit?.(r.area.hits, impact.sourceId);
      this.handle(r, r.area, true);
    }
    let outcome: CastOutcome | null = null;
    if (input.press) {
      const result = castSpell(
        this.caster,
        {
          slot: input.press.slot,
          slots: this.slots,
          leader: this.leader,
          aim: input.press.aim,
          nextId: () => this.ids.next(),
        },
        SPELLS,
        SPELL_TUNING,
      );
      this.caster = result.state;
      outcome = result.outcome;
      this.casts.push({ t: this.t, value: outcome });
    }

    // Keg: fuses, Kaboom, cascade (lit after the step).
    const kegStep = stepKegs(this.kegs, dt);
    this.kegs = [...kegStep.kegs];
    for (const keg of kegStep.exploded) {
      // Its own blast is `reactions[0].area`: no separate primary.
      this.handle(resolveKaboom(keg, this.ctx()), null, false);
    }

    // Knockback plays out in the next frames' movement.
    this.enemies = moveEnemies(
      this.enemies,
      this.enemies.map(() => ({ moveDirection: { x: 0, y: 0 } })),
      {
        defs: ENEMIES,
        wizards: [],
        bounds: DEV_ARENA,
        isAlive: (id) => this.world.isAlive(id),
        dtMs: dt,
      },
    );

    this.flush();
    return outcome;
  }

  /** Runs `ms` of frames with the same input each frame (a press is sent on the first only). */
  run(ms: number, input: FrameInput = {}): void {
    const frames = Math.round(ms / this.dtMs);
    for (let i = 0; i < frames; i++) {
      this.frame(i === 0 ? input : { moveTo: input.moveTo ?? null });
    }
  }

  /** Walks the leader to `target` (and a moment for the line to settle). */
  walkTo(target: Vec2, maxMs = 20_000): void {
    for (let t = 0; t < maxMs; t += this.dtMs) {
      const leader = this.leader;
      if (!leader || distance(leader.position, target) < 1e-6) break;
      this.frame({ moveTo: target });
    }
    this.run(1000);
  }

  /** Steps until the given spell is off cooldown. */
  waitForCooldown(spell: SpellId): void {
    while (this.caster.cooldowns[spell].remainingMs > 0) this.frame();
  }

  /** A wizard auto-attack landing, as CombatSystem resolves it (bolt status included). */
  autoHit(wizard: EntityId, target: EntityId): void {
    const cls = this.classes.get(wizard);
    if (!cls) throw new Error(`No wizard ${String(wizard)}`);
    const attack: ProjectileAttackDef = CLASSES[cls].attack;
    const hit: Hit = { ...attack, sourceId: wizard };
    const r = resolveUnitHit(target, hit, this.ctx());
    if (r.hit.killed) this.pendingDeaths.push(r.hit.death);
    if (r.hit.landed && !r.hit.killed && attack.applies) {
      applyStatus(this.world, target, STATUSES[attack.applies], wizard);
    }
    this.handle(r, null, false);
    this.flush();
  }

  /** Kills wizards outright (the dev K key), then flushes like the frame does. */
  killWizards(ids: readonly EntityId[]): void {
    for (const id of ids) {
      const d = killUnit(this.world, id, 'combat');
      if (d) this.pendingDeaths.push(d);
    }
    this.flush();
  }

  classOf(id: EntityId): MageClassId | undefined {
    return this.classes.get(id);
  }

  protected livingClasses(): MageClassId[] {
    return this.squad.members.flatMap((m) => {
      const cls = this.classes.get(m.id);
      return cls ? [cls] : [];
    });
  }

  protected ctx(): ReactionContext {
    const units: UnitPosition[] = [
      ...this.squad.members.map((m) => ({ id: m.id, position: m.position })),
      ...(this.hooks.extraUnits?.() ?? []),
      ...this.enemies.map((e) => ({ id: e.id, position: e.position })),
    ];
    return {
      world: this.world,
      statuses: STATUSES,
      gibs: GIBS,
      combust: REACTIONS.combust,
      kaboom: REACTIONS.kaboom,
      units,
      kegs: kegBodies(this.kegs, KEG),
    };
  }

  /** A hit's follow-ups: deaths, knockback, reactions, keg lights. */
  protected handle(
    r: ReactionResults,
    primary: { readonly knockbacks: ReactionOutcome['area']['knockbacks'] } | null,
    beforeStep: boolean,
  ): void {
    this.pendingDeaths.push(...r.deaths);
    const knockbacks = [
      ...(primary?.knockbacks ?? []),
      ...r.reactions.flatMap((x) => x.area.knockbacks),
    ];
    for (const k of knockbacks) {
      this.squad = knockSquadMember(
        this.squad,
        k.target,
        k.direction,
        k.distancePx,
        COMBAT.knockbackMs,
      );
      this.enemies = this.enemies.map((e) =>
        e.id === k.target
          ? knockEnemy(e, ENEMIES[e.enemy], k.direction, k.distancePx, COMBAT.knockbackMs)
          : e,
      );
    }
    for (const reaction of r.reactions) {
      this.reactions.push({ t: this.t, value: reaction });
      this.hooks.credit?.(reaction.area.hits, reaction.sourceId);
    }
    this.kegs = this.kegs.map((keg) => {
      if (!r.kegs.includes(keg.id)) return keg;
      const lit = triggerKeg(keg, REACTIONS.kaboom, { beforeStep });
      if (lit.started) this.fuses.push({ t: this.t, value: keg.id });
      return lit.keg;
    });
  }

  protected flush(): void {
    const resolved = resolveFrameDeaths(this.pendingDeaths);
    this.pendingDeaths = [];
    this.hooks.onDeaths?.(resolved);
    if (resolved.length > 0) {
      for (const d of resolved) this.deaths.push({ t: this.t, value: d });
      const wizards = resolved.filter((d) => d.team === 'squad').map((d) => d.id);
      if (wizards.length > 0) this.squad = killSquadMembers(this.squad, wizards, TRAIL).state;
      const enemyIds = new Set(resolved.filter((d) => d.team === 'enemy').map((d) => d.id));
      this.enemies = this.enemies.filter((e) => !enemyIds.has(e.id));
    }
    const next = this.readSlots(this.livingClasses());
    for (const spell of lostSpells(this.slots, next)) this.lost.push({ t: this.t, value: spell });
    this.slots = next;
  }
}
