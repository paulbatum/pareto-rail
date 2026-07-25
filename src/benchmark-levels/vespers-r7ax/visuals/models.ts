import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CORE_WHITE,
  LEAD,
  LOCK_GOLD,
  STONE_EDGE,
  hdr,
} from './palette';

type TargetParts = {
  chestMaterials: MeshBasicMaterial[];
  silhouetteMaterials: MeshBasicMaterial[];
  edgeMaterials: Array<MeshBasicMaterial | LineBasicMaterial>;
  animated: Object3D[];
};

const BLACK_MATERIAL = new MeshBasicMaterial({
  color: LEAD.clone().multiplyScalar(0.58),
  side: DoubleSide,
});

const CHARCOAL_MATERIAL = new MeshBasicMaterial({
  color: STONE_EDGE.clone().multiplyScalar(0.45),
  side: DoubleSide,
});

function freshBlack() {
  return BLACK_MATERIAL.clone();
}

function freshCharcoal() {
  return CHARCOAL_MATERIAL.clone();
}

function jewelMaterial(color: Color, intensity = 1.1) {
  return new MeshBasicMaterial({
    color: hdr(color, intensity),
    side: DoubleSide,
  });
}

function jewelGlow(color: Color, intensity = 0.48) {
  return createAdditiveBasicMaterial({
    color: hdr(color, intensity),
    opacity: 0.58,
    side: DoubleSide,
  });
}

function registerTarget(group: Group, color: Color, parts: TargetParts) {
  group.userData.jewel = color.clone();
  group.userData.chestMaterials = parts.chestMaterials;
  group.userData.silhouetteMaterials = parts.silhouetteMaterials;
  group.userData.edgeMaterials = parts.edgeMaterials;
  group.userData.animatedParts = parts.animated;
  group.userData.baseScale = 1;
  return group;
}

function polygonGeometry(points: ReadonlyArray<readonly [number, number]>) {
  const shape = new Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return new ShapeGeometry(shape);
}

export function createShade(color: Color) {
  const group = new Group();
  const silhouettes: MeshBasicMaterial[] = [];
  const edges: Array<MeshBasicMaterial | LineBasicMaterial> = [];
  const chests: MeshBasicMaterial[] = [];
  const animated: Object3D[] = [];

  const wingGeometry = polygonGeometry([
    [0, 0.2],
    [1.9, 1.45],
    [1.2, 0.2],
    [2.25, -0.8],
    [0.55, -0.5],
    [0, -1.55],
  ]);
  for (const side of [-1, 1]) {
    const wingMaterial = freshBlack();
    silhouettes.push(wingMaterial);
    const wing = new Mesh(wingGeometry, wingMaterial);
    wing.scale.x = side;
    wing.position.x = side * 0.12;
    wing.userData.wingSide = side;
    group.add(wing);
    animated.push(wing);

    const ribMaterial = new LineBasicMaterial({ color: hdr(color, 0.22), transparent: true, opacity: 0.7 });
    edges.push(ribMaterial);
    const ribs = new LineSegments(new EdgesGeometry(wingGeometry), ribMaterial);
    ribs.scale.x = side;
    ribs.position.x = side * 0.12;
    ribs.position.z = 0.012;
    group.add(ribs);
  }

  const bodyMaterial = freshBlack();
  silhouettes.push(bodyMaterial);
  const body = new Mesh(
    polygonGeometry([[-0.45, 1.25], [0.45, 1.25], [0.66, -0.2], [0, -1.9], [-0.66, -0.2]]),
    bodyMaterial,
  );
  body.position.z = 0.03;
  group.add(body);

  const chestMaterial = jewelMaterial(color, 1.35);
  chests.push(chestMaterial);
  const chest = new Mesh(new OctahedronGeometry(0.42, 0), chestMaterial);
  chest.scale.set(0.78, 1.25, 0.28);
  chest.position.set(0, 0.05, 0.14);
  group.add(chest);

  const glow = new Mesh(new CircleGeometry(0.78, 24), jewelGlow(color));
  glow.position.set(0, 0.05, -0.03);
  group.add(glow);
  group.userData.glow = glow;
  return registerTarget(group, color, {
    chestMaterials: chests,
    silhouetteMaterials: silhouettes,
    edgeMaterials: edges,
    animated,
  });
}

