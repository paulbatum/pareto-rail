import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';

// Capital-ship construction. No look decisions live here: every colour, size,
// and count arrives as a parameter from the environment spine. What this file
// owns is the *grammar* both fleets share, so a friendly cruiser and an enemy
// dreadnought are recognisably the same kind of object at different scales:
//
//   a long tapering box keel, stepped superstructure blocks on the dorsal
//   spine, ventral fins, an engine cluster at the stern, and — the level's
//   signature — two continuous rim strips running the full length of the hull
//   along its upper and lower chines. The nebula is the only light in the
//   level, so those strips are how a hull separates from the background: a
//   magenta key line on top, a gold fill line underneath, and pure silhouette
//   in between.
//
// Local space: +Z is the bow, X is beam, Y is height.

export type CapitalShipOptions = {
  length: number;
  beam: number;
  height: number;
  hullColor: Color;
  plateColor: Color;
  /** Upper-chine rim, keyed to the nebula's magenta side. */
  rimKey: Color;
  /** Lower-chine rim, keyed to the nebula's gold side. */
  rimFill: Color;
  /** Faction signal colour: engines, running lights, muzzle flashes. */
  accent: Color;
  engines: number;
  towers: number;
  /** Broadside blisters per side. Their muzzle materials come back for beat flashes. */
  batteries?: number;
  /** Hot seam lines cut into the hull — the enemy fleet's molten look. */
  seams?: boolean;
  seed: number;
  /** Multiplies rim and light brightness; distant hulls run dimmer. */
  glow?: number;
};

