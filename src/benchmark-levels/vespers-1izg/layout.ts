// Shared nave geometry constants. Gameplay needs the window positions to
// decide which pane each thief is carrying; visuals need the same numbers to
// build the glass. One layout, two readers.

export const NAVE_HALF_WIDTH = 11.5;
export const WALL_X = 13.2;
export const FLOOR_Y = -13;
export const VAULT_APEX_Y = 14.5;
export const WINDOW_CENTER_Y = 5.4;

// Fourteen clerestory pairs marching down the nave, plus the rose window at
// the west end. Windows are numbered left/right alternating by pair, in rail
// order, so index 0 is the first pair a flythrough passes.
export const WINDOW_PAIRS = 14;
export const NAVE_WINDOWS = WINDOW_PAIRS * 2;
export const ROSE_WINDOW = NAVE_WINDOWS; // index 28
export const TOTAL_WINDOWS = NAVE_WINDOWS + 1;

export const WINDOW_SPACING = 26;
export const WINDOW_FIRST_Z = -16;

export function naveWindowZ(pair: number): number {
  return WINDOW_FIRST_Z + pair * -WINDOW_SPACING;
}

export function naveWindowSide(index: number): -1 | 1 {
  return index % 2 === 0 ? -1 : 1;
}

export function naveWindowPair(index: number): number {
  return Math.floor(index / 2);
}
