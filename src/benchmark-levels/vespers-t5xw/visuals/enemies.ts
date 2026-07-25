import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CANDLE, hdr, PETAL_JEWELS, ROSEWHITE, THIEF_BLACK, THIEF_EDGE } from './palette';

// Leaf: the thieves. Every enemy is a flat black shape — blacker than the
// dark — with one stolen pane burning in its chest. The chest core is the
// only reason you can see them at all, so every factory routes its core and
// glow through userData for the spawn handler to tint with the exact colour
// of the window that thief robbed.
//
// Draw-call budget: every static black silhouette is ONE merged mesh (plus
// one merged edge-line set); only parts that animate independently (moth
// wings, wisp tatters, the heart's shell) get their own object.

// Radial gradient disc: white centre falling to black rim. Under additive
// blending, multiplied by a material colour, it reads as a soft light.
export function createRadialFanGeometry(segments = 20): BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [1, 1, 1];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle), Math.sin(angle), 0);
    colors.push(0, 0, 0);
  }
  for (let i = 1; i <= segments; i += 1) indices.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

const FAN_GEOMETRY = createRadialFanGeometry();

function blackMaterial() {
  return new MeshBasicMaterial({ color: THIEF_BLACK.clone(), blending: NormalBlending, depthWrite: true, side: DoubleSide });
}

type Part = {
  geometry: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  /** Include this part's silhouette in the merged edge-line pass. */
  edges?: boolean;
};

const scratchMatrix = new Matrix4();

function partMatrix(part: Part): Matrix4 {
  const rotation = new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0])));
  return scratchMatrix.compose(
    new Vector3(...(part.position ?? [0, 0, 0])),
    rotation,
    new Vector3(...(part.scale ?? [1, 1, 1])),
  ).clone();
}

/** Merge black parts into one mesh (+ one edge-line set for the flagged parts). */
function mergedBlackBody(parts: Part[]): Group {
  const group = new Group();
  const bodies: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  for (const part of parts) {
    const matrix = partMatrix(part);
    const transformed = part.geometry.clone().applyMatrix4(matrix);
    // Primitive geometries mix indexed and non-indexed layouts; normalise so
    // mergeGeometries always sees compatible attributes.
    if (transformed.index) {
      bodies.push(transformed.toNonIndexed());
      transformed.dispose();
    } else {
      bodies.push(transformed);
    }
    if (part.edges) edges.push(new EdgesGeometry(part.geometry as never).applyMatrix4(matrix) as unknown as BufferGeometry);
  }
  group.add(new Mesh(mergeGeometries(bodies), blackMaterial()));
  if (edges.length > 0) {
    group.add(new LineSegments(
      mergeGeometries(edges),
      new LineBasicMaterial(additiveMaterialParameters({ color: THIEF_EDGE.clone() })),
    ));
  }
  for (const geometry of [...bodies, ...edges]) geometry.dispose();
  return group;
}

// The stolen pane: a flattened glass shard plus its soft glow. The materials
// land in userData so the spawn handler can tint them per window.
function attachCore(group: Group, position: Vector3, scale = 1) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CANDLE, 1.1) });
  const core = new Mesh(new OctahedronGeometry(0.34 * scale, 0), coreMaterial);
  core.scale.set(0.75, 1, 0.35);
  core.position.copy(position);

  const glowMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(CANDLE, 0.5), vertexColors: true }));
  const glow = new Mesh(FAN_GEOMETRY, glowMaterial);
  glow.scale.setScalar(1.15 * scale);
  glow.position.copy(position).add(new Vector3(0, 0, -0.06));

  group.add(glow, core);
  group.userData.coreMaterial = coreMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.coreBase = hdr(CANDLE, 1.1);
  group.userData.glowBase = hdr(CANDLE, 0.5);
  return { coreMaterial, glowMaterial };
}

/** Tint a thief's stolen pane with its window's colour. */
export function setEnemyJewel(mesh: Group, jewel: Color) {
  mesh.userData.jewel = jewel.clone();
  mesh.userData.coreBase = hdr(jewel.clone().lerp(new Color(1, 1, 1), 0.25), 1.5);
  mesh.userData.glowBase = hdr(jewel, 0.55);
  const coreMaterial = mesh.userData.coreMaterial as MeshBasicMaterial | undefined;
  const glowMaterial = mesh.userData.glowMaterial as MeshBasicMaterial | undefined;
  coreMaterial?.color.copy(mesh.userData.coreBase as Color);
  glowMaterial?.color.copy(mesh.userData.glowBase as Color);
}

// Wisp — a hooded shroud drifting toward the light, its hem torn to tatters.
export function createWispMesh(): Group {
  const group = mergedBlackBody([
    { geometry: new ConeGeometry(0.78, 1.9, 6), position: [0, -0.15, 0], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.34], edges: true },
    { geometry: new SphereGeometry(0.44, 7, 5), position: [0, 0.78, 0], scale: [1, 0.85, 0.5] },
  ]);
  // The tatters sway as one fringe below the hem.
  const tatters = mergedBlackBody([
    { geometry: new ConeGeometry(0.14, 0.75, 4), position: [-0.42, -1.2, 0], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.4] },
    { geometry: new ConeGeometry(0.14, 0.75, 4), position: [0, -1.32, 0], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.4] },
    { geometry: new ConeGeometry(0.14, 0.75, 4), position: [0.42, -1.2, 0], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.4] },
  ]);
  group.add(tatters);
  group.userData.tatters = tatters;
  attachCore(group, new Vector3(0, 0.22, 0.24));
  return group;
}

