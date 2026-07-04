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
import crystalTemplateJson from './crystal-template.json';
import { AMBER, CORE_WHITE, CYAN, hdr, MAGENTA, mulberry32, pickColor, type Rng } from './palette';

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

export type CrystalKind = 'node' | 'drifter' | 'orbiter';
export type NumericRange = [number, number];
export type CrystalColorRole = 'accent' | 'contrast';

export type CrystalTemplate = {
  shared: {
    hexRings: Array<{
      radius: number;
      zOffset: number;
      intensity: number;
      colorRole: CrystalColorRole;
      spinOffset: number;
    }>;
    spokes: {
      count: number;
      radius: number;
      length: number;
      centerDistance: number;
      fillIntensity: number;
      edgeIntensity: number;
    };
    shards: {
      baseRadius: number;
      scale: {
        x: NumericRange;
        y: NumericRange;
        z: NumericRange;
      };
      xBiasScale: number;
      xBiasOffset: number;
      distanceMult: NumericRange;
      flatten: number;
      tiltJitter: number;
      fillIntensity: number;
      edgeIntensity: number;
    };
    fins: {
      angleSpread: number;
      zTilt: number;
      lengthMult: NumericRange;
      baseWidth: NumericRange;
      tipWidth: number;
      baseDistanceMult: NumericRange;
      fillIntensity: number;
      edgeIntensity: number;
    };
    core: {
      coreRadius: number;
      glowRadius: number;
      coreIntensity: number;
      glowIntensity: number;
      glowOpacity: number;
    };
  };
  kinds: Record<
    CrystalKind,
    {
      weights: [number, number, number];
      shardPairs: number;
      finPairs: number;
      shellRadius: number;
      elongation: number;
    }
  >;
};

export type CreateCrystalOptions = {
  seed?: number;
  template?: CrystalTemplate;
};

export const defaultCrystalTemplate = crystalTemplateJson as CrystalTemplate;

const KIND_SEED_BASES: Record<CrystalKind, number> = {
  node: 11,
  drifter: 47,
  orbiter: 83,
};

const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

let nextSeed = 1;