export function createCenser(color: Color) {
  const group = new Group();
  const silhouettes: MeshBasicMaterial[] = [];
  const edges: Array<MeshBasicMaterial | LineBasicMaterial> = [];
  const chests: MeshBasicMaterial[] = [];
  const animated: Object3D[] = [];

  const chainMaterial = freshCharcoal();
  silhouettes.push(chainMaterial);
  const chain = new Group();
  for (let i = 0; i < 5; i += 1) {
    const link = new Mesh(new TorusGeometry(0.16, 0.035, 5, 12), chainMaterial);
    link.position.y = 1.9 - i * 0.28;
    link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
    chain.add(link);
  }
  group.add(chain);
  animated.push(chain);

  const cageMaterial = freshBlack();
  silhouettes.push(cageMaterial);
  const bowl = new Mesh(new SphereGeometry(0.92, 12, 8, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.64), cageMaterial);
  bowl.position.y = -0.15;
  group.add(bowl);

  for (let i = 0; i < 6; i += 1) {
    const bar = new Mesh(new CylinderGeometry(0.035, 0.035, 1.8, 5), cageMaterial);
    const angle = (i / 6) * Math.PI * 2;
    bar.position.set(Math.cos(angle) * 0.67, 0.45, Math.sin(angle) * 0.67);
    bar.rotation.z = Math.cos(angle) * 0.36;
    bar.rotation.x = Math.sin(angle) * 0.36;
    group.add(bar);
  }

  const rimMaterial = new MeshBasicMaterial({ color: hdr(color, 0.32) });
  edges.push(rimMaterial);
  const rim = new Mesh(new TorusGeometry(0.9, 0.055, 6, 28), rimMaterial);
  rim.position.y = 0.1;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const chestMaterial = jewelMaterial(color, 1.45);
  chests.push(chestMaterial);
  const ember = new Mesh(new OctahedronGeometry(0.5, 1), chestMaterial);
  ember.position.y = -0.05;
  group.add(ember);

  const glow = new Mesh(new SphereGeometry(0.75, 10, 7), jewelGlow(color, 0.36));
  glow.position.y = -0.05;
  group.add(glow);
  group.userData.glow = glow;
  group.userData.censerChain = chain;
  return registerTarget(group, color, {
    chestMaterials: chests,
    silhouetteMaterials: silhouettes,
    edgeMaterials: edges,
    animated,
  });
}

