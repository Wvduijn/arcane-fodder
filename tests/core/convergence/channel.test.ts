import { describe, expect, it } from 'vitest';
import type { AreaBlastDef, EntityId, MageClassId, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import {
  channelPhase,
  createConvergence,
  pendingStrikeCount,
  startChannel,
  stepConvergence,
  type ConvergenceBlast,
  type ConvergenceContext,
  type ConvergenceState,
  type ConvergenceStepInput,
  type GroundBurnTick,
  type Release,
} from '@core/convergence/channel';
import { distance } from '@core/math/vec2';
import { createRng } from '@core/rng/rng';
import { CLASSES } from '@data/classes';
import { SPELL_TUNING } from '@data/spells';
import {
  COMPOSITIONS,
  CONVERGENCE_DEFS,
  FIRESTORM,
  METEOR,
  P,
  S,
  THUNDERSTORM,
  TUNING,
} from './fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const FPS = [30, 60, 144] as const;
const STRIKE_ID = id(900);
const REACTION_ID = id(901);
const LEADER = { id: id(1), position: v(0, 0) };
const AIM = v(100, 0);
const EPS = 1e-6;

const ctxOf = (seed = 1): ConvergenceContext => ({
  defs: CONVERGENCE_DEFS,
  classes: CLASSES,
  tuning: TUNING,
  spells: SPELL_TUNING,
  ids: { sourceId: STRIKE_ID, reactionSourceId: REACTION_ID },
  rng: createRng(seed),
});

const started = (aim: Vec2 = AIM, leader = LEADER): ConvergenceState => {
  const r = startChannel(createConvergence(), { meterFull: true, leader, aim }, SPELL_TUNING);
  if (r.outcome.kind !== 'started') throw new Error('did not start');
  return r.state;
};

interface Frame {
  readonly t: number;
  readonly released: Release | null;
  readonly cancelled: boolean;
  readonly blasts: readonly ConvergenceBlast[];
  readonly burns: readonly GroundBurnTick[];
}

/** Steps `ms` of frames; `input(t)` may change the leader, aim, living classes or targets. */
function run(
  state: ConvergenceState,
  ms: number,
  dtMs: number,
  input: (t: number) => Partial<ConvergenceStepInput> = () => ({}),
  ctx = ctxOf(),
): { state: ConvergenceState; frames: Frame[] } {
  let s = state;
  const frames: Frame[] = [];
  for (let t = dtMs; t <= ms + EPS; t += dtMs) {
    const step = stepConvergence(
      s,
      {
        dtMs,
        leader: LEADER,
        aim: AIM,
        livingClasses: [P, S, P, S],
        targets: [],
        ...input(t),
      },
      ctx,
    );
    s = step.state;
    frames.push({ t, ...step });
  }
  return { state: s, frames };
}

const releaseOf = (frames: readonly Frame[]) => {
  const f = frames.find((x) => x.released);
  if (!f?.released) throw new Error('no release');
  return { t: f.t, released: f.released };
};
const blastsOf = (frames: readonly Frame[]) =>
  frames.flatMap((f) => f.blasts.map((b) => ({ t: f.t, ...b })));

describe('startChannel (GDD §10 Activate)', () => {
  const fresh = createConvergence();
  const press = (
    state: ConvergenceState,
    meterFull: boolean,
    leader = LEADER,
    aim: Vec2 | null = AIM,
  ) => startChannel(state, { meterFull, leader, aim }, SPELL_TUNING);

  it('starts with a full meter, a leader and an aim; the aim is clamped to 280 px', () => {
    const r = press(fresh, true, LEADER, v(1000, 0));
    expect(r.outcome).toEqual({ kind: 'started', leader: 1, aim: v(280, 0) });
    expect(channelPhase(r.state)).toBe('channeling');
  });

  it('gate order: no leader → ignored, channeling → denied, not full → denied, no aim → ignored', () => {
    expect(
      startChannel(fresh, { meterFull: true, leader: null, aim: AIM }, SPELL_TUNING).outcome,
    ).toEqual({ kind: 'ignored', reason: 'no-leader' });
    expect(press(started(), true).outcome).toEqual({ kind: 'denied', reason: 'channeling' });
    expect(press(fresh, false).outcome).toEqual({ kind: 'denied', reason: 'not-full' });
    expect(press(fresh, false, LEADER, null).outcome).toEqual({
      kind: 'denied',
      reason: 'not-full',
    });
    expect(press(fresh, true, LEADER, null).outcome).toEqual({ kind: 'ignored', reason: 'no-aim' });
  });

  it('a refused press changes nothing', () => {
    expect(press(fresh, false).state).toBe(fresh);
    expect(press(fresh, true, LEADER, null).state).toBe(fresh);
  });

  it('strikes still landing from an earlier channel do not block a new one', () => {
    const { state } = run(started(), 1300, 1000 / 60);
    expect(channelPhase(state)).toBe('striking');
    expect(press(state, true).outcome.kind).toBe('started');
  });
});

describe('stepConvergence: the channel', () => {
  it('releases on the frame channelMs has fully elapsed, at 30/60/144 fps', () => {
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      const { frames } = run(started(), 1500, dtMs);
      const { t } = releaseOf(frames);
      expect(t).toBeGreaterThanOrEqual(TUNING.channelMs - EPS);
      expect(t).toBeLessThan(TUNING.channelMs + dtMs);
      expect(frames.filter((f) => f.released)).toHaveLength(1);
    }
  });

  it.each(COMPOSITIONS)(
    '%s alive at release → %s ×%d, every blast damage × power (D1)',
    (_name, classes, combo, power) => {
      const { frames } = run(started(), 5000, 1000 / 60, () => ({ livingClasses: classes }));
      expect(releaseOf(frames).released).toEqual({ combo, power, at: AIM });
      const def = CONVERGENCE_DEFS.find((d) => d.id === combo);
      const base =
        def?.pattern.kind === 'impact'
          ? [def.pattern.blast]
          : (def?.pattern.strikes.map((s) => s.blast) ?? []);
      const blasts = blastsOf(frames);
      expect(blasts).toHaveLength(base.length);
      expect(blasts.every((b) => b.combo === combo)).toBe(true);
      expect(blasts.map((b) => b.event.blast.damage).sort((a, b) => a - b)).toEqual(
        base.map((b) => Math.round(b.damage * power)).sort((a, b) => a - b),
      );
    },
  );

  it('P,S,S with the P killed mid-channel → Thunderstorm ×1.5 (GDD §10 Verify)', () => {
    const living = (t: number): MageClassId[] => (t < 600 ? [P, S, S] : [S, S]);
    const { frames } = run(started(), 1500, 1000 / 60, (t) => ({ livingClasses: living(t) }));
    expect(releaseOf(frames).released).toMatchObject({ combo: 'thunderstorm', power: 1.5 });
  });

  it('combo and power resolve at release, not at start: a late death counts', () => {
    const { frames } = run(started(), 1500, 1000 / 60, (t) => ({
      livingClasses: t < TUNING.channelMs - 20 ? [P, P, S, S] : [P],
    }));
    expect(releaseOf(frames).released).toMatchObject({ combo: 'meteor', power: 1 });
  });

  it('the aim tracks during the channel and locks at release', () => {
    const aimAt = (t: number) =>
      t < 1000 ? v(50, 0) : t < TUNING.channelMs + 50 ? v(0, 120) : v(-200, 0);
    const { frames } = run(started(), 3500, 1000 / 60, (t) => ({
      aim: aimAt(t),
      livingClasses: [S],
    }));
    expect(releaseOf(frames).released.at).toEqual(v(0, 120));
    for (const b of blastsOf(frames)) {
      expect(distance(b.event.centre, v(0, 120))).toBeLessThanOrEqual(THUNDERSTORM.radiusPx + EPS);
    }
  });

  it('a null aim keeps the last one; the aim is clamped to 280 px from the leader', () => {
    const { frames } = run(started(v(50, 0)), 1500, 1000 / 60, (t) => ({
      aim: t < 500 ? v(0, -1000) : null,
    }));
    expect(releaseOf(frames).released.at).toEqual(v(0, -280));
  });

  it('leader death mid-channel: the channel goes on, the aim re-clamps to the new leader (GDD Q4)', () => {
    const next = { id: id(2), position: v(0, 26) };
    const { frames } = run(started(v(0, -280)), 1500, 1000 / 60, (t) => ({
      leader: t < 600 ? LEADER : next,
      aim: v(0, -280),
      livingClasses: t < 600 ? [P, S, P, S] : [S, P, S],
    }));
    const { released } = releaseOf(frames);
    expect(released).toMatchObject({ combo: 'firestorm', power: 2 });
    expect(released.at.x).toBeCloseTo(0, 9);
    expect(released.at.y).toBeCloseTo(26 - 280, 9);
    expect(frames.some((f) => f.cancelled)).toBe(false);
  });

  it('damage never interrupts: only a wipe cancels, and nothing resolves (ADR 0005 Q1)', () => {
    const { frames, state } = run(started(), 3000, 1000 / 60, (t) => ({
      leader: t < 700 ? LEADER : null,
      livingClasses: t < 700 ? [P] : [],
    }));
    expect(frames.filter((f) => f.cancelled)).toHaveLength(1);
    expect(frames.some((f) => f.released)).toBe(false);
    expect(blastsOf(frames)).toEqual([]);
    expect(channelPhase(state)).toBe('idle');
  });

  it('no combo for the living classes cancels (data without a match)', () => {
    const ctx = { ...ctxOf(), defs: [METEOR] };
    const { frames } = run(started(), 1500, 1000 / 60, () => ({ livingClasses: [S] }), ctx);
    expect(frames.filter((f) => f.cancelled)).toHaveLength(1);
    expect(blastsOf(frames)).toEqual([]);
  });

  it('a zero or negative dt changes nothing', () => {
    const s = started();
    for (const dtMs of [0, -16]) {
      const r = stepConvergence(
        s,
        { dtMs, leader: LEADER, aim: AIM, livingClasses: [P], targets: [] },
        ctxOf(),
      );
      expect(r).toEqual({ state: s, released: null, cancelled: false, blasts: [], burns: [] });
    }
  });
});

