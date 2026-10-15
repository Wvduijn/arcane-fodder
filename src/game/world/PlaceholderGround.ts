import type Phaser from 'phaser';
import type { Rect } from '@core/types';
import { Depth } from '../depths';
import { PlaceholderTextures, TILE_SIZE_PX } from '../placeholders';

/**
 * Grid ground covering `world`, with a one-tile border in a different colour so the map edge is
 * obvious when checking camera bounds. Static game objects; the scene's display list owns them.
 * Replaced by the tilemap in M7.
 */
export function createPlaceholderGround(scene: Phaser.Scene, world: Rect): void {
  const { x, y, width, height } = world;
  const tile = TILE_SIZE_PX;
  const strips: readonly Rect[] = [
    { x, y, width, height: tile },
    { x, y: y + height - tile, width, height: tile },
    { x, y: y + tile, width: tile, height: height - 2 * tile },
    { x: x + width - tile, y: y + tile, width: tile, height: height - 2 * tile },
  ];

  addTiled(
    scene,
    { x: x + tile, y: y + tile, width: width - 2 * tile, height: height - 2 * tile },
    PlaceholderTextures.Ground,
  );
  for (const strip of strips) addTiled(scene, strip, PlaceholderTextures.GroundBorder);
}

function addTiled(scene: Phaser.Scene, area: Rect, texture: string): void {
  scene.add
    .tileSprite(area.x, area.y, area.width, area.height, texture)
    .setOrigin(0, 0)
    .setDepth(Depth.Ground);
}
