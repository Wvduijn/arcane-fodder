import type { SpellId } from '@core/types';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { System } from '../systems/System';

/** One spell slot as the caster sees it this frame (SpellSystem implements the source). */
export interface SpellSlotState {
  readonly slot: 1 | 2;
  readonly spell: SpellId;
  /** Derived from the living squad (GDD §5); false for a lost or never-granted spell. */
  readonly available: boolean;
  /** 0 when ready. */
  readonly cooldownRemainingMs: number;
  readonly cooldownMs: number;
}

export interface SpellSlotSource {
  /** Slot 1 then slot 2, fixed order from data. */
  readonly slots: readonly SpellSlotState[];
}

export type HudSlotState = 'ready' | 'cooldown' | 'lost';

export interface HudSlotView {
  readonly slot: 1 | 2;
  readonly spell: SpellId;
  readonly state: HudSlotState;
  readonly cooldownRemainingMs: number;
  readonly cooldownMs: number;
  /** `spell:denied` presses so far this run; the HUD shakes the slot when it goes up. */
  readonly deniedCount: number;
  /**
   * `spell:lost` events so far this run (0 or 1). Goes up when the slot was lost mid-mission (shake
   * and fade); a slot that starts `lost` with 0 was never granted (lost look, no animation).
   */
  readonly lostCount: number;
}

/** The Convergence meter as ConvergenceSystem holds it (it implements the source). */
export interface ConvergenceHudSource {
  /** 0..1 */
  readonly meterFraction: number;
  readonly meterFull: boolean;
  /** True while the 1.2 s channel runs (the meter was just spent). */
  readonly channelling: boolean;
}

/** Volunteer! as VolunteerSystem holds it (it implements the source). */
export interface VolunteerHudSource {
  /** Only the leader left: nobody can volunteer (readability.md §5c "Unavailable"). */
  readonly volunteerUnavailable: boolean;
  /** 0 when ready. */
  readonly volunteerCooldownRemainingMs: number;
  readonly volunteerCooldownMs: number;
}

export interface HudMeterView {
  readonly fraction: number;
  readonly full: boolean;
  readonly channelling: boolean;
  /** `convergence:denied` presses so far this run; the HUD shakes the meter when it goes up. */
  readonly deniedCount: number;
  /** `convergence:charged` so far this run; the border flashes when it goes up (§5c). */
  readonly chargedCount: number;
  /** `convergence:channel-started` so far this run; the spent ghost plays when it goes up. */
  readonly spentCount: number;
}

export type HudVolunteerState = 'ready' | 'cooldown' | 'unavailable';

export interface HudVolunteerView {
  readonly state: HudVolunteerState;
  readonly cooldownRemainingMs: number;
  readonly cooldownMs: number;
  /** `volunteer:denied` presses so far this run; the HUD shakes the icon when it goes up. */
  readonly deniedCount: number;
}

/** What HudScene reads. Read-only; refreshed by the mission scene every frame. */
export interface HudView {
  /** False once the mission run shut down: the HUD stops reading. */
  readonly alive: boolean;
  readonly slots: readonly HudSlotView[];
  readonly meter: HudMeterView;
  readonly volunteer: HudVolunteerView;
}

const EMPTY_METER: HudMeterView = {
  fraction: 0,
  full: false,
  channelling: false,
  deniedCount: 0,
  chargedCount: 0,
  spentCount: 0,
};

const NO_VOLUNTEER: HudVolunteerView = {
  state: 'unavailable',
  cooldownRemainingMs: 0,
  cooldownMs: 0,
  deniedCount: 0,
};

/**
 * The HUD's read-only window on the mission (M5 Q3). A mission-scene system: it listens to the bus
 * and copies the caster's slots, the Convergence meter and the Volunteer! state once per frame,
 * after the spell step. HudScene runs as its own
 * scene and only reads this, so it never holds bus listeners or system references, and the bus can
 * be destroyed with the mission run before Phaser stops the HUD scene.
 */
