import { describe, expect, it } from 'vitest';
import type { EntityId, MageClassId, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import { distance } from '@core/math/vec2';
import { createRng } from '@core/rng/rng';
import { spellSlots } from '@core/spells/availability';
import { createSquad, type SquadState } from '@core/squad/squad';
import { killUnit } from '@core/combat/death';
import { resolveUnitHit } from '@core/combat/reactions';
import { CombatWorld } from '@core/combat/world';
import {
  activateVolunteer,
  createVolunteer,
  detachVolunteer,
  detonateFallen,
  pickBark,
  pickVolunteer,
  stepVolunteers,
  volunteerBlast,
  volunteerCooldownMs,
  type Detonation,
  type VolunteerState,
} from '@core/squad/volunteer';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { REACTIONS } from '@data/reactions';
import { STATUSES } from '@data/statuses';
import { MOVEMENT } from '@data/movement';
import { SPELLS, SPELL_TUNING } from '@data/spells';
import { TRAIL } from '@data/trail';
import { P, S, VOLUNTEER_TUNING as V } from '../convergence/fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const FPS = [30, 60, 144] as const;
const LEADER_AT = v(1000, 1000);
const R = MOVEMENT.wizardBodyRadiusPx;

const squadOf = (size: number): SquadState =>
  createSquad(
    {
      ids: Array.from({ length: size }, (_, i) => id(i + 1)),
      leaderPosition: LEADER_AT,
      behind: v(0, 1),
    },
    TRAIL,
  );
const ids = (s: SquadState) => s.members.map((m) => m.id);

const activate = (
  state: VolunteerState,
  squad: SquadState,
  aim: Vec2 | null = v(1000, 900),
  channelRunning = false,
) => activateVolunteer(state, squad, { channelRunning, aim }, V, SPELL_TUNING, TRAIL);

interface RunResult {
  readonly detonation: Detonation;
  readonly t: number;
}

/** Steps one runner until it detonates. */
function runUntilBoom(
  state: VolunteerState,
  dtMs: number,
  contacts: readonly AreaBody[] = [],
  isAlive: (id: EntityId, t: number) => boolean = () => true,
): RunResult {
  let s = state;
  for (let t = dtMs; t < 10_000; t += dtMs) {
    const step = stepVolunteers(
      s,
      { dtMs, isAlive: (x) => isAlive(x, t), contacts, runnerRadiusPx: R },
      V,
    );
    s = step.state;
    const d = step.detonations[0];
    if (d) return { detonation: d, t };
  }
  throw new Error('never detonated');
}

describe('pickVolunteer', () => {
  it('squads of size 1–4: none for 1, else the last trail index, never the leader', () => {
    expect(pickVolunteer([])).toBeNull();
    expect(pickVolunteer([id(1)])).toBeNull();
    expect(pickVolunteer([id(1), id(2)])).toBe(2);
    expect(pickVolunteer([id(1), id(2), id(3)])).toBe(3);
    expect(pickVolunteer([id(1), id(2), id(3), id(4)])).toBe(4);
  });

  it('never the leader, whatever the ids', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const size = rng.int(1, 4);
      const roster = Array.from({ length: size }, () => id(rng.int(1, 1000)));
      const unique = [...new Set(roster)];
      const pick = pickVolunteer(unique);
      if (unique.length < 2) expect(pick).toBeNull();
      else expect(pick).toBe(unique[unique.length - 1]);
      expect(pick).not.toBe(unique[0]);
    }
  });
});

describe('detachVolunteer', () => {
  it('the follower leaves the roster; the leader and the order stay', () => {
    const squad = squadOf(4);
    const after = detachVolunteer(squad, id(4), TRAIL);
    expect(ids(after)).toEqual([1, 2, 3]);
    expect(after.members[0]).toEqual(squad.members[0]);
    expect(after.trail).toBe(squad.trail);
  });

  it('a middle follower leaves too and those behind move up a slot', () => {
    expect(ids(detachVolunteer(squadOf(4), id(2), TRAIL))).toEqual([1, 3, 4]);
  });

  it('never detaches the leader; unknown ids are a no-op', () => {
    const squad = squadOf(3);
    expect(detachVolunteer(squad, id(1), TRAIL)).toBe(squad);
    expect(detachVolunteer(squad, id(99), TRAIL)).toBe(squad);
  });
});

