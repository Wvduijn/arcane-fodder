import Phaser from 'phaser';
import { cssColor, Palette } from '../palette';
import { SceneKeys } from './keys';

/** Passed through `scene.launch(SceneKeys.Pause, data)` by MissionScene. */
export interface PauseSceneData {
  /** Close the overlay and let the mission run again. */
  readonly onResume: () => void;
  /** Restart the mission with fresh recruits (GDD §14: the same restart as Results' Again). */
  readonly onRestart: () => void;
}

/** Overlay layout in HUD px at 640×360. Presentation, not tuning (CD Q6: minimal pause). */
const LAYOUT = {
  dimAlpha: 0.6,
  titleY: 140,
  firstOptionY: 182,
  optionGapPx: 22,
  titlePx: 20,
  optionPx: 12,
} as const;

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
const RESUME_KEYS = [KeyCodes.ESC, KeyCodes.P] as const;
const RESTART_KEYS = [KeyCodes.R] as const;

/**
 * Minimal pause (CD Q6): MissionScene pauses itself (clock, tweens, systems, mission timer all
 * freeze) and launches this overlay above the HUD. Esc/P or a click on Resume continue; R or a click
 * on Restart starts a fresh attempt. Keys and listeners belong to this scene and go with SHUTDOWN.
 */
export class PauseScene extends Phaser.Scene {
  private options: PauseSceneData | null = null;
  /** One choice per opening: a second key in the same frame is ignored. */
  private chosen = false;

  constructor() {
    super(SceneKeys.Pause);
  }

  init(data: PauseSceneData): void {
    this.options = data;
    this.chosen = false;
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, Palette.ink, LAYOUT.dimAlpha)
      .setOrigin(0, 0)
      .setInteractive();
    this.add
      .text(width / 2, LAYOUT.titleY, 'Paused', textStyle(LAYOUT.titlePx, Palette.cream))
      .setOrigin(0.5);
    this.option('Resume (Esc)', 0, this.resume);
    this.option('Restart (R)', 1, this.restart);

    const { keyboard } = this.input;
    if (!keyboard) throw new Error('PauseScene needs the keyboard plugin');
    for (const code of RESUME_KEYS)
      keyboard.addKey(code).on(Phaser.Input.Keyboard.Events.DOWN, this.resume);
    for (const code of RESTART_KEYS)
      keyboard.addKey(code).on(Phaser.Input.Keyboard.Events.DOWN, this.restart);
  }

  private option(label: string, index: number, onPick: () => void): void {
    const y = LAYOUT.firstOptionY + index * LAYOUT.optionGapPx;
    const text = this.add
      .text(this.scale.width / 2, y, label, textStyle(LAYOUT.optionPx, Palette.cream))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    text.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () =>
      text.setColor(cssColor(Palette.flame)),
    );
    text.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () =>
      text.setColor(cssColor(Palette.cream)),
    );
    text.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPick);
  }

  private readonly resume = (): void => {
    this.pick((data) => {
      data.onResume();
    });
  };

  private readonly restart = (): void => {
    this.pick((data) => {
      data.onRestart();
    });
  };

  private pick(choice: (data: PauseSceneData) => void): void {
    const data = this.options;
    if (this.chosen || !data) return;
    this.chosen = true;
    choice(data);
  }
}

function textStyle(sizePx: number, color: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: 'monospace',
    fontSize: `${String(sizePx)}px`,
    color: cssColor(color),
    stroke: cssColor(Palette.ink),
    strokeThickness: 2,
  };
}
