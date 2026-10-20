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

/** What HudScene reads. Read-only; refreshed by the mission scene every frame. */
export interface HudView {
  /** False once the mission run shut down: the HUD stops reading. */
  readonly alive: boolean;
  readonly slots: readonly HudSlotView[];
}

/**
 * The HUD's read-only window on the mission (M5 Q3). A mission-scene system: it listens to the bus
 * and copies the caster's slots once per frame, after the spell step. HudScene runs as its own
 * scene and only reads this, so it never holds bus listeners or system references, and the bus can
 * be destroyed with the mission run before Phaser stops the HUD scene.
 */
export class HudModel implements System, HudView {
  private live = true;
  private slotViews: readonly HudSlotView[] = [];
  private readonly denied = new Map<SpellId, number>();
  private readonly lost = new Map<SpellId, number>();

  constructor(
    private readonly source: SpellSlotSource,
    private readonly bus: EventBus,
  ) {
    bus.on('spell:denied', this.handleDenied);
    bus.on('spell:lost', this.handleLost);
    this.refresh();
  }

  get alive(): boolean {
    return this.live;
  }

  get slots(): readonly HudSlotView[] {
    return this.slotViews;
  }

  update(): void {
    this.refresh();
  }

  destroy(): void {
    this.bus.off('spell:denied', this.handleDenied);
    this.bus.off('spell:lost', this.handleLost);
    this.live = false;
    this.slotViews = [];
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
  }

  private readonly handleDenied: GameEventListener<'spell:denied'> = ({ spell }) => {
    this.denied.set(spell, (this.denied.get(spell) ?? 0) + 1);
  };

  private readonly handleLost: GameEventListener<'spell:lost'> = ({ spell }) => {
    this.lost.set(spell, (this.lost.get(spell) ?? 0) + 1);
  };
}

function slotState(slot: SpellSlotState): HudSlotState {
  if (!slot.available) return 'lost';
  return slot.cooldownRemainingMs > 0 ? 'cooldown' : 'ready';
}
