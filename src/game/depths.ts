/** Render order of scene layers, back to front. */
export const Depth = {
  Ground: 0,
  /**
   * Ground markers, below every character (leader marker). A follower may partly hide it (CD
   * playtest, M3-T9 Re-review 4).
   */
  GroundMarker: 5,
  /**
   * Wizard health bars, on the ground layer like the marker and above it (they sit below the
   * feet, partly under the marker's ellipse). A wizard behind may partly hide them (CD, M4 T12).
   */
  GroundBars: 6,
  /**
   * Engine-drawn ground decals above the marker and bars, below every unit: the keg fuse ring,
   * the Lightning reticle and its ground flash (readability.md §5a).
   */
  GroundFx: 7,
  /** Units, the leader included, sort by feet y inside [Units, Units + 1): see {@link unitDepth}. */
  Units: 10,
  /** Goblin health bars and the Burning overlay, above every unit (readability.md §4a: corpses below). */
  UnitOverlays: 20,
  /** Projectiles in flight (readability.md §4a: above live units). */
  Projectiles: 30,
  /** Death puffs and other short FX. */
  Fx: 40,
  Debug: 1000,
} as const;

/** Largest world y that still sorts inside the Units band. */
const UNIT_DEPTH_Y_RANGE = 100_000;

/** Depth for a unit whose feet are at world `y`: lower on screen draws in front. */
export function unitDepth(y: number): number {
  return Depth.Units + Math.min(Math.max(y, 0), UNIT_DEPTH_Y_RANGE) / (UNIT_DEPTH_Y_RANGE + 1);
}
