import { Color, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { configureAdditiveMaterial } from '../../../engine/visual-kit';

// One desk lamp, one wooden table, and a drawer of ordinary supplies. Every
// colour in the level comes from this list: warm woods and lamp light for the
// world, saturated stationery for the things worth rescuing, and a single
// near-black for the glue.

export const TABLE = new Color(0x3c2412);
export const TABLE_DARK = new Color(0x150b04);
export const TABLE_LIGHT = new Color(0x6d4523);
export const LAMP = new Color(0xffcf8c);
export const LAMP_HOT = new Color(0xfff2d8);

/** The adhesive itself: never lit, always the darkest thing in frame. */
export const GLUE = new Color(0x0b0a11);
/** Wet sheen on the glue — the only cool colour in the level, so cores read. */
export const GLUE_SHEEN = new Color(0x8e86c8);

export const BUTTON = new Color(0xe8563f);
export const BEAD = new Color(0x35c9b4);
export const PENCIL = new Color(0xf5bf35);
export const PAPER = new Color(0xf1e7d2);
export const CARD = new Color(0xc08a4e);
export const STEEL = new Color(0xaebac6);
export const PAINT = new Color(0x4f7fe0);
export const ERASER = new Color(0xff92ab);
export const WOOD = new Color(0xd7a765);
/** The player's marble: cool glass, so it never competes with the lamp. */
export const MARBLE_GLASS = new Color(0x8fa6b8);

/** Rescued-supply colours, in the order pieces cycle through them. */
export const SUPPLY_COLORS = [BUTTON, BEAD, PENCIL, PAPER, STEEL, PAINT, ERASER, WOOD, CARD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

const lambertCache = new Map<string, MeshLambertMaterial>();
const additiveCache = new Map<string, MeshBasicMaterial>();

/** Lit stationery. Flat shading keeps the low-poly supplies reading as facets under the lamp. */
export function matte(color: Color, emissive = 0.06) {
  const key = `${color.getHexString()}:${emissive.toFixed(3)}`;
  const cached = lambertCache.get(key);
  if (cached) return cached;
  const material = new MeshLambertMaterial({
    color,
    emissive: color.clone().multiplyScalar(emissive),
    flatShading: true,
  });
  lambertCache.set(key, material);
  return material;
}

/** Lamp glare, glue sheen, effect flashes: additive, so bloom-off still shows the base colour. */
export function glow(color: Color, opacity = 1) {
  const key = `${color.getHexString()}:${opacity.toFixed(3)}`;
  const cached = additiveCache.get(key);
  if (cached) return cached;
  const material = configureAdditiveMaterial(new MeshBasicMaterial({ color }), { opacity });
  additiveCache.set(key, material);
  return material;
}
