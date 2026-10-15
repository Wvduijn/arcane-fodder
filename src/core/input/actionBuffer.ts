/**
 * Edge-triggered action buffer for input adapters.
 *
 * Presses are buffered as pending and become consumable on the next `update()`, so `consume()`
 * returns true at most once per press and only during the frame after it happened. A press that
 * is not consumed in that frame is dropped at the following `update()`, so stale presses never fire
 * late. Call `update()` once per frame before any system reads the input.
 */
export class ActionBuffer<A extends string> {
  /** Pressed since the last update(). */
  private readonly pending = new Set<A>();
  /** Consumable during the current frame. */
  private readonly ready = new Set<A>();

  /** Buffers a press. It becomes consumable after the next `update()`. */
  press(action: A): void {
    this.pending.add(action);
  }

  /** Starts a new frame: drops unconsumed ready actions, then promotes pending to ready. */
  update(): void {
    this.ready.clear();
    for (const action of this.pending) this.ready.add(action);
    this.pending.clear();
  }

  /** True once if `action` was pressed before the last `update()` and not consumed yet. */
  consume(action: A): boolean {
    return this.ready.delete(action);
  }

  /** Forgets every pending and ready press, for example on window blur or destroy. */
  reset(): void {
    this.pending.clear();
    this.ready.clear();
  }
}