describe('activateVolunteer', () => {
  it('starts the last follower, detaches it and starts the cooldown', () => {
    const squad = squadOf(4);
    const r = activate(createVolunteer(), squad);
    expect(r.outcome).toEqual({
      kind: 'started',
      id: 4,
      from: squad.members[3]?.position,
      at: v(1000, 900),
    });
    expect(ids(r.squad)).toEqual([1, 2, 3]);
    expect(r.state.runners.map((x) => x.id)).toEqual([4]);
    expect(volunteerCooldownMs(r.state)).toBe(V.cooldownMs);
  });

  it('sizes 1–4: denied alone, else the last index (D1)', () => {
    expect(activate(createVolunteer(), squadOf(1)).outcome).toEqual({
      kind: 'denied',
      reason: 'alone',
    });
    for (const size of [2, 3, 4]) {
      const r = activate(createVolunteer(), squadOf(size));
      expect(r.outcome).toMatchObject({ kind: 'started', id: size });
      expect(r.squad.members[0]?.id).toBe(1);
    }
  });

  it('a wiped squad is ignored; a channel denies; cooldown denies; no aim is ignored', () => {
    const fresh = createVolunteer();
    const empty: SquadState = { ...squadOf(1), members: [] };
    expect(activate(fresh, empty).outcome).toEqual({ kind: 'ignored', reason: 'no-leader' });
    expect(activate(fresh, squadOf(4), v(0, 0), true).outcome).toEqual({
      kind: 'denied',
      reason: 'channel',
    });
    const once = activate(fresh, squadOf(4));
    expect(activate(once.state, once.squad).outcome).toEqual({
      kind: 'denied',
      reason: 'cooldown',
    });
    expect(activate(fresh, squadOf(4), null).outcome).toEqual({
      kind: 'ignored',
      reason: 'no-aim',
    });
  });

  it('a denial or ignore changes nothing', () => {
    const fresh = createVolunteer();
    const squad = squadOf(4);
    for (const r of [
      activate(fresh, squad, null),
      activate(fresh, squad, v(0, 0), true),
      activate(fresh, squadOf(1)),
    ]) {
      expect(r.state).toBe(fresh);
    }
    expect(activate(fresh, squad, null).squad).toBe(squad);
  });

  it('the aim is clamped to maxCastRangePx from the leader', () => {
    const r = activate(createVolunteer(), squadOf(2), v(1000, 0));
    expect(r.outcome).toMatchObject({ kind: 'started', at: v(1000, 1000 - 280) });
  });

  it('the aim is clamped into the walkable rect, so the sprint never leaves the arena (m1)', () => {
    const walkable = { x: 900, y: 900, width: 200, height: 300 };
    const r = activateVolunteer(
      createVolunteer(),
      squadOf(2),
      { channelRunning: false, aim: v(1000, 750), walkable },
      V,
      SPELL_TUNING,
      TRAIL,
    );
    expect(r.outcome).toMatchObject({ kind: 'started', at: v(1000, 900) });
  });

  it('the cooldown frees up after cooldownMs, within a frame, at any fps', () => {
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      let r = activate(createVolunteer(), squadOf(4));
      let t = 0;
      while (r.outcome.kind !== 'started' || t === 0) {
        t += dtMs;
        const state = stepVolunteers(
          r.state,
          { dtMs, isAlive: () => false, contacts: [], runnerRadiusPx: R },
          V,
        ).state;
        r = activate(state, r.squad);
        if (r.outcome.kind === 'denied') expect(r.outcome.reason).toBe('cooldown');
      }
      expect(t).toBeGreaterThanOrEqual(V.cooldownMs - 1e-6);
      expect(t).toBeLessThan(V.cooldownMs + dtMs);
    }
  });
});

describe('spell loss on activation (GDD §5 Verify)', () => {
  const available = (classes: readonly MageClassId[]) =>
    spellSlots(classes, CLASSES, SPELLS)
      .filter((s) => s.available)
      .map((s) => s.spell);

  /** Volunteers `times` times, ignoring the cooldown; returns the living classes after each. */
  function volunteer(classes: readonly MageClassId[], times: number): MageClassId[][] {
    const classOf = new Map(classes.map((c, i) => [id(i + 1), c]));
    let squad = squadOf(classes.length);
    const after: MageClassId[][] = [];
    for (let i = 0; i < times; i++) {
      const r = activate(createVolunteer(), squad);
      squad = r.squad;
      after.push(squad.members.flatMap((m) => classOf.get(m.id) ?? []));
    }
    return after;
  }

  it('P,S,P,S volunteering twice keeps both spells', () => {
    const steps = volunteer([P, S, P, S], 2);
    expect(steps.map(available)).toEqual([
      ['fireball', 'lightning'],
      ['fireball', 'lightning'],
    ]);
  });

  it('P,P,S,S volunteering twice loses Lightning at the second activation', () => {
    const steps = volunteer([P, P, S, S], 2);
    expect(steps.map(available)).toEqual([['fireball', 'lightning'], ['fireball']]);
  });

  it('P,S: the Stormcaller volunteering loses Lightning at once', () => {
    expect(volunteer([P, S], 1).map(available)).toEqual([['fireball']]);
  });
});

