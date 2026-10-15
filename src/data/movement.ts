/** Squad movement tuning. Speed from GDD Q9 (one squad speed), body radius from GDD §0. */
import type { MovementTuning } from '@core/types';

export const MOVEMENT = {
  squadMoveSpeed: 110,
  wizardBodyRadiusPx: 10,
} as const satisfies MovementTuning;