export type CapitalShip = {
  group: Group;
  /** Muzzle flare materials, port side then starboard, for beat-synced salvos. */
  muzzles: MeshBasicMaterial[];
  /** Engine bell materials, so a ship can throttle up under the score. */
  engines: MeshBasicMaterial[];
  rimMaterials: MeshBasicMaterial[];
  length: number;
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new BoxGeometry(w, h, d).applyMatrix4(new Matrix4().makeTranslation(x, y, z));

export function createCapitalShip(options: CapitalShipOptions): CapitalShip {
  const rng = mulberry32(options.seed);
  const glow = options.glow ?? 1;
  const group = new Group();
  const { length, beam, height } = options;

  // ---- keel: ten segments, tapering to a wedge prow -------------------------
  const hullParts: BufferGeometry[] = [];
  const SEGMENTS = 10;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    const mid = (t0 + t1) / 2;
    // Full section aft, drawn down to a blade forward.
    const taper = mid < 0.62 ? 1 - mid * 0.16 : 1 - 0.1 - (mid - 0.62) ** 1.5 * 2.3;
    const w = Math.max(beam * 0.08, beam * taper);
    const h = Math.max(height * 0.1, height * (mid < 0.7 ? 1 - mid * 0.2 : 1 - 0.14 - (mid - 0.7) * 1.9));
    hullParts.push(box(w, h, (length / SEGMENTS) * 1.02, 0, 0, (mid - 0.5) * length));
  }
  // Ventral fins: the thing that makes a hull read as "keel" rather than "brick".
  hullParts.push(box(beam * 0.14, height * 0.9, length * 0.3, 0, -height * 0.62, -length * 0.16));
  hullParts.push(box(beam * 1.24, height * 0.1, length * 0.16, 0, -height * 0.18, -length * 0.3));

  const hullMaterial = new MeshBasicMaterial({ color: options.hullColor.clone() });
  group.add(new Mesh(mergeGeometries(hullParts), hullMaterial));
  for (const geometry of hullParts) geometry.dispose();

  // ---- superstructure: stepped blocks walking the dorsal spine --------------
  const towerParts: BufferGeometry[] = [];
  for (let i = 0; i < options.towers; i += 1) {
    const t = -0.34 + (i / Math.max(1, options.towers - 1)) * 0.62;
    const scale = 0.55 + rng() * 0.75;
    const w = beam * (0.3 + rng() * 0.34);
    const h = height * 0.5 * scale;
    const d = length * (0.03 + rng() * 0.05);
    towerParts.push(box(w, h, d, (rng() - 0.5) * beam * 0.3, height * 0.5 + h / 2, t * length));
    // A mast or sensor spine on the taller blocks.
    if (scale > 0.95) towerParts.push(box(beam * 0.035, h * 1.5, beam * 0.035, 0, height * 0.5 + h * 1.4, t * length));
  }
  const plateMaterial = new MeshBasicMaterial({ color: options.plateColor.clone() });
  if (towerParts.length) {
    group.add(new Mesh(mergeGeometries(towerParts), plateMaterial));
    for (const geometry of towerParts) geometry.dispose();
  }

  // ---- rim light: the level's signature -------------------------------------
  // Two continuous strips down the full length of the hull, outboard of the
  // plating so they read as the nebula catching an edge rather than as paint.
  const rimMaterials: MeshBasicMaterial[] = [];
  const addRim = (color: Color, y: number, intensity: number) => {
    const strips: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      strips.push(box(beam * 0.03, height * 0.035, length * 0.94, side * beam * 0.5, y, -length * 0.02));
    }
    strips.push(box(beam * 0.9, height * 0.03, length * 0.05, 0, y, length * 0.42));
    const material = createAdditiveBasicMaterial({ color: color.clone().multiplyScalar(intensity * glow) });
    group.add(new Mesh(mergeGeometries(strips), material));
    for (const geometry of strips) geometry.dispose();
    rimMaterials.push(material);
  };
  addRim(options.rimKey, height * 0.52, 1.5);
  addRim(options.rimFill, -height * 0.52, 1.1);

  // ---- hot seams: the enemy fleet's molten plating --------------------------
  if (options.seams) {
    const seams: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1) {
      const z = (rng() - 0.5) * length * 0.8;
      const y = (rng() - 0.5) * height * 0.6;
      for (const side of [-1, 1]) {
        seams.push(box(beam * 0.012, height * 0.02, length * (0.03 + rng() * 0.08), side * beam * 0.5, y, z));
      }
    }
    const seamMaterial = createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(0.9 * glow) });
    group.add(new Mesh(mergeGeometries(seams), seamMaterial));
    for (const geometry of seams) geometry.dispose();
    rimMaterials.push(seamMaterial);
  }

  // ---- running lights --------------------------------------------------------
  const lights: BufferGeometry[] = [];
  const lightCount = Math.max(6, Math.round(length / 26));
  for (let i = 0; i < lightCount; i += 1) {
    const z = (i / (lightCount - 1) - 0.5) * length * 0.9;
    for (const side of [-1, 1]) {
      lights.push(box(beam * 0.02, height * 0.028, beam * 0.02, side * beam * 0.52, height * (i % 2 ? 0.2 : -0.24), z));
    }
  }
  const lightMaterial = createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(1.3 * glow) });
  group.add(new Mesh(mergeGeometries(lights), lightMaterial));
  for (const geometry of lights) geometry.dispose();
  rimMaterials.push(lightMaterial);

  // ---- engines: a cluster of bells at the stern ------------------------------
  const engineMaterials: MeshBasicMaterial[] = [];
  const bellGeometry = new CircleGeometry(Math.min(beam, height) * 0.17, 16);
  for (let i = 0; i < options.engines; i += 1) {
    const spread = options.engines === 1 ? 0 : (i / (options.engines - 1) - 0.5) * beam * 0.62;
    const material = createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(2.2 * glow) });
    const bell = new Mesh(bellGeometry.clone(), material);
    bell.position.set(spread, -height * 0.04, -length * 0.5 - 0.4);
    bell.rotation.y = Math.PI;
    group.add(bell);
    engineMaterials.push(material);
  }
  bellGeometry.dispose();
  const housings: BufferGeometry[] = [];
  housings.push(box(beam * 0.92, height * 0.62, length * 0.06, 0, -height * 0.04, -length * 0.48));
  group.add(new Mesh(mergeGeometries(housings), plateMaterial));
  for (const geometry of housings) geometry.dispose();

  // ---- broadside batteries ---------------------------------------------------
  // Blisters down both flanks with a flat muzzle quad facing outboard. The
  // environment drives those quads on the beat so a cruiser's salvo is a
  // musical event, not an animation loop.
  const muzzles: MeshBasicMaterial[] = [];
  const batteryCount = options.batteries ?? 0;
  if (batteryCount > 0) {
    const blisters: BufferGeometry[] = [];
    const muzzleGeometry = new PlaneGeometry(beam * 0.34, height * 0.34);
    for (const side of [-1, 1]) {
      for (let i = 0; i < batteryCount; i += 1) {
        const z = (i / Math.max(1, batteryCount - 1) - 0.5) * length * 0.66;
        blisters.push(box(beam * 0.14, height * 0.2, length * 0.035, side * beam * 0.53, height * 0.06, z));
        const material = createAdditiveBasicMaterial({ color: options.accent.clone(), opacity: 0 });
        const flare = new Mesh(muzzleGeometry.clone(), material);
        flare.position.set(side * beam * 0.66, height * 0.06, z);
        flare.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(flare);
        muzzles.push(material);
      }
    }
    muzzleGeometry.dispose();
    group.add(new Mesh(mergeGeometries(blisters), plateMaterial));
    for (const geometry of blisters) geometry.dispose();
  }

  return { group, muzzles, engines: engineMaterials, rimMaterials, length };
}

