import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hexRing, paintVertexColor, type ShardSpec } from './crystal';
import { AMBER, CORE_WHITE, CYAN, hdr, MAGENTA } from './palette';

// Threat visuals for the challenge pass: lancer bolts, and the Crystal Warden
// miniboss (shielded core + orbiting hex plates). Every group honors the same
// userData contract as createCrystal (core/glow/edge/fill materials, base
// colors, shardSpecs) so lock tint, distance falloff, and kill shatter in
// visuals/index.ts work on them unchanged.

const UP = new Vector3(0, 1, 0);

type HotGroupParts = {
  group: Group;
  addFill(geometry: BufferGeometry, matrix: Matrix4 | null, color: Color, fillIntensity: number, edgeIntensity: number): void;
  addEdge(geometry: BufferGeometry, color: Color, intensity: number): void;
  finish(options: {
    coreRadius: number;
    glowRadius: number;
    coreColor: Color;
    glowColor: Color;
    glowOpacity: number;
    accent: Color;
    shardSpecs: ShardSpec[];
  }): Group;
};

// Collects vertex-colored fill + edge geometry into two merged meshes and a
// hot core, then wires the userData contract expected by visuals/index.ts.
function hotGroup(): HotGroupParts {
  const group = new Group();
  const fillGeometries: BufferGeometry[] = [];
  const edgeGeometries: BufferGeometry[] = [];

  const addEdge = (geometry: BufferGeometry, color: Color, intensity: number) => {
    paintVertexColor(geometry, color, intensity);
    edgeGeometries.push(geometry);
  };

  const addFill = (
    geometry: BufferGeometry,
    matrix: Matrix4 | null,
    color: Color,
    fillIntensity: number,
    edgeIntensity: number,
  ) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const placed = matrix ? source.clone().applyMatrix4(matrix) : source.clone();
    if (source !== geometry) source.dispose();
    paintVertexColor(placed, color, fillIntensity);
    fillGeometries.push(placed);
    const edges = new EdgesGeometry(geometry, 12);
    if (matrix) edges.applyMatrix4(matrix);
    addEdge(edges, color, edgeIntensity);
  };

  const finish: HotGroupParts['finish'] = ({ coreRadius, glowRadius, coreColor, glowColor, glowOpacity, accent, shardSpecs }) => {
    const fillMesh = new Mesh(
      fillGeometries.length > 0 ? mergeGeometries(fillGeometries) : new BufferGeometry(),
      new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    const edgeLines = new LineSegments(
      edgeGeometries.length > 0 ? mergeGeometries(edgeGeometries) : new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    const coreMaterial = new MeshBasicMaterial({ color: coreColor.clone() });
    const core = new Mesh(new OctahedronGeometry(coreRadius, 2), coreMaterial);
    const coreGlow = new Mesh(
      new OctahedronGeometry(glowRadius, 2),
      new MeshBasicMaterial({
        color: glowColor.clone(),
        transparent: true,
        opacity: glowOpacity,
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
    group.userData.coreUnlockedBase = coreColor;
    group.userData.glowUnlockedBase = glowColor;
    group.userData.coreBase = coreColor.clone();
    group.userData.glowBase = glowColor.clone();
    group.userData.edgeMaterial = edgeLines.material;
    group.userData.fillMaterial = fillMesh.material;
    group.userData.accent = accent;
    return group;
  };

  return { group, addFill, addEdge, finish };
}

function radialShardSpecs(count: number, colors: Color[], size: number): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const tilt = ((i % 3) - 1) * 0.45;
    specs.push({
      direction: new Vector3(Math.cos(angle), Math.sin(angle), tilt).normalize(),
      color: colors[i % colors.length],
      size: size * (0.8 + (i % 2) * 0.5),
    });
  }
  return specs;
}

// A shard bolt: hot amber dart the player must shoot down before it lands.
// Small but unmistakably hostile — nothing else in the level is this orange.
export function createBoltMesh(): Group {
  const parts = hotGroup();

  // Four trailing fins around the dart body.
  const finGeometry = new TetrahedronGeometry(0.32, 0);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const outward = new Vector3(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0.5);
    const matrix = new Matrix4().compose(
      outward,
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle),
      new Vector3(0.8, 0.8, 1.6),
    );
    parts.addFill(finGeometry, matrix, AMBER, 0.5, 1.5);
  }
  finGeometry.dispose();

  // Thin triangular halo so the bolt reads as a lockable target, not debris.
  const halo = new RingGeometry(0.78, 0.86, 3);
  parts.addFill(halo, new Matrix4(), AMBER, 1.3, 0);
  halo.dispose();

  const group = parts.finish({
    coreRadius: 0.18,
    glowRadius: 0.32,
    coreColor: hdr(CORE_WHITE, 2.2),
    glowColor: hdr(AMBER, 1.5),
    glowOpacity: 0.55,
    accent: AMBER,
    shardSpecs: radialShardSpecs(6, [AMBER, AMBER, MAGENTA], 0.5),
  });
  group.userData.isBolt = true;
  group.userData.lockRingScale = 0.8;
  return group;
}

