import Phaser from 'phaser';
import type { MissionDef } from '@core/types';
import { Palette, cssColor } from '../palette';
import { createPlaceholderTextures } from '../placeholders';
import { createStructurePlaceholders } from '../world/structurePlaceholders';
import { mapCacheKey, mapUrl } from '../world/TilemapLoader';
import { SceneKeys } from './keys';

const ERROR_MARGIN_PX = 8;
const ERROR_FONT_PX = 10;

/** Loads the mission map and prepares global resources, then hands off to the mission. */
export class BootScene extends Phaser.Scene {
  private readonly failed: string[] = [];

  constructor(private readonly mission: MissionDef) {
    super(SceneKeys.Boot);
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.push(typeof file.url === 'string' ? file.url : file.key);
    });
    this.load.tilemapTiledJSON(mapCacheKey(this.mission), mapUrl(this.mission));
  }

  create(): void {
    this.load.removeAllListeners(Phaser.Loader.Events.FILE_LOAD_ERROR);
    if (this.failed.length > 0) {
      // A broken map is a build problem: say so on screen and in the console, don't start.
      const message = `Could not load:\n${this.failed.join('\n')}\n\nRun pnpm maps:build.`;
      console.error(message);
      this.add
        .text(ERROR_MARGIN_PX, ERROR_MARGIN_PX, message, {
          fontFamily: 'monospace',
          fontSize: `${String(ERROR_FONT_PX)}px`,
          color: cssColor(Palette.cream),
        })
        .setWordWrapWidth(this.scale.width - 2 * ERROR_MARGIN_PX);
      return;
    }
    createPlaceholderTextures(this.textures);
    createStructurePlaceholders(this.textures);
    this.scene.start(SceneKeys.Mission);
  }
}
