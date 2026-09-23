import { Color, Vector3 } from 'three';
import type { Family } from '../gameplay';
import type { Tier } from '../ball';
import type { PieceType } from './pieces';
import { CREAM, KRAFT, MUSTARD, PINE, STEEL, TOY_COLORS } from './palette';

// Spine: what each glue monster is built from, per size tier. "Rulers and
// pencils become legs, buttons and spools form beetles, cardboard and
// clothespins fold into snapping birds." A tier's monsters are made of the
// same supplies the ball can roll up at that size.

export type LegRecipe = { type: PieceType; axis: Vector3; thickness: number };

export type Recipe = {
  coreRadius: number;
  shell?: { type: PieceType; scale: number; tints: Color[] };
  body?: { type: PieceType; scale: Vector3; lying: boolean; tints: Color[] };
  head?: { type: PieceType; scale: number; tints: Color[] };
  hat?: { type: PieceType; scale: number; tints: Color[] };
  legs?: LegRecipe & { length: number; tints: Color[] };
  wings?: { type: PieceType; scale: Vector3; tints: Color[] };
  beak?: { type: PieceType; scale: number; tints: Color[] };
  tail?: { type: PieceType; scale: number; tints: Color[] };
  antennae?: { type: PieceType; scale: number; tints: Color[] };
};

const Y_DOWN = new Vector3(0, -1, 0);
const Y_UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

const toys = TOY_COLORS;
const brights = [toys[0], toys[1], toys[2], toys[3], toys[9]];
const pastels = [toys[4], toys[5], toys[6], toys[1]];

export const RECIPES: Record<Family, Record<Tier, Recipe>> = {
  beetle: {
    // Button beetle: two coat buttons for wing-cases, a bead head, pin legs.
    0: {
      coreRadius: 0.42,
      shell: { type: 'button', scale: 1.3, tints: brights },
      head: { type: 'bead', scale: 1.15, tints: toys },
      legs: { type: 'pin', axis: Y_DOWN, thickness: 1.5, length: 1.3, tints: brights },
      antennae: { type: 'pin', scale: 0.4, tints: brights },
    },
    // Spool beetle: a thread spool thorax, big buttons for a shell, crayon legs.
    1: {
      coreRadius: 0.42,
      shell: { type: 'button', scale: 1.35, tints: brights },
      body: { type: 'spool', scale: new Vector3(0.62, 0.62, 0.62), lying: true, tints: toys },
      head: { type: 'block', scale: 0.52, tints: pastels },
      legs: { type: 'crayon', axis: Y_UP, thickness: 0.9, length: 1.35, tints: toys },
      antennae: { type: 'pin', scale: 0.45, tints: brights },
    },
    // Jar beetle: a jam jar body under cardboard wing-cases, pencil legs.
    2: {
      coreRadius: 0.44,
      shell: { type: 'card', scale: 0.66, tints: [KRAFT] },
      body: { type: 'jar', scale: new Vector3(0.6, 0.66, 0.6), lying: true, tints: toys },
      head: { type: 'paintpot', scale: 0.78, tints: brights },
      legs: { type: 'pencil', axis: Y_UP, thickness: 0.8, length: 1.4, tints: [MUSTARD, toys[3], toys[0], toys[8]] },
      antennae: { type: 'pencil', scale: 0.22, tints: [MUSTARD] },
    },
  },
  strider: {
    // Pin strider: hat-pin stilts under a coat-button cap.
    0: {
      coreRadius: 0.4,
      hat: { type: 'button', scale: 1.35, tints: brights },
      body: { type: 'bead', scale: new Vector3(1, 1, 1), lying: false, tints: toys },
      legs: { type: 'pin', axis: Y_DOWN, thickness: 3.2, length: 0, tints: brights },
    },
    // Pencil strider: four pencils and a paint-pot cap on a spool hip.
    1: {
      coreRadius: 0.4,
      hat: { type: 'paintpot', scale: 0.75, tints: brights },
      body: { type: 'spool', scale: new Vector3(0.48, 0.48, 0.48), lying: false, tints: toys },
      legs: { type: 'pencil', axis: Y_UP, thickness: 1.25, length: 0, tints: [MUSTARD, toys[0], toys[3], toys[8], toys[7]] },
    },
    // Ruler strider: long rulers striding on a toy-block hip under a jar.
    2: {
      coreRadius: 0.42,
      hat: { type: 'jar', scale: 0.55, tints: toys },
      body: { type: 'block', scale: new Vector3(0.62, 0.62, 0.62), lying: false, tints: pastels },
      legs: { type: 'ruler', axis: X_AXIS, thickness: 0.9, length: 0, tints: [PINE, MUSTARD, STEEL, CREAM] },
    },
  },
  snapper: {
    // Paper snapper: coloured paper wings, a mini-clothespin beak.
    0: {
      coreRadius: 0.38,
      body: { type: 'bead', scale: new Vector3(1.1, 1.1, 1.1), lying: false, tints: toys },
      wings: { type: 'paper', scale: new Vector3(1.35, 1, 1.0), tints: brights },
      beak: { type: 'jaw', scale: 0.62, tints: [PINE] },
      tail: { type: 'paper', scale: 0.7, tints: pastels },
    },
    // Card snapper: cardboard wings folded off a box flap, clothespin beak.
    1: {
      coreRadius: 0.38,
      body: { type: 'eraser', scale: new Vector3(0.62, 0.62, 0.62), lying: false, tints: pastels },
      wings: { type: 'card', scale: new Vector3(0.66, 1, 0.72), tints: [KRAFT] },
      beak: { type: 'jaw', scale: 0.72, tints: [PINE, toys[0], toys[2]] },
      tail: { type: 'paper', scale: 0.72, tints: brights },
    },
    // Crate snapper: whole box flaps for wings, a toy block breast.
    2: {
      coreRadius: 0.4,
      body: { type: 'block', scale: new Vector3(0.62, 0.62, 0.62), lying: false, tints: brights },
      wings: { type: 'card', scale: new Vector3(0.8, 1.2, 0.8), tints: [KRAFT] },
      beak: { type: 'jaw', scale: 0.82, tints: [PINE, toys[3]] },
      tail: { type: 'card', scale: 0.36, tints: [KRAFT] },
    },
  },
};

/** The spill's recycled shells: layer 0 is the thick outer cage, layer 1 the rewrap. */
export const SPILL_LAYERS: Record<'core' | 'heart', Array<Array<{ type: PieceType; scale: number; count: number }>>> = {
  core: [
    [{ type: 'jar', scale: 2.1, count: 4 }, { type: 'ruler', scale: 1.12, count: 3 }, { type: 'card', scale: 1.96, count: 3 }],
    [{ type: 'paintpot', scale: 2.24, count: 3 }, { type: 'pencil', scale: 1.54, count: 4 }, { type: 'block', scale: 1.96, count: 2 }],
  ],
  heart: [
    [{ type: 'card', scale: 3.64, count: 6 }, { type: 'jar', scale: 3.08, count: 5 }, { type: 'ruler', scale: 1.68, count: 4 }],
    [{ type: 'ruler', scale: 1.82, count: 6 }, { type: 'spool', scale: 3.36, count: 4 }, { type: 'block', scale: 2.8, count: 4 }],
  ],
};

export const SPILL_CORE_RADIUS = { core: 3.3, heart: 6.2 } as const;
export const SPILL_TINTS = TOY_COLORS;
