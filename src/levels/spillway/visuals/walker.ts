import { CylinderGeometry, Float32BufferAttribute, Group, MathUtils, Matrix4, Mesh, Vector3 } from 'three';
import type { BufferGeometry, Color, Material, Object3D } from 'three';
import {
  BODY_SCALE,
  CHASSIS,
  CORE_LOCAL,
  CRANE,
  HATCH_LOCAL,
  HIP,
  SHIN,
  THIGH,
  WALKER_LEGS,
  boomTipLocal,
  solveWalker,
  walkerDamage,
  walkerPoint,
  type WalkerRig,
} from '../walker';
import { chamferBox, createPartBuilder, drum, hull, sharedMachineMaterial, type Finish } from './machine-kit';
import type { Spray } from './spray';

// The salvage walker: a box-girder dredge chassis on four long legs, with a
// slewing crane amidships, a launch rack and the core at the rear, a cab and
// winch at the bow. Every part is built once from machine-kit parts in its own
// joint frame, and each frame the rig from ../walker.ts poses them: hips ride
// the body, thighs and shins run hip to knee to foot, rams stretch between their
// lugs, the feet stay level. The walker also throws its own water and smoke.

export type WalkerColors = {
  paint: Color;
  steel: Color;
  darkSteel: Color;
  hazard: Color;
  rubber: Color;
  lamp: Color;
  glass: Color;
  core: Color;
  concrete: Color;
  smoke: Color;
};

type Fx = { flash: number; lamp: number; deny: number };

export type WalkerModel = {
  group: Group;
  /** Hit flash per leg and for the core; the event choreography writes these. */
  legFx: Fx[];
  coreFx: Fx;
  update(runTime: number, dt: number, world: WalkerWorld): void;
};

export type WalkerWorld = {
  spray: Spray;
  camera: Vector3;
  waterAt(x: number, z: number): number;
  setGateStrain(index: number, amount: number, time: number): void;
};

type Finishes = Record<'paint' | 'hazard' | 'steel' | 'chrome' | 'dark' | 'rubber' | 'lamp' | 'glass' | 'core' | 'concrete', Finish>;

function finishes(colors: WalkerColors): Finishes {
  return {
    paint: { color: colors.paint, metal: 0.25, rough: 0.55, paint: true },
    hazard: { color: colors.paint, metal: 0.25, rough: 0.55, paint: true, hazard: true },
    steel: { color: colors.steel, metal: 0.8, rough: 0.45 },
    chrome: { color: colors.steel.clone().multiplyScalar(1.3), metal: 0.95, rough: 0.18 },
    dark: { color: colors.darkSteel, metal: 0.6, rough: 0.6 },
    rubber: { color: colors.rubber, metal: 0, rough: 0.9 },
    lamp: { color: colors.lamp, metal: 0, rough: 0.3, glow: 3.2 },
    glass: { color: colors.glass, metal: 0.2, rough: 0.12 },
    core: { color: colors.core, metal: 0, rough: 0.4, glow: 4 },
    concrete: { color: colors.concrete, metal: 0, rough: 0.92 },
  };
}

type Builder = ReturnType<typeof createPartBuilder>;

/** A straight member between two points in one plane: a box of `size` cross-section. */
function strut(b: Builder, finish: Finish, from: [number, number, number], to: [number, number, number], size: number) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const geometry = chamferBox(size, size, length, size * 0.2);
  geometry.lookAt(new Vector3(dx, dy, dz));
  b.add(geometry, finish, { at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] });
}

// ---- body ------------------------------------------------------------------------------

