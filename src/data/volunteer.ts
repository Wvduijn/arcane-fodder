/**
 * Volunteer! (GDD §11). The last trail wizard sprints to the clamped aim point and detonates at the
 * first of arrival, enemy contact, the fuse or death. The blast is arcane: it triggers kegs (GDD
 * Q6), never hurts wizards (GDD Q7) and dies as blood by the element mapping (GDD §12a). The
 * cooldown starts at activation. Starting values, tuned at playtest.
 */
import type { VolunteerTuning } from '@core/types';

export const VOLUNTEER = {
  /** Faster than the squad (110) and every goblin, so they get where they're sent. */
  sprintSpeed: 180,
  fuseMs: 1500,
  cooldownMs: 12000,
  blast: {
    element: 'arcane',
    damage: 80,
    knockbackPx: 30,
    canGib: true,
    radiusPx: 64,
  },
} as const satisfies VolunteerTuning;
