import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CUBE_SLOTS, CUBIES, FACE_NORMALS, type Vec3i } from '../cube-model';

// Leaf: builds the puzzle cube — twenty-six graphite cubies, fifty-four
// sticker tiles that recolor from the live puzzle state, bare machinery
// plates for stripped slots, and the white spider core hidden inside. It
// takes every dimension and color as a parameter and decides nothing.

export type CubeLook = {
  pitch: number;
  cubieSize: number;
  faceColors: readonly Color[];
  body: Color;
  machine: Color;
  machineDetail: Color;
  steel: Color;
};

export type CubieVisual = {
  group: Group;
  coord: Vec3i;
  rest: Vector3;
};

export type StickerVisual = {
  slot: number;
  cubie: number;
  mesh: Mesh;
  material: MeshStandardMaterial;
  detail: Mesh;
  color: number;
};

export type CoreVisual = {
  group: Group;
  spinner: Group;
  heart: Mesh;
  heartMaterial: MeshStandardMaterial;
  caps: Mesh[];
  arms: Mesh[];
};

export type CubeVisual = {
  root: Group;
  cubies: CubieVisual[];
  stickers: StickerVisual[];
  core: CoreVisual;
};

const Q_FROM_Z = new Vector3(0, 0, 1);

export function createCubeVisual(look: CubeLook): CubeVisual {
  const root = new Group();
  root.name = 'speedsolve-cube';
  const half = look.cubieSize / 2;

  const bodyGeometry = new RoundedBoxGeometry(look.cubieSize, look.cubieSize, look.cubieSize, 3, look.cubieSize * 0.09);
  const bodyMaterial = new MeshStandardMaterial({ color: look.body, roughness: 0.55, metalness: 0.1 });
  const stickerGeometry = roundedTileGeometry(look.cubieSize * 0.86, look.cubieSize * 0.13, 0.12);
  const detailGeometry = machineDetailGeometry(look.cubieSize * 0.86);
  const detailMaterial = new MeshStandardMaterial({ color: look.machineDetail, roughness: 0.6, metalness: 0.2 });

  const cubies: CubieVisual[] = CUBIES.map((coord) => {
    const group = new Group();
    const rest = new Vector3(coord[0], coord[1], coord[2]).multiplyScalar(look.pitch);
    group.position.copy(rest);
    group.add(new Mesh(bodyGeometry, bodyMaterial));
    root.add(group);
    return { group, coord, rest };
  });

  const cubieIndex = new Map(CUBIES.map((coord, index) => [coord.join(','), index]));
  const stickers: StickerVisual[] = CUBE_SLOTS.map((slot, index) => {
    const cubie = cubieIndex.get(slot.p.join(',')) ?? 0;
    const material = new MeshStandardMaterial({ color: look.faceColors[slot.face], roughness: 0.32, metalness: 0 });
    const mesh = new Mesh(stickerGeometry, material);
    const normal = new Vector3(slot.n[0], slot.n[1], slot.n[2]);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(Q_FROM_Z, normal));
    mesh.position.copy(normal).multiplyScalar(half - 0.02);
    const detail = new Mesh(detailGeometry, detailMaterial);
    detail.position.z = 0.165;
    detail.visible = false;
    mesh.add(detail);
    cubies[cubie].group.add(mesh);
    return { slot: index, cubie, mesh, material, detail, color: slot.face };
  });

  const core = createCoreVisual(look);
  root.add(core.group);

  return { root, cubies, stickers, core };
}

/** Recolor a sticker from the puzzle state: a face index, or -1 for bare machinery. */
export function paintSticker(sticker: StickerVisual, color: number, look: CubeLook) {
  if (sticker.color === color) return;
  sticker.color = color;
  sticker.material.color.copy(color < 0 ? look.machine : look.faceColors[color]);
  sticker.material.roughness = color < 0 ? 0.7 : 0.32;
  sticker.detail.visible = color < 0;
}

function createCoreVisual(look: CubeLook): CoreVisual {
  const group = new Group();
  const spinner = new Group();
  group.add(spinner);
  const steel = new MeshStandardMaterial({ color: look.steel, roughness: 0.3, metalness: 0.65 });
  const heartMaterial = new MeshStandardMaterial({ color: look.machine, roughness: 0.25, metalness: 0.1, emissive: new Color(0, 0, 0) });

  const heart = new Mesh(new SphereGeometry(1.55, 32, 20), heartMaterial);
  spinner.add(heart);
  const collar = new Mesh(new TorusGeometry(1.75, 0.16, 10, 40), steel);
  spinner.add(collar);
  const collar2 = new Mesh(new TorusGeometry(1.75, 0.16, 10, 40), steel);
  collar2.rotation.x = Math.PI / 2;
  spinner.add(collar2);

  const armGeometry = new CylinderGeometry(0.34, 0.42, look.pitch - 0.6, 12);
  const capGeometry = new RoundedBoxGeometry(1.5, 1.5, 0.55, 2, 0.14);
  const arms: Mesh[] = [];
  const caps: Mesh[] = [];
  FACE_NORMALS.forEach((n, face) => {
    const normal = new Vector3(n[0], n[1], n[2]);
    const orient = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal);
    const arm = new Mesh(armGeometry, steel);
    arm.quaternion.copy(orient);
    arm.position.copy(normal).multiplyScalar((look.pitch - 0.6) / 2 + 0.3);
    spinner.add(arm);
    arms.push(arm);
    const cap = new Mesh(capGeometry, new MeshStandardMaterial({ color: look.faceColors[face], roughness: 0.3 }));
    cap.quaternion.copy(new Quaternion().setFromUnitVectors(Q_FROM_Z, normal));
    cap.position.copy(normal).multiplyScalar(look.pitch - 0.3);
    spinner.add(cap);
    caps.push(cap);
  });
  return { group, spinner, heart, heartMaterial, caps, arms };
}

function roundedTileGeometry(size: number, radius: number, depth: number) {
  const h = size / 2;
  const shape = new Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.quadraticCurveTo(h, -h, h, -h + radius);
  shape.lineTo(h, h - radius);
  shape.quadraticCurveTo(h, h, h - radius, h);
  shape.lineTo(-h + radius, h);
  shape.quadraticCurveTo(-h, h, -h, h - radius);
  shape.lineTo(-h, -h + radius);
  shape.quadraticCurveTo(-h, -h, -h + radius, -h);
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 });
  return geometry;
}

/** A machined plate: a hex hub, four corner bolts and two vent slots — hardware, not a sight. */
function machineDetailGeometry(size: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hub = new CylinderGeometry(size * 0.17, size * 0.17, 0.08, 6);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const bore = new CylinderGeometry(size * 0.07, size * 0.07, 0.12, 12);
  bore.rotateX(Math.PI / 2);
  parts.push(bore);
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const bolt = new CylinderGeometry(size * 0.05, size * 0.05, 0.06, 6);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(x * size * 0.36, y * size * 0.36, 0);
    parts.push(bolt);
  }
  for (const y of [-0.3, 0.3]) {
    const vent = new BoxGeometry(size * 0.34, size * 0.045, 0.03);
    vent.translate(0, y * size, 0);
    parts.push(vent);
  }
  return mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part)).map(stripToPosition), false) ?? parts[0];
}

function stripToPosition(geometry: BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}