export class HudModel implements System, HudView {
  private live = true;
  private slotViews: readonly HudSlotView[] = [];
  private meterView: HudMeterView = EMPTY_METER;
  private volunteerView: HudVolunteerView = NO_VOLUNTEER;
  private readonly denied = new Map<SpellId, number>();
  private readonly lost = new Map<SpellId, number>();
  private meterDenied = 0;
  private meterCharged = 0;
  private meterSpent = 0;
  private volunteerDenied = 0;

  constructor(
    private readonly source: SpellSlotSource,
    private readonly convergenceSource: ConvergenceHudSource,
    private readonly volunteerSource: VolunteerHudSource,
    private readonly bus: EventBus,
  ) {
    bus.on('spell:denied', this.handleDenied);
    bus.on('spell:lost', this.handleLost);
    bus.on('convergence:denied', this.handleMeterDenied);
    bus.on('convergence:charged', this.handleCharged);
    bus.on('convergence:channel-started', this.handleSpent);
    bus.on('volunteer:denied', this.handleVolunteerDenied);
    this.refresh();
  }

  get alive(): boolean {
    return this.live;
  }

  get slots(): readonly HudSlotView[] {
    return this.slotViews;
  }

  get meter(): HudMeterView {
    return this.meterView;
  }

  get volunteer(): HudVolunteerView {
    return this.volunteerView;
  }

  update(): void {
    this.refresh();
  }

  destroy(): void {
    this.bus.off('spell:denied', this.handleDenied);
    this.bus.off('spell:lost', this.handleLost);
    this.bus.off('convergence:denied', this.handleMeterDenied);
    this.bus.off('convergence:charged', this.handleCharged);
    this.bus.off('convergence:channel-started', this.handleSpent);
    this.bus.off('volunteer:denied', this.handleVolunteerDenied);
    this.live = false;
    this.slotViews = [];
    this.meterView = EMPTY_METER;
    this.volunteerView = NO_VOLUNTEER;
    this.denied.clear();
    this.lost.clear();
  }

  private refresh(): void {
    this.slotViews = this.source.slots.map((slot) => ({
      slot: slot.slot,
      spell: slot.spell,
      state: slotState(slot),
      cooldownRemainingMs: slot.cooldownRemainingMs,
      cooldownMs: slot.cooldownMs,
      deniedCount: this.denied.get(slot.spell) ?? 0,
      lostCount: this.lost.get(slot.spell) ?? 0,
    }));
    const { meterFraction, meterFull, channelling } = this.convergenceSource;
    this.meterView = {
      fraction: meterFraction,
      full: meterFull,
      channelling,
      deniedCount: this.meterDenied,
      chargedCount: this.meterCharged,
      spentCount: this.meterSpent,
    };
    const { volunteerUnavailable, volunteerCooldownRemainingMs, volunteerCooldownMs } =
      this.volunteerSource;
    this.volunteerView = {
      state: volunteerUnavailable
        ? 'unavailable'
        : volunteerCooldownRemainingMs > 0
          ? 'cooldown'
          : 'ready',
      cooldownRemainingMs: volunteerCooldownRemainingMs,
      cooldownMs: volunteerCooldownMs,
      deniedCount: this.volunteerDenied,
    };
  }

  private readonly handleDenied: GameEventListener<'spell:denied'> = ({ spell }) => {
    this.denied.set(spell, (this.denied.get(spell) ?? 0) + 1);
  };

  private readonly handleLost: GameEventListener<'spell:lost'> = ({ spell }) => {
    this.lost.set(spell, (this.lost.get(spell) ?? 0) + 1);
  };

  private readonly handleMeterDenied: GameEventListener<'convergence:denied'> = () => {
    this.meterDenied++;
  };

  private readonly handleCharged: GameEventListener<'convergence:charged'> = () => {
    this.meterCharged++;
  };

  private readonly handleSpent: GameEventListener<'convergence:channel-started'> = () => {
    this.meterSpent++;
  };

  private readonly handleVolunteerDenied: GameEventListener<'volunteer:denied'> = () => {
    this.volunteerDenied++;
  };
}

function slotState(slot: SpellSlotState): HudSlotState {
  if (!slot.available) return 'lost';
  return slot.cooldownRemainingMs > 0 ? 'cooldown' : 'ready';
}