// Assembles a crystalline enemy following the concept construction sheet:
// glowing sphere core → concentric hex frames with radial prism spokes (the
// visual anchor) → a disk of tetrahedral shards clustered around it → large
// blade fins angled for thrust. Everything lives in the local XY plane facing
// +Z; the game billboards crystals toward the camera so the hex face reads.
export function createCrystal(kind: CrystalKind, opts: CreateCrystalOptions = {}): Group {
  const template = opts.template ?? defaultCrystalTemplate;
  const params = template.kinds[kind];
  const shared = template.shared;
  const seedIndex = opts.seed ?? nextSeed;
  const rng = mulberry32(KIND_SEED_BASES[kind] + seedIndex * 7919);
  if (opts.seed === undefined) nextSeed += 1;

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
  for (const ring of shared.hexRings) {
    addEdges(
      hexRing(ring.radius, ring.zOffset, frameSpin + ring.spinOffset),
      ring.colorRole === 'accent' ? accent : contrast,
      ring.intensity,
    );
  }

  // Radial prism spokes on each side, hex vertex to just past the outer ring.
  const spokeCount = Math.max(0, Math.round(shared.spokes.count));
  const spokeGeometry = new CylinderGeometry(shared.spokes.radius, shared.spokes.radius, shared.spokes.length, 3).toNonIndexed();
  for (let i = 0; i < spokeCount; i += 1) {
    const angle = frameSpin + (i / spokeCount) * Math.PI * 2;
    const outward = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const matrix = new Matrix4().compose(
      outward.clone().multiplyScalar(shared.spokes.centerDistance),
      new Quaternion().setFromUnitVectors(UP, outward),
      new Vector3(1, 1, 1),
    );
    addSolid(spokeGeometry, matrix, i % 2 === 0 ? accent : contrast, shared.spokes.fillIntensity, shared.spokes.edgeIntensity);
  }
  spokeGeometry.dispose();

  // Shard disk — tetrahedra clustered around the core, flattened toward the
  // hex plane so the silhouette reads as a snowflake, not a ball. Generated
  // on one side and mirrored across X for bilateral symmetry; outward
  // alignment with random roll keeps them radiating rather than tumbling.
  const shardGeometry = new TetrahedronGeometry(shared.shards.baseRadius, 0);
  const addShard = (direction: Vector3, distance: number, scale: Vector3, color: Color) => {
    const outward = direction.clone().normalize();
    const rotation = new Quaternion().setFromUnitVectors(FORWARD, outward);
    rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
    rotation.premultiply(new Quaternion().setFromAxisAngle(randomDirection(rng), (rng() - 0.5) * shared.shards.tiltJitter));
    const matrix = new Matrix4().compose(outward.clone().multiplyScalar(distance), rotation, scale);
    addSolid(shardGeometry, matrix, color, shared.shards.fillIntensity, shared.shards.edgeIntensity);
    shardSpecs.push({ direction: outward.clone(), color, size: (scale.x + scale.y + scale.z) / 3 });
  };

  const shardPairs = Math.max(0, Math.round(params.shardPairs));
  for (let i = 0; i < shardPairs; i += 1) {
    const direction = randomDirection(rng);
    direction.x = Math.abs(direction.x) * shared.shards.xBiasScale + shared.shards.xBiasOffset;
    direction.z *= shared.shards.flatten;
    const color = pickColor(rng, params.weights);
    const scale = new Vector3(
      randomInRange(rng, shared.shards.scale.x),
      randomInRange(rng, shared.shards.scale.y),
      randomInRange(rng, shared.shards.scale.z),
    );
    const distance = params.shellRadius * randomInRange(rng, shared.shards.distanceMult);
    addShard(direction, distance, scale, color);
    addShard(mirrorX(direction), distance, scale, color);
  }
  shardGeometry.dispose();

  // Fins — large tapered triangular prisms thrusting out sideways, mostly
  // in-plane, mirrored. These give the creature its wingspan and direction.
  const finPairs = Math.max(0, Math.round(params.finPairs));
  for (let i = 0; i < finPairs; i += 1) {
    const angle = (rng() - 0.5) * shared.fins.angleSpread;
    const direction = new Vector3(Math.cos(angle), Math.sin(angle), (rng() - 0.5) * shared.fins.zTilt).normalize();
    const color = pickColor(rng, params.weights);
    const length = params.elongation * randomInRange(rng, shared.fins.lengthMult);
    const finGeometry = new CylinderGeometry(
      shared.fins.tipWidth,
      randomInRange(rng, shared.fins.baseWidth),
      length,
      3,
    ).toNonIndexed();
    const baseDistance = params.shellRadius * randomInRange(rng, shared.fins.baseDistanceMult);
    for (const outward of [direction, mirrorX(direction)]) {
      const rotation = new Quaternion().setFromUnitVectors(UP, outward);
      rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
      const matrix = new Matrix4().compose(
        outward.clone().multiplyScalar(baseDistance + length / 2),
        rotation,
        new Vector3(1, 1, 1),
      );
      addSolid(finGeometry, matrix, color, shared.fins.fillIntensity, shared.fins.edgeIntensity);
      shardSpecs.push({ direction: outward.clone(), color, size: length * 0.4 });
    }
    finGeometry.dispose();
  }

  const fillMesh = new Mesh(
    fillGeometries.length > 0 ? mergeGeometries(fillGeometries) : new BufferGeometry(),
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );

  const edgeLines = new LineSegments(
    edgeGeometries.length > 0 ? mergeGeometries(edgeGeometries) : new BufferGeometry(),
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );

  const coreBase = hdr(CORE_WHITE, shared.core.coreIntensity);
  const glowBase = hdr(CYAN, shared.core.glowIntensity);
  const coreMaterial = new MeshBasicMaterial({ color: coreBase.clone() });
  const core = new Mesh(new OctahedronGeometry(shared.core.coreRadius, 2), coreMaterial);
  const coreGlow = new Mesh(
    new OctahedronGeometry(shared.core.glowRadius, 2),
    new MeshBasicMaterial({
      color: glowBase.clone(),
      transparent: true,
      opacity: shared.core.glowOpacity,
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
  group.userData.coreUnlockedBase = coreBase;
  group.userData.glowUnlockedBase = glowBase;
  // Base colors + material handles for the per-frame distance falloff:
  // far away, hot elements are dimmed so bloom can't swallow the silhouette.
  group.userData.coreBase = coreBase.clone();
  group.userData.glowBase = glowBase.clone();
  group.userData.edgeMaterial = edgeLines.material;
  group.userData.fillMaterial = fillMesh.material;
  group.userData.accent = accent;
  return group;
}

export function setCrystalLocked(group: Group, locked: boolean) {
  // Update the base colors; the per-frame distance falloff in updateVisuals
  // multiplies these onto the materials.
  const unlockedCore = (group.userData.coreUnlockedBase as Color | undefined) ?? hdr(CORE_WHITE, 1.2);
  const unlockedGlow = (group.userData.glowUnlockedBase as Color | undefined) ?? hdr(CYAN, 0.42);
  (group.userData.coreBase as Color).copy(locked ? hdr(MAGENTA, 1.7) : unlockedCore);
  (group.userData.glowBase as Color).copy(locked ? hdr(MAGENTA, 0.7) : unlockedGlow);
}

// A hexagon outline in the XY plane as line segments.
export function hexRing(radius: number, z: number, spin: number): BufferGeometry {
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

export function paintVertexColor(geometry: BufferGeometry, color: Color, intensity: number) {
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

function randomInRange(rng: Rng, [min, max]: NumericRange): number {
  return min + rng() * (max - min);
}

function mirrorX(direction: Vector3): Vector3 {
  return new Vector3(-direction.x, direction.y, direction.z);
}
