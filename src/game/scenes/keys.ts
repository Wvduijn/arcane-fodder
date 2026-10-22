export const SceneKeys = {
  Boot: 'Boot',
  Mission: 'Mission',
  /** Runs above Mission, launched and stopped by it (M5 Q3). */
  Hud: 'Hud',
  /** Above the HUD while the mission is paused (CD Q6). */
  Pause: 'Pause',
  /** Above everything once the mission has ended (GDD §14). */
  Results: 'Results',
} as const;
