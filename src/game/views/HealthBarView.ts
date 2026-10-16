import type Phaser from 'phaser';
import type { Vec2 } from '@core/types';
import type { CombatWorld } from '@core/combat/world';
import { Depth } from '../depths';
import type { UnitLookup } from '../entities/Positioned';
import type { System } from '../systems/System';

interface BarLook {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly offsetBelowFeetPx: number;
  readonly fill: number;
}

/** Placeholder bars (readability.md §2, §3). Presentation, not tuning; M8 art may replace them. */
const HEALTH_BAR = {
  /** Below the feet, clear of the leader marker's 27×12 ellipse. */
  squad: { widthPx: 24, heightPx: 3, offsetBelowFeetPx: 9, fill: 0x6ee06e },
  /** Hostile fill: not fire red, not gold. */
  enemy: { widthPx: 18, heightPx: 3, offsetBelowFeetPx: 4, fill: 0xd9577a },
  outlinePx: 1,
  /** style-guide.md ink. */
  outline: 0x1a1020,
  empty: 0x3a2a3a,
  /** readability.md §2: the bar blinks at ≤ 25% HP. */
  lowHpRatio: 0.25,
  blinkPeriodMs: 500,
} as const;

/**
 * Health bars for every living unit below full HP, redrawn each frame. Wizard bars sit under the
 * feet on the ground layer, below every character like the leader marker, so a wizard standing
 * behind draws over them (readability.md §2, CD 2026-10-16). Goblin bars sit under the feet above
 * every unit (§3). Reads HP from the combat world and positions through {@link UnitLookup}; owns
 * only the blink clock.
 */
export class HealthBarView implements System {
  private readonly wizardBars: Phaser.GameObjects.Graphics;
  private readonly enemyBars: Phaser.GameObjects.Graphics;
  private blinkMs = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly world: CombatWorld,
    private readonly units: UnitLookup,
  ) {
    this.wizardBars = scene.add.graphics().setDepth(Depth.GroundBars);
    this.enemyBars = scene.add.graphics().setDepth(Depth.UnitOverlays);
  }

  update(dt: number): void {
    this.blinkMs = (this.blinkMs + dt) % HEALTH_BAR.blinkPeriodMs;
    const blinkOff = this.blinkMs >= HEALTH_BAR.blinkPeriodMs / 2;
    this.wizardBars.clear();
    this.enemyBars.clear();
    for (const unit of this.world.units()) {
      if (unit.team === 'neutral' || !unit.alive || unit.hp >= unit.maxHp) continue;
      const ratio = unit.hp / unit.maxHp;
      if (ratio <= HEALTH_BAR.lowHpRatio && blinkOff) continue;
      const feet = this.units.positionOf(unit.id);
      if (!feet) continue;
      if (unit.team === 'squad') drawBar(this.wizardBars, HEALTH_BAR.squad, feet, ratio);
      else drawBar(this.enemyBars, HEALTH_BAR.enemy, feet, ratio);
    }
  }

  destroy(): void {
    this.wizardBars.destroy();
    this.enemyBars.destroy();
  }
}

function drawBar(g: Phaser.GameObjects.Graphics, look: BarLook, feet: Vec2, ratio: number): void {
  const { widthPx, heightPx } = look;
  const x = Math.round(feet.x - widthPx / 2);
  const y = Math.round(feet.y + look.offsetBelowFeetPx);
  const o = HEALTH_BAR.outlinePx;
  g.fillStyle(HEALTH_BAR.outline).fillRect(x - o, y - o, widthPx + o * 2, heightPx + o * 2);
  g.fillStyle(HEALTH_BAR.empty).fillRect(x, y, widthPx, heightPx);
  g.fillStyle(look.fill).fillRect(x, y, Math.max(1, Math.round(widthPx * ratio)), heightPx);
}
