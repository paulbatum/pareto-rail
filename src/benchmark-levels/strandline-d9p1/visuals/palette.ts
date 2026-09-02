import { Color } from 'three';

// Strandline palette:
// Clear sunlit blue/green water shading into deep oceanic abyss, layered with
// the jellyfish's organic emerald and gold bioluminescence. The only jarring
// notes are the sickly, necrotic violets and magentas of the parasitic infestation.

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

// Ocean atmosphere
export const DEEP_BLUE = new Color(0x021622); // Abyss fog / background
export const SHALLOW_CYAN = new Color(0x0e7490); // Upper sunlit water
export const CAUSTIC_AQUA = new Color(0x14b8a6); // Sunbeam caustic refraction
export const PLANKTON_CYAN = new Color(0x5eead4); // Marine snow drifting

// Jellyfish bioluminescence (green-gold harmony)
export const JELLY_EMERALD = new Color(0x10b981); // Primary tentacle strand glow
export const JELLY_MINT = new Color(0x6ee7b7); // Inner nerve glow
export const JELLY_GOLD = new Color(0xfbbf24); // Crown gonads & sensory rhopalia
export const JELLY_AMBER = new Color(0xf59e0b); // Deep bell core warmth
export const JELLY_BELL_DEEP = new Color(0x042f2e); // Base translucent bell dome
export const JELLY_BELL_LIGHT = new Color(0x2dd4bf); // Rim & radial canals

// Parasite infestation (sickly violet / toxic magenta)
export const PARASITE_VIOLET = new Color(0x9333ea); // Sickly chitin shell
export const PARASITE_DEEP = new Color(0x4c1d95); // Barbed hooks and claws
export const PARASITE_LILAC = new Color(0xc084fc); // Spore sac rim
export const PARASITE_CORE = new Color(0xf43f5e); // Pulsing toxic venom core
export const PARASITE_WEB = new Color(0xa855f7); // Boss webbing lattice filaments

// Gameplay & feedback
export const RETICLE_AQUA = new Color(0x2dd4bf);
export const PROJECTILE_EMERALD = new Color(0x34d399);
export const DENY_VIOLET_RED = new Color(1.8, 0.15, 0.4);
export const HEAL_GOLD = new Color(1.4, 1.2, 0.3);

// Lock tier colors
export const LOCK_GRADIENT = [
  new Color(0x2dd4bf), // 1 lock
  new Color(0x34d399), // 2 locks
  new Color(0xa3e635), // 3 locks
  new Color(0xfacc15), // 4 locks
  new Color(0xfb923c), // 5 locks
  new Color(0xf87171), // 6 locks
];
