import Phaser from 'phaser';
import { PlaceholderTextures } from '../placeholders';
import { SceneKeys } from './keys';

/** Integer scale keeps every texel the same size on screen. */
const PLACEHOLDER_SCALE = 4;

/** Empty mission for M1: shows one placeholder sprite to prove crisp pixel scaling. */
export class MissionScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Mission);
  }

  create(): void {
    const { centerX, centerY } = this.cameras.main;
    this.add.image(centerX, centerY, PlaceholderTextures.Wizard).setScale(PLACEHOLDER_SCALE);
  }
}
