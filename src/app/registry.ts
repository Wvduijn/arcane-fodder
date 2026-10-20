import type Phaser from 'phaser';
import { BootScene } from '@game/scenes/BootScene';
import { HudScene } from '@game/scenes/HudScene';
import { MissionScene } from '@game/scenes/MissionScene';

/**
 * Scene registration order, which is also update and render order: the HUD draws above the mission.
 * The first scene starts automatically.
 */
export const SCENES: readonly Phaser.Types.Scenes.SceneType[] = [BootScene, MissionScene, HudScene];
