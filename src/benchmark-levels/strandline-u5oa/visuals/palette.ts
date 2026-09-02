import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's visual language:
// - Ocean medium: clear aquamarine/cyan in the foreground (0x063d42), shading to abyssal deep blue with distance (0x010c1c).
// - Giant Jellyfish Bioluminescence: translucent emerald green (0x10ffa8), seafoam mint (0x48ffc8), and warm gold (0xffd850).
// - Parasitic Infestation: sickly necrotic violet (0x9910d8), bruised purple (0x4b0a66), and toxic magenta (0xff1080).
// - Player arsenal: crystalline oceanic pearl (0xdffaff) and cyan-white (0x80ffff) with gold charge pips (0xffe070).
// - Warning / Denied / Damage: toxic venom red/magenta (0xff2040).

export const OCEAN_ABYSS = new Color(0.005, 0.04, 0.08);
export const OCEAN_CLEAR = new Color(0.03, 0.22, 0.26);
export const SUNLIGHT_RAY = new Color(0.35, 0.85, 0.9);

export const JELLY_EMERALD = new Color(0.06, 0.95, 0.6);
export const JELLY_MINT = new Color(0.28, 1.0, 0.78);
export const JELLY_GOLD = new Color(1.0, 0.84, 0.32);

export const PARASITE_VIOLET = new Color(0.6, 0.06, 0.88);
export const PARASITE_BRUISE = new Color(0.25, 0.04, 0.38);
export const PARASITE_TOXIC = new Color(1.0, 0.08, 0.52);
export const PARASITE_CORE = new Color(1.2, 0.15, 0.95);

export const PEARL_WHITE = new Color(0.88, 0.98, 1.0);
export const LOCK_CYAN = new Color(0.3, 0.9, 1.0);
export const LOCK_GOLD = new Color(1.0, 0.88, 0.4);

export const DENIED_RED = new Color(1.0, 0.12, 0.25);

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
