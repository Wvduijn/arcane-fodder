import type { CollisionGrid } from '@core/world/collisionGrid';
import type { ClassDef, MageClassId, SpellDef, SpellId, SpellTuning, Vec2 } from '@core/types';
import type { IdAllocator } from '@core/ids';
import type { AreaBody } from '@core/combat/area';
import {
  castSpell,
  cooldownRemainingMs,
  createCaster,
  stepCaster,
  type CasterState,
  type PendingSpell,
} from '@core/spells/caster';
import { createSpellSlotReader, lostSpells, type SpellSlot } from '@core/spells/availability';
import { CLASSES } from '@data/classes';
import { SPELL_TUNING, SPELLS } from '@data/spells';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { SpellSlotSource, SpellSlotState } from '../hud/HudModel';
import type { GameInput, InputAction } from '../input/GameInput';
import type { FireballFlight, SpellFlightSource } from '../views/SpellFxView';
import type { CombatSystem } from './CombatSystem';
import type { EnemyRoster, StructureRoster } from './EnemyRoster';
import type { SquadSystem } from './SquadSystem';
import type { System } from './System';
import type { ChannelGate } from './VolunteerSystem';

/** Bodies other than enemy units a Fireball explodes on (kegs now, huts in M7). */
export interface SpellHitBodies {
  readonly spellHitBodies: readonly AreaBody[];
}

const SLOT_ACTIONS: readonly (readonly [1 | 2, InputAction])[] = [
  [1, 'spell1'],
  [2, 'spell2'],
];

/** Last cast and impact points, for DebugSnapshot (D2 precision). */
export interface SpellDebug {
  readonly lastCast: { readonly spell: SpellId; readonly from: Vec2; readonly at: Vec2 } | null;
  readonly lastImpact: { readonly spell: SpellId; readonly at: Vec2 } | null;
  readonly casts: number;
  readonly denied: number;
  readonly lost: readonly SpellId[];
}

export interface SpellSystemOptions {
  /** Huts (M7): included with their footprint. None when omitted. */
  readonly structures?: StructureRoster;
  /** Map blockers (M7): a Fireball explodes on the first trunk it enters. Open ground when omitted. */
  readonly collision?: CollisionGrid;
  readonly spells?: Readonly<Record<SpellId, SpellDef>>;
  readonly tuning?: SpellTuning;
  readonly classes?: Readonly<Record<MageClassId, ClassDef>>;
}

/**
 * Granted spells (GDD §4, §5) on core's caster. Frame order: after targeting, before kegs and
 * combat (M5.md). Each frame: re-derive the slots (and emit `spell:lost` for every spell that just
 * lost its last caster), step cooldowns, strikes and Fireball flights, resolve impacts, then take
 * this frame's `spell1`/`spell2` presses with `GameInput.aimWorld` (already world space; core clamps
 * it to the cast range). Presses during a Convergence channel do nothing (M6).
 *
 * Every impact is one area event through `CombatSystem.resolveArea` (enemies only: spells never
 * hurt wizards), which also runs reactions and keg triggers. Slots are derived on every read from
 * the living squad; nothing stores "has Fireball". A death also re-derives at once (on
 * `unit:died`), so `spell:lost` comes on the frame the last caster fell.
 */
export class SpellSystem implements System, SpellSlotSource, SpellFlightSource {
  private caster: CasterState;
  private readonly readSlots: (living: readonly MageClassId[]) => readonly SpellSlot[];
  private derived: readonly SpellSlot[];
  private readonly spells: Readonly<Record<SpellId, SpellDef>>;
  private readonly tuning: SpellTuning;
  private debug: SpellDebug = { lastCast: null, lastImpact: null, casts: 0, denied: 0, lost: [] };

  private readonly collision: CollisionGrid | undefined;
  private readonly structures: StructureRoster | undefined;

  constructor(
    private readonly input: GameInput,
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly combat: CombatSystem,
    private readonly extraBodies: SpellHitBodies,
    private readonly channel: ChannelGate,
    private readonly ids: IdAllocator,
    private readonly bus: EventBus,
    options: SpellSystemOptions = {},
  ) {
    this.spells = options.spells ?? SPELLS;
    this.collision = options.collision;
    this.structures = options.structures;
    this.tuning = options.tuning ?? SPELL_TUNING;
    this.caster = createCaster(this.spells);
    this.readSlots = createSpellSlotReader(options.classes ?? CLASSES, this.spells);
    this.derived = this.readSlots(this.livingClasses());
    bus.on('unit:died', this.handleDied);
  }

