/**
 * Statuses (GDD §6). Burning: first tick tickMs after apply, reapply refreshes the duration and
 * keeps the tick phase, no stacking. Starting values, tuned at playtest.
 */
import type { StatusDef, StatusId } from '@core/types';

export const STATUSES = {
  burning: {
    id: 'burning',
    element: 'fire',
    tickDamage: 3,
    tickMs: 500,
    durationMs: 3000,
  },
} as const satisfies Record<StatusId, StatusDef>;
