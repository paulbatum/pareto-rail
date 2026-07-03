import {
  AdditiveBlending,
  BufferGeometry,
  Color,
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

type KindParams = {
  weights: [number, number, number];
  shardPairs: number;
  spikePairs: number;
  shellRadius: number;
  elongation: number;
  seedBase: number;
};

const KIND_PARAMS: Record<EnemyKind, KindParams> = {
  node: { weights: [6, 2.5, 1.5], shardPairs: 6, spikePairs: 2, shellRadius: 0.85, elongation: 1.6, seedBase: 11 },
  drifter: { weights: [3, 6, 1], shardPairs: 5, spikePairs: 3, shellRadius: 0.75, elongation: 2.4, seedBase: 47 },
  orbiter: { weights: [4.5, 1.5, 4], shardPairs: 7, spikePairs: 2, shellRadius: 0.95, elongation: 1.2, seedBase: 83 },
};

const coreGeometry = new OctahedronGeometry(0.3, 0);
const coreGlowGeometry = new OctahedronGeometry(0.52, 1);

let nextSeed = 1;

// Assembles a crystalline enemy in the concept-art language: a blazing core,
// a translucent facet shell, a neon wireframe layer, and mirrored spike
// clusters — all seeded so every enemy is a distinct sibling, not a clone.
export function createCrystal(kind: EnemyKind): Group {
  const params = KIND_PARAMS[kind];
  const rng = mulberry32(params.seedBase + nextSeed * 7919);
  nextSeed += 1;

  const group = new Group();
  const shardSpecs: ShardSpec[] = [];
  const fillGeometries: BufferGeometry[] = [];
  const edgeGeometries: BufferGeometry[] = [];

  const addShard = (direction: Vector3, distance: number, scale: Vector3, color: Color) => {
    const geometry = new TetrahedronGeometry(0.42, 0);
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rng() * Math.PI * 2,
    );
    const matrix = new Matrix4().compose(direction.clone().multiplyScalar(distance), rotation, scale);

    const fill = geometry.clone().applyMatrix4(matrix);
    paintVertexColor(fill, color, 0.16);
    fillGeometries.push(fill);

    const edges = new EdgesGeometry(geometry, 12).applyMatrix4(matrix);
    paintVertexColor(edges, color, 1.35);
    edgeGeometries.push(edges);

    shardSpecs.push({ direction: direction.clone(), color, size: (scale.x + scale.y + scale.z) / 3 });
  };

  // Facet shell — generated on one side, mirrored across X for the bilateral
  // symmetry that makes the scatter read as a designed creature.
  for (let i = 0; i < params.shardPairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * 0.85 + 0.15;
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(0.7 + rng() * 0.9, 0.7 + rng() * 0.9, 0.7 + rng() * 0.9);
    const distance = params.shellRadius * (0.55 + rng() * 0.65);
    addShard(direction, distance, scale, color);
    addShard(mirrorX(direction), distance, scale, color);
  }

  // Spike clusters — long thin shards thrusting outward, the "claws".
  for (let i = 0; i < params.spikePairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * 1.6 + 0.6;
    direction.normalize();
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(0.28 + rng() * 0.2, 0.28 + rng() * 0.2, params.elongation + rng() * 1.1);
    const distance = params.shellRadius * (1.15 + rng() * 0.5);
    addShard(direction, distance, scale, color);
    addShard(mirrorX(direction), distance, scale, color);
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

  const coreMaterial = new MeshBasicMaterial({ color: hdr(CORE_WHITE, 2.4) });
  const core = new Mesh(coreGeometry, coreMaterial);
  const coreGlow = new Mesh(
    coreGlowGeometry,
    new MeshBasicMaterial({
      color: hdr(CYAN, 0.55),
      transparent: true,
      opacity: 0.5,
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
  group.userData.accent = kind === 'drifter' ? MAGENTA : kind === 'orbiter' ? AMBER : CYAN;
  return group;
}

export function setCrystalLocked(group: Group, locked: boolean) {
  const coreMaterial = group.userData.coreMaterial as MeshBasicMaterial | undefined;
  if (coreMaterial) {
    coreMaterial.color.copy(locked ? hdr(MAGENTA, 3.2) : hdr(CORE_WHITE, 2.4));
  }
  const coreGlow = group.userData.coreGlow as Mesh | undefined;
  if (coreGlow) {
    (coreGlow.material as MeshBasicMaterial).color.copy(locked ? hdr(MAGENTA, 1.1) : hdr(CYAN, 0.55));
  }
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