describe('stepConvergence: strike timelines (30/60/144 fps)', () => {
  /** Each blast lands on the first frame at or after release + atMs, at any fps. */
  function expectOnTime(living: readonly MageClassId[], atMs: readonly number[]) {
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      const { frames } = run(started(), 7000, dtMs, () => ({ livingClasses: living }));
      const times = blastsOf(frames).map((b) => b.t);
      expect(times).toHaveLength(atMs.length);
      [...atMs]
        .sort((a, b) => a - b)
        .forEach((a, i) => {
          const due = TUNING.channelMs + a;
          expect(times[i]).toBeGreaterThanOrEqual(due - EPS);
          expect(times[i]).toBeLessThan(due + dtMs);
        });
    }
  }

  it('Meteor: one impact fallMs after release, at the locked aim', () => {
    expectOnTime([P], [METEOR.pattern.fallMs]);
    const { frames } = run(started(), 2000, 1000 / 60, () => ({ livingClasses: [P] }));
    expect(blastsOf(frames)[0]?.event.centre).toEqual(AIM);
  });

  it('Thunderstorm: 10 bolts every 200 ms from release', () => {
    expectOnTime(
      [S],
      THUNDERSTORM.pattern.strikes.map((s) => s.atMs),
    );
  });

  it('Firestorm: 6 meteorlets and 8 bolts on their marks', () => {
    expectOnTime(
      [P, S],
      FIRESTORM.pattern.strikes.map((s) => s.atMs),
    );
  });

  it('Firestorm ties: the meteorlet lands before the bolt at 600 and 1200 ms', () => {
    for (const fps of FPS) {
      const { frames } = run(started(), 5000, 1000 / fps, () => ({ livingClasses: [P, S] }));
      const elements = blastsOf(frames).map((b) => b.event.blast.element);
      expect(elements).toEqual([
        'fire',
        'fire',
        'storm',
        'fire',
        'storm',
        'storm',
        'fire',
        'storm',
        'fire',
        'storm',
        'storm',
        'fire',
        'storm',
        'storm',
      ]);
    }
  });

  it('every blast: enemy teams only, both credit ids, radius and knockback untouched', () => {
    const { frames } = run(started(), 5000, 1000 / 60, () => ({ livingClasses: [P, P, S, S] }));
    for (const b of blastsOf(frames)) {
      expect(b.event.teams).toEqual(['enemy']);
      expect(b.element).toBe(b.event.blast.element);
      expect(b.event.sourceId).toBe(STRIKE_ID);
      expect(b.event.reactionSourceId).toBe(REACTION_ID);
      const base: { readonly blast: AreaBlastDef } | undefined = FIRESTORM.pattern.strikes.find(
        (s) => s.blast.element === b.event.blast.element,
      );
      expect(b.event.blast.radiusPx).toBe(base?.blast.radiusPx);
      expect(b.event.blast.knockbackPx).toBe(base?.blast.knockbackPx);
      expect(b.event.blast.applies).toBe(base?.blast.applies);
    }
  });

  it('power rounds to whole HP, halves up (35 × 2.5 = 88)', () => {
    const { frames } = run(started(), 5000, 1000 / 60, () => ({ livingClasses: [P, P, S, S] }));
    const damages = new Set(blastsOf(frames).map((b) => b.event.blast.damage));
    expect([...damages].sort((a, b) => a - b)).toEqual([38, 88]);
  });

  it('pendingStrikeCount counts down to 0; the phase goes back to idle', () => {
    let s = started();
    expect(pendingStrikeCount(s)).toBe(0);
    s = run(s, TUNING.channelMs + 1, 1000 / 60, () => ({ livingClasses: [S] })).state;
    expect(channelPhase(s)).toBe('striking');
    expect(pendingStrikeCount(s)).toBe(9);
    s = run(s, 2000, 1000 / 60, () => ({ livingClasses: [S] })).state;
    expect(pendingStrikeCount(s)).toBe(0);
    expect(channelPhase(s)).toBe('idle');
  });

  it('one huge frame lands the whole timeline in order (hitch)', () => {
    const r = stepConvergence(
      started(),
      { dtMs: 5000, leader: LEADER, aim: AIM, livingClasses: [S], targets: [] },
      ctxOf(),
    );
    expect(r.released).toMatchObject({ combo: 'thunderstorm' });
    expect(r.blasts).toHaveLength(10);
    expect(channelPhase(r.state)).toBe('idle');
  });
});

