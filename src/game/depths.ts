/** Render order of scene layers, back to front. */
export const Depth = {
  Ground: 0,
  /**
   * Ground markers, below every character (leader marker). A follower may partly hide it (CD
   * playtest, M3-T9 Re-review 4).
   */
  GroundMarker: 5,
  /** Units, the leader included, sort by feet y inside [Units, Units + 1): see {@link unitDepth}. */
  Units: 10,
  Debug: 1000,
} as const;

/** Largest world y that still sorts inside the Units band. */
const UNIT_DEPTH_Y_RANGE = 100_000;

/** Depth for a unit whose feet are at world `y`: lower on screen draws in front. */
export function unitDepth(y: number): number {
  return Depth.Units + Math.min(Math.max(y, 0), UNIT_DEPTH_Y_RANGE) / (UNIT_DEPTH_Y_RANGE + 1);
}
