import type { Vec2 } from '@core/types';

/** Anything the camera or debug views can track. */
export interface Positioned {
  readonly position: Readonly<Vec2>;
}

/** Whoever leads right now. Null once the squad is wiped. Read it every frame; it changes on succession. */
export interface LeaderSource {
  readonly leader: Positioned | null;
}
