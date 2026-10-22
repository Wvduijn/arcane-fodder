import type Phaser from 'phaser';
import type { GameServices } from '@game/services';
import { BootScene } from '@game/scenes/BootScene';
import { HudScene } from '@game/scenes/HudScene';
import { MissionScene } from '@game/scenes/MissionScene';
import { PauseScene } from '@game/scenes/PauseScene';
import { ResultsScene } from '@game/scenes/ResultsScene';
import { M01_GOBLIN_WOODS } from '@data/missions/m01-goblin-woods';

/**
 * Scene registration order, which is also update and render order: the HUD draws above the mission.
 * The first scene starts automatically. Scenes that need platform services get them through their
 * constructor; Phaser reuses the instance on restart, so they last the whole session.
 */
export function createScenes(services: GameServices): Phaser.Types.Scenes.SceneType[] {
  return [
    new BootScene(M01_GOBLIN_WOODS),
    new MissionScene(services, M01_GOBLIN_WOODS),
    HudScene,
    PauseScene,
    ResultsScene,
  ];
}
