import Phaser from 'phaser';
import type { Rect, Vec2 } from '@core/types';
import { MOVEMENT } from '@data/movement';
import { Depth } from '../depths';
import type { Positioned } from '../entities/Positioned';
import type { GameInput } from '../input/GameInput';
import type { System } from '../systems/System';
import type { CameraController } from '../world/CameraController';

/** Read-only view of the debug state, for the overlay and for automated playtests. */
export interface DebugSnapshot {
  readonly visible: boolean;
  readonly fps: number;
  readonly frame: number;
  readonly world: Rect;
  /** Rect the leader position is clamped to. */
  readonly walkable: Rect;
  /** Visible world area (camera.worldView). */
  readonly view: Rect;
  readonly camera: { readonly scrollX: number; readonly scrollY: number };
  readonly deadzone: Rect;
  /** Leader plus the smoothed camera look-ahead offset. */
  readonly followPoint: Vec2;
  readonly leader: Vec2;
  readonly moveVector: Vec2;
  readonly aimWorld: Vec2 | null;
  /** Pointer in game (logical) pixels, as Phaser reports it. */
  readonly pointerScreen: Vec2;
  /** Leak check: these must not grow across scene restarts. */
  readonly lifecycle: {
    readonly overlaysCreated: number;
    readonly overlaysLive: number;
    readonly pointerMoveListeners: number;
    readonly pointerDownListeners: number;
    readonly keyboardKeys: number;
    readonly keyDownListeners: number;
    readonly sceneShutdownListeners: number;
  };
}

export interface DebugHook {
  snapshot(): DebugSnapshot;
}

declare global {
  interface Window {
    /** Present only when the page was opened with ?debug. */
    __ARCANE_DEBUG__?: DebugHook;
  }
}

export interface DebugSources {
  readonly input: GameInput;
  readonly leader: Positioned;
  readonly camera: CameraController;
  readonly world: Rect;
  readonly walkable: Rect;
}

export interface DebugOptions {
  /** Start visible and publish `window.__ARCANE_DEBUG__`. */
  readonly debugUrl: boolean;
  /** Debug-only scene restart, used to prove nothing leaks or doubles. */
  readonly onRestart: () => void;
}

const DEBUG_QUERY_PARAM = 'debug';
const ToggleKey = Phaser.Input.Keyboard.KeyCodes.BACKTICK;
const RestartKey = Phaser.Input.Keyboard.KeyCodes.BACKSPACE;

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '10px',
  color: '#ffffff',
  backgroundColor: '#000000aa',
  padding: { x: 3, y: 2 },
};
const TEXT_MARGIN_PX = 4;
/**
 * Marker line widths in world px. The 640×360 canvas is shown with `image-rendering: pixelated`,
 * so below 1× (e.g. 0.61× on a 390 px phone) whole 1 px rows and columns are dropped. 2 px lines
 * survive any FIT scale.
 */
const MARKER_LINE_PX = 2;
/** Crosshair arm length from the centre: 11 px across, drawn over a dark outline. */
const CROSSHAIR_HALF_PX = 5;
const CROSSHAIR_OUTLINE_PX = 4;
const FOLLOW_DOT_RADIUS_PX = 2;
const Colors = {
  crosshair: 0xff4040,
  outline: 0x000000,
  deadzone: 0xffe14d,
  followPoint: 0xffe14d,
  body: 0x40e0ff,
} as const;

let overlaysCreated = 0;
let overlaysLive = 0;

export function isDebugUrl(): boolean {
  return new URLSearchParams(window.location.search).has(DEBUG_QUERY_PARAM);
}

/**
 * Screen-fixed debug readout plus world-space markers (aim crosshair, deadzone, leader body).
 * Backtick toggles it; Backspace restarts the scene while it is visible.
 */