export function createAngel(color: Color) {
  const group = new Group();
  const silhouettes: MeshBasicMaterial[] = [];
  const edges: Array<MeshBasicMaterial | LineBasicMaterial> = [];
  const chests: MeshBasicMaterial[] = [];
  const animated: Object3D[] = [];
  const wingMaterial = freshBlack();
  silhouettes.push(wingMaterial);

  const wingShape = polygonGeometry([
    [0, 0],
    [1.2, 1.7],
    [3.4, 2.2],
    [2.45, 1.15],
    [3.75, 0.55],
    [2.15, 0.18],
    [3.15, -0.85],
    [1.1, -0.48],
  ]);
  for (const side of [-1, 1]) {
    const wing = new Mesh(wingShape, wingMaterial);
    wing.scale.x = side;
    wing.position.x = side * 0.1;
    group.add(wing);
    animated.push(wing);

    const outlineMaterial = new LineBasicMaterial({ color: hdr(color, 0.28), transparent: true, opacity: 0.72 });
    edges.push(outlineMaterial);
    const outline = new LineSegments(new EdgesGeometry(wingShape), outlineMaterial);
    outline.scale.x = side;
    outline.position.set(side * 0.1, 0, 0.015);
    group.add(outline);
  }

  const bodyMaterial = freshBlack();
  silhouettes.push(bodyMaterial);
  const torso = new Mesh(new BoxGeometry(0.45, 3.5, 0.22), bodyMaterial);
  torso.position.y = -0.25;
  group.add(torso);
  const crossbar = new Mesh(new BoxGeometry(2.25, 0.35, 0.2), bodyMaterial);
  crossbar.position.y = 0.58;
  group.add(crossbar);
  const crown = new Mesh(new RingGeometry(0.66, 0.76, 12), bodyMaterial);
  crown.position.y = 1.85;
  group.add(crown);

  const chestMaterial = jewelMaterial(color, 1.5);
  chests.push(chestMaterial);
  const heart = new Mesh(new OctahedronGeometry(0.5, 0), chestMaterial);
  heart.scale.set(0.75, 1.15, 0.42);
  heart.position.set(0, 0.55, 0.23);
  group.add(heart);

  const glow = new Mesh(new CircleGeometry(0.95, 24), jewelGlow(color, 0.42));
  glow.position.set(0, 0.55, -0.03);
  group.add(glow);
  group.userData.glow = glow;
  group.userData.angelWings = animated;
  return registerTarget(group, color, {
    chestMaterials: chests,
    silhouetteMaterials: silhouettes,
    edgeMaterials: edges,
    animated,
  });
}

export function createRosePetal(color: Color) {
  const group = new Group();
  const silhouettes: MeshBasicMaterial[] = [];
  const edges: Array<MeshBasicMaterial | LineBasicMaterial> = [];
  const chests: MeshBasicMaterial[] = [];

  const petalShape = polygonGeometry([
    [0, 2.25],
    [0.78, 1.1],
    [0.92, -0.9],
    [0, -2],
    [-0.92, -0.9],
    [-0.78, 1.1],
  ]);
  const backMaterial = freshBlack();
  silhouettes.push(backMaterial);
  const back = new Mesh(petalShape, backMaterial);
  group.add(back);

  const innerMaterial = jewelMaterial(color, 1.18);
  chests.push(innerMaterial);
  const inner = new Mesh(petalShape, innerMaterial);
  inner.scale.set(0.54, 0.68, 1);
  inner.position.z = 0.05;
  group.add(inner);

  const leadMaterial = new LineBasicMaterial({ color: hdr(LEAD, 1.2) });
  edges.push(leadMaterial);
  const leadwork = new LineSegments(new EdgesGeometry(petalShape), leadMaterial);
  leadwork.position.z = 0.08;
  group.add(leadwork);

  const glow = new Mesh(new CircleGeometry(1.1, 24), jewelGlow(color, 0.34));
  glow.scale.y = 1.7;
  glow.position.z = -0.04;
  group.add(glow);
  group.userData.glow = glow;
  return registerTarget(group, color, {
    chestMaterials: chests,
    silhouetteMaterials: silhouettes,
    edgeMaterials: edges,
    animated: [],
  });
}

