import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
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
  spikePairs: number;
  shellRadius: number;
  elongation: number;
  seedBase: number;
};

const KIND_PARAMS: Record<CrystalKind, KindParams> = {
  node: { weights: [6, 2.5, 1.5], shardPairs: 5, spikePairs: 2, shellRadius: 0.85, elongation: 1.6, seedBase: 11 },
  drifter: { weights: [3, 6, 1], shardPairs: 4, spikePairs: 3, shellRadius: 0.75, elongation: 2.4, seedBase: 47 },
  orbiter: { weights: [4.5, 1.5, 4], shardPairs: 6, spikePairs: 2, shellRadius: 0.95, elongation: 1.2, seedBase: 83 },
};

const FORWARD = new Vector3(0, 0, 1);

const coreGeometry = new OctahedronGeometry(0.21, 0);
const coreGlowGeometry = new OctahedronGeometry(0.4, 1);

let nextSeed = 1;

// Assembles a crystalline enemy in the concept-art language: a blazing core,
// a translucent facet shell, a neon wireframe layer, and mirrored spike
// clusters — all seeded so every enemy is a distinct sibling, not a clone.
export function createCrystal(kind: CrystalKind): Group {
  const params = KIND_PARAMS[kind];
  const rng = mulberry32(params.seedBase + nextSeed * 7919);
  nextSeed += 1;

  const group = new Group();
  const shardSpecs: ShardSpec[] = [];
  const fillGeometries: BufferGeometry[] = [];
  const edgeGeometries: BufferGeometry[] = [];

  // Shards point outward (+Z aligned with their direction) with a random roll
  // and a little tilt jitter — radiating from the center is what makes the
  // cluster read as one creature instead of a scatter of triangles.
  const addShard = (
    direction: Vector3,
    distance: number,
    scale: Vector3,
    color: Color,
    fillIntensity: number,
    edgeIntensity: number,
    tiltJitter: number,
  ) => {
    const geometry = new TetrahedronGeometry(0.42, 0);
    const outward = direction.clone().normalize();
    const rotation = new Quaternion().setFromUnitVectors(FORWARD, outward);
    rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
    if (tiltJitter > 0) {
      rotation.premultiply(new Quaternion().setFromAxisAngle(randomDirection(rng), (rng() - 0.5) * tiltJitter));
    }
    const matrix = new Matrix4().compose(outward.clone().multiplyScalar(distance), rotation, scale);

    const fill = geometry.clone().applyMatrix4(matrix);
    paintVertexColor(fill, color, fillIntensity);
    fillGeometries.push(fill);

    const edges = new EdgesGeometry(geometry, 12).applyMatrix4(matrix);
    paintVertexColor(edges, color, edgeIntensity);
    edgeGeometries.push(edges);

    shardSpecs.push({ direction: outward.clone(), color, size: (scale.x + scale.y + scale.z) / 3 });
  };

  // Central body — a faceted polyhedron with a bright wireframe and an inner
  // counter-rotated frame. This is the anchor the shards radiate from; dark
  // glass fill so the neon edges carry the read.
  const accent = kind === 'drifter' ? MAGENTA : kind === 'orbiter' ? AMBER : CYAN;
  const contrast = kind === 'drifter' ? CYAN : MAGENTA;
  const bodyGeometry = new IcosahedronGeometry(0.5, 0);
  const bodyMatrix = new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromAxisAngle(randomDirection(rng), rng() * Math.PI * 2),
  );
  const bodyFill = bodyGeometry.clone().applyMatrix4(bodyMatrix);
  paintVertexColor(bodyFill, accent, 0.1);
  fillGeometries.push(bodyFill);
  const bodyEdges = new EdgesGeometry(bodyGeometry).applyMatrix4(bodyMatrix);
  paintVertexColor(bodyEdges, accent, 1.6);
  edgeGeometries.push(bodyEdges);

  const innerFrame = new EdgesGeometry(new OctahedronGeometry(0.33, 0)).applyMatrix4(
    new Matrix4().makeRotationFromQuaternion(
      new Quaternion().setFromAxisAngle(randomDirection(rng), rng() * Math.PI * 2),
    ),
  );
  paintVertexColor(innerFrame, contrast, 1.3);
  edgeGeometries.push(innerFrame);

  // Facet shell — generated on one side, mirrored across X for the bilateral
  // symmetry that makes the scatter read as a designed creature. Pushed out
  // past the body so facets ring the core instead of piling up over it.
  for (let i = 0; i < params.shardPairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * 0.85 + 0.15;
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(0.6 + rng() * 0.7, 0.6 + rng() * 0.7, 0.7 + rng() * 0.8);
    const distance = params.shellRadius * (0.8 + rng() * 0.55);
    addShard(direction, distance, scale, color, 0.07, 1.7, 0.9);
    addShard(mirrorX(direction), distance, scale, color, 0.07, 1.7, 0.9);
  }

  // Spike clusters — long thin shards thrusting outward, the "claws".
  for (let i = 0; i < params.spikePairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * 1.6 + 0.6;
    direction.normalize();
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(0.28 + rng() * 0.2, 0.28 + rng() * 0.2, params.elongation + rng() * 1.1);
    const distance = params.shellRadius * (1.15 + rng() * 0.5);
    addShard(direction, distance, scale, color, 0.05, 1.9, 0.25);
    addShard(mirrorX(direction), distance, scale, color, 0.05, 1.9, 0.25);
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
