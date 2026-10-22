import type Phaser from 'phaser';

/**
 * Procedural stand-ins for the M7 structures until tech-artist's atlas lands (M8). Sizes follow
 * GDD §12/§13 and level doc m01 §1: hut 64×64 footprint, portal base 4×4 tiles on a 128 px canvas.
 */
export const StructureTextures = {
  /** 64×64 goblin hut: hide roof, plank walls, dark door at the bottom centre. */
  Hut: 'placeholder-hut',
  /** Same footprint, collapsed (GDD Q16: rubble keeps the footprint). */
  HutRubble: 'placeholder-hut-rubble',
  /** The door's warm glow, drawn over the door during the spawn tell (GDD §12). */
  HutDoorGlow: 'placeholder-hut-door-glow',
  /** 128×128 portal: stone arch over a 64 px pad. The swirl is engine-drawn. */
  Portal: 'placeholder-portal',
  /** One rune socket, 10×10: dark (sealed) and lit (gold, readability §1). */
  RuneDark: 'placeholder-rune-dark',
  RuneLit: 'placeholder-rune-lit',
  /** Off-screen portal arrow, 12×12, pointing along +x. Tinted sealed or open by the HUD. */
  PortalArrow: 'placeholder-portal-arrow',
} as const;

/** Door rectangle inside the 64 px hut texture (texture px), for the glow placement. */
const HUT_DOOR = { x: 26, y: 44, width: 12, height: 20 } as const;
export const HUT_TEXTURE_PX = 64;
export const PORTAL_TEXTURE_PX = 128;
export const RUNE_TEXTURE_PX = 10;

const COLORS = {
  ink: '#1a1020',
  bark: '#5c3a24',
  leather: '#8f5a34',
  soil: '#3a2418',
  hide: '#a07a4a',
  slate: '#4f4a5e',
  ash: '#807a8c',
  dusk: '#33263f',
  gold: '#f2b42a',
  flame: '#ffab2e',
  flameWhite: '#fff4c2',
  cream: '#f4ecdc',
} as const;

/** Creates every structure placeholder that doesn't exist yet. Textures outlive scene restarts. */
export function createStructurePlaceholders(textures: Phaser.Textures.TextureManager): void {
  paint(textures, StructureTextures.Hut, HUT_TEXTURE_PX, HUT_TEXTURE_PX, drawHut);
  paint(textures, StructureTextures.HutRubble, HUT_TEXTURE_PX, HUT_TEXTURE_PX, drawRubble);
  paint(textures, StructureTextures.HutDoorGlow, HUT_DOOR.width, HUT_DOOR.height, drawDoorGlow);
  paint(textures, StructureTextures.Portal, PORTAL_TEXTURE_PX, PORTAL_TEXTURE_PX, drawPortal);
  paint(textures, StructureTextures.RuneDark, RUNE_TEXTURE_PX, RUNE_TEXTURE_PX, (c) => {
    drawRune(c, COLORS.dusk, COLORS.slate);
  });
  paint(textures, StructureTextures.RuneLit, RUNE_TEXTURE_PX, RUNE_TEXTURE_PX, (c) => {
    drawRune(c, COLORS.gold, COLORS.flameWhite);
  });
  paint(textures, StructureTextures.PortalArrow, 12, 12, drawArrow);
}

type Painter = (context: CanvasRenderingContext2D) => void;

function paint(
  textures: Phaser.Textures.TextureManager,
  key: string,
  width: number,
  height: number,
  painter: Painter,
): void {
  if (textures.exists(key)) return;
  const texture = textures.createCanvas(key, width, height);
  if (!texture) throw new Error(`Could not create placeholder texture "${key}"`);
  painter(texture.context);
  texture.refresh();
}

