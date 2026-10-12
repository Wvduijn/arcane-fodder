import type Phaser from 'phaser';
import { BootScene } from '@game/scenes/BootScene';
import { MissionScene } from '@game/scenes/MissionScene';

/** Scene registration order. The first scene starts automatically. */
export const SCENES: readonly Phaser.Types.Scenes.SceneType[] = [BootScene, MissionScene];
