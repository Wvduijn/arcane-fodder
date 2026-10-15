/**
 * Lifecycle every system follows (plan.md §7.4). The scene destroys all systems on SHUTDOWN.
 * By then Phaser may already have torn down its cameras, display list and input plugin (their
 * SHUTDOWN listeners run first), so destroy() must tolerate already-destroyed Phaser objects.
 */
export interface System {
  /** @param dt Elapsed time in milliseconds, from the Phaser clock. */
  update(dt: number): void;
  destroy(): void;
}
