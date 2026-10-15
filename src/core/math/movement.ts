/** Pure movement helpers: input axes to a move vector, integration over dt, and bounds clamping. */
import type { Rect, Vec2 } from '@core/types';
import { add, clamp, length, normalize, scale } from '@core/math/vec2';

/**
 * Turns input axes (each -1..1) into a move vector of length <= 1.
 * Vectors longer than 1 (digital diagonals such as (1,1)) are normalised, so diagonal speed equals
 * cardinal speed. Shorter vectors (analog sticks) are returned unchanged. Zero input returns {0,0}.
 */
export function moveVectorFromAxes(x: number, y: number): Vec2 {
  const v = { x, y };
  return length(v) > 1 ? normalize(v) : v;
}

/** Advances `pos` along `move` at `speedPxPerS` for `dtMs`. A dt <= 0 leaves the position unchanged. */
export function stepPosition(pos: Vec2, move: Vec2, speedPxPerS: number, dtMs: number): Vec2 {
  if (dtMs <= 0) return { x: pos.x, y: pos.y };
  return add(pos, scale(move, (speedPxPerS * dtMs) / 1000));
}

/**
 * Clamps `pos` so a circle of radius `insetPx` centred on it stays fully inside `rect`.
 * If the rect is narrower (or shorter) than 2 * insetPx on an axis, no position fits, so the
 * result is centred on that axis instead.
 */
export function clampToRect(pos: Vec2, rect: Rect, insetPx: number): Vec2 {
  return {
    x: clampAxis(pos.x, rect.x, rect.width, insetPx),
    y: clampAxis(pos.y, rect.y, rect.height, insetPx),
  };
}

/** Per-side inset amounts in px, used by {@link insetRect}. */
export interface RectInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Returns `rect` shrunk by `insets` on each side.
 * If an axis collapses (left + right > width, or top + bottom > height), that axis becomes zero
 * size, centred on the original rect, matching {@link clampToRect}'s undersized-rect rule.
 */
export function insetRect(rect: Rect, insets: RectInsets): Rect {
  const [x, width] = insetAxis(rect.x, rect.width, insets.left, insets.right);
  const [y, height] = insetAxis(rect.y, rect.height, insets.top, insets.bottom);
  return { x, y, width, height };
}

function insetAxis(start: number, size: number, before: number, after: number): [number, number] {
  const insetSize = size - before - after;
  if (insetSize < 0) return [start + size / 2, 0];
  return [start + before, insetSize];
}

function clampAxis(value: number, start: number, size: number, inset: number): number {
  const min = start + inset;
  const max = start + size - inset;
  if (min > max) return start + size / 2;
  return clamp(value, min, max);
}
