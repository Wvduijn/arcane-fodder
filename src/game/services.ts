import type { SaveRepository } from './save/SaveRepository';

/** Platform services created once at boot (main.ts) and handed to the scenes that need them. */
export interface GameServices {
  readonly saves: SaveRepository;
}