function bodyGeometry(f: Finishes) {
  const b = createPartBuilder();
  const { halfWidth: W, height: H, halfLength: L } = CHASSIS;
  const bays = 8;
  const bay = (2 * L) / bays;
  // Two lattice side girders: chords, posts and alternating diagonals.
  for (const side of [-1, 1]) {
    const x = side * (W - 0.6);
    b.add(chamferBox(1.4, 1.4, 2 * L), f.paint, { at: [x, H - 0.7, 0] });
    b.add(chamferBox(1.6, 1.6, 2 * L), f.paint, { at: [x, 0.8, 0] });
    for (let i = 0; i <= bays; i += 1) b.add(chamferBox(1, H - 2.4, 1), f.paint, { at: [x, H / 2, -L + i * bay] });
    for (let i = 0; i < bays; i += 1) {
      const z0 = -L + i * bay;
      const up = i % 2 === 0;
      strut(b, f.paint, [x, up ? 1.4 : H - 1.4, z0], [x, up ? H - 1.4 : 1.4, z0 + bay], 0.7);
    }
    // Solid skin over the rear third: the engine room behind its louvres.
    b.add(chamferBox(0.4, H - 2.6, 2 * L / 3), f.paint, { at: [side * (W - 1.1), H / 2, L * 2 / 3] });
    for (let k = 0; k < 5; k += 1) b.add(chamferBox(0.3, 0.35, 5), f.dark, { at: [side * (W - 0.8), 2.4 + k * 0.9, L * 0.62] }, 'none');
  }
  // Belly: cross girders, twin keels either side of the hatch, the hatch coaming and floodlights.
  for (let z = -L + 1; z <= L - 1; z += 4) b.add(chamferBox(2 * W - 1.6, 1.1, 1), f.paint, { at: [0, 0.55, z] });
  for (const x of [-2.6, 2.6]) {
    b.add(chamferBox(1.1, 1.3, L - 6), f.dark, { at: [x, -0.1, -L + (L - 6) / 2] });
    b.add(chamferBox(1.1, 1.3, L - 6), f.dark, { at: [x, -0.1, L - (L - 6) / 2] });
  }
  for (const side of [-1, 1]) b.add(chamferBox(0.8, 1.6, 10.4), f.hazard, { at: [side * 4.3, -0.2, HATCH_LOCAL.z] });
  for (const end of [-1, 1]) b.add(chamferBox(9.4, 1.6, 0.8), f.hazard, { at: [0, -0.2, HATCH_LOCAL.z + end * 5.2] });
  for (const [x, z] of [[-5.4, -9], [5.4, -9], [-5.4, 10], [5.4, 10]]) b.add(drum(0.6, 0.5, 0.1, 10), f.lamp, { at: [x, -0.35, z] }, 'none');
  // Machinery seen through the lattice: tanks forward, the engine block aft.
  for (const x of [-3.8, 3.8]) b.add(drum(1.6, 13, 0.3, 14), f.steel, { at: [x, 4, -8.5], rot: [Math.PI / 2, 0, 0] }, 'lathe');
  b.add(chamferBox(9, 5, 8), f.dark, { at: [0, 4, 9] });
  // Deck plate with hazard edges.
  b.add(chamferBox(2 * W + 0.4, 0.6, 2 * L + 0.6), f.dark, { at: [0, H + 0.3, 0] });
  for (const side of [-1, 1]) b.add(chamferBox(0.6, 0.3, 2 * L), f.hazard, { at: [side * (W - 0.1), H + 0.7, 0] });
  // Bow: a bumper beam, the operator's cab on the left, a cable winch on the right.
  b.add(chamferBox(2 * W + 0.8, 2.4, 1.3), f.hazard, { at: [0, 1.8, -L - 0.4] });
  b.add(chamferBox(2 * W, H - 3, 0.5), f.paint, { at: [0, H / 2 + 0.6, -L + 0.2] });
  b.add(chamferBox(5.8, 4.8, 5.6), f.paint, { at: [-3.4, H + 3, -L + 3.4] });
  b.add(chamferBox(5.95, 1.5, 5.75), f.glass, { at: [-3.4, H + 4, -L + 3.4] }, 'none');
  b.add(chamferBox(6.4, 0.5, 6.2), f.dark, { at: [-3.4, H + 5.6, -L + 3.4] });
  for (const x of [-5.4, -3.4, -1.4]) b.add(drum(0.36, 0.3, 0.06, 10), f.lamp, { at: [x, H + 5.2, -L + 0.4], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(chamferBox(0.3, 4, 0.3), f.steel, { at: [-1.2, H + 7.6, -L + 5] });
  b.add(drum(0.4, 0.35, 0.08, 10), f.lamp, { at: [-1.2, H + 9.7, -L + 5] }, 'none');
  b.add(drum(1.7, 5.2, 0.25, 16), f.steel, { at: [3.6, H + 2, -L + 3.4], rot: [0, 0, Math.PI / 2] }, 'lathe');
  for (const x of [0.8, 6.4]) b.add(chamferBox(0.6, 3.6, 3.4), f.paint, { at: [x, H + 1.9, -L + 3.4] });
  b.add(drum(1.9, 4.6, 0.1, 16), f.dark, { at: [3.6, H + 2, -L + 3.4], rot: [0, 0, Math.PI / 2] }, 'none');
  // Under the bow, a dredge's bucket ladder: a lattice boom slung from a bow gantry, a chain of buckets along it.
  const ladderTop: [number, number, number] = [0, -0.6, -L + 5];
  const ladderEnd: [number, number, number] = [0, -7.5, -L - 5];
  for (const x of [-1.7, 1.7]) strut(b, f.paint, [x, ladderTop[1], ladderTop[2]], [x, ladderEnd[1], ladderEnd[2]], 0.8);
  for (let k = 0; k <= 6; k += 1) {
    const t = k / 6;
    const y = MathUtils.lerp(ladderTop[1], ladderEnd[1], t);
    const z = MathUtils.lerp(ladderTop[2], ladderEnd[2], t);
    b.add(chamferBox(3.4, 0.4, 0.4), f.steel, { at: [0, y, z] });
    if (k < 6) b.add(hull([[-1.2, 0, 0], [1.2, 0, 0], [-1.2, 0, 1.4], [1.2, 0, 1.4], [-1, -1.3, 0.3], [1, -1.3, 0.3]]), f.dark, { at: [0, y - 0.6, z - 1.2], rot: [0.55, 0, 0] }, 'none');
  }
  b.add(drum(1.4, 3.8, 0.2, 14), f.steel, { at: [0, ladderEnd[1], ladderEnd[2]], rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(drum(1.2, 3.8, 0.2, 14), f.dark, { at: [0, ladderTop[1], ladderTop[2]], rot: [0, 0, Math.PI / 2] }, 'lathe');
  for (const x of [-2.8, 2.8]) strut(b, f.paint, [x, H + 0.6, -L + 1], [x * 0.3, H + 5.5, -L - 2.5], 0.6);
  strut(b, f.dark, [0, H + 5.5, -L - 2.5], [0, ladderEnd[1] + 1, ladderEnd[2] + 0.5], 0.25);
  // Hip housings: a pier plate on the side girder and a drum around each hip pin, with a work lamp.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      b.add(chamferBox(1.6, H + 1, 7), f.hazard, { at: [side * (W + 0.3), H / 2, end * HIP.z] });
      b.add(drum(2.5, 3.4, 0.35, 18), f.dark, { at: [side * (HIP.x + 1.4), HIP.y, end * HIP.z], rot: [0, 0, Math.PI / 2] }, 'lathe');
      b.add(chamferBox(1.4, 1.8, 4.4), f.steel, { at: [side * (W - 0.2), -0.4, end * (HIP.z - 4.5)] });
      b.add(drum(0.4, 0.35, 0.08, 10), f.lamp, { at: [side * (W + 1.2), H + 0.2, end * (HIP.z + 3)], rot: [0, 0, Math.PI / 2] }, 'none');
    }
  }
  // Rear deck: the launch rack, sloping up to the stern, with two skiffs still parked on it.
  const slope = -0.26;
  b.add(chamferBox(10.4, 0.4, 13), f.dark, { at: [0, H + 2.4, 9.8], rot: [slope, 0, 0] });
  for (const x of [-5, -1.6, 1.6, 5]) b.add(chamferBox(0.5, 0.8, 13.2), f.steel, { at: [x, H + 2.9, 9.8], rot: [slope, 0, 0] });
  for (const x of [-4.4, 4.4]) for (const z of [5, 15]) b.add(chamferBox(0.8, z > 10 ? 4.4 : 1.6, 0.8), f.paint, { at: [x, H + (z > 10 ? 2.2 : 1.1), z] });
  for (const x of [-3.3, 3.3]) {
    b.add(hull([[-1.1, 0.3, 2], [1.1, 0.3, 2], [-0.9, -0.3, 2], [0.9, -0.3, 2], [-0.4, 0.28, -1.6], [0.4, 0.28, -1.6], [0, 0.1, -2.3], [0, -0.35, -1.6]]), f.paint, { at: [x, H + 3.7 + (x > 0 ? 0 : 0.8), x > 0 ? 8 : 12], rot: [slope, 0, 0] }, 'none');
    b.add(chamferBox(0.8, 0.5, 1.1), f.lamp, { at: [x, H + 4.3 + (x > 0 ? 0 : 0.8), x > 0 ? 8.4 : 12.4], rot: [slope, 0, 0] }, 'none');
  }
  // Exhaust stacks at the stern corners, sooted at the top.
  for (const side of [-1, 1]) {
    b.add(drum(0.95, 12, 0.2, 14), f.paint, { at: [side * 6.2, H + 6.4, 15.2] }, 'lathe');
    b.add(drum(1.15, 1.2, 0.2, 14), f.dark, { at: [side * 6.2, H + 12.6, 15.2] }, 'lathe');
    b.add(drum(1.05, 0.6, 0.1, 14), f.hazard, { at: [side * 6.2, H + 3.2, 15.2] }, 'none');
  }
  // Stern: the core bay in a hazard-striped frame, with the stern chute under it.
  const coreY = CORE_LOCAL.y;
  b.add(chamferBox(10.2, 1.4, 1.4), f.hazard, { at: [0, coreY + 3.6, L + 0.3] });
  b.add(chamferBox(10.2, 1.4, 1.4), f.hazard, { at: [0, coreY - 3.4, L + 0.3] });
  for (const side of [-1, 1]) {
    b.add(chamferBox(1.4, 8.4, 1.4), f.hazard, { at: [side * 4.4, coreY, L + 0.3] });
    b.add(chamferBox(2.4, H - 1, 0.6), f.paint, { at: [side * 6.2, H / 2, L + 0.1] });
    b.add(drum(0.45, 0.4, 0.08, 10), f.lamp, { at: [side * 6.2, H - 1.2, L + 0.5], rot: [Math.PI / 2, 0, 0] }, 'none');
  }
  b.add(chamferBox(7.4, 6, 0.6), f.dark, { at: [0, coreY, L - 1.4] });
  for (let k = 0; k < 6; k += 1) b.add(drum(2.6 - k * 0.12, 0.35, 0.05, 20), f.steel, { at: [0, coreY, L - 1.2 + k * 0.12], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(chamferBox(8, 0.5, 4), f.steel, { at: [0, -1.2, L - 1.5], rot: [0.35, 0, 0] });
  return b.build();
}

function hatchDoorGeometry(f: Finishes, side: number) {
  const b = createPartBuilder();
  b.add(chamferBox(3.6, 0.4, 9.6), f.paint, { at: [-side * 1.9, 0, 0] });
  for (const z of [-3, 0, 3]) b.add(chamferBox(3.2, 0.5, 0.4), f.dark, { at: [-side * 1.9, 0.35, z] });
  return b.build();
}

function coreDoorGeometry(f: Finishes, side: number) {
  const b = createPartBuilder();
  b.add(chamferBox(3.8, 6, 0.6), f.hazard, { at: [-side * 1.9, 0, 0] });
  for (const y of [-2, 0, 2]) b.add(chamferBox(3.2, 0.5, 0.3), f.dark, { at: [-side * 1.9, y, 0.4] });
  return b.build();
}

function coreGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(2, 2, 0.4, 20), f.core, { rot: [Math.PI / 2, 0, 0] }, 'none');
  for (let k = 0; k < 4; k += 1) b.add(chamferBox(0.35, 4.6, 0.4), f.dark, { at: [0, 0, 1], rot: [0, 0, (k * Math.PI) / 4] }, 'none');
  return b.build();
}

// ---- crane ------------------------------------------------------------------------------

function turretGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(3.6, 0.9, 0.2, 24), f.dark, { at: [0, 0.45, 0] }, 'lathe');
  b.add(chamferBox(6.6, 4, 7), f.paint, { at: [0, 2.9, 1.4] });
  b.add(chamferBox(1.6, 1.4, 0.3), f.glass, { at: [-2.4, 3.6, -2.15] }, 'none');
  b.add(chamferBox(6.2, 2.8, 2.6), f.hazard, { at: [0, 2.3, 6] });
  // Gantry for the luffing pendants, and the boom foot lugs.
  for (const side of [-1, 1]) strut(b, f.paint, [side * 2.8, 4.8, 3.6], [side * 1, 10.5, 3], 0.7);
  b.add(chamferBox(2.8, 0.7, 0.9), f.steel, { at: [0, 10.6, 3] });
  for (const side of [-1, 1]) b.add(chamferBox(0.6, 2, 2), f.steel, { at: [side * 1.6, CRANE.foot, 0] });
  b.add(drum(0.4, 0.35, 0.08, 10), f.lamp, { at: [0, 11.2, 3] }, 'none');
  return b.build();
}