describe('stepConvergence: barrage target picks (seeded)', () => {
  const goblin = (n: number, at: Vec2, alive = true): AreaBody => ({
    id: id(n),
    position: at,
    bodyRadiusPx: 12,
    alive,
  });

  it('each strike lands on a living target the ring touches', () => {
    const inside = [goblin(10, v(100, 50)), goblin(11, v(150, 0)), goblin(12, v(100 - 131, 0))];
    const outside = [goblin(13, v(100 + 133, 0)), goblin(14, v(100, 10), false)];
    const { frames } = run(started(), 5000, 1000 / 60, () => ({
      livingClasses: [S],
      targets: [...inside, ...outside],
    }));
    const centres = blastsOf(frames).map((b) => b.event.centre);
    expect(centres).toHaveLength(10);
    for (const c of centres) expect(inside.map((g) => g.position)).toContainEqual(c);
    expect(new Set(centres.map((c) => `${String(c.x)},${String(c.y)}`)).size).toBeGreaterThan(1);
  });

  it('with no target in range, a random point inside the ring', () => {
    const { frames } = run(started(), 5000, 1000 / 60, () => ({ livingClasses: [P, S] }));
    const centres = blastsOf(frames).map((b) => b.event.centre);
    expect(centres).toHaveLength(14);
    for (const c of centres) expect(distance(c, AIM)).toBeLessThanOrEqual(FIRESTORM.radiusPx + EPS);
    expect(new Set(centres.map((c) => c.x)).size).toBe(14);
  });

  it('the same seed gives the same strikes; another seed differs', () => {
    const targets = [goblin(10, v(100, 50)), goblin(11, v(150, 0)), goblin(12, v(60, -40))];
    const centres = (seed: number) =>
      blastsOf(
        run(started(), 5000, 1000 / 60, () => ({ livingClasses: [S], targets }), ctxOf(seed))
          .frames,
      ).map((b) => b.event.centre);
    expect(centres(7)).toEqual(centres(7));
    expect(centres(7)).not.toEqual(centres(8));
  });
});

