import type { FallenWizard } from '@core/types';
import { appendFallen } from '@core/hatHill';
import type { SaveRepository } from './SaveRepository';
import type { HatHillRecorder } from '../systems/VolunteerSystem';

/**
 * Hat Hill on the versioned save (M6 Q2, D4): every entry is appended through the repository at
 * once, so it survives a reload or a crash mid-mission.
 */
export class SavedHatHill implements HatHillRecorder {
  private recorded = 0;

  constructor(private readonly saves: SaveRepository) {}

  /** Entries recorded this run (debug). */
  get recordedThisRun(): number {
    return this.recorded;
  }

  /** Every entry on the hill, oldest first (debug, D4). */
  get entries(): readonly FallenWizard[] {
    return this.saves.load().hatHill;
  }

  recordFallen(entry: FallenWizard): void {
    this.saves.update((save) => appendFallen(save, [entry]));
    this.recorded++;
  }
}