/** A lattice boom along -z from its foot pin, tapering to the sheave head. */
function boomGeometry(f: Finishes) {
  const b = createPartBuilder();
  const length = CRANE.boom;
  const half = (z: number) => MathUtils.lerp(1.2, 0.6, z / length);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) strut(b, f.paint, [sx * 1.2, sy * 1.2, 0], [sx * 0.6, sy * 0.6, -length], 0.5);
  }
  const bays = 12;
  for (let i = 0; i < bays; i += 1) {
    const z0 = (i / bays) * length;
    const z1 = ((i + 1) / bays) * length;
    const [h0, h1] = [half(z0), half(z1)];
    const flip = i % 2 === 0 ? 1 : -1;
    for (const sx of [-1, 1]) strut(b, f.steel, [sx * h0, -flip * h0, -z0], [sx * h1, flip * h1, -z1], 0.22);
    strut(b, f.steel, [-flip * h0, h0, -z0], [flip * h1, h1, -z1], 0.22);
  }
  b.add(chamferBox(3, 2.8, 2.4), f.hazard, { at: [0, 0, -1] });
  b.add(drum(1, 1.8, 0.15, 14), f.steel, { at: [0, -0.2, -length], rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(chamferBox(1.6, 1.4, 2), f.hazard, { at: [0, 0.4, -length + 1] });
  b.add(drum(0.35, 0.3, 0.06, 10), f.lamp, { at: [0, 1.2, -length + 0.8] }, 'none');
  return b.build();
}

function clawHeadGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(1.1, 1.3, 0.2, 14), f.dark, { at: [0, 0, 0] }, 'lathe');
  b.add(chamferBox(3.2, 0.8, 1.4), f.hazard, { at: [0, -0.8, 0] });
  return b.build();
}