describe('stepVolunteers', () => {
  /** A runner at the leader's last follower, sprinting at `aim`. */
  const started = (aim: Vec2, size = 2) => activate(createVolunteer(), squadOf(size), aim).state;
  const runnerStart = squadOf(2).members[1]?.position ?? v(0, 0);

  it('arrives at the aim point exactly, at distance / sprintSpeed, at any fps', () => {
    const aim = v(1000, 900);
    const expectedMs = (distance(runnerStart, aim) / V.sprintSpeed) * 1000;
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      const { detonation, t } = runUntilBoom(started(aim), dtMs);
      expect(detonation).toEqual({ id: 2, at: aim, reason: 'arrived' });
      expect(t).toBeGreaterThanOrEqual(expectedMs - 1e-6);
      expect(t).toBeLessThan(expectedMs + dtMs);
    }
  });

  it('the fuse goes at fuseMs, at the same point at any fps', () => {
    const aim = v(1000, 720); // 280 px from the leader, 306 from the runner: farther than 270
    const along = (V.sprintSpeed * V.fuseMs) / 1000;
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      const { detonation, t } = runUntilBoom(started(aim), dtMs);
      expect(detonation.reason).toBe('fuse');
      expect(detonation.at.x).toBeCloseTo(1000, 6);
      expect(detonation.at.y).toBeCloseTo(runnerStart.y - along, 6);
      expect(t).toBeGreaterThanOrEqual(V.fuseMs - 1e-6);
      expect(t).toBeLessThan(V.fuseMs + dtMs);
    }
  });

  it('touching an enemy detonates at the touching point, swept, at any fps', () => {
    const goblin: AreaBody = { id: id(10), position: v(1000, 900), bodyRadiusPx: 12, alive: true };
    for (const fps of FPS) {
      const { detonation } = runUntilBoom(started(v(1000, 800)), 1000 / fps, [goblin]);
      expect(detonation.reason).toBe('contact');
      expect(distance(detonation.at, goblin.position)).toBeCloseTo(R + 12, 6);
      expect(detonation.at.x).toBeCloseTo(1000, 6);
    }
  });

  it('a long frame cannot tunnel through an enemy', () => {
    const goblin: AreaBody = { id: id(10), position: v(1000, 950), bodyRadiusPx: 4, alive: true };
    const { detonation, t } = runUntilBoom(started(v(1000, 800)), 500, [goblin]);
    expect(t).toBe(500);
    expect(detonation.reason).toBe('contact');
    expect(detonation.at.y).toBeCloseTo(950 + R + 4, 6);
  });

  it('a runner already touching an enemy goes off on the first step, where it stands', () => {
    const goblin: AreaBody = {
      id: id(10),
      position: { x: runnerStart.x + 15, y: runnerStart.y },
      bodyRadiusPx: 12,
      alive: true,
    };
    const { detonation, t } = runUntilBoom(started(v(1000, 800)), 1000 / 60, [goblin]);
    expect(detonation).toEqual({ id: 2, at: runnerStart, reason: 'contact' });
    expect(t).toBeCloseTo(1000 / 60);
  });

  it('dead bodies are not contacts; a body beside the path is not touched', () => {
    const dead: AreaBody = { id: id(10), position: v(1000, 900), bodyRadiusPx: 12, alive: false };
    const beside: AreaBody = { id: id(11), position: v(1023, 900), bodyRadiusPx: 12, alive: true };
    const { detonation } = runUntilBoom(started(v(1000, 850)), 1000 / 60, [dead, beside]);
    expect(detonation.reason).toBe('arrived');
  });

  it('death mid-sprint still detonates, where it fell (D1)', () => {
    const dtMs = 1000 / 60;
    let s = started(v(1000, 720));
    let last: Vec2 | undefined;
    for (let i = 0; i < 30; i++) {
      s = stepVolunteers(
        s,
        { dtMs, isAlive: () => true, contacts: [], runnerRadiusPx: R },
        V,
      ).state;
      last = s.runners[0]?.position;
    }
    const step = stepVolunteers(
      s,
      { dtMs, isAlive: () => false, contacts: [], runnerRadiusPx: R },
      V,
    );
    expect(step.detonations).toEqual([{ id: 2, at: last, reason: 'death' }]);
    expect(step.state.runners).toEqual([]);
  });

  it('a zero or negative dt changes nothing', () => {
    const s = started(v(1000, 900));
    for (const dtMs of [0, -5]) {
      expect(
        stepVolunteers(s, { dtMs, isAlive: () => true, contacts: [], runnerRadiusPx: R }, V),
      ).toEqual({ state: s, detonations: [] });
    }
  });

  it('an aim on the runner itself arrives at once', () => {
    const s = started(runnerStart);
    const { detonation } = runUntilBoom(s, 1000 / 60);
    expect(detonation).toEqual({ id: 2, at: runnerStart, reason: 'arrived' });
  });
});