// Moth — wide flat black wings crossing the nave; the pane rides its thorax.
export function createMothMesh(): Group {
  const group = mergedBlackBody([
    { geometry: new BoxGeometry(0.26, 1.15, 0.16), edges: true },
    { geometry: new ConeGeometry(0.14, 0.34, 5), position: [0, 0.72, 0] },
  ]);
  const wingGeometry = makeWingGeometry();
  const wings: Group[] = [];
  for (const side of [1, -1]) {
    const wing = new Group();
    const membrane = new Mesh(wingGeometry, blackMaterial());
    wing.add(membrane);
    wing.position.set(side * 0.13, 0.18, 0);
    wing.scale.x = side;
    wings.push(wing);
    group.add(wing);
  }
  group.userData.wings = wings;
  attachCore(group, new Vector3(0, 0.05, 0.14), 0.9);
  return group;
}

function makeWingGeometry(): BufferGeometry {
  // Fore and hind wing as two shear triangles — a swallowtail silhouette.
  const positions = new Float32Array([
    0, 0.5, 0, 1.35, 0.8, 0, 1.1, -0.05, 0,
    0, 0.12, 0, 1.1, -0.42, 0, 0.5, -0.85, 0,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Gargoyle — a hunched mass on a floating corbel, horns and folded wings.
export function createGargoyleMesh(): Group {
  const group = mergedBlackBody([
    { geometry: new BoxGeometry(1.05, 0.4, 0.9), position: [0, -0.85, 0], edges: true },
    { geometry: new SphereGeometry(0.66, 7, 6), position: [0, -0.1, 0], scale: [1, 0.82, 0.9] },
    { geometry: new BoxGeometry(0.46, 0.36, 0.5), position: [0, 0.52, 0.2] },
    { geometry: new ConeGeometry(0.09, 0.42, 4), position: [0.18, 0.84, 0.14], rotation: [0, 0, -0.35] },
    { geometry: new ConeGeometry(0.09, 0.42, 4), position: [-0.18, 0.84, 0.14], rotation: [0, 0, 0.35] },
    { geometry: new BoxGeometry(0.16, 1.0, 0.5), position: [0.58, 0.42, -0.28], rotation: [0, 0, 0.55], edges: true },
    { geometry: new BoxGeometry(0.16, 1.0, 0.5), position: [-0.58, 0.42, -0.28], rotation: [0, 0, -0.55], edges: true },
  ]);
  attachCore(group, new Vector3(0, 0.02, 0.55), 0.95);
  return group;
}

// Censer — a swinging thurible, its stolen light leaking through the slits.
export function createCenserMesh(): Group {
  const group = mergedBlackBody([
    { geometry: new ConeGeometry(0.58, 0.75, 6), position: [0, 0.38, 0], edges: true },
    { geometry: new ConeGeometry(0.58, 0.75, 6), position: [0, -0.38, 0], rotation: [Math.PI, 0, 0], edges: true },
    { geometry: new BoxGeometry(0.05, 3.4, 0.05), position: [0, 2.4, 0] },
    { geometry: new OctahedronGeometry(0.14, 0), position: [0, 0.85, 0] },
  ]);

  const { coreMaterial } = attachCore(group, new Vector3(0, 0, 0.1), 1.05);
  // Equator slits share the core material, so the leak is the pane's colour.
  const slitGeometries: BufferGeometry[] = [];
  const slitGeometry = new BoxGeometry(0.34, 0.09, 0.05);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.35;
    const matrix = new Matrix4().compose(
      new Vector3(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5),
      new Quaternion().setFromEuler(new Euler(0, -angle, 0)),
      new Vector3(1, 1, 1),
    );
    slitGeometries.push(slitGeometry.clone().applyMatrix4(matrix));
  }
  group.add(new Mesh(mergeGeometries(slitGeometries), coreMaterial));
  for (const geometry of slitGeometries) geometry.dispose();
  slitGeometry.dispose();
  return group;
}

// Gloom bolt — a sliver of the dark with a guttering ember at its heart.
export function createBoltMesh(): Group {
  const group = mergedBlackBody([
    { geometry: new OctahedronGeometry(0.34, 0), scale: [0.55, 0.55, 1.8], edges: true },
  ]);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CANDLE, 1.4) });
  const core = new Mesh(new OctahedronGeometry(0.15, 0), coreMaterial);
  core.scale.set(0.7, 0.7, 1.9);
  const glowMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(CANDLE, 0.6), vertexColors: true }));
  const glow = new Mesh(FAN_GEOMETRY, glowMaterial);
  glow.scale.setScalar(0.5);
  group.add(core, glow);
  group.userData.coreMaterial = coreMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.coreBase = hdr(CANDLE, 1.4);
  group.userData.glowBase = hdr(CANDLE, 0.6);
  group.userData.isBolt = true;
  return group;
}