export function createRoseHeart(colors: readonly Color[]) {
  const group = new Group();
  const silhouettes: MeshBasicMaterial[] = [];
  const edges: Array<MeshBasicMaterial | LineBasicMaterial> = [];
  const chests: MeshBasicMaterial[] = [];
  const animated: Object3D[] = [];

  const nestMaterial = freshBlack();
  silhouettes.push(nestMaterial);
  const nest = new Group();
  for (let i = 0; i < 3; i += 1) {
    const ring = new Mesh(new TorusGeometry(2.6 + i * 0.42, 0.22, 7, 38), nestMaterial);
    ring.rotation.z = i * Math.PI / 3;
    ring.rotation.y = (i - 1) * 0.32;
    nest.add(ring);
    animated.push(ring);
  }
  for (let i = 0; i < 12; i += 1) {
    const thorn = new Mesh(new CylinderGeometry(0.05, 0.19, 2.6, 5), nestMaterial);
    const angle = (i / 12) * Math.PI * 2;
    thorn.position.set(Math.cos(angle) * 3.5, Math.sin(angle) * 3.5, 0);
    thorn.rotation.z = angle - Math.PI / 2;
    nest.add(thorn);
  }
  group.add(nest);
  group.userData.nest = nest;

  colors.forEach((color, index) => {
    const material = jewelMaterial(color, 1.25);
    chests.push(material);
    const shard = new Mesh(new OctahedronGeometry(0.78, 0), material);
    const angle = (index / colors.length) * Math.PI * 2;
    shard.position.set(Math.cos(angle) * 1.42, Math.sin(angle) * 1.42, 0.28);
    shard.scale.set(0.7, 1.35, 0.45);
    shard.rotation.z = angle;
    group.add(shard);
    animated.push(shard);

    const glow = new Mesh(new CircleGeometry(0.74, 20), jewelGlow(color, 0.34));
    glow.position.copy(shard.position);
    glow.position.z = -0.08;
    group.add(glow);
  });

  const coreMaterial = jewelMaterial(CORE_WHITE, 1.35);
  chests.push(coreMaterial);
  const core = new Mesh(new OctahedronGeometry(1.12, 1), coreMaterial);
  core.scale.set(0.72, 1.1, 0.62);
  core.position.z = 0.4;
  group.add(core);
  group.userData.roseCore = core;
  group.userData.lockRingScale = 1.6;
  return registerTarget(group, CORE_WHITE, {
    chestMaterials: chests,
    silhouetteMaterials: silhouettes,
    edgeMaterials: edges,
    animated,
  });
}

export function createLetterMesh(character: string, color: Color) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const fillMaterial = jewelMaterial(color, 0.95);
  const edgeMaterial = new LineBasicMaterial({ color: hdr(CORE_WHITE, 0.82) });
  const darkMaterial = freshBlack();
  const geometry = new BoxGeometry(0.23, 0.23, 0.1);
  const edges = new EdgesGeometry(geometry);

  for (const cell of cells) {
    const backing = new Mesh(geometry, darkMaterial);
    backing.scale.set(1.18, 1.18, 1);
    backing.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    group.add(backing);

    const block = new Mesh(geometry, fillMaterial);
    block.position.copy(backing.position);
    block.position.z = 0.07;
    block.scale.set(0.88, 0.88, 0.7);
    group.add(block);

    const outline = new LineSegments(edges, edgeMaterial);
    outline.position.copy(block.position);
    outline.scale.copy(block.scale);
    group.add(outline);
  }

  const arch = new Mesh(new RingGeometry(1.02, 1.075, 40), new MeshBasicMaterial({
    color: hdr(color, 0.7),
    side: DoubleSide,
  }));
  arch.scale.y = 1.28;
  arch.position.y = 0.03;
  group.add(arch);
  group.userData.isLetter = true;
  group.userData.letterFill = fillMaterial;
  group.userData.letterEdge = edgeMaterial;
  group.userData.jewel = color.clone();
  group.userData.baseScale = 1;
  return group;
}

export function setTargetLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    const fill = mesh.userData.letterFill as MeshBasicMaterial;
    const edge = mesh.userData.letterEdge as LineBasicMaterial;
    const jewel = mesh.userData.jewel as Color;
    fill.color.copy(locked ? hdr(CORE_WHITE, 1.35) : hdr(jewel, 0.95));
    edge.color.copy(locked ? hdr(LOCK_GOLD, 1.35) : hdr(CORE_WHITE, 0.82));
    return;
  }

  const jewel = mesh.userData.jewel as Color;
  const chestMaterials = mesh.userData.chestMaterials as MeshBasicMaterial[] | undefined;
  const edgeMaterials = mesh.userData.edgeMaterials as Array<MeshBasicMaterial | LineBasicMaterial> | undefined;
  for (const material of chestMaterials ?? []) {
    material.color.copy(locked ? hdr(CORE_WHITE, 1.45 + lockCount * 0.08) : hdr(jewel, 1.35));
  }
  for (const material of edgeMaterials ?? []) {
    material.color.copy(locked ? hdr(LOCK_GOLD, 1.15) : hdr(jewel, 0.28));
  }
}

