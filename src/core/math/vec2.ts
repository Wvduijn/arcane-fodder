/** Pure helpers over the immutable Vec2 contract. Every function returns a new value. */
import type { Vec2 } from '@core/types';

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor };
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Unit vector in the direction of `v`. A zero-length vector returns {0,0} instead of NaN. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Clamps `value` to [min, max]. Expects min <= max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation from `a` (t = 0) to `b` (t = 1). `t` is not clamped.
 * This form returns exactly `a` and `b` at the endpoints, without float drift.
 */
export function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}
