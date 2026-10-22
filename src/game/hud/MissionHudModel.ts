import type { Rect, Vec2 } from '@core/types';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { System } from '../systems/System';
import { edgeArrow, type EdgeArrowPlacement } from './edgeArrow';

/** Objective progress and the portal, as MissionSystem and PortalSystem expose them. */
export interface MissionHudSource {
  readonly targetsDestroyed: number;
  readonly targetsRequired: number;
  readonly portalPosition: Vec2;
  /** Opening or open: the arrow switches to its bright style (GDD §13 step 3). */
  readonly portalOpen: boolean;
}

/** The visible world rect (the main camera's worldView). */
export interface ViewSource {
  readonly worldView: Rect;
}

export interface HudObjectiveView {
  readonly progress: number;
  readonly required: number;
  /** Bumps on every `mission:target-destroyed`, so the widget can pulse. */
  readonly changedCount: number;
}

export interface HudPortalArrowView {
  /** Null while the portal is on screen. */
  readonly placement: EdgeArrowPlacement | null;
  readonly open: boolean;
}

export interface MissionHudView {
  readonly alive: boolean;
  readonly objective: HudObjectiveView;
  readonly arrow: HudPortalArrowView;
}

/**
 * Arrow placement in HUD px. Presentation, not tuning: the arrow sits 14 px inside the screen
 * edge and hides once the portal centre is 32 px inside the view (most of the arch is visible).
 */
const ARROW = { edgeInsetPx: 14, hideInsetPx: 32 } as const;

/**
 * Mission part of the HUD (GDD §13, readability Portal): "Huts n/2" and the off-screen portal
 * arrow, dim while sealed and bright once open. Runs in the HUD step of MissionScene's frame and
 * reads the camera view of the previous frame (the camera steps after the HUD), a one-frame lag
 * that doesn't show on an edge arrow.
 */
export class MissionHudModel implements System, MissionHudView {
  private live = true;
  private objectiveView: HudObjectiveView;
  private arrowView: HudPortalArrowView = { placement: null, open: false };
  private changed = 0;

  constructor(
    private readonly source: MissionHudSource,
    private readonly view: ViewSource,
    private readonly bus: EventBus,
  ) {
    this.objectiveView = { progress: 0, required: source.targetsRequired, changedCount: 0 };
    bus.on('mission:target-destroyed', this.handleTargetDestroyed);
    this.refresh();
  }

  get alive(): boolean {
    return this.live;
  }

  get objective(): HudObjectiveView {
    return this.objectiveView;
  }

  get arrow(): HudPortalArrowView {
    return this.arrowView;
  }

  update(): void {
    this.refresh();
  }

  destroy(): void {
    this.bus.off('mission:target-destroyed', this.handleTargetDestroyed);
    this.live = false;
    this.arrowView = { placement: null, open: false };
  }

  private refresh(): void {
    const { source } = this;
    this.objectiveView = {
      progress: source.targetsDestroyed,
      required: source.targetsRequired,
      changedCount: this.changed,
    };
    this.arrowView = {
      placement: edgeArrow(
        this.view.worldView,
        source.portalPosition,
        ARROW.edgeInsetPx,
        ARROW.hideInsetPx,
      ),
      open: source.portalOpen,
    };
  }

  private readonly handleTargetDestroyed: GameEventListener<'mission:target-destroyed'> = () => {
    this.changed++;
  };
}
