import Phaser from 'phaser';
import type { GameServices } from '@game/services';
import { createScenes } from './registry';

/** Logical resolution (ADR 0002). Everything is authored in these pixels and scaled to fit. */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;

const BACKGROUND_COLOR = '#1b1f2a';
const PARENT_ELEMENT_ID = 'game';

export function createGameConfig(services: GameServices): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    title: 'Arcane Fodder',
    backgroundColor: BACKGROUND_COLOR,
    // pixelArt turns off antialiasing (nearest-neighbour sampling) and turns on roundPixels.
    pixelArt: true,
    disableContextMenu: true,
    scale: {
      parent: PARENT_ELEMENT_ID,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: createScenes(services),
  };
}