describe('stepConvergence: Meteor burning ground', () => {
  it('ticks every tickMs from the impact until durationMs, at any fps; then ends', () => {
    const ground = METEOR.pattern.groundBurn;
    const impactAt = TUNING.channelMs + METEOR.pattern.fallMs;
    for (const fps of FPS) {
      const dtMs = 1000 / fps;
      const { frames, state } = run(started(), 7000, dtMs, () => ({ livingClasses: [P, P] }));
      const ticks = frames.flatMap((f) => f.burns.map((b) => ({ t: f.t, ...b })));
      expect(ticks).toHaveLength(ground.durationMs / ground.tickMs);
      ticks.forEach((tick, i) => {
        const due = impactAt + (i + 1) * ground.tickMs;
        expect(tick.t).toBeGreaterThanOrEqual(due - EPS);
        expect(tick.t).toBeLessThan(due + dtMs);
        expect(tick).toMatchObject({
          centre: AIM,
          radiusPx: ground.radiusPx,
          status: 'burning',
          sourceId: STRIKE_ID,
          teams: ['enemy'],
        });
      });
      expect(channelPhase(state)).toBe('idle');
    }
  });

  it('the ground keeps burning after a new channel starts', () => {
    let s = run(started(), 2000, 1000 / 60, () => ({ livingClasses: [P] })).state;
    const again = startChannel(s, { meterFull: true, leader: LEADER, aim: AIM }, SPELL_TUNING);
    s = again.state;
    const { frames } = run(s, 1000, 1000 / 60, () => ({ livingClasses: [P] }));
    expect(frames.flatMap((f) => f.burns).length).toBeGreaterThan(0);
    expect(channelPhase(s)).toBe('channeling');
  });
});
