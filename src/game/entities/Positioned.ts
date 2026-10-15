import type { Vec2 } from '@core/types';

/** Anything the camera or debug views can track. */
export interface Positioned {
  readonly position: Readonly<Vec2>;
}
