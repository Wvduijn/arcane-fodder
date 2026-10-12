/** Shared core contracts. Producer-owned: propose changes by message, never edit directly. */

/** Unique id for any runtime entity (wizard, enemy, structure, projectile). */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** Immutable 2D vector in world pixels. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}
