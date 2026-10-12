import Phaser from 'phaser';
import { createPlaceholderTextures } from '../placeholders';
import { SceneKeys } from './keys';

/** Prepares global resources, then hands off to the mission. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    createPlaceholderTextures(this.textures);
    this.scene.start(SceneKeys.Mission);
  }
}