describe('volunteerBlast', () => {
  it('hits enemy units and huts only, credited to the volunteer', () => {
    const e = volunteerBlast({ id: id(4), at: v(5, 6), reason: 'fuse' }, V);
    expect(e).toEqual({ centre: v(5, 6), blast: V.blast, sourceId: 4, teams: ['enemy'] });
  });
});

describe('pickBark', () => {
  it('never repeats the last line and reaches every other one', () => {
    const rng = createRng(5);
    let last: number | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const next = pickBark(12, rng, last);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(12);
      seen.add(next);
      last = next;
    }
    expect(seen.size).toBe(12);
  });

  it('one bark repeats; the same seed gives the same lines; no barks throws', () => {
    expect(pickBark(1, createRng(1), 0)).toBe(0);
    const a = createRng(9);
    const b = createRng(9);
    expect([0, 1, 2].map(() => pickBark(12, a, null))).toEqual(
      [0, 1, 2].map(() => pickBark(12, b, null)),
    );
    expect(() => pickBark(0, createRng(1), null)).toThrow(RangeError);
  });
});

describe('death mid-sprint (GDD §11, §14; T6 review M1)', () => {
  /** A world with the squad and one grunt; the runner marked as a volunteer, at `hp`. */
  function setup(hp: number) {
    const squad = squadOf(2);
    const world = new CombatWorld();
    for (const m of squad.members) {
      world.add({ id: m.id, team: 'squad', maxHp: CLASSES.stormcaller.maxHp, bodyRadiusPx: R });
    }
    const grunt = ENEMIES['goblin-grunt'];
    world.add({ id: id(10), team: 'enemy', maxHp: grunt.maxHp, bodyRadiusPx: grunt.bodyRadiusPx });
    const r = activate(createVolunteer(), squad, v(1000, 800));
    if (r.outcome.kind !== 'started') throw new Error('did not start');
    world.setDeathCause(r.outcome.id, 'volunteer');
    world.setHp(r.outcome.id, hp);
    const ctx = {
      world,
      statuses: STATUSES,
      gibs: GIBS,
      combust: REACTIONS.combust,
      kaboom: REACTIONS.kaboom,
      units: [],
      kegs: [],
    };
    return { world, ctx, state: r.state, runner: r.outcome.id, grunt };
  }

  it('a goblin killing the runner records one death, cause volunteer, and it goes off that frame', () => {
    const { world, ctx, state, runner, grunt } = setup(1);
    const fell = state.runners[0]?.position;
    const hit = resolveUnitHit(runner, { ...grunt.attack, sourceId: id(10) }, ctx);
    expect(hit.hit.killed).toBe(true);
    if (!hit.hit.killed) return;
    expect(hit.hit.death).toEqual({
      id: runner,
      team: 'squad',
      cause: 'volunteer',
      deathVariant: 'blood',
      gibbed: false,
    });
    // Same frame, before the flush: it detonates where it fell, and the kill is not repeated.
    const boom = detonateFallen(state, (x) => world.isAlive(x));
    expect(boom.detonations).toEqual([{ id: runner, at: fell, reason: 'death' }]);
    expect(boom.state.runners).toEqual([]);
    expect(boom.state.cooldown).toBe(state.cooldown);
    expect(killUnit(world, runner, 'volunteer')).toBeNull();
  });

  it('a living runner does not go off; nothing changes', () => {
    const { world, state } = setup(30);
    const r = detonateFallen(state, (x) => world.isAlive(x));
    expect(r).toEqual({ state, detonations: [] });
  });

  it('only marked units die as volunteers; marking a dead unit does nothing', () => {
    const { world, ctx, grunt } = setup(30);
    world.setHp(id(1), 1);
    const leaderHit = resolveUnitHit(id(1), { ...grunt.attack, sourceId: id(10) }, ctx);
    expect(leaderHit.hit.killed && leaderHit.hit.death.cause).toBe('combat');
    world.setDeathCause(id(1), 'volunteer');
    expect(world.get(id(1))?.deathCause).toBe('combat');
  });
});
