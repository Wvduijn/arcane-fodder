import Phaser from 'phaser';
import type { System } from '../systems/System';

/** What each mission debug key does (MissionScene wires them to the systems). */
export interface MissionDebugActions {
  /** H: the next standing hut (rune order) dies at once, through the normal death flush. */
  readonly destroyNextHut: () => void;
  /** O: the last rune lights now: the opening starts (and with it the surge). */
  readonly openPortal: () => void;
  /** I: the living squad stands in single file just south of the portal. */
  readonly warpToPortal: () => void;
  /** U: the living squad stands in single file just south of the next standing hut. */
  readonly warpToHut: () => void;
}

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
const BINDINGS = [
  [KeyCodes.H, 'destroyNextHut'],
  [KeyCodes.O, 'openPortal'],
  [KeyCodes.I, 'warpToPortal'],
  [KeyCodes.U, 'warpToHut'],
] as const;

/** Help line for the debug overlay. */
export const MISSION_DEBUG_HELP =
  '[H] destroy next hut  [O] open portal  [I] warp to portal  [U] warp to next hut';

/**
 * Mission debug keys (M7.md T13, "my calls": only with `?debug`). Created only on a debug URL;
 * its key handlers go with destroy(). Nothing to step per frame.
 */
export class MissionDebugKeys implements System {
  private readonly handlers: (readonly [Phaser.Input.Keyboard.Key, () => void])[] = [];
  private uses = 0;

  /** `onUse` runs before every action (the run is marked debug-assisted). */
  constructor(scene: Phaser.Scene, actions: MissionDebugActions, onUse: () => void) {
    const { keyboard } = scene.input;
    if (!keyboard) throw new Error('MissionDebugKeys needs the keyboard plugin');
    for (const [code, action] of BINDINGS) {
      const key = keyboard.addKey(code);
      const handler = (): void => {
        this.uses++;
        onUse();
        actions[action]();
      };
      key.on(Phaser.Input.Keyboard.Events.DOWN, handler);
      this.handlers.push([key, handler]);
    }
  }

  /** Mission debug key presses this run (the restart leak log reads it). */
  get useCount(): number {
    return this.uses;
  }

  update(): void {
    // Keys act on press.
  }

  destroy(): void {
    for (const [key, handler] of this.handlers) key.off(Phaser.Input.Keyboard.Events.DOWN, handler);
    this.handlers.length = 0;
  }
}