function rect(
  c: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function drawHut(c: CanvasRenderingContext2D): void {
  // Walls: planks with ink outline.
  rect(c, COLORS.ink, 6, 26, 52, 38);
  rect(c, COLORS.bark, 7, 27, 50, 36);
  for (let x = 13; x < 57; x += 7) rect(c, COLORS.soil, x, 27, 1, 36);
  // Hide roof: stepped triangle.
  for (let row = 0; row < 26; row++) {
    const half = 4 + row * 1.15;
    rect(c, COLORS.ink, 32 - half - 1, 2 + row, half * 2 + 2, 1);
    rect(c, row % 6 === 5 ? COLORS.leather : COLORS.hide, 32 - half, 2 + row, half * 2, 1);
  }
  // Banner pole on the ridge, and the door.
  rect(c, COLORS.ink, 30, 0, 4, 6);
  rect(c, COLORS.ink, HUT_DOOR.x - 1, HUT_DOOR.y - 1, HUT_DOOR.width + 2, HUT_DOOR.height + 1);
  rect(c, COLORS.soil, HUT_DOOR.x, HUT_DOOR.y, HUT_DOOR.width, HUT_DOOR.height);
}

function drawRubble(c: CanvasRenderingContext2D): void {
  // Low heap filling the footprint, so the blocked area still reads as solid.
  const chunks: readonly (readonly [number, number, number, number, string])[] = [
    [4, 40, 24, 20, COLORS.bark],
    [24, 34, 22, 26, COLORS.hide],
    [40, 42, 20, 18, COLORS.soil],
    [12, 30, 16, 12, COLORS.leather],
    [30, 26, 14, 10, COLORS.bark],
    [8, 52, 50, 10, COLORS.soil],
  ];
  for (const [x, y, w, h, color] of chunks) {
    rect(c, COLORS.ink, x - 1, y - 1, w + 2, h + 2);
    rect(c, color, x, y, w, h);
  }
  for (let i = 0; i < 6; i++) rect(c, COLORS.ash, 10 + i * 8, 46 - (i % 3) * 6, 3, 2);
}

function drawDoorGlow(c: CanvasRenderingContext2D): void {
  rect(c, COLORS.flame, 0, 0, HUT_DOOR.width, HUT_DOOR.height);
  rect(c, COLORS.flameWhite, 3, 6, HUT_DOOR.width - 6, HUT_DOOR.height - 6);
}

function drawPortal(c: CanvasRenderingContext2D): void {
  const centre = PORTAL_TEXTURE_PX / 2;
  // Pad: 64 px stone disc at the bottom half (the walkable trigger area).
  for (let y = 0; y < PORTAL_TEXTURE_PX; y++) {
    for (let x = 0; x < PORTAL_TEXTURE_PX; x++) {
      const dx = (x + 0.5 - centre) / 32;
      const dy = (y + 0.5 - (centre + 24)) / 16;
      const d = dx * dx + dy * dy;
      if (d <= 1)
        rect(c, d > 0.8 ? COLORS.ink : (x + y) % 6 === 0 ? COLORS.ash : COLORS.slate, x, y, 1, 1);
    }
  }
  // Arch: two pillars and a stepped lintel, outlined.
  rect(c, COLORS.ink, 27, 18, 10, 72);
  rect(c, COLORS.ink, 91, 18, 10, 72);
  rect(c, COLORS.slate, 28, 19, 8, 70);
  rect(c, COLORS.slate, 92, 19, 8, 70);
  rect(c, COLORS.ink, 27, 10, 74, 12);
  rect(c, COLORS.ash, 28, 11, 72, 10);
  for (let x = 32; x < 98; x += 9) rect(c, COLORS.slate, x, 11, 1, 10);
  // The opening between the pillars: dark until the engine swirl fills it.
  rect(c, COLORS.dusk, 37, 22, 54, 66);
}

function drawRune(c: CanvasRenderingContext2D, fill: string, core: string): void {
  rect(c, COLORS.ink, 1, 0, 8, 10);
  rect(c, COLORS.ink, 0, 1, 10, 8);
  rect(c, fill, 1, 1, 8, 8);
  rect(c, core, 4, 2, 2, 6);
  rect(c, core, 2, 4, 6, 2);
}

function drawArrow(c: CanvasRenderingContext2D): void {
  // Outlined triangle pointing right; white body so the HUD can tint it.
  for (let x = 0; x < 12; x++) {
    const half = Math.ceil((12 - x) / 2);
    rect(c, COLORS.ink, x, 6 - half, 1, half * 2);
    if (x >= 1 && half > 1) rect(c, '#ffffff', x, 7 - half, 1, half * 2 - 2);
  }
}