// Amber targeting halo added around a lancer's crystal body: the "this one
// shoots back" signifier. Returned as a child; the crystal group keeps its
// own userData contract.
export function createLancerHalo(): Group {
  const halo = new Group();
  const ring = new Mesh(
    new RingGeometry(2.35, 2.46, 3),
    new MeshBasicMaterial({
      color: hdr(AMBER, 1.35),
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  const counterRing = new Mesh(
    new RingGeometry(2.7, 2.76, 3),
    new MeshBasicMaterial({
      color: hdr(AMBER, 0.8),
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  counterRing.rotation.z = Math.PI;
  halo.add(ring, counterRing);
  halo.userData.spinParts = [ring, counterRing];
  return halo;
}

// One node of the Warden's outer lattice: six individually lockable pylons
// that make the boss read as a structure before the inner plates crack.
export function createWardenOuterTargetMesh(): Group {
  const parts = hotGroup();

  const hubGeometry = new CylinderGeometry(1.05, 1.05, 0.26, 6);
  const faceMatrix = new Matrix4().compose(
    new Vector3(0, 0, 0),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    new Vector3(1.2, 1.2, 1),
  );
  parts.addFill(hubGeometry, faceMatrix, AMBER, 0.22, 1.1);
  hubGeometry.dispose();

  const sparGeometry = new CylinderGeometry(0.06, 0.06, 3.1, 3).toNonIndexed();
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const outward = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const matrix = new Matrix4().compose(
      outward.clone().multiplyScalar(1.55),
      new Quaternion().setFromUnitVectors(UP, outward),
      new Vector3(1, 1, 1),
    );
    parts.addFill(sparGeometry, matrix, i === 1 ? MAGENTA : CYAN, 0.38, 1.2);
  }
  sparGeometry.dispose();

  parts.addEdge(hexRing(1.55, 0.18, 0.25), CYAN, 1.0);
  parts.addEdge(hexRing(1.55, -0.18, -0.25), AMBER, 0.85);

  const group = parts.finish({
    coreRadius: 0.28,
    glowRadius: 0.5,
    coreColor: hdr(CORE_WHITE, 1.35),
    glowColor: hdr(AMBER, 0.75),
    glowOpacity: 0.36,
    accent: AMBER,
    shardSpecs: radialShardSpecs(8, [AMBER, CYAN, MAGENTA], 0.68),
  });
  group.userData.lockRingScale = 1.18;
  return group;
}

// One of the Warden's orbiting shield plates: a flat hex slab, magenta-edged,
// two hits to crack.
export function createWardenShieldMesh(): Group {
  const parts = hotGroup();

  const plateGeometry = new CylinderGeometry(1.85, 1.85, 0.34, 6);
  const plateMatrix = new Matrix4().compose(
    new Vector3(0, 0, 0),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    new Vector3(1, 1, 1),
  );
  parts.addFill(plateGeometry, plateMatrix, MAGENTA, 0.28, 1.5);
  plateGeometry.dispose();

  parts.addEdge(hexRing(1.35, 0.24, 0.3), CYAN, 1.2);
  parts.addEdge(hexRing(1.35, -0.24, 0.3), CYAN, 1.2);

  const group = parts.finish({
    coreRadius: 0.34,
    glowRadius: 0.62,
    coreColor: hdr(CORE_WHITE, 1.4),
    glowColor: hdr(MAGENTA, 0.8),
    glowOpacity: 0.4,
    accent: MAGENTA,
    shardSpecs: radialShardSpecs(10, [MAGENTA, CYAN, MAGENTA], 0.8),
  });
  group.userData.lockRingScale = 1.35;
  return group;
}

// The Crystal Warden core: a large hex mandala with a hot heart, wrapped in an
// amber shield shell (userData.shell) that visuals/index.ts dissolves once
// gameplay marks userData.exposed.
export function createWardenCoreMesh(): Group {
  const parts = hotGroup();

  parts.addEdge(hexRing(2.1, 0.15, 0), CYAN, 1.35);
  parts.addEdge(hexRing(2.1, -0.15, 0), CYAN, 1.35);
  parts.addEdge(hexRing(2.85, 0, 0.35), MAGENTA, 1.0);
  parts.addEdge(hexRing(3.6, 0, 0.1), CYAN, 1.25);

  // Radial prism spokes between the middle and outer rings.
  const spokeGeometry = new CylinderGeometry(0.09, 0.09, 1.5, 3).toNonIndexed();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.1;
    const outward = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const matrix = new Matrix4().compose(
      outward.clone().multiplyScalar(2.9),
      new Quaternion().setFromUnitVectors(UP, outward),
      new Vector3(1, 1, 1),
    );
    parts.addFill(spokeGeometry, matrix, i % 2 === 0 ? CYAN : MAGENTA, 0.5, 1.4);
  }
  spokeGeometry.dispose();

  const group = parts.finish({
    coreRadius: 1.0,
    glowRadius: 1.75,
    coreColor: hdr(CORE_WHITE, 1.5),
    glowColor: hdr(CYAN, 0.6),
    glowOpacity: 0.32,
    accent: MAGENTA,
    shardSpecs: radialShardSpecs(18, [CYAN, MAGENTA, AMBER], 1.5),
  });
  group.userData.lockRingScale = 2.3;

  // Shield shell: amber cage that spins while the shield plates live. Not part
  // of the falloff contract — it stays hot until it dissolves.
  const shell = new Group();
  const shellLineMaterial = new LineBasicMaterial({
    color: hdr(AMBER, 0.78),
    transparent: true,
    opacity: 0.62,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (const [radius, z, twist] of [
    [8.2, 0.7, 0.12],
    [8.55, 0, 0],
    [8.2, -0.7, -0.12],
    [4.35, 0.5, 0.25],
    [4.6, 0, 0],
    [4.35, -0.5, -0.25],
  ] as const) {
    shell.add(new LineSegments(hexRing(radius, z, twist), shellLineMaterial));
  }
  const cage = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(6.9, 0)),
    new LineBasicMaterial({
      color: hdr(AMBER, 0.45),
      transparent: true,
      opacity: 0.48,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  shell.add(cage);
  group.add(shell);
  group.userData.shell = shell;
  return group;
}