// Vigil petal — a fan of stolen glass blades on a black tattered backing.
export function createPetalMesh(index: number): Group {
  const jewel = PETAL_JEWELS[index % PETAL_JEWELS.length];
  const wing = makeWingGeometry();
  const group = mergedBlackBody([
    { geometry: wing, position: [0, -0.3, 0], scale: [0.95, 1.25, 1] },
    { geometry: wing, position: [0, -0.3, 0], scale: [-0.95, 1.25, 1] },
  ]);

  const bladeMaterial = new MeshBasicMaterial({ color: hdr(jewel.clone().lerp(new Color(1, 1, 1), 0.2), 1.5) });
  const bladeGeometries: BufferGeometry[] = [];
  const bladeGeometry = new OctahedronGeometry(0.42, 0);
  for (const [angle, length] of [[-0.55, 1.1], [0, 1.5], [0.55, 1.1]] as const) {
    const matrix = new Matrix4().compose(
      new Vector3(Math.sin(angle) * 0.7, Math.cos(angle) * 0.55, 0.08),
      new Quaternion().setFromEuler(new Euler(0, 0, -angle)),
      new Vector3(0.4, length, 0.22),
    );
    bladeGeometries.push(bladeGeometry.clone().applyMatrix4(matrix));
  }
  group.add(new Mesh(mergeGeometries(bladeGeometries), bladeMaterial));
  for (const geometry of bladeGeometries) geometry.dispose();
  bladeGeometry.dispose();

  const glowMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(jewel, 0.5), vertexColors: true }));
  const glow = new Mesh(FAN_GEOMETRY, glowMaterial);
  glow.scale.setScalar(1.7);
  glow.position.z = -0.08;
  group.add(glow);

  group.userData.coreMaterial = bladeMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.coreBase = hdr(jewel.clone().lerp(new Color(1, 1, 1), 0.2), 1.5);
  group.userData.glowBase = hdr(jewel, 0.5);
  group.userData.jewel = jewel.clone();
  group.userData.petalIndex = index;
  return group;
}

// The Vigil's heart — every stolen colour packed behind a black tracery
// shell. The shell cracks away at the stage break; the bare heart is the
// brightest thing in the level until the rose outshines it.
export function createHeartMesh(): Group {
  const group = new Group();

  // The whole shell spins and cracks as one piece: one merged mesh.
  const shellParts: Part[] = [
    { geometry: new TorusGeometry(2.15, 0.1, 6, 24), edges: false },
    { geometry: new TorusGeometry(1.45, 0.09, 6, 20) },
  ];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    shellParts.push({
      geometry: new BoxGeometry(0.09, 2.1, 0.09),
      position: [Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0],
      rotation: [0, 0, angle + Math.PI / 2],
    });
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.26;
    shellParts.push({
      geometry: new ConeGeometry(0.16, 0.9, 4),
      position: [Math.cos(angle) * 2.55, Math.sin(angle) * 2.55, 0],
      rotation: [0, 0, angle - Math.PI / 2],
      edges: true,
    });
  }
  const shell = mergedBlackBody(shellParts);
  group.add(shell);
  group.userData.shell = shell;

  // The stolen colours as one vertex-coloured cluster around a white core.
  const paneGeometries: BufferGeometry[] = [];
  const paneGeometry = new OctahedronGeometry(0.44, 0);
  PETAL_JEWELS.forEach((jewel, index) => {
    const angle = (index / PETAL_JEWELS.length) * Math.PI * 2;
    const matrix = new Matrix4().compose(
      new Vector3(Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, 0.05),
      new Quaternion().setFromEuler(new Euler(0, 0, angle - Math.PI / 2)),
      new Vector3(0.55, 0.95, 0.3),
    );
    const geometry = paneGeometry.clone().applyMatrix4(matrix);
    const lit = hdr(jewel, 1.3);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = lit.r;
      colors[i + 1] = lit.g;
      colors[i + 2] = lit.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    paneGeometries.push(geometry);
  });
  group.add(new Mesh(mergeGeometries(paneGeometries), new MeshBasicMaterial({ vertexColors: true })));
  for (const geometry of paneGeometries) geometry.dispose();
  paneGeometry.dispose();

  const coreMaterial = new MeshBasicMaterial({ color: hdr(ROSEWHITE, 1.6) });
  const core = new Mesh(new SphereGeometry(0.62, 8, 6), coreMaterial);
  core.scale.z = 0.55;
  const glowMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(ROSEWHITE, 0.4), vertexColors: true }));
  const glow = new Mesh(FAN_GEOMETRY, glowMaterial);
  glow.scale.setScalar(2.6);
  glow.position.z = -0.12;
  group.add(glow, core);

  group.userData.coreMaterial = coreMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.coreBase = hdr(ROSEWHITE, 1.6);
  group.userData.glowBase = hdr(ROSEWHITE, 0.4);
  return group;
}