// ---- rail-following hulls ---------------------------------------------------------
//
// The three ships you actually fly against are too long and too close to be
// straight boxes: a straight 900-unit hull laid beside a curving rail will
// eventually cut through it. So the close-pass hulls are built as strips of
// plating seated on sampled rail frames. The ship still has a bow, a stern, and
// towers — those are placed on the end frames — but its spine follows the same
// curve you do, which is both safe and, at this scale, indistinguishable from a
// vessel so large that its own hull is the horizon.

/** Exactly the shape returned by the engine's `sampleRailFrame`. */
export type HullFrame = {
  position: Vector3;
  right: Vector3;
  up: Vector3;
  tangent: Vector3;
};

export type HullSurfaceOptions = {
  /** Rail-relative centre of the plating: x right, y up. */
  offsetX: number;
  offsetY: number;
  halfWidth: number;
  halfHeight: number;
  hullColor: Color;
  plateColor: Color;
  rimKey: Color;
  rimFill: Color;
  accent: Color;
  /** Superstructure blocks per hundred units of hull. */
  towerDensity: number;
  /**
   * Keep superstructure outboard of this |x|, leaving a clear lane down the
   * middle of the plating. The flagship needs this: you fly its dorsal surface
   * at head height, and a randomly placed tower in the lane would hide the
   * shield emitters you are there to shoot.
   */
  towerKeepOut?: number;
  /** Ceiling on tower height, as a multiple of halfHeight. */
  towerMaxHeight?: number;
  /** Broadside blisters per side, spread down the strip. */
  batteries?: number;
  /** Which flank the batteries face and fire from: -1 port, +1 starboard. */
  batterySide?: number;
  seams?: boolean;
  seed: number;
  glow?: number;
};

export type HullSurface = {
  group: Group;
  muzzles: MeshBasicMaterial[];
  /** World positions of the battery muzzles, for spawning salvo streaks. */
  muzzlePoints: Array<{ x: number; y: number; z: number }>;
  /** Outboard direction each battery fires along. */
  muzzleDirections: Array<{ x: number; y: number; z: number }>;
  rimMaterials: MeshBasicMaterial[];
};

/** Rail frame → world transform for a piece of plating seated at a rail-relative offset. */
function frameBasis(frame: HullFrame, offsetX: number, offsetY: number) {
  const matrix = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  matrix.setPosition(
    frame.position.clone().addScaledVector(frame.right, offsetX).addScaledVector(frame.up, offsetY),
  );
  return { matrix };
}

