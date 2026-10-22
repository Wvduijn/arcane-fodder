import { CollisionGrid } from '@core/world/collisionGrid';

export const TILE = 16;

/** A grid from rows of '#' (solid) and '.' (open), one char per 16 px tile. */
export function gridOf(rows: readonly string[]): CollisionGrid {
  const width = rows[0]?.length ?? 0;
  const data = rows.flatMap((row) =>
    Array.from({ length: row.length }, (_, i) => (row[i] === '#' ? 7 : 0)),
  );
  return CollisionGrid.fromTiles(width, rows.length, TILE, data);
}

/** `width`×`height` open tiles with `solid(tx, ty)` tiles marked. */
export function gridWhere(
  width: number,
  height: number,
  solid: (tx: number, ty: number) => boolean,
): CollisionGrid {
  return gridOf(
    Array.from({ length: height }, (_, ty) =>
      Array.from({ length: width }, (_, tx) => (solid(tx, ty) ? '#' : '.')).join(''),
    ),
  );
}
