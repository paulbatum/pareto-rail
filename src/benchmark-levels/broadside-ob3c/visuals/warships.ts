import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32, type Rng } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { hullStationAt, type HullStation } from '../gameplay';
import { hdr } from './palette';

// Capital ships are lofted **along the flight path**, not placed in world
// space. A station table (gameplay.ts) says where a hull's centreline sits in
// the rail's own frame at each bar; this file walks that table, samples the
// rail frame at every station, and skins the result.
//
// The payoff is that a hull is exactly as close as it was authored to be no
// matter what the rail is doing underneath it, and the flagship's dorsal
// trench is guaranteed to contain the flight path — the canyon cannot be
// mis-fitted, because the canyon is defined relative to the path itself.

export type HullSkin = {
  /** Near-black plating. The hull is a silhouette; this is barely above the void. */
  plate: Color;
  /** Emissive strips along the dorsal corners and trench lip. */
  rim: Color;
  /** Running lights strung down the length. */
  light: Color;
  /** Engine bells and window banks. */
  glow: Color;
};

export type HullRibbon = {
  group: Group;
  /** World position of a point on this hull, in the rail frame at a given bar. */
  pointAt(barIndex: number, right: number, up: number): Vector3;
};

/** The eight-point cross-section: a rectangle with an optional slot cut out of the dorsal. */
function profile(station: HullStation): Array<[number, number]> {
  const { halfWidth: hw, halfHeight: hh, trenchHalfWidth: thw, trenchDepth: depth } = station;
  const floor = hh - depth;
  return [
    [hw, hh],
    [thw, hh],
    [thw, floor],
    [-thw, floor],
    [-thw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ];
}

type Ring = { points: Vector3[]; frame: ReturnType<typeof sampleRailFrame>; station: HullStation };

function ringAt(curve: CatmullRomCurve3, u: number, station: HullStation): Ring {
  const frame = sampleRailFrame(curve, u);
  const points = profile(station).map(([right, up]) =>
    frame.position
      .clone()
      .addScaledVector(frame.right, station.right + right)
      .addScaledVector(frame.up, station.up + up));
  return { points, frame, station };
}

/** Loft a closed profile through a run of rings. No caps: these hulls run off both ends of the shot. */
function loft(rings: Ring[]): BufferGeometry {
  const pointCount = rings[0].points.length;
  const positions = new Float32Array(rings.length * pointCount * 3);
  let cursor = 0;
  for (const ring of rings) {
    for (const point of ring.points) {
      positions[cursor] = point.x;
      positions[cursor + 1] = point.y;
      positions[cursor + 2] = point.z;
      cursor += 3;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r + 1 < rings.length; r += 1) {
    for (let p = 0; p < pointCount; p += 1) {
      const next = (p + 1) % pointCount;
      const a = r * pointCount + p;
      const b = r * pointCount + next;
      const c = (r + 1) * pointCount + p;
      const d = (r + 1) * pointCount + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A thin emissive ribbon traced along one profile vertex down the hull's length. */
function edgeRibbon(rings: Ring[], pointIndex: number, width: number): BufferGeometry {
  const positions = new Float32Array(rings.length * 2 * 3);
  let cursor = 0;
  for (const ring of rings) {
    const point = ring.points[pointIndex];
    const offset = ring.frame.right.clone().multiplyScalar(width * 0.5);
    for (const sign of [-1, 1]) {
      const vertex = point.clone().addScaledVector(offset, sign);
      positions[cursor] = vertex.x;
      positions[cursor + 1] = vertex.y;
      positions[cursor + 2] = vertex.z;
      cursor += 3;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r + 1 < rings.length; r += 1) {
    const a = r * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export type HullRibbonOptions = {
  curve: CatmullRomCurve3;
  stations: HullStation[];
  /** Bar index → rail parameter. */
  railUAtBar: (barIndex: number) => number;
  skin: HullSkin;
  seed: number;
  /** Rings across the whole hull. More is smoother; 8 points per ring, so this is cheap. */
  segments?: number;
  /** Superstructure blocks per bar of hull. */
  greebleDensity?: number;
  /** Which profile vertices carry rim light. Defaults to the dorsal corners and trench lip. */
  rimVertices?: number[];
  /** Set false for fields and shields, which are not made of plating. */
  runningLights?: boolean;
};

export function buildHullRibbon(options: HullRibbonOptions): HullRibbon {
  const { curve, stations, railUAtBar, skin } = options;
  const rng = mulberry32(options.seed);
  const fromBar = stations[0].bar;
  const toBar = stations[stations.length - 1].bar;
  const segments = options.segments ?? Math.max(24, Math.round((toBar - fromBar) * 9));

  const rings: Ring[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const barIndex = fromBar + ((toBar - fromBar) * i) / segments;
    rings.push(ringAt(curve, railUAtBar(barIndex), hullStationAt(stations, barIndex)));
  }

  const group = new Group();
  const plate = new Mesh(loft(rings), new MeshBasicMaterial({ color: skin.plate.clone(), side: 2 }));
  plate.name = 'hull-plate';
  plate.frustumCulled = false;
  group.add(plate);

  // Dorsal corners and trench lips are the only lines on the ship — they are
  // what tells you where the hull ends and the nebula begins.
  const rimVertices = options.rimVertices ?? [0, 2, 3, 5];
  const rimGeometries = rimVertices.map((index) => edgeRibbon(rings, index, 0.9));
  const rimMesh = new Mesh(mergeGeometries(rimGeometries), createAdditiveBasicMaterial({ color: hdr(skin.rim, 1.1), side: 2 }));
  for (const geometry of rimGeometries) geometry.dispose();
  rimMesh.name = 'hull-rim';
  rimMesh.frustumCulled = false;
  group.add(rimMesh);

  addGreebles(group, rings, skin, rng, options.greebleDensity ?? 2.4, toBar - fromBar);
  if (options.runningLights !== false) addRunningLights(group, rings, skin, rng);

  return {
    group,
    pointAt(barIndex, right, up) {
      const station = hullStationAt(stations, barIndex);
      const frame = sampleRailFrame(curve, railUAtBar(barIndex));
      return frame.position
        .clone()
        .addScaledVector(frame.right, station.right + right)
        .addScaledVector(frame.up, station.up + up);
    },
  };
}

/** Superstructure: slab towers, gun barbettes, and radiator fins broken over the plating. */
function addGreebles(group: Group, rings: Ring[], skin: HullSkin, rng: Rng, density: number, barSpan: number) {
  const count = Math.max(6, Math.round(barSpan * density));
  const plateGeometries: BufferGeometry[] = [];
  const rimGeometries: BufferGeometry[] = [];

  for (let i = 0; i < count; i += 1) {
    const ring = rings[Math.floor(rng() * (rings.length - 1))];
    const { station, frame } = ring;
    // Superstructure only ever grows away from the flight path. A hull is
    // allowed to fill half the frame, but nothing bolted to it may reach into
    // the corridor and swallow a target the player is tracking.
    const awayRight = station.right >= 0 ? 1 : -1;
    const awayUp = station.up >= 0 ? 1 : -1;
    const onFlank = station.trenchHalfWidth > 4 || rng() < 0.35;
    const lateral = onFlank
      ? awayRight * station.halfWidth
      : (rng() * 2 - 1) * Math.max(2, station.halfWidth - station.trenchHalfWidth - 4)
        + awayRight * (station.trenchHalfWidth + 4);
    const vertical = onFlank ? (rng() * 2 - 1) * station.halfHeight * 0.7 : awayUp * station.halfHeight;

    const width = 2.5 + rng() * 7;
    const height = 2 + rng() * 9;
    const depth = 4 + rng() * 16;
    const block = new BoxGeometry(width, height, depth);
    const quaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(frame.right, frame.up, frame.tangent),
    );
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, station.right + lateral)
      .addScaledVector(frame.up, station.up + vertical + (onFlank ? 0 : awayUp * height * 0.4));
    const matrix = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
    plateGeometries.push(block.applyMatrix4(matrix));

    // Every third block wears a lit strip so the superstructure is not a void.
    if (i % 3 === 0) {
      const strip = new BoxGeometry(width * 0.85, 0.28, depth * 0.9);
      const stripMatrix = new Matrix4().compose(
        position.clone().addScaledVector(frame.up, awayUp * height * 0.5),
        quaternion,
        new Vector3(1, 1, 1),
      );
      rimGeometries.push(strip.applyMatrix4(stripMatrix));
    }
  }

  const blocks = new Mesh(mergeGeometries(plateGeometries), new MeshBasicMaterial({ color: skin.plate.clone().multiplyScalar(1.9) }));
  for (const geometry of plateGeometries) geometry.dispose();
  blocks.name = 'hull-greebles';
  blocks.frustumCulled = false;
  group.add(blocks);

  if (rimGeometries.length > 0) {
    const strips = new Mesh(mergeGeometries(rimGeometries), createAdditiveBasicMaterial({ color: hdr(skin.glow, 0.45) }));
    for (const geometry of rimGeometries) geometry.dispose();
    strips.name = 'hull-strips';
    strips.frustumCulled = false;
    group.add(strips);
  }
}

/** Running lights: the only fine detail at hull scale, and the level's speedometer up close. */
function addRunningLights(group: Group, rings: Ring[], skin: HullSkin, rng: Rng) {
  // Kept sparse and small on purpose: these are additive, and a close pass
  // beneath a hull stacks hundreds of them into one white wall otherwise.
  const count = Math.min(130, rings.length * 3);
  const mesh = new InstancedMesh(
    new BoxGeometry(0.45, 0.45, 0.45),
    createAdditiveBasicMaterial({ color: hdr(skin.light, 0.85) }),
    count,
  );
  mesh.name = 'hull-lights';
  mesh.frustumCulled = false;
  const dummy = new Object3D();
  for (let i = 0; i < count; i += 1) {
    const ring = rings[Math.floor(rng() * (rings.length - 1))];
    const { station, frame } = ring;
    const side = station.right >= 0 ? 1 : -1;
    const lateral = side * station.halfWidth * (0.9 + rng() * 0.12);
    const vertical = (rng() * 2 - 1) * station.halfHeight * 0.85;
    dummy.position.copy(frame.position)
      .addScaledVector(frame.right, station.right + lateral)
      .addScaledVector(frame.up, station.up + vertical);
    dummy.scale.setScalar(0.6 + rng() * 0.8);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

// ---- distant fleet -------------------------------------------------------------------

/**
 * A capital ship seen across the engagement: a long wedge hull, a lit spine,
 * engine bells, and nothing else. At these distances the silhouette and the
 * colour of its engines are the entire read.
 */
export function createDistantWarship(length: number, skin: HullSkin, rng: Rng) {
  const group = new Group();
  const beam = length * (0.09 + rng() * 0.05);
  const depth = beam * (0.5 + rng() * 0.3);

  const hull = new BoxGeometry(beam, depth, length);
  const prow = new ConeGeometry(beam * 0.55, length * 0.28, 4, 1);
  prow.rotateX(Math.PI / 2);
  prow.applyMatrix4(new Matrix4().makeTranslation(0, 0, length * 0.63));
  const merged = mergeGeometries([hull, prow]);
  hull.dispose();
  prow.dispose();
  const distantHull = new Mesh(merged, new MeshBasicMaterial({ color: skin.plate.clone().multiplyScalar(1.5) }));
  distantHull.name = 'distant-hull';
  group.add(distantHull);

  // Dorsal spine strip: one bright line so the hull is not a hole in the nebula.
  const spine = new BoxGeometry(beam * 0.14, 0.5, length * 0.86);
  spine.applyMatrix4(new Matrix4().makeTranslation(0, depth * 0.52, 0));
  group.add(new Mesh(spine, createAdditiveBasicMaterial({ color: hdr(skin.rim, 1.0) })));

  const towers: BufferGeometry[] = [];
  const towerCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < towerCount; i += 1) {
    const tower = new BoxGeometry(beam * (0.3 + rng() * 0.4), depth * (0.5 + rng() * 0.9), length * (0.03 + rng() * 0.06));
    tower.applyMatrix4(new Matrix4().makeTranslation(
      (rng() * 2 - 1) * beam * 0.3,
      depth * 0.6,
      (rng() * 2 - 1) * length * 0.35,
    ));
    towers.push(tower);
  }
  group.add(new Mesh(mergeGeometries(towers), new MeshBasicMaterial({ color: skin.plate.clone().multiplyScalar(2.2) })));
  for (const geometry of towers) geometry.dispose();

  const bells: BufferGeometry[] = [];
  const bellCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < bellCount; i += 1) {
    const bell = new BoxGeometry(beam * 0.2, depth * 0.32, length * 0.03);
    bell.applyMatrix4(new Matrix4().makeTranslation(
      ((i + 0.5) / bellCount - 0.5) * beam * 1.3,
      -depth * 0.1,
      -length * 0.53,
    ));
    bells.push(bell);
  }
  group.add(new Mesh(mergeGeometries(bells), createAdditiveBasicMaterial({ color: hdr(skin.glow, 1.7) })));
  for (const geometry of bells) geometry.dispose();

  return group;
}