export function createHullSurface(frames: HullFrame[], options: HullSurfaceOptions): HullSurface {
  const rng = mulberry32(options.seed);
  const glow = options.glow ?? 1;
  const group = new Group();
  const plates: BufferGeometry[] = [];
  const keyRims: BufferGeometry[] = [];
  const fillRims: BufferGeometry[] = [];
  const towers: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];
  const seams: BufferGeometry[] = [];
  const blisters: BufferGeometry[] = [];
  const muzzles: MeshBasicMaterial[] = [];
  const muzzlePoints: Array<{ x: number; y: number; z: number }> = [];
  const muzzleDirections: Array<{ x: number; y: number; z: number }> = [];

  const batterySide = options.batterySide ?? 1;
  const batteryEvery = options.batteries ? Math.max(1, Math.floor(frames.length / options.batteries)) : 0;
  const muzzleGeometry = new PlaneGeometry(options.halfHeight * 0.7, options.halfHeight * 0.7);

  for (let i = 0; i < frames.length - 1; i += 1) {
    const frame = frames[i];
    const next = frames[i + 1];
    const dz = Math.hypot(
      next.position.x - frame.position.x,
      next.position.y - frame.position.y,
      next.position.z - frame.position.z,
    );
    if (dz < 0.01) continue;
    const { matrix } = frameBasis(frame, options.offsetX, options.offsetY);

    // Main plating. Every third segment steps a little proud of its
    // neighbours so the surface reads as armour belts, not as a ribbon.
    const step = i % 3 === 0 ? 1.06 : 1;
    plates.push(new BoxGeometry(options.halfWidth * 2, options.halfHeight * 2 * step, dz * 1.04)
      .applyMatrix4(new Matrix4().makeTranslation(0, 0, dz / 2))
      .applyMatrix4(matrix));

    // Rim strips down both chines: the level's signature, at hull scale.
    for (const side of [-1, 1]) {
      keyRims.push(new BoxGeometry(options.halfWidth * 0.05, options.halfHeight * 0.06, dz * 1.04)
        .applyMatrix4(new Matrix4().makeTranslation(side * options.halfWidth, options.halfHeight, dz / 2))
        .applyMatrix4(matrix));
      fillRims.push(new BoxGeometry(options.halfWidth * 0.05, options.halfHeight * 0.06, dz * 1.04)
        .applyMatrix4(new Matrix4().makeTranslation(side * options.halfWidth, -options.halfHeight, dz / 2))
        .applyMatrix4(matrix));
    }

    if (i % 2 === 0) {
      for (const side of [-1, 1]) {
        lights.push(new BoxGeometry(options.halfWidth * 0.03, options.halfHeight * 0.05, options.halfWidth * 0.03)
          .applyMatrix4(new Matrix4().makeTranslation(side * options.halfWidth * 0.82, options.halfHeight * 1.02, dz / 2))
          .applyMatrix4(matrix));
      }
    }

    if (options.seams && i % 3 === 1) {
      seams.push(new BoxGeometry(options.halfWidth * (0.3 + rng() * 0.9), options.halfHeight * 0.04, dz * 0.4)
        .applyMatrix4(new Matrix4().makeTranslation((rng() - 0.5) * options.halfWidth, options.halfHeight * 1.02, dz / 2))
        .applyMatrix4(matrix));
    }

    // Superstructure: blocks and masts walking the spine.
    if (rng() < options.towerDensity) {
      const w = options.halfWidth * (0.16 + rng() * 0.3);
      const h = options.halfHeight * Math.min(options.towerMaxHeight ?? 2, 0.5 + rng() * 1.5);
      const d = dz * (1.2 + rng() * 2.4);
      const keepOut = options.towerKeepOut ?? 0;
      const span = Math.max(0, options.halfWidth * 0.95 - keepOut);
      const x = keepOut > 0
        ? (rng() < 0.5 ? -1 : 1) * (keepOut + rng() * span)
        : (rng() - 0.5) * options.halfWidth * 1.3;
      towers.push(new BoxGeometry(w, h, d)
        .applyMatrix4(new Matrix4().makeTranslation(x, options.halfHeight + h / 2, dz / 2))
        .applyMatrix4(matrix));
      if (rng() < 0.4) {
        towers.push(new BoxGeometry(w * 0.16, h * 1.3, w * 0.16)
          .applyMatrix4(new Matrix4().makeTranslation(x, options.halfHeight + h * 1.5, dz / 2))
          .applyMatrix4(matrix));
      }
    }

    if (batteryEvery > 0 && i % batteryEvery === 0 && muzzles.length < (options.batteries ?? 0)) {
      const bx = batterySide * options.halfWidth;
      blisters.push(new BoxGeometry(options.halfWidth * 0.1, options.halfHeight * 0.5, dz * 0.7)
        .applyMatrix4(new Matrix4().makeTranslation(bx, options.halfHeight * 0.55, dz / 2))
        .applyMatrix4(matrix));
      const material = createAdditiveBasicMaterial({ color: options.accent.clone(), opacity: 0 });
      const flare = new Mesh(muzzleGeometry.clone(), material);
      flare.applyMatrix4(new Matrix4()
        .makeRotationY(batterySide > 0 ? Math.PI / 2 : -Math.PI / 2)
        .premultiply(new Matrix4().makeTranslation(bx * 1.14, options.halfHeight * 0.55, dz / 2))
        .premultiply(matrix));
      group.add(flare);
      muzzles.push(material);
      muzzlePoints.push({ x: flare.position.x, y: flare.position.y, z: flare.position.z });
      muzzleDirections.push({
        x: frame.right.x * batterySide,
        y: frame.right.y * batterySide,
        z: frame.right.z * batterySide,
      });
    }
  }
  muzzleGeometry.dispose();

  const rimMaterials: MeshBasicMaterial[] = [];
  const addMerged = (geometries: BufferGeometry[], material: MeshBasicMaterial, collect = false) => {
    if (!geometries.length) {
      material.dispose();
      return;
    }
    group.add(new Mesh(mergeGeometries(geometries), material));
    for (const geometry of geometries) geometry.dispose();
    if (collect) rimMaterials.push(material);
  };

  addMerged(plates, new MeshBasicMaterial({ color: options.hullColor.clone() }));
  addMerged(towers, new MeshBasicMaterial({ color: options.plateColor.clone() }));
  addMerged(keyRims, createAdditiveBasicMaterial({ color: options.rimKey.clone().multiplyScalar(1.5 * glow) }), true);
  addMerged(fillRims, createAdditiveBasicMaterial({ color: options.rimFill.clone().multiplyScalar(1.1 * glow) }), true);
  addMerged(lights, createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(1.4 * glow) }), true);
  addMerged(seams, createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(0.9 * glow) }), true);
  addMerged(blisters, new MeshBasicMaterial({ color: options.plateColor.clone() }));

  return { group, muzzles, muzzlePoints, muzzleDirections, rimMaterials };
}