export class DebugOverlay implements System {
  private readonly text: Phaser.GameObjects.Text;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly toggleKey: Phaser.Input.Keyboard.Key;
  private readonly restartKey: Phaser.Input.Keyboard.Key;
  private readonly hook: DebugHook | null;
  private visible: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sources: DebugSources,
    private readonly options: DebugOptions,
  ) {
    overlaysCreated++;
    overlaysLive++;
    this.visible = options.debugUrl;

    this.text = scene.add
      .text(TEXT_MARGIN_PX, TEXT_MARGIN_PX, '', TEXT_STYLE)
      .setScrollFactor(0)
      .setDepth(Depth.Debug);
    this.markers = scene.add.graphics().setDepth(Depth.Debug);

    const keyboard = this.keyboard;
    this.toggleKey = keyboard.addKey(ToggleKey).on(Phaser.Input.Keyboard.Events.DOWN, this.toggle);
    this.restartKey = keyboard
      .addKey(RestartKey)
      .on(Phaser.Input.Keyboard.Events.DOWN, this.restart);

    this.hook = options.debugUrl ? { snapshot: () => this.snapshot() } : null;
    if (this.hook) window.__ARCANE_DEBUG__ = this.hook;

    this.applyVisibility();
  }

  update(): void {
    if (!this.visible) return;
    const s = this.snapshot();

    const lines = [
      `fps     ${s.fps.toFixed(0)}`,
      `leader  ${formatVec(s.leader)}`,
      `move    ${formatVec(s.moveVector, 2)}`,
      `aim     ${s.aimWorld ? formatVec(s.aimWorld) : '-'}`,
      `scroll  ${formatVec({ x: s.camera.scrollX, y: s.camera.scrollY })}`,
      `look    ${formatVec({ x: s.followPoint.x - s.leader.x, y: s.followPoint.y - s.leader.y })}`,
      '[`] hide  [Backspace] restart',
    ];
    const content = lines.join('\n');
    if (this.text.text !== content) this.text.setText(content);

    const g = this.markers.clear();
    const zone = s.deadzone;
    g.lineStyle(MARKER_LINE_PX, Colors.deadzone).strokeRect(
      zone.x,
      zone.y,
      zone.width,
      zone.height,
    );
    g.lineStyle(MARKER_LINE_PX, Colors.body).strokeCircle(
      s.leader.x,
      s.leader.y,
      MOVEMENT.wizardBodyRadiusPx,
    );
    g.fillStyle(Colors.followPoint).fillCircle(
      s.followPoint.x,
      s.followPoint.y,
      FOLLOW_DOT_RADIUS_PX,
    );
    if (s.aimWorld) this.drawCrosshair(g, s.aimWorld);
  }

  snapshot(): DebugSnapshot {
    const { input, leader, camera, world, walkable } = this.sources;
    const cam = this.scene.cameras.main;
    const { worldView } = cam;
    const pointer = this.scene.input.activePointer;
    // Phaser types `keys` as dense, but removeKey() and shutdown leave undefined slots behind.
    const slots: readonly (Phaser.Input.Keyboard.Key | undefined)[] = this.keyboard.keys;
    const keys = slots.filter((key) => key !== undefined);
    return {
      visible: this.visible,
      fps: this.scene.game.loop.actualFps,
      frame: this.scene.game.loop.frame,
      world: { ...world },
      walkable: { ...walkable },
      view: { x: worldView.x, y: worldView.y, width: worldView.width, height: worldView.height },
      camera: { scrollX: cam.scrollX, scrollY: cam.scrollY },
      deadzone: camera.deadzoneWorld,
      followPoint: camera.followPoint,
      leader: { ...leader.position },
      moveVector: { ...input.moveVector },
      aimWorld: input.aimWorld ? { ...input.aimWorld } : null,
      pointerScreen: { x: pointer.x, y: pointer.y },
      lifecycle: {
        overlaysCreated,
        overlaysLive,
        pointerMoveListeners: this.scene.input.listenerCount(Phaser.Input.Events.POINTER_MOVE),
        pointerDownListeners: this.scene.input.listenerCount(Phaser.Input.Events.POINTER_DOWN),
        keyboardKeys: keys.length,
        keyDownListeners: keys.reduce(
          (sum, key) => sum + key.listenerCount(Phaser.Input.Keyboard.Events.DOWN),
          0,
        ),
        sceneShutdownListeners: this.scene.events.listenerCount(Phaser.Scenes.Events.SHUTDOWN),
      },
    };
  }

  destroy(): void {
    // Keys may be shared with other systems (addKey returns the existing Key), so only our
    // handlers are removed; KeyboardPlugin.shutdown removes the Key objects.
    this.toggleKey.off(Phaser.Input.Keyboard.Events.DOWN, this.toggle);
    this.restartKey.off(Phaser.Input.Keyboard.Events.DOWN, this.restart);
    this.text.destroy();
    this.markers.destroy();
    if (this.hook && window.__ARCANE_DEBUG__ === this.hook) delete window.__ARCANE_DEBUG__;
    overlaysLive--;
  }

  private drawCrosshair(g: Phaser.GameObjects.Graphics, { x, y }: Vec2): void {
    const arms = (width: number, color: number, reach: number): void => {
      g.lineStyle(width, color)
        .lineBetween(x - reach, y, x + reach, y)
        .lineBetween(x, y - reach, x, y + reach);
    };
    const outlineReach = CROSSHAIR_HALF_PX + (CROSSHAIR_OUTLINE_PX - MARKER_LINE_PX) / 2;
    arms(CROSSHAIR_OUTLINE_PX, Colors.outline, outlineReach);
    arms(MARKER_LINE_PX, Colors.crosshair, CROSSHAIR_HALF_PX);
  }

  private get keyboard(): Phaser.Input.Keyboard.KeyboardPlugin {
    const { keyboard } = this.scene.input;
    if (!keyboard) throw new Error('DebugOverlay needs the keyboard plugin');
    return keyboard;
  }

  private applyVisibility(): void {
    this.text.setVisible(this.visible);
    this.markers.setVisible(this.visible);
  }

  // OS auto-repeat is ignored, or a held key would toggle or restart again after each restart.
  private readonly toggle = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.visible = !this.visible;
    this.applyVisibility();
  };

  private readonly restart = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (this.visible && !event.repeat) this.options.onRestart();
  };
}

function formatVec(v: Vec2, digits = 1): string {
  return `${v.x.toFixed(digits)}, ${v.y.toFixed(digits)}`;
}
