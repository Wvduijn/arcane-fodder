import Phaser from 'phaser';
import type { Vec2 } from '@core/types';
import { ActionBuffer } from '@core/input/actionBuffer';
import { moveVectorFromAxes } from '@core/math/movement';
import type { GameInput, InputAction } from './GameInput';

type Direction = 'up' | 'down' | 'left' | 'right';

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;

/** Desktop bindings from the plan.md §6 table. */
const MOVE_BINDINGS: Readonly<Record<Direction, readonly number[]>> = {
  up: [KeyCodes.W, KeyCodes.UP],
  down: [KeyCodes.S, KeyCodes.DOWN],
  left: [KeyCodes.A, KeyCodes.LEFT],
  right: [KeyCodes.D, KeyCodes.RIGHT],
};

const ACTION_KEY_BINDINGS: Readonly<Record<InputAction, readonly number[]>> = {
  spell1: [KeyCodes.Q],
  spell2: [KeyCodes.E],
  convergence: [KeyCodes.R, KeyCodes.SPACE],
  volunteer: [KeyCodes.F],
  pause: [KeyCodes.ESC, KeyCodes.P],
};

/** DOM `MouseEvent.button` values. Right click needs `disableContextMenu` in the game config. */
const MouseButton = { Left: 0, Right: 2 } as const;

const ACTION_POINTER_BINDINGS: ReadonlyMap<number, InputAction> = new Map([
  [MouseButton.Left, 'spell1'],
  [MouseButton.Right, 'spell2'],
]);

const ZERO: Vec2 = { x: 0, y: 0 };

/**
 * Key DOWN listener. OS auto-repeat events are ignored: a fresh Key (after a scene restart) has
 * isDown false, so Phaser would count each repeat of a key held across the restart as a new press.
 */
type KeyDownHandler = (key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => void;

/**
 * Keyboard and mouse adapter for {@link GameInput}.
 *
 * Action presses go through core's {@link ActionBuffer}, so `consume()` returns true at most once
 * per press and only during the frame after it happened. Call `update()` once per frame before any
 * system reads the input.
 *
 * Phaser's `addKey` returns the existing Key when another system registered the same code, so
 * `destroy()` removes only this adapter's own handlers and leaves the Key objects to
 * `KeyboardPlugin.shutdown`.
 */
export class KeyboardMouseInput implements GameInput {
  private readonly moveKeys: Readonly<Record<Direction, readonly Phaser.Input.Keyboard.Key[]>>;
  private readonly keyHandlers: readonly (readonly [Phaser.Input.Keyboard.Key, KeyDownHandler])[];
  private readonly actions = new ActionBuffer<InputAction>();
  private readonly worldPoint = new Phaser.Math.Vector2();
  private pointerScreen: Vec2 | null = null;
  private move: Vec2 = ZERO;
  private aim: Vec2 | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly camera: Phaser.Cameras.Scene2D.Camera = scene.cameras.main,
  ) {
    const { keyboard } = scene.input;
    if (!keyboard) throw new Error('KeyboardMouseInput needs the keyboard plugin');

    const addKeys = (codes: readonly number[]): Phaser.Input.Keyboard.Key[] =>
      codes.map((code) => keyboard.addKey(code));
    this.moveKeys = {
      up: addKeys(MOVE_BINDINGS.up),
      down: addKeys(MOVE_BINDINGS.down),
      left: addKeys(MOVE_BINDINGS.left),
      right: addKeys(MOVE_BINDINGS.right),
    };

    const keyHandlers: (readonly [Phaser.Input.Keyboard.Key, KeyDownHandler])[] = [];
    for (const [action, codes] of Object.entries(ACTION_KEY_BINDINGS) as [
      InputAction,
      number[],
    ][]) {
      for (const key of addKeys(codes)) {
        const handler = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
          if (!event.repeat) this.actions.press(action);
        };
        key.on(Phaser.Input.Keyboard.Events.DOWN, handler);
        keyHandlers.push([key, handler]);
      }
    }
    this.keyHandlers = keyHandlers;

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown);
    // A press buffered just before alt-tab must not fire when focus returns.
    scene.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur);
  }

  get moveVector(): Readonly<Vec2> {
    return this.move;
  }

  /** Null until the pointer first moves over (or clicks) the game. */
  get aimWorld(): Readonly<Vec2> | null {
    return this.aim;
  }

  consume(action: InputAction): boolean {
    return this.actions.consume(action);
  }

  update(): void {
    this.actions.update();

    const axis = (negative: Direction, positive: Direction): number =>
      (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
    this.move = moveVectorFromAxes(axis('left', 'right'), axis('up', 'down'));

    // Re-project every frame: the camera scrolls even when the pointer stands still.
    // getWorldPoint uses the last rendered camera transform, i.e. what the player aimed at.
    if (this.pointerScreen) {
      const { x, y } = this.camera.getWorldPoint(
        this.pointerScreen.x,
        this.pointerScreen.y,
        this.worldPoint,
      );
      this.aim = { x, y };
    }
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove);
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown);
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur);
    for (const [key, handler] of this.keyHandlers) {
      key.off(Phaser.Input.Keyboard.Events.DOWN, handler);
    }
    this.actions.reset();
    this.pointerScreen = null;
    this.aim = null;
    this.move = ZERO;
  }

  private isHeld(direction: Direction): boolean {
    return this.moveKeys[direction].some((key) => key.isDown);
  }

  private readonly handleBlur = (): void => {
    this.actions.reset();
  };

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.pointerScreen = { x: pointer.x, y: pointer.y };
  };

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.pointerScreen = { x: pointer.x, y: pointer.y };
    const action = ACTION_POINTER_BINDINGS.get(pointer.button);
    if (action) this.actions.press(action);
  };
}
