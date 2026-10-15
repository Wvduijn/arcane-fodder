import type { Vec2 } from '@core/types';

/** High-level actions every input adapter produces (plan.md §6). */
export type InputAction = 'spell1' | 'spell2' | 'convergence' | 'volunteer' | 'pause';

/** One interface for every platform; gameplay reads this, never raw keys or pointers. */
export interface GameInput {
  /** Normalised movement vector, length 0..1 */
  readonly moveVector: Readonly<Vec2>;
  /** Aim target in WORLD coordinates (camera-adjusted) */
  readonly aimWorld: Readonly<Vec2> | null;
  /** Edge-triggered: true only on the frame the action was requested */
  consume(action: InputAction): boolean;
  update(): void;
  destroy(): void;
}
