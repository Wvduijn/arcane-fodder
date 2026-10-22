import Phaser from 'phaser';
import type { DeathCause, MageClassId, MissionResult } from '@core/types';
import { cssColor, Palette } from '../palette';
import { SceneKeys } from './keys';

/** Passed through `scene.launch(SceneKeys.Results, data)` by MissionScene. */
export interface ResultsSceneData {
  readonly result: MissionResult;
  /** Restart the mission with fresh recruits (GDD §14). */
  readonly onAgain: () => void;
}

/** Epitaph per cause (GDD §14). Presentation text. */
const EPITAPHS = {
  combat: 'Fell in battle',
  volunteer: 'Volunteered.',
  'left-behind': 'Left behind.',
} as const satisfies Record<DeathCause, string>;

const CLASS_LABELS = {
  pyromancer: 'Pyromancer',
  stormcaller: 'Stormcaller',
} as const satisfies Record<MageClassId, string>;

/**
 * Layout in HUD px at 640×360. Presentation, not tuning. Full names are ≤ 28 characters (GDD §14),
 * so a 28-character name plus class and epitaph fits one 8 px monospace row of a 300 px column.
 */
const LAYOUT = {
  dimAlpha: 0.78,
  headerY: 36,
  headerPx: 24,
  statsY: 72,
  statsPx: 10,
  statsGapPx: 120,
  bestY: 90,
  columnsY: 118,
  columnLeftX: 24,
  columnRightX: 328,
  rowPx: 8,
  rowGapPx: 14,
  /** The epitaph sits on its own line under the name, indented (review M7-T18 m2). */
  subLineGapPx: 11,
  subLineIndentPx: 12,
  /** Column right margin: nothing reaches closer than this to the screen edge. */
  edgeMarginPx: 24,
  columnTitlePx: 10,
  promptY: 330,
  promptPx: 12,
} as const;

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
const AGAIN_KEYS = [KeyCodes.ENTER, KeyCodes.R] as const;

/**
 * Results (GDD §14), shared by victory and defeat: header, time (pause excluded, mm:ss), kills,
 * huts, best time, saved and lost wizards. Again (Enter, R, click anywhere) restarts with fresh
 * recruits. Reads the {@link MissionResult} core built; it keeps no other state.
 */
export class ResultsScene extends Phaser.Scene {
  private options: ResultsSceneData | null = null;
  /** Again fires once, even if Enter and a click land in the same frame. */
  private chosen = false;

  constructor() {
    super(SceneKeys.Results);
  }

  /** Debug: what this scene shows now (the restart leak log reads it). */
  get state(): { readonly showing: boolean; readonly outcome: string | null } {
    return { showing: this.options !== null, outcome: this.options?.result.outcome ?? null };
  }

  init(data: ResultsSceneData): void {
    this.options = data;
    this.chosen = false;
  }

  create(): void {
    const options = this.options;
    if (!options) throw new Error('ResultsScene needs ResultsSceneData');
    const { result } = options;
    const { width, height } = this.scale;
    const victory = result.outcome === 'victory';

    this.add
      .rectangle(0, 0, width, height, Palette.ink, LAYOUT.dimAlpha)
      .setOrigin(0, 0)
      .setInteractive()
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, this.again);
    this.add
      .text(
        width / 2,
        LAYOUT.headerY,
        victory ? 'Victory' : 'Defeat',
        textStyle(LAYOUT.headerPx, victory ? Palette.gold : Palette.crimson),
      )
      .setOrigin(0.5);

    const stats = [
      `Time ${formatTime(result.timeMs)}`,
      `Kills ${String(result.kills)}`,
      `Huts ${String(result.targetsDestroyed)}/${String(result.targetsRequired)}`,
    ];
    stats.forEach((line, index) => {
      const x = width / 2 + (index - (stats.length - 1) / 2) * LAYOUT.statsGapPx;
      this.add
        .text(x, LAYOUT.statsY, line, textStyle(LAYOUT.statsPx, Palette.cream))
        .setOrigin(0.5);
    });
    const best = bestLine(result);
    if (best) {
      this.add
        .text(
          width / 2,
          LAYOUT.bestY,
          best,
          textStyle(LAYOUT.statsPx, result.newBest ? Palette.gold : Palette.ash),
        )
        .setOrigin(0.5);
    }

    this.column(
      LAYOUT.columnLeftX,
      `Saved (${String(result.saved.length)})`,
      result.saved.map((wizard) => [`${wizard.name}, ${CLASS_LABELS[wizard.classId]}`]),
      Palette.cream,
    );
    this.column(
      LAYOUT.columnRightX,
      `Lost (${String(result.lost.length)})`,
      result.lost.map((wizard) => [
        `${wizard.name}, ${CLASS_LABELS[wizard.classId]}`,
        EPITAPHS[wizard.cause],
      ]),
      Palette.ash,
    );

    this.add
      .text(
        width / 2,
        LAYOUT.promptY,
        'Again (Enter / R / click)',
        textStyle(LAYOUT.promptPx, Palette.cream),
      )
      .setOrigin(0.5);

    const { keyboard } = this.input;
    if (!keyboard) throw new Error('ResultsScene needs the keyboard plugin');
    for (const code of AGAIN_KEYS)
      keyboard.addKey(code).on(Phaser.Input.Keyboard.Events.DOWN, this.again);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.options = null;
    });
  }

  /**
   * One column: a title, then one entry per wizard. An entry is its first line plus indented
   * sub-lines (the epitaph). Lines wrap at the column's right edge, so a long name never clips.
   */
  private column(
    x: number,
    title: string,
    entries: readonly (readonly string[])[],
    color: number,
  ): void {
    this.add.text(x, LAYOUT.columnsY, title, textStyle(LAYOUT.columnTitlePx, Palette.gold));
    const right = x === LAYOUT.columnLeftX ? LAYOUT.columnRightX : this.scale.width;
    const wrapWidth = right - LAYOUT.edgeMarginPx - x;
    let y = LAYOUT.columnsY + 1.5 * LAYOUT.rowGapPx;
    for (const entry of entries.length > 0 ? entries : [['-']]) {
      entry.forEach((line, index) => {
        const indent = index === 0 ? 0 : LAYOUT.subLineIndentPx;
        const text = this.add
          .text(x + indent, y, line, textStyle(LAYOUT.rowPx, color))
          .setWordWrapWidth(wrapWidth - indent);
        y += index === entry.length - 1 ? 0 : Math.max(LAYOUT.subLineGapPx, text.height);
      });
      y += LAYOUT.rowGapPx;
    }
  }

  private readonly again = (): void => {
    const options = this.options;
    if (this.chosen || !options) return;
    this.chosen = true;
    options.onAgain();
  };
}

/** mm:ss, seconds rounded down (GDD §14). */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function bestLine(result: MissionResult): string | null {
  if (result.newBest) return 'New best time!';
  if (result.bestTimeMs === null) return null;
  return `Best ${formatTime(result.bestTimeMs)}`;
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