export function setTargetDenied(mesh: Object3D, until: number) {
  mesh.userData.deniedUntil = until;
  if (mesh.userData.isLetter) {
    (mesh.userData.letterFill as MeshBasicMaterial).color.copy(hdr(LOCK_GOLD, 1.2));
    return;
  }
  for (const material of (mesh.userData.chestMaterials as MeshBasicMaterial[] | undefined) ?? []) {
    material.color.copy(hdr(LOCK_GOLD, 1.3));
  }
}

export function updateTargetModel(mesh: Group, elapsed: number, age: number, dt: number) {
  const pulse = 1 + Math.sin(elapsed * 3.1 + mesh.id) * 0.035;
  const glow = mesh.userData.glow as Mesh | undefined;
  if (glow) glow.scale.setScalar(pulse);

  const wings = mesh.userData.angelWings as Mesh[] | undefined;
  if (wings) {
    wings.forEach((wing, index) => {
      wing.rotation.y = Math.sin(age * 3 + index * Math.PI) * 0.18;
    });
  }
  const chain = mesh.userData.censerChain as Group | undefined;
  if (chain) chain.rotation.z = Math.sin(age * 1.7) * 0.2;

  const nest = mesh.userData.nest as Group | undefined;
  if (nest) {
    nest.rotation.z += dt * 0.13;
    nest.rotation.y = Math.sin(age * 0.28) * 0.16;
  }
  const core = mesh.userData.roseCore as Mesh | undefined;
  if (core) {
    core.rotation.y += dt * 0.7;
    core.rotation.z -= dt * 0.45;
    const exposed = mesh.userData.exposed === true;
    core.scale.setScalar((exposed ? 1.18 : 0.78) * pulse);
  }
}

export function createProjectileVisual() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.2, 0),
    new MeshBasicMaterial({ color: hdr(CORE_WHITE, 1.8) }),
  );
  core.scale.set(0.55, 0.55, 2.8);
  const halo = new Mesh(
    new RingGeometry(0.2, 0.33, 12),
    createAdditiveBasicMaterial({ color: hdr(LOCK_GOLD, 0.8), opacity: 0.65, side: DoubleSide }),
  );
  halo.rotation.x = Math.PI / 2;
  group.add(core, halo);
  group.userData.projectileHalo = halo;
  return group;
}

export function createReticleVisual() {
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const makeMaterial = (color: Color) => {
    const material = createAdditiveBasicMaterial({
      color,
      opacity: 0.84,
      side: DoubleSide,
      depthTest: false,
    });
    materials.push(material);
    return material;
  };

  const outer = new Mesh(new RingGeometry(0.88, 0.94, 48), makeMaterial(hdr(CORE_WHITE, 0.82)));
  const quatrefoil = new Group();
  for (let i = 0; i < 4; i += 1) {
    const petal = new Mesh(new RingGeometry(0.28, 0.32, 20, 1, 0, Math.PI * 1.15), makeMaterial(hdr(LOCK_GOLD, 0.72)));
    const angle = (i / 4) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 0);
    petal.rotation.z = angle + Math.PI * 0.42;
    quatrefoil.add(petal);
  }
  const dot = new Mesh(new CircleGeometry(0.045, 16), makeMaterial(hdr(CORE_WHITE, 1.4)));
  group.add(outer, quatrefoil, dot);
  group.userData.reticleMaterials = materials;
  group.userData.quatrefoil = quatrefoil;
  group.userData.active = false;
  return group;
}
