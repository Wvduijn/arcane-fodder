import type { Rect, Vec2 } from '@core/types';

/** Where an off-screen edge arrow sits, in view px (0,0 = the view's top-left), and where it points. */
export interface EdgeArrowPlacement {
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = pointing right (+x), clockwise positive like Phaser. */
  readonly angle: number;
}

/**
 * Off-screen arrow (readability.md, Portal: "an edge-of-screen arrow points to the portal"). Null
 * while `target` is inside `view` shrunk by `hideInsetPx` (it is on screen). Otherwise the arrow
 * sits where the ray from the view centre to the target leaves the view shrunk by `edgeInsetPx`,
 * so it hugs the screen edge in the target's direction.
 */
export function edgeArrow(
  view: Rect,
  target: Vec2,
  edgeInsetPx: number,
  hideInsetPx: number,
): EdgeArrowPlacement | null {
  const inside =
    target.x >= view.x + hideInsetPx &&
    target.x <= view.x + view.width - hideInsetPx &&
    target.y >= view.y + hideInsetPx &&
    target.y <= view.y + view.height - hideInsetPx;
  if (inside) return null;

  const halfWidth = view.width / 2 - edgeInsetPx;
  const halfHeight = view.height / 2 - edgeInsetPx;
  const dx = target.x - (view.x + view.width / 2);
  const dy = target.y - (view.y + view.height / 2);
  const angle = Math.atan2(dy, dx);
  // Scale the direction so it touches the inset rect: the smaller of the two axis ratios wins.
  const scaleX = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: view.width / 2 + dx * scale, y: view.height / 2 + dy * scale, angle };
}
