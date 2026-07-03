import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EnemyKind } from '../events';
import { AMBER, CORE_WHITE, CYAN, hdr, MAGENTA, mulberry32, pickColor, type Rng } from './palette';

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type CrystalKind = Exclude<EnemyKind, 'letter'>;

type KindParams = {
  weights: [number, number, number];
  shardPairs: number;
  finPairs: number;
  shellRadius: number;
  elongation: number;
  seedBase: number;
};

const KIND_PARAMS: Record<CrystalKind, KindParams> = {
  node: { weights: [6, 2.5, 1.5], shardPairs: 5, finPairs: 2, shellRadius: 0.85, elongation: 1.6, seedBase: 11 },
  drifter: { weights: [3, 6, 1], shardPairs: 4, finPairs: 3, shellRadius: 0.75, elongation: 2.4, seedBase: 47 },
  orbiter: { weights: [4.5, 1.5, 4], shardPairs: 6, finPairs: 2, shellRadius: 0.95, elongation: 1.2, seedBase: 83 },
};

const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

const coreGeometry = new OctahedronGeometry(0.17, 2);
const coreGlowGeometry = new OctahedronGeometry(0.38, 2);

let nextSeed = 1;

// Assembles a crystalline enemy following the concept construction sheet:
// glowing sphere core → concentric hex frames with radial prism spokes (the
// visual anchor) → a disk of tetrahedral shards clustered around it → large
// blade fins angled for thrust. Everything lives in the local XY plane facing
// +Z; the game billboards crystals toward the camera so the hex face reads.
export function createCrystal(kind: CrystalKind): Group {
  const params = KIND_PARAMS[kind];
  const rng = mulberry32(params.seedBase + nextSeed * 7919);
  nextSeed += 1;

  const group = new Group();
  const shardSpecs: ShardSpec[] = [];
  const fillGeometries: BufferGeometry[] = [];
  const edgeGeometries: BufferGeometry[] = [];

  const accent = kind === 'drifter' ? MAGENTA : kind === 'orbiter' ? AMBER : CYAN;
  const contrast = kind === 'drifter' ? CYAN : MAGENTA;

  const addEdges = (geometry: BufferGeometry, color: Color, intensity: number) => {
    paintVertexColor(geometry, color, intensity);
    edgeGeometries.push(geometry);
  };

  const addSolid = (
    geometry: BufferGeometry,
    matrix: Matrix4,
    color: Color,
    fillIntensity: number,
    edgeIntensity: number,
  ) => {
    const fill = geometry.clone().applyMatrix4(matrix);
    paintVertexColor(fill, color, fillIntensity);
    fillGeometries.push(fill);
    addEdges(new EdgesGeometry(geometry, 12).applyMatrix4(matrix), color, edgeIntensity);
  };

  // Hex frames — concentric hexagon outlines, layered with slight z offsets
  // and a rotated second pass for depth. This is the anchor of the read.
  const frameSpin = rng() * Math.PI * 2;
  addEdges(hexRing(0.3, 0.05, frameSpin + Math.PI / 6), contrast, 1.6);
  addEdges(hexRing(0.5, 0, frameSpin), accent, 1.7);
  addEdges(hexRing(0.56, -0.06, frameSpin + Math.PI / 6), accent, 0.8);

  // Radial prism spokes on six sides, hex vertex to just past the outer ring.
  const spokeGeometry = new CylinderGeometry(0.045, 0.045, 0.3, 3).toNonIndexed();
  for (let i = 0; i < 6; i += 1) {
    const angle = frameSpin + (i / 6) * Math.PI * 2;
    const outward = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const matrix = new Matrix4().compose(
      outward.clone().multiplyScalar(0.46),
      new Quaternion().setFromUnitVectors(UP, outward),
      new Vector3(1, 1, 1),
    );
    addSolid(spokeGeometry, matrix, i % 2 === 0 ? accent : contrast, 0.12, 1.4);
  }

  // Shard disk — tetrahedra clustered around the core, flattened toward the
  // hex plane so the silhouette reads as a snowflake, not a ball. Generated
  // on one side and mirrored across X for bilateral symmetry; outward
  // alignment with random roll keeps them radiating rather than tumbling.
  const shardGeometry = new TetrahedronGeometry(0.42, 0);
  const addShard = (direction: Vector3, distance: number, scale: Vector3, color: Color) => {
    const outward = direction.clone().normalize();
    const rotation = new Quaternion().setFromUnitVectors(FORWARD, outward);
    rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
    rotation.premultiply(new Quaternion().setFromAxisAngle(randomDirection(rng), (rng() - 0.5) * 0.7));
    const matrix = new Matrix4().compose(outward.clone().multiplyScalar(distance), rotation, scale);
    addSolid(shardGeometry, matrix, color, 0.07, 1.7);
    shardSpecs.push({ direction: outward.clone(), color, size: (scale.x + scale.y + scale.z) / 3 });
  };

  for (let i = 0; i < params.shardPairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * 0.85 + 0.15;
    direction.z *= 0.35;
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(0.55 + rng() * 0.6, 0.55 + rng() * 0.6, 0.6 + rng() * 0.7);
    const distance = params.shellRadius * (0.62 + rng() * 0.5);
    addShard(direction, distance, scale, color);
    addShard(mirrorX(direction), distance, scale, color);
  }

  // Fins — large tapered triangular prisms thrusting out sideways, mostly
  // in-plane, mirrored. These give the creature its wingspan and direction.
  for (let i = 0; i < params.finPairs; i += 1) {
    const angle = (rng() - 0.5) * 1.6;
    const direction = new Vector3(Math.cos(angle), Math.sin(angle), (rng() - 0.5) * 0.35).normalize();
    const color = pickColor(rng, params.weights);
    const length = params.elongation * (0.8 + rng() * 0.5);
    const finGeometry = new CylinderGeometry(0.02, 0.13 + rng() * 0.06, length, 3).toNonIndexed();
    const baseDistance = params.shellRadius * (0.75 + rng() * 0.3);
    for (const outward of [direction, mirrorX(direction)]) {
      const rotation = new Quaternion().setFromUnitVectors(UP, outward);
      rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
      const matrix = new Matrix4().compose(
        outward.clone().multiplyScalar(baseDistance + length / 2),
        rotation,
        new Vector3(1, 1, 1),
      );
      addSolid(finGeometry, matrix, color, 0.05, 1.9);
      shardSpecs.push({ direction: outward.clone(), color, size: length * 0.4 });
    }
  }

  const fillMesh = new Mesh(
    mergeGeometries(fillGeometries),
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );

  const edgeLines = new LineSegments(
    mergeGeometries(edgeGeometries),
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );

  const coreMaterial = new MeshBasicMaterial({ color: hdr(CORE_WHITE, 1.2) });
  const core = new Mesh(coreGeometry, coreMaterial);
  const coreGlow = new Mesh(
    coreGlowGeometry,
    new MeshBasicMaterial({
      color: hdr(CYAN, 0.42),
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );

  group.add(fillMesh, edgeLines, core, coreGlow);

  for (const geometry of fillGeometries) geometry.dispose();
  for (const geometry of edgeGeometries) geometry.dispose();

  group.userData.shardSpecs = shardSpecs;
  group.userData.coreMaterial = coreMaterial;
  group.userData.coreGlow = coreGlow;
  // Base colors + material handles for the per-frame distance falloff:
  // far away, hot elements are dimmed so bloom can't swallow the silhouette.
  group.userData.coreBase = hdr(CORE_WHITE, 1.2);
  group.userData.glowBase = hdr(CYAN, 0.42);
  group.userData.edgeMaterial = edgeLines.material;
  group.userData.fillMaterial = fillMesh.material;
  group.userData.accent = accent;
  return group;
}

export function setCrystalLocked(group: Group, locked: boolean) {
  // Update the base colors; the per-frame distance falloff in updateVisuals
  // multiplies these onto the materials.
  (group.userData.coreBase as Color).copy(locked ? hdr(MAGENTA, 1.7) : hdr(CORE_WHITE, 1.2));
  (group.userData.glowBase as Color).copy(locked ? hdr(MAGENTA, 0.7) : hdr(CYAN, 0.42));
}

// A hexagon outline in the XY plane as line segments.
function hexRing(radius: number, z: number, spin: number): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a0 = spin + (i / 6) * Math.PI * 2;
    const a1 = spin + ((i + 1) / 6) * Math.PI * 2;
    positions.push(Math.cos(a0) * radius, Math.sin(a0) * radius, z);
    positions.push(Math.cos(a1) * radius, Math.sin(a1) * radius, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function paintVertexColor(geometry: BufferGeometry, color: Color, intensity: number) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r * intensity;
    colors[i * 3 + 1] = color.g * intensity;
    colors[i * 3 + 2] = color.b * intensity;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function randomDirection(rng: Rng): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

function mirrorX(direction: Vector3): Vector3 {
  return new Vector3(-direction.x, direction.y, direction.z);
}