  /** HUD slots: availability derived now, plus the caster's cooldowns. */
  get slots(): readonly SpellSlotState[] {
    return this.readSlots(this.livingClasses()).map((slot) => ({
      slot: slot.slot,
      spell: slot.spell,
      available: slot.available,
      cooldownRemainingMs: cooldownRemainingMs(this.caster, slot.spell),
      cooldownMs: this.spells[slot.spell].cooldownMs,
    }));
  }

  get fireballs(): readonly FireballFlight[] {
    const list: FireballFlight[] = [];
    for (const p of this.caster.pending) {
      if (p.kind === 'projectile') list.push({ id: p.id, position: p.projectile.position });
    }
    return list;
  }

  /** Strikes and flights on their way, cast order (debug). */
  get pending(): readonly PendingSpell[] {
    return this.caster.pending;
  }

  get debugState(): SpellDebug {
    return this.debug;
  }

  update(dt: number): void {
    this.rederive();
    const step = stepCaster(this.caster, {
      hitBodies: this.hitBodies(),
      dtMs: dt,
      ...(this.collision ? { collision: this.collision } : {}),
    });
    this.caster = step.state;
    for (const impact of step.impacts) {
      const def = this.spells[impact.spell];
      this.bus.emit('spell:impact', { spell: impact.spell, at: impact.at });
      this.debug = { ...this.debug, lastImpact: { spell: impact.spell, at: { ...impact.at } } };
      this.combat.resolveArea({
        centre: impact.at,
        blast: def,
        sourceId: impact.sourceId,
        teams: ['enemy'],
      });
    }
    // A press during a Convergence channel is taken and dropped: blocked, no shake (GDD §10).
    for (const [slot, action] of SLOT_ACTIONS) {
      if (this.input.consume(action) && !this.channel.channelling) this.cast(slot);
    }
  }

  destroy(): void {
    this.bus.off('unit:died', this.handleDied);
  }

  private cast(slot: 1 | 2): void {
    const leader = this.squad.state.members[0] ?? null;
    const aim = this.input.aimWorld;
    const result = castSpell(
      this.caster,
      {
        slot,
        slots: this.readSlots(this.livingClasses()),
        leader: leader ? { id: leader.id, position: leader.position } : null,
        aim: aim ? { x: aim.x, y: aim.y } : null,
        nextId: () => this.ids.next(),
      },
      this.spells,
      this.tuning,
    );
    this.caster = result.state;
    const { outcome } = result;
    if (outcome.kind === 'denied') {
      this.debug = { ...this.debug, denied: this.debug.denied + 1 };
      this.bus.emit('spell:denied', { spell: outcome.spell });
    } else if (outcome.kind === 'cast') {
      const { spell, from, at } = outcome;
      this.debug = {
        ...this.debug,
        casts: this.debug.casts + 1,
        lastCast: { spell, from: { ...from }, at: { ...at } },
      };
      this.bus.emit('spell:cast', { spell, from, at });
    }
  }

  /** Diff of two derivations: `spell:lost` once per spell (GDD §5). */
  private rederive(): void {
    const next = this.readSlots(this.livingClasses());
    if (next === this.derived) return;
    const lost = lostSpells(this.derived, next);
    this.derived = next;
    for (const spell of lost) {
      this.debug = { ...this.debug, lost: [...this.debug.lost, spell] };
      this.bus.emit('spell:lost', { spell });
    }
  }

  private livingClasses(): MageClassId[] {
    return this.squad.state.members.map((member) => this.squad.classOf(member.id));
  }

  /** Living enemy units plus kegs (and huts in M7): what a Fireball explodes on. */
  private hitBodies(): AreaBody[] {
    const bodies: AreaBody[] = [];
    for (const id of this.enemies.ids()) {
      const position = this.enemies.positionOf(id);
      const def = this.enemies.defOf(id);
      if (!position || !def) continue;
      bodies.push({
        id,
        position,
        bodyRadiusPx: def.bodyRadiusPx,
        alive: this.combat.isAlive(id),
      });
    }
    bodies.push(...this.extraBodies.spellHitBodies);
    bodies.push(...(this.structures?.areaBodies() ?? []));
    return bodies;
  }

  private readonly handleDied: GameEventListener<'unit:died'> = ({ team }) => {
    if (team === 'squad') this.rederive();
  };
}