export type TrenchOptions = {
  /** Rail-relative centre of the canyon. */
  offsetX: number;
  offsetY: number;
  /** Distance from the centreline to each wall at this frame. */
  halfWidth: (t: number) => number;
  wallHeight: number;
  floorDepth: number;
  hullColor: Color;
  plateColor: Color;
  rimKey: Color;
  rimFill: Color;
  accent: Color;
  /** Structural ribs arching over the canyon, every N frames. */
  ribEvery: number;
  seed: number;
};

/**
 * The flagship's dorsal canyon. Walls, floor, greebled buttresses, and ribs
 * crossing overhead — all seated on rail frames, so the flight path is the
 * canyon's centreline by construction and can never clip a wall.
 */
export function createTrench(frames: HullFrame[], options: TrenchOptions) {
  const rng = mulberry32(options.seed);
  const group = new Group();
  const walls: BufferGeometry[] = [];
  const ribs: BufferGeometry[] = [];
  const keyRims: BufferGeometry[] = [];
  const fillRims: BufferGeometry[] = [];
  const lamps: BufferGeometry[] = [];

  for (let i = 0; i < frames.length - 1; i += 1) {
    const frame = frames[i];
    const next = frames[i + 1];
    const dz = Math.hypot(
      next.position.x - frame.position.x,
      next.position.y - frame.position.y,
      next.position.z - frame.position.z,
    );
    if (dz < 0.01) continue;
    const t = i / (frames.length - 1);
    const half = options.halfWidth(t);
    const { matrix } = frameBasis(frame, options.offsetX, options.offsetY);
    const place = (geometry: BufferGeometry, x: number, y: number) => geometry
      .applyMatrix4(new Matrix4().makeTranslation(x, y, dz / 2))
      .applyMatrix4(matrix);

    for (const side of [-1, 1]) {
      walls.push(place(new BoxGeometry(half * 0.24, options.wallHeight, dz * 1.05), side * (half + half * 0.12), 0));
      // Buttresses: irregular blocks that make the wall shear past at speed.
      if (i % 2 === 0) {
        const w = half * (0.1 + rng() * 0.13);
        walls.push(place(
          new BoxGeometry(w, options.wallHeight * (0.2 + rng() * 0.5), dz * (0.5 + rng() * 0.7)),
          side * (half + w * 0.1),
          (rng() - 0.5) * options.wallHeight * 0.5,
        ));
      }
      keyRims.push(place(new BoxGeometry(half * 0.3, options.wallHeight * 0.02, dz * 1.05), side * half, options.wallHeight * 0.5));
      fillRims.push(place(new BoxGeometry(half * 0.3, options.wallHeight * 0.02, dz * 1.05), side * half, -options.wallHeight * 0.5));
      if (i % 3 === 0) {
        lamps.push(place(new BoxGeometry(half * 0.05, options.wallHeight * 0.03, dz * 0.3), side * half * 0.94, (i % 6 === 0 ? 0.22 : -0.24) * options.wallHeight));
      }
    }

    walls.push(place(new BoxGeometry(half * 2.4, options.floorDepth, dz * 1.05), 0, -options.wallHeight * 0.5 - options.floorDepth * 0.5));

    // Ribs arch over the canyon, so the roof strobes past as you dive.
    if (i % options.ribEvery === 0 && t > 0.12) {
      ribs.push(place(new BoxGeometry(half * 2.3, options.wallHeight * 0.09, dz * 0.5), 0, options.wallHeight * 0.5));
      for (const side of [-1, 1]) {
        ribs.push(place(new BoxGeometry(half * 0.1, options.wallHeight * 0.4, dz * 0.5), side * half * 0.92, options.wallHeight * 0.32));
      }
    }
  }

  const rimMaterials: MeshBasicMaterial[] = [];
  const addMerged = (geometries: BufferGeometry[], material: MeshBasicMaterial, collect = false) => {
    if (!geometries.length) {
      material.dispose();
      return;
    }
    group.add(new Mesh(mergeGeometries(geometries), material));
    for (const geometry of geometries) geometry.dispose();
    if (collect) rimMaterials.push(material);
  };

  addMerged(walls, new MeshBasicMaterial({ color: options.hullColor.clone() }));
  addMerged(ribs, new MeshBasicMaterial({ color: options.plateColor.clone() }));
  addMerged(keyRims, createAdditiveBasicMaterial({ color: options.rimKey.clone().multiplyScalar(1.6) }), true);
  addMerged(fillRims, createAdditiveBasicMaterial({ color: options.rimFill.clone().multiplyScalar(1.2) }), true);
  addMerged(lamps, createAdditiveBasicMaterial({ color: options.accent.clone().multiplyScalar(1.6) }), true);

  return { group, rimMaterials };
}