function clawJawGeometry(f: Finishes, side: number) {
  const b = createPartBuilder();
  b.add(hull([
    [-1.4, 0, side * 0.2], [1.4, 0, side * 0.2], [-1.4, 0, side * 1], [1.4, 0, side * 1],
    [-1.2, -2.8, side * 0.05], [1.2, -2.8, side * 0.05], [-1.2, -1.8, side * 1.5], [1.2, -1.8, side * 1.5],
  ]), f.steel, {}, 'none');
  for (const x of [-1, 0, 1]) b.add(hull([[x - 0.25, -2.6, side * 0.05], [x + 0.25, -2.6, side * 0.05], [x - 0.15, -2.6, side * 0.5], [x, -3.5, side * -0.2]]), f.dark, {}, 'none');
  return b.build();
}

// ---- legs --------------------------------------------------------------------------------

/** The thigh: a deep box girder from a heavy hip housing, carrying the twin lift-ram lugs. */
function thighGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(2.4, 5.2, 0.35, 18), f.steel, { rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(chamferBox(5, 5.6, 7.5), f.paint, { at: [0, 0, 3.6] });
  b.add(chamferBox(5.2, 1.2, 7.7), f.hazard, { at: [0, 2.3, 3.6] });
  b.add(chamferBox(3.8, 4.4, THIGH - 4), f.paint, { at: [0, 0, THIGH / 2 + 1] });
  for (const side of [-1, 1]) {
    b.add(chamferBox(0.5, 2, THIGH - 7), f.dark, { at: [side * 2, 0, THIGH / 2 + 1.5] });
    b.add(chamferBox(1, 1.4, 2.2), f.steel, { at: [side * 1.3, -2.6, THIGH * 0.55] });
  }
  b.add(chamferBox(4.1, 4.7, 1.6), f.hazard, { at: [0, 0, THIGH - 2.5] });
  return b.build();
}

function shinGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(2.3, 4.6, 0.4, 18), f.steel, { rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(chamferBox(2.6, 3.2, 30), f.paint, { at: [0, 0, 16.5] });
  for (const side of [-1, 1]) b.add(chamferBox(0.4, 1.6, 24), f.dark, { at: [side * 1.4, 0, 16] });
  b.add(chamferBox(3.6, 3.6, 1.4), f.hazard, { at: [0, 0, 31] });
  // The wading boot: bare, heavier steel below the waterline.
  b.add(chamferBox(3.2, 3.4, SHIN - 32), f.steel, { at: [0, 0, 32 + (SHIN - 32) / 2] });
  b.add(chamferBox(3.6, 1, 2), f.dark, { at: [0, 0, 40] });
  b.add(drum(1.5, 3.8, 0.25, 14), f.dark, { at: [0, 0, SHIN], rot: [0, 0, Math.PI / 2] }, 'lathe');
  return b.build();
}

/** The armour over each knee: shot off in the first stage. It carries the lamp that shows the leg is open. */
function kneeArmourGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(hull([[-2.6, 0, -2.4], [2.6, 0, -2.4], [-2.6, 0, 3], [2.6, 0, 3], [-2, -1.6, -1.8], [2, -1.6, -1.8], [-2, -1.6, 2.4], [2, -1.6, 2.4]]), f.hazard, { at: [0, -1.9, 0] }, 'none');
  b.add(drum(0.6, 0.5, 0.1, 12), f.lamp, { at: [0, -3.6, 0.4] }, 'none');
  for (const side of [-1, 1]) b.add(drum(0.35, 0.3, 0.05, 8), f.lamp, { at: [side * 1.6, -3.4, -0.8] }, 'none');
  return b.build();
}

function footGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(drum(1.7, 3.4, 0.25, 14), f.steel, { rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(chamferBox(4, 1.4, 4.4), f.paint, { at: [0, -0.9, 0] });
  b.add(chamferBox(6.6, 1.2, 8.2), f.dark, { at: [0, -2.1, -0.4] });
  for (const x of [-2.2, 0, 2.2]) b.add(hull([[x - 0.6, -2.7, -4.2], [x + 0.6, -2.7, -4.2], [x - 0.5, -1.5, -4.2], [x + 0.5, -1.5, -4.2], [x, -3.3, -6.6]]), f.steel, {}, 'none');
  b.add(hull([[-0.8, -2.7, 3.6], [0.8, -2.7, 3.6], [-0.6, -1.5, 3.6], [0.6, -1.5, 3.6], [0, -3, 5.4]]), f.steel, {}, 'none');
  return b.build();
}

/** Hydraulic ram halves, each along +z from its own lug: the barrel from the base, the rod from the tip. */
function barrelGeometry(f: Finishes, length: number) {
  const b = createPartBuilder();
  b.add(drum(0.62, length, 0.12, 12), f.dark, { at: [0, 0, length / 2], rot: [Math.PI / 2, 0, 0] }, 'lathe');
  b.add(drum(0.75, 0.6, 0.1, 12), f.paint, { at: [0, 0, length - 0.4], rot: [Math.PI / 2, 0, 0] }, 'none');
  return b.build();
}

function rodGeometry(f: Finishes, length: number) {
  const b = createPartBuilder();
  b.add(drum(0.3, length, 0.05, 10), f.chrome, { at: [0, 0, length / 2], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(drum(0.55, 0.9, 0.1, 10), f.dark, { rot: [Math.PI / 2, 0, 0] }, 'none');
  return b.build();
}

function slabGeometry(f: Finishes) {
  const b = createPartBuilder();
  b.add(hull([
    [-2.6, -0.8, -1.9], [2.4, -0.7, -1.7], [-2.2, -0.8, 2], [2.7, -0.8, 1.6],
    [-2.5, 0.8, -1.6], [2.2, 0.7, -1.9], [-2.4, 0.9, 1.8], [1.9, 0.8, 2.1], [0.4, 1, 2.4], [3, 0.2, 0],
  ]), f.concrete, {}, 'none');
  // Torn rebar sticking out of the broken edges.
  for (const [x, z, yaw] of [[2.6, -1.2, 0.3], [2.8, 0.6, -0.2], [-2.6, 0.4, 2.9], [0.5, 2.2, 1.4]] as const) {
    b.add(chamferBox(0.16, 0.16, 2.2, 0.04), f.dark, { at: [x + Math.sin(yaw) * 0.8, 0.1, z + Math.cos(yaw) * 0.8], rot: [0.3, yaw, 0] }, 'none');
  }
  b.add(chamferBox(0.2, 1.2, 3.6), f.steel, { at: [-1.4, 0, 0.3] }, 'none');
  return b.build();
}

// ---- model --------------------------------------------------------------------------------

const newFx = (): Fx => ({ flash: 0, lamp: 1, deny: 0 });
const UP = new Vector3(0, 1, 0);

type LegParts = {
  fx: Fx;
  thigh: Mesh;
  shin: Mesh;
  armour: Mesh;
  foot: Mesh;
  rams: Array<{ barrel: Mesh; rod: Mesh }>;
  planted: boolean;
  lastLift: number;
};

let walkerFinishes: Finishes | null = null;
let walkerMaterial: Material | null = null;

function kit(colors: WalkerColors) {
  walkerFinishes ??= finishes(colors);
  // Its own stripe and wear scales: at the walker's size the enemies' fine hazard stripes read as grey hatching.
  walkerMaterial ??= sharedMachineMaterial({ bare: colors.steel, hazard: colors.hazard, wearScale: 0.9, stripeScale: 0.45 });
  return { f: walkerFinishes, material: walkerMaterial };
}

export function createWalker(colors: WalkerColors): WalkerModel {
  const { f, material } = kit(colors);
  const group = new Group();
  group.name = 'walker';
  // The walker is the boss: its legs and core are the targets, so its own body never counts as cover.
  group.userData.raildIgnoreOcclusion = true;
  const bodyFx = newFx();
  const coreFx: Fx = { flash: 0, lamp: 0.2, deny: 0 };
  const part = (geometry: BufferGeometry, fx: Fx, parent: Object3D = group) => {
    const mesh = new Mesh(geometry, material);
    mesh.userData.fx = fx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const body = new Group();
  body.scale.setScalar(BODY_SCALE);
  group.add(body);
  part(bodyGeometry(f), bodyFx, body);
  const hatch = [-1, 1].map((side) => {
    const door = part(hatchDoorGeometry(f, side), bodyFx, body);
    door.position.set(side * 4, HATCH_LOCAL.y, HATCH_LOCAL.z);
    return door;
  });
  const coreDoors = [-1, 1].map((side) => {
    const door = part(coreDoorGeometry(f, side), bodyFx, body);
    door.position.set(side * 3.7, CORE_LOCAL.y, CHASSIS.halfLength + 0.9);
    return door;
  });
  const core = part(coreGeometry(f), coreFx, body);
  core.position.copy(CORE_LOCAL).setZ(CHASSIS.halfLength - 1);
  core.castShadow = false;

  const turret = new Group();
  turret.position.copy(CRANE.ring);
  body.add(turret);
  part(turretGeometry(f), bodyFx, turret);
  const boom = part(boomGeometry(f), bodyFx, turret);
  boom.position.set(0, CRANE.foot, 0);
  const pendant = part(new CylinderGeometry(0.1, 0.1, 1, 6).translate(0, 0.5, 0), bodyFx);
  const cable = part(new CylinderGeometry(0.14, 0.14, 1, 6).translate(0, -0.5, 0), bodyFx);
  for (const line of [pendant, cable]) line.castShadow = false;
  // Cylinder parts carry no machine attributes: give them the dark-steel finish.
  for (const line of [pendant, cable]) finishLine(line.geometry, f.dark);
  const claw = new Group();
  claw.scale.setScalar(1.4);
  group.add(claw);
  part(clawHeadGeometry(f), bodyFx, claw);
  const jaws = [-1, 1].map((side) => {
    const jaw = part(clawJawGeometry(f, side), bodyFx, claw);
    jaw.position.set(0, -1, side * 0.2);
    return jaw;
  });
  // The slab being carried to the throw; gameplay spawns the thrown one where this lets go.
  const heldSlab = part(slabGeometry(f), bodyFx, claw);
  heldSlab.position.set(0, -2.9, 0);
  heldSlab.scale.setScalar(1 / 1.4);

  const thighGeo = thighGeometry(f);
  const shinGeo = shinGeometry(f);
  const armourGeo = kneeArmourGeometry(f);
  const footGeo = footGeometry(f);
  // Two lift rams side by side, then the knee ram.
  const liftRam = { barrel: barrelGeometry(f, 8), rod: rodGeometry(f, 8.5) };
  const ramGeo = [liftRam, liftRam, { barrel: barrelGeometry(f, 9), rod: rodGeometry(f, 10) }];
  const legs: LegParts[] = WALKER_LEGS.map(() => {
    const fx = newFx();
    const shin = part(shinGeo, fx);
    const armour = part(armourGeo, fx, shin);
    return {
      fx,
      thigh: part(thighGeo, fx),
      shin,
      armour,
      foot: part(footGeo, fx),
      rams: ramGeo.map((geo) => ({ barrel: part(geo.barrel, fx), rod: part(geo.rod, fx) })),
      planted: true,
      lastLift: 0,
    };
  });

  // ---- posing ----
  const basis = new Matrix4();
  const axisX = new Vector3();
  const axisY = new Vector3();
  const axisZ = new Vector3();
  const convex = new Vector3();
  const mid = new Vector3();
  const a = new Vector3();
  const c = new Vector3();
  const tip = new Vector3();
  const scratch = new Vector3();

  /** Place a part at `from`, its +z toward `to`, its +x along `hinge`. */
  function orient(mesh: Object3D, from: Vector3, to: Vector3, hinge: Vector3) {
    axisZ.copy(to).sub(from).normalize();
    axisX.copy(hinge).addScaledVector(axisZ, -hinge.dot(axisZ)).normalize();
    axisY.crossVectors(axisZ, axisX);
    basis.makeBasis(axisX, axisY, axisZ);
    mesh.position.copy(from);
    mesh.quaternion.setFromRotationMatrix(basis);
  }

  function placeRam(ram: { barrel: Mesh; rod: Mesh }, base: Vector3, end: Vector3, hinge: Vector3, burst: boolean) {
    orient(ram.barrel, base, end, hinge);
    orient(ram.rod, end, base, hinge);
    ram.rod.visible = !burst;
  }

  function poseLeg(rig: WalkerRig, index: number) {
    const leg = rig.legs[index];
    const spec = WALKER_LEGS[index];
    const parts = legs[index];
    const hinge = scratch.copy(leg.foot).sub(leg.hip).cross(leg.pole).normalize();
    orient(parts.thigh, leg.hip, leg.knee, hinge);
    orient(parts.shin, leg.knee, leg.foot, hinge);
    // Armour faces out of the bend.
    mid.addVectors(leg.hip, leg.foot).multiplyScalar(0.5);
    convex.copy(leg.knee).sub(mid).normalize();
    parts.armour.visible = walkerDamage.legStage[index] < 1 && leg.give <= 0;
    parts.foot.position.copy(leg.foot);
    parts.foot.rotation.set(0, rig.footYaw, 0);
    // Twin lift rams: from the lugs under the hip housing to the underside of the thigh.
    for (const [k, offset] of [[0, -1.3], [1, 1.3]] as const) {
      walkerPoint(rig, a.set(spec.side * (CHASSIS.halfWidth - 0.2), -0.4, spec.end * (HIP.z - 4.5) + offset), a);
      tip.lerpVectors(leg.hip, leg.knee, 0.55).addScaledVector(convex, -2.4).addScaledVector(hinge, offset * spec.end);
      placeRam(parts.rams[k], a, tip, hinge, false);
    }
    // Knee ram: across the joint on its outside, thigh to shin.
    a.lerpVectors(leg.hip, leg.knee, 0.3).addScaledVector(convex, 2.8);
    c.lerpVectors(leg.knee, leg.foot, 0.22).addScaledVector(convex, 2);
    placeRam(parts.rams[2], a, c, hinge, leg.give > 0);
  }

  function poseCrane(rig: WalkerRig) {
    const crane = rig.crane;
    turret.rotation.set(0, crane.slew, 0);
    boom.rotation.set(crane.luff, 0, 0);
    // Pendant from the gantry top to the boom head; cable from the boom head to the claw.
    walkerPoint(rig, boomTipLocal(crane, tip), tip);
    body.localToWorld(a.set(0, 10.6, 3).applyAxisAngle(UP, crane.slew).add(CRANE.ring));
    orient(pendant, a, tip, axisX.set(1, 0, 0));
    pendant.rotateX(Math.PI / 2);
    pendant.scale.set(1, a.distanceTo(tip), 1);
    cable.position.copy(tip);
    cable.quaternion.identity();
    cable.scale.set(1, Math.max(0.1, crane.cable - 1.2), 1);
    claw.position.copy(tip).addScaledVector(UP, 1.4 - crane.cable);
    claw.rotation.set(0, rig.footYaw + crane.slew, 0);
    jaws[0].rotation.x = -crane.open * 0.75;
    jaws[1].rotation.x = crane.open * 0.75;
    heldSlab.visible = crane.holding;
  }

  // ---- particles ----
  const foam = new Vector3();
  const direction = new Vector3();
  const line = new Vector3();
  let exhaustClock = 0;

  function waterWork(rig: WalkerRig, dt: number, world: WalkerWorld, near: number) {
    rig.legs.forEach((leg, index) => {
      const parts = legs[index];
      const water = world.waterAt(leg.foot.x, leg.foot.z);
      const wet = leg.foot.y < water + 2;
      if (rig.state === 'wading' || rig.state === 'climbing') {
        // A foot coming down smashes the surface; one lifting streams water.
        if (leg.planted && !parts.planted && wet) {
          foam.copy(leg.foot).setY(water + 0.4);
          world.spray.spray({ at: foam, count: 140 * near, speed: 11, spread: 0.65, life: 1.7, size: 1.8, radius: 2.8 });
          world.spray.mist({ at: foam, count: 2, size: 24, life: 6, radius: 5 });
        }
        if (!leg.planted && leg.lift > parts.lastLift && leg.foot.y < water + 6) {
          world.spray.spray({ at: leg.foot, count: dt * 160 * near, direction: direction.set(0, -1, 0), speed: 2, spread: 0.6, life: 1, size: 1, radius: 2.2 });
        }
        // The river piles up against the planted boots: a standing plume and a foam wake downstream.
        if (leg.planted && wet) {
          foam.copy(leg.foot).setY(water + 0.3);
          direction.copy(rig.pose.forward).multiplyScalar(-0.3).setY(1);
          world.spray.spray({ at: foam, count: dt * (30 + rig.pose.speed * 3) * near, direction, speed: 4 + rig.pose.speed * 0.1, spread: 0.5, life: 1.1, size: 1.2, radius: 1.8 });
        }
      }
      parts.planted = leg.planted;
      parts.lastLift = leg.lift;
    });
  }

  function exhaust(rig: WalkerRig, dt: number, world: WalkerWorld, near: number) {
    exhaustClock += dt;
    const dead = rig.collapse > 0.5;
    for (const side of [-1, 1]) {
      walkerPoint(rig, a.set(side * 6.2, CHASSIS.height + 13.4, 15.2), a);
      // A heavy diesel: a thump of smoke every half second, harder while it hauls.
      const pulse = Math.max(0, Math.sin(exhaustClock * 12 + side)) ** 4;
      world.spray.spray({ at: a, count: dt * (dead ? 4 : 10 + pulse * 30) * near, direction: direction.set(0.15, 1, 0.1), speed: dead ? 3 : 9, spread: 0.25, life: 1.8, size: dead ? 2 : 2.8, radius: 0.5, color: colors.smoke });
      world.spray.mist({ at: a.addScaledVector(UP, 4), count: dt * 2.5, direction: direction.set(0.3, 1, 0), speed: 2.5, spread: 0.3, life: 6, size: 9, color: colors.smoke });
    }
  }

  function damageSmoke(rig: WalkerRig, dt: number, world: WalkerWorld) {
    rig.legs.forEach((leg, index) => {
      if (leg.give <= 0) return;
      // Broken knees bleed smoke and hydraulic mist.
      world.spray.spray({ at: leg.knee, count: dt * 14, direction: direction.set(0, 1, 0), speed: 4, spread: 0.5, life: 1.6, size: 2.4, color: colors.smoke });
      if (Math.random() < dt * 3) world.spray.spray({ at: leg.knee, count: 30, direction: line.copy(leg.knee).sub(leg.hip).normalize(), speed: 9, spread: 0.3, life: 0.9, size: 0.6 });
      legs[index].fx.lamp = 0;
    });
    if (walkerDamage.coreDownAt <= rig.time && rig.visible) {
      walkerPoint(rig, a.copy(CORE_LOCAL), a);
      world.spray.spray({ at: a, count: dt * 30, direction: direction.set(0, 1, 0.4), speed: 5, spread: 0.5, life: 2.2, size: 3.4, color: colors.smoke });
    }
  }

  return {
    group,
    legFx: legs.map((leg) => leg.fx),
    coreFx,
    update(runTime, dt, world) {
      const rig = solveWalker(runTime);
      group.visible = rig.visible;
      if (!rig.visible) return;
      body.position.copy(rig.position);
      body.quaternion.copy(rig.quaternion);
      body.updateMatrixWorld();
      for (let i = 0; i < legs.length; i += 1) poseLeg(rig, i);
      poseCrane(rig);
      hatch[0].rotation.z = -rig.hatch * 1.35;
      hatch[1].rotation.z = rig.hatch * 1.35;
      coreDoors[0].rotation.y = -rig.coreDoors * 1.9;
      coreDoors[1].rotation.y = rig.coreDoors * 1.9;

      // Lamps: open legs blink their knee lamps; the core glows once bared; everything gutters when it dies.
      const dying = rig.collapse > 0 ? Math.max(0, 1 - rig.collapse * 1.2) * (Math.random() < 0.3 ? 0.2 : 1) : 1;
      bodyFx.lamp = dying;
      legs.forEach((leg, i) => {
        const open = walkerDamage.legOpen[i];
        leg.fx.lamp = (open ? 1.4 + 1.4 * Math.sign(Math.sin(runTime * 9)) : 0.8) * dying;
        leg.fx.flash = Math.max(0, leg.fx.flash - dt * 5);
      });
      coreFx.lamp = rig.coreDoors > 0 ? (0.6 + rig.coreDoors * 1.2 + Math.sin(runTime * 14) * 0.3 * rig.coreDoors) * (rig.collapse > 0 ? 0.3 : 1) : 0.2;
      coreFx.flash = Math.max(0, coreFx.flash - dt * 5);

      rig.gateStrain.forEach((strain, index) => {
        if (strain >= 0) world.setGateStrain(index, strain, runTime);
      });
      if (dt <= 0) return;
      // Particles only while it is close enough to see them.
      const distance = rig.position.distanceTo(world.camera);
      const near = 1 - MathUtils.smoothstep(distance, 350, 700);
      if (near <= 0) return;
      waterWork(rig, dt, world, near);
      exhaust(rig, dt, world, near);
      damageSmoke(rig, dt, world);
    },
  };
}

/** Machine-kit attributes for a plain geometry, so it draws with the shared material. */
function finishLine(geometry: BufferGeometry, finish: Finish) {
  const count = geometry.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  const surface = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    color.set([finish.color.r, finish.color.g, finish.color.b], i * 3);
    surface.set([finish.metal ?? 0.35, finish.rough ?? 0.6, 0, 0], i * 4);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  geometry.setAttribute('surface', new Float32BufferAttribute(surface, 4));
  geometry.setAttribute('detail', new Float32BufferAttribute(new Float32Array(count * 2), 2));
}

// ---- boss targets ---------------------------------------------------------------------------

/**
 * The fight's target meshes. Legs and the core are drawn by the walker itself,
 * so their targets are empty frames the rig seats on the knee or the core bay;
 * the slab is a torn block of gate concrete.
 */
export function createBossTargetMesh(kind: 'leg' | 'core' | 'slab', colors: WalkerColors) {
  const group = new Group();
  const fx = newFx();
  group.userData.fx = fx;
  if (kind === 'slab') {
    const { f, material } = kit(colors);
    const mesh = new Mesh(slabGeometry(f), material);
    mesh.userData.fx = fx;
    mesh.castShadow = true;
    group.add(mesh);
    group.userData.spinner = mesh;
    group.userData.lockSize = 5.5;
  } else {
    group.userData.lockSize = kind === 'leg' ? 7 : 6;
  }
  return group;
}
