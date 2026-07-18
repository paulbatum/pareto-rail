import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera, Side } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createStrandlineS5cxRail } from '../gameplay';

const WATER_NEAR = new Color(0x087b8a);
const WATER_DEEP = new Color(0x031b48);
const STRAND = new Color(0x7bd97c);
const STRAND_HOT = new Color(0xffd66b);
const BELL = new Color(0x55b86b);
const GOLD = new Color(0xffcf67);
const PEARL = new Color(0xd8fff0);
const VIOLET = new Color(0x8d2baa);
const VIOLET_DARK = new Color(0x2f073c);
const SOUR = new Color(0xd060e6);

type EnemyVisual = {
  mesh: Group;
  kind: string;
  born: number;
  pulse: number;
  denied: number;
  locked: boolean;
};
type Transient = { group: Group; age: number; life: number; velocity: Vector3; spin: number };

const pending: Array<{ mesh: Group; kind: string }> = [];
const pendingProjectiles: Group[] = [];
const projectiles = new Map<number, { mesh: Group; enemyId: number }>();
const enemies = new Map<number, EnemyVisual>();
const transients: Transient[] = [];
const strandMaterials: MeshBasicMaterial[] = [];
const webLayers: Group[] = [];
let root: Group | null = null;
let sceneRef: Scene | null = null;
let bellInner: Mesh | null = null;
let crownAura: Mesh | null = null;
let reticleRef: Object3D | null = null;
let now = 0;
let beatPulse = 0;
let rejectPulse = 0;
let webRoots = 3;
let liberationAt = -1;
let pullStart: Vector3 | null = null;

function basic(color: Color | number, options: { transparent?: boolean; opacity?: number; side?: Side; depthWrite?: boolean; additive?: boolean } = {}) {
  const material = new MeshBasicMaterial({
    color,
    transparent: options.transparent,
    opacity: options.opacity,
    side: options.side,
    depthWrite: options.depthWrite,
    blending: options.additive ? AdditiveBlending : undefined,
  });
  material.userData.baseColor = material.color.clone();
  material.userData.baseOpacity = material.opacity;
  return material;
}

function restoreBaseColor(material: MeshBasicMaterial) {
  const base = material.userData.baseColor as Color | number | { r: number; g: number; b: number } | undefined;
  if (base instanceof Color) material.color.copy(base);
  else if (typeof base === 'number') material.color.setHex(base);
  else if (base) material.color.setRGB(base.r, base.g, base.b);
}

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  sceneRef = scene;
  scene.background = WATER_DEEP.clone();
  scene.fog = new Fog(WATER_DEEP, 72, 315);
  root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  const rail = createStrandlineS5cxRail();

  // The bell is deliberately a huge, translucent hemisphere. During the wide
  // bank it fills the view like a green moon; close in, its nested membranes
  // become the roof above the crown fight.
  const bellCenter = new Vector3(0, 96, -548);
  const bell = new Mesh(
    new SphereGeometry(76, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.56),
    basic(BELL, { transparent: true, opacity: 0.34, side: DoubleSide, depthWrite: false }),
  );
  bell.position.copy(bellCenter);
  bell.rotation.x = Math.PI;
  root.add(bell);
  const bellRim = new Mesh(new TorusGeometry(69, 2.1, 8, 72), basic(STRAND_HOT, { transparent: true, opacity: 0.68 }));
  bellRim.position.set(0, 55, -548);
  bellRim.rotation.x = Math.PI / 2;
  root.add(bellRim);
  bellInner = new Mesh(
    new SphereGeometry(62, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.48),
    basic(0x9de779, { transparent: true, opacity: 0.16, side: BackSide, depthWrite: false, additive: true }),
  );
  bellInner.position.copy(bellCenter).add(new Vector3(0, -3, 0));
  bellInner.rotation.x = Math.PI;
  root.add(bellInner);

  for (let ringIndex = 0; ringIndex < 5; ringIndex += 1) {
    const ring = new Mesh(
      new TorusGeometry(15 + ringIndex * 10.8, 0.34, 5, 64),
      basic(ringIndex % 2 ? STRAND : GOLD, { transparent: true, opacity: 0.43 }),
    );
    ring.position.set(0, 56 + ringIndex * 3.8, -548);
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
  }

  // Forty-eight individual trailing strands form a real traversable forest.
  // Their roots follow the bell rim while their lower control points wander,
  // creating clear lanes and repeated near-field parallax all along the rail.
  for (let i = 0; i < 48; i += 1) {
    const angle = i * 2.399963 + (i % 4) * 0.2;
    const rootRadius = 12 + (i % 7) * 6.4;
    const rootPoint = new Vector3(
      Math.cos(angle) * rootRadius,
      53 + Math.sin(angle * 2) * 5,
      -548 + Math.sin(angle) * rootRadius * 0.45,
    );
    const lean = Math.sin(i * 3.71) * 28;
    const sway = Math.cos(i * 2.17) * 22;
    const endZ = 28 - (i % 6) * 18;
    const curve = new CatmullRomCurve3([
      rootPoint,
      new Vector3(rootPoint.x * 0.72 + lean * 0.2, 30 + (i % 5) * 5, -430 + sway),
      new Vector3(rootPoint.x * 0.46 + lean, 6 + (i % 4) * 7, -270 + lean * 0.35),
      new Vector3(lean * 1.35, -15 + (i % 6) * 5, -110 + sway),
      new Vector3(lean * 1.6 + sway * 0.4, -36 + (i % 4) * 8, endZ),
    ], false, 'catmullrom', 0.55);
    const material = basic(i % 7 === 0 ? STRAND_HOT : STRAND, {
      transparent: true,
      opacity: i % 7 === 0 ? 0.62 : 0.38 + (i % 3) * 0.07,
    });
    strandMaterials.push(material);
    const strand = new Mesh(new TubeGeometry(curve, 32, 0.22 + (i % 5) * 0.055, 5, false), material);
    root.add(strand);

    // Beads carry a slow pulse down the living filament without needing bloom.
    for (let beadIndex = 0; beadIndex < 5; beadIndex += 1) {
      const bead = new Mesh(new SphereGeometry(0.48 + (i % 3) * 0.09, 7, 5), basic(i % 7 === 0 ? GOLD : 0xa8ef8b));
      bead.position.copy(curve.getPoint((beadIndex + 0.5) / 5));
      bead.userData.pulsePhase = i * 0.7 + beadIndex * 1.6;
      root.add(bead);
    }
  }

  // Sun shafts from far above give the clear water a readable vertical source.
  for (let i = 0; i < 9; i += 1) {
    const shaft = new Mesh(
      new ConeGeometry(16 + (i % 3) * 8, 360, 10, 1, true),
      basic(0x9cebd0, { transparent: true, opacity: 0.018 + (i % 3) * 0.006, side: DoubleSide, depthWrite: false, additive: true }),
    );
    shaft.position.set((i - 4) * 42, 145, -270 - (i % 4) * 80);
    shaft.rotation.z = (i - 4) * 0.035;
    root.add(shaft);
  }

  // Clear-water particulate gives scale and motion while remaining subdued.
  const motePositions = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i += 1) {
    const u = (i * 0.6180339887) % 1;
    const frame = sampleRailFrame(rail, u);
    const angle = i * 2.399963;
    const radius = 15 + (i * 29) % 105;
    const point = frame.position.clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (i * 17) % 80 - 40);
    motePositions.set([point.x, point.y, point.z], i * 3);
  }
  const motesGeometry = new BufferGeometry();
  motesGeometry.setAttribute('position', new Float32BufferAttribute(motePositions, 3));
  root.add(new Points(motesGeometry, new PointsMaterial({
    color: 0x9cd8c8,
    size: 0.32,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })));

  createCrown(root, rail.getPoint(0.98));
  scene.add(root);
}

function createCrown(parent: Group, position: Vector3) {
  const crown = new Group();
  crown.position.copy(position).add(new Vector3(0, 4, -2));
  crown.userData.crown = true;
  crownAura = new Mesh(new RingGeometry(16, 17, 48), basic(GOLD, { transparent: true, opacity: 0.28, side: DoubleSide }));
  crownAura.rotation.x = Math.PI / 2;
  crown.add(crownAura);

  for (let layer = 0; layer < 3; layer += 1) {
    const web = new Group();
    const material = basic(layer % 2 ? SOUR : VIOLET, { transparent: true, opacity: 0.72 });
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke / 8 * Math.PI * 2 + layer * 0.32;
      const filament = new Mesh(new CylinderGeometry(0.09, 0.09, 17 + layer * 3, 5), material.clone());
      filament.position.set(Math.cos(angle) * (6 + layer * 1.8), Math.sin(angle) * (4.2 + layer), layer * 0.8);
      filament.rotation.z = angle + Math.PI / 2;
      filament.rotation.y = 0.4 + layer * 0.15;
      web.add(filament);
    }
    const webRing = new Mesh(new TorusGeometry(8 + layer * 4.3, 0.16, 5, 32), material.clone());
    webRing.rotation.x = Math.PI / 2;
    web.add(webRing);
    crown.add(web);
    webLayers.push(web);
  }
  parent.add(crown);
}

export function disposeEnvironment() {
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  root = null;
  sceneRef = null;
  bellInner = null;
  crownAura = null;
  reticleRef = null;
  pending.length = 0;
  pendingProjectiles.length = 0;
  projectiles.clear();
  enemies.clear();
  transients.length = 0;
  strandMaterials.length = 0;
  webLayers.length = 0;
  pullStart = null;
  liberationAt = -1;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createLetter(letter ?? 'A') : createParasite(kind);
  mesh.scale.setScalar(0.001);
  pending.push({ mesh, kind });
  return mesh;
}

function createParasite(kind: string) {
  const group = new Group();
  group.userData.kind = kind;
  const shell = basic(VIOLET_DARK);
  const flesh = basic(VIOLET);
  const acid = basic(SOUR);

  if (kind === 'clasper') {
    const body = new Mesh(new IcosahedronGeometry(0.9, 1), flesh);
    body.scale.set(1.3, 0.65, 1.05);
    group.add(body);
    for (let i = 0; i < 6; i += 1) {
      const angle = i / 6 * Math.PI * 2;
      const arm = new Mesh(new ConeGeometry(0.28, 2.7, 5), shell.clone());
      arm.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 1.05, 0.18);
      arm.rotation.z = angle - Math.PI / 2;
      const cup = new Mesh(new TorusGeometry(0.34, 0.12, 5, 12), acid.clone());
      cup.position.set(Math.cos(angle) * 2.65, Math.sin(angle) * 1.9, 0.1);
      cup.rotation.x = Math.PI / 2;
      group.add(arm, cup);
    }
    const eye = new Mesh(new SphereGeometry(0.32, 10, 6), acid);
    eye.position.z = 0.92;
    group.add(eye);
  } else if (kind === 'ribbon') {
    const wingGeometry = new BufferGeometry();
    wingGeometry.setAttribute('position', new Float32BufferAttribute([
      -5.2, 0, 0, -0.6, 1.05, 0.1, -0.4, -0.8, 0,
      5.2, 0, 0, 0.6, 1.05, 0.1, 0.4, -0.8, 0,
    ], 3));
    const wings = new Mesh(wingGeometry, basic(0xa438ba, { transparent: true, opacity: 0.78, side: DoubleSide }));
    const body = new Mesh(new ConeGeometry(0.55, 3.4, 7), shell);
    body.rotation.x = Math.PI / 2;
    const spine = new Mesh(new TorusGeometry(1.25, 0.14, 5, 22), acid);
    spine.rotation.y = Math.PI / 2;
    group.add(wings, body, spine);
  } else if (kind === 'spore') {
    group.add(new Mesh(new OctahedronGeometry(0.86, 1), acid));
    for (let i = 0; i < 4; i += 1) {
      const tail = new Mesh(new ConeGeometry(0.17, 2.8 + i * 0.3, 5), i % 2 ? flesh.clone() : shell.clone());
      const angle = i / 4 * Math.PI * 2;
      tail.position.set(Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, -0.4);
      tail.rotation.z = angle - Math.PI / 2;
      group.add(tail);
    }
    const orbit = new Mesh(new TorusGeometry(1.45, 0.1, 5, 24), flesh);
    orbit.rotation.x = 0.75;
    group.add(orbit);
  } else if (kind === 'brood') {
    const sac = new Mesh(new SphereGeometry(1.75, 16, 10), basic(0x6c167e, { transparent: true, opacity: 0.84 }));
    sac.scale.set(1, 1.35, 0.65);
    const core = new Mesh(new IcosahedronGeometry(0.72, 1), acid);
    core.position.z = 1;
    group.add(sac, core);
    for (let i = 0; i < 8; i += 1) {
      const angle = i / 8 * Math.PI * 2;
      const barb = new Mesh(new ConeGeometry(0.18, 2.2, 5), shell.clone());
      barb.position.set(Math.cos(angle) * 1.7, Math.sin(angle) * 2.15, -0.2);
      barb.rotation.z = angle - Math.PI / 2;
      group.add(barb);
    }
  } else {
    // Parent: a heavy radial body with an obvious pale tear-point under its
    // violet carapace. Three nested rings correspond to its hit stages.
    const abdomen = new Mesh(new SphereGeometry(3.2, 20, 12), shell);
    abdomen.scale.set(1.2, 0.9, 0.62);
    group.add(abdomen);
    const core = new Mesh(new IcosahedronGeometry(1.15, 1), acid);
    core.position.z = 2.1;
    group.add(core);
    for (let i = 0; i < 10; i += 1) {
      const angle = i / 10 * Math.PI * 2;
      const leg = new Mesh(new ConeGeometry(0.3, 5.8, 6), i % 2 ? flesh.clone() : shell.clone());
      leg.position.set(Math.cos(angle) * 3.65, Math.sin(angle) * 2.75, -0.2);
      leg.rotation.z = angle - Math.PI / 2;
      group.add(leg);
    }
    for (let i = 0; i < 3; i += 1) {
      const armor = new Mesh(new TorusGeometry(2 + i * 0.72, 0.18, 5, 30), basic(i === 2 ? SOUR : VIOLET));
      armor.position.z = 1.85 - i * 0.22;
      armor.userData.stageArmor = i;
      group.add(armor);
    }
  }
  return group;
}

function createLetter(character: string) {
  const group = new Group();
  group.userData.kind = 'letter';
  const cells = glyphOnCells(character);
  const pearlMaterial = basic(PEARL);
  for (const cell of cells) {
    const pearl = new Mesh(new SphereGeometry(0.145, 7, 5), pearlMaterial.clone());
    pearl.scale.set(1, 1, 0.55);
    pearl.position.set((cell.x - 2) * 0.34, (3 - cell.y) * 0.34, 0.08);
    group.add(pearl);
  }
  const plaque = new Mesh(new PlaneGeometry(2.05, 2.72), basic(0x0a6270, { transparent: true, opacity: 0.56, side: DoubleSide }));
  plaque.position.z = -0.08;
  group.add(plaque);
  const halo = new Mesh(new TorusGeometry(1.42, 0.055, 6, 32), basic(GOLD));
  halo.scale.y = 1.12;
  group.add(halo);
  return group;
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('runstart', () => {
    now = 0;
    webRoots = 3;
    liberationAt = -1;
    pullStart = null;
    projectiles.clear();
    for (const layer of webLayers) layer.visible = true;
  });
  bus.on('spawn', ({ enemyId }) => {
    const next = pending.shift();
    if (next) enemies.set(enemyId, { mesh: next.mesh, kind: next.kind, born: now, pulse: 0, denied: 0, locked: false });
  });
  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const visual = enemies.get(enemyId);
    if (visual) visual.pulse = 1;
    addRing(worldPosition, colorForLockCount(lockCount), 0.72, 0.65);
  });
  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const visual = enemies.get(enemyId);
    if (visual) visual.locked = false;
    addRing(worldPosition, WATER_NEAR, 0.42, 0.5);
  });
  bus.on('fire', ({ projectileId, enemyId, worldPosition, volleySize }) => {
    const projectile = pendingProjectiles.shift();
    if (projectile) projectiles.set(projectileId, { mesh: projectile, enemyId });
    addRing(worldPosition, volleySize === 6 ? GOLD : PEARL, 0.48 + volleySize * 0.05, 0.35);
  });
  bus.on('hit', ({ projectileId, worldPosition, lethal, stageCompleted, enemyId, hitStageIndex }) => {
    const projectile = projectiles.get(projectileId);
    if (projectile) {
      disposeObject3D(projectile.mesh);
      projectiles.delete(projectileId);
    }
    addBurst(worldPosition, lethal ? GOLD : SOUR, stageCompleted ? 12 : 6, stageCompleted ? 1.1 : 0.62);
    const visual = enemies.get(enemyId);
    if (visual?.kind === 'parent' && stageCompleted) {
      visual.mesh.traverse((child) => {
        if (child instanceof Mesh && child.userData.stageArmor === hitStageIndex) child.visible = false;
      });
    }
  });
  bus.on('stage', ({ worldPosition }) => addRing(worldPosition, GOLD, 2.2, 1.1));
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const visual = enemies.get(enemyId);
    if (visual?.kind === 'brood') {
      webRoots = Math.max(0, webRoots - 1);
      const layer = webLayers[webRoots];
      if (layer) layer.visible = false;
      addRing(worldPosition, STRAND_HOT, 3.3, 1.5);
    }
    addBurst(worldPosition, visual?.kind === 'parent' ? PEARL : GOLD, visual?.kind === 'parent' ? 34 : 18, visual?.kind === 'parent' ? 2.2 : 1.1);
    if (visual) disposeObject3D(visual.mesh);
    for (const [projectileId, projectile] of projectiles) {
      if (projectile.enemyId !== enemyId) continue;
      disposeObject3D(projectile.mesh);
      projectiles.delete(projectileId);
    }
    enemies.delete(enemyId);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    addBurst(worldPosition, VIOLET, 7, 0.68);
    const visual = enemies.get(enemyId);
    if (visual) disposeObject3D(visual.mesh);
    for (const [projectileId, projectile] of projectiles) {
      if (projectile.enemyId !== enemyId) continue;
      disposeObject3D(projectile.mesh);
      projectiles.delete(projectileId);
    }
    enemies.delete(enemyId);
  });
  bus.on('reject', () => {
    rejectPulse = 1;
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = isDownbeat ? 1 : 0.48;
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      if (crownAura) (crownAura.material as MeshBasicMaterial).color.copy(STRAND_HOT);
      addRing(createStrandlineS5cxRail().getPoint(0.98), GOLD, 5.2, 2);
    } else if (phase === 'destroyed') {
      liberationAt = now;
      pullStart = null;
      for (const material of strandMaterials) material.color.copy(STRAND_HOT);
    }
  });
}

function addRing(position: Vector3, color: Color | number, radius: number, life: number) {
  if (!sceneRef) return;
  const group = new Group();
  const ring = new Mesh(new RingGeometry(radius * 0.82, radius, 32), basic(color, { transparent: true, opacity: 0.82, side: DoubleSide, depthWrite: false, additive: true }));
  group.position.copy(position);
  group.add(ring);
  sceneRef.add(group);
  transients.push({ group, age: 0, life, velocity: new Vector3(0, 0.22, 0), spin: 0.9 });
}

function addBurst(position: Vector3, color: Color | number, count: number, scale: number) {
  if (!sceneRef) return;
  const group = new Group();
  group.position.copy(position);
  const shardGeometry = new OctahedronGeometry(0.18, 0);
  for (let i = 0; i < count; i += 1) {
    const shard = new Mesh(shardGeometry, basic(color, { transparent: true, opacity: 0.9 }));
    const angle = i * 2.399963;
    shard.position.set(Math.cos(angle) * (0.25 + (i % 5) * 0.12) * scale, Math.sin(angle) * (0.25 + (i % 5) * 0.12) * scale, ((i * 7) % 9 - 4) * 0.12);
    shard.scale.set(0.55, 2.4, 0.55);
    group.add(shard);
  }
  sceneRef.add(group);
  transients.push({ group, age: 0, life: 0.85 + scale * 0.35, velocity: new Vector3(0, 0.5, 0), spin: 2.1 });
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  const group = mesh as Group;
  group.userData.locked = locked;
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = child.material as MeshBasicMaterial;
    if (locked) material.color.copy(GOLD);
    else restoreBaseColor(material);
  });
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.denied = 1;
  mesh.traverse((child) => {
    if (child instanceof Mesh) (child.material as MeshBasicMaterial).color.copy(SOUR);
  });
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.13, 0), basic(PEARL));
  const halo = new Mesh(new RingGeometry(0.19, 0.25, 12), basic(GOLD, { transparent: true, opacity: 0.78, side: DoubleSide }));
  group.add(core, halo);
  pendingProjectiles.push(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.48, 0.53, 36), basic(PEARL, { transparent: true, opacity: 0.8, side: DoubleSide }));
  group.add(ring);
  for (let i = 0; i < 6; i += 1) {
    const tick = new Mesh(new BoxGeometry(0.05, 0.24, 0.025), basic(i < 3 ? STRAND_HOT : PEARL));
    const angle = i / 6 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 0);
    tick.rotation.z = angle;
    group.add(tick);
  }
  reticleRef = group;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.035 + (active ? 0.08 : 0) + rejectPulse * 0.18);
  reticle.rotation.z = active ? now * 0.45 : 0;
  reticle.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = child.material as MeshBasicMaterial;
    material.color.copy(rejectPulse > 0.1 ? SOUR : active ? colorForLockCount(Math.max(1, lockCount)) : PEARL);
  });
}

export function updateVisuals(dt: number, context: { camera: PerspectiveCamera; runTime: number; running: boolean }) {
  // Attract mode deliberately has no run clock. Keep a visual clock moving so
  // RESTORE/RETURN glyphs can complete their spawn animation before START.
  now = context.running ? context.runTime : now + dt;
  beatPulse = Math.max(0, beatPulse - dt * 2.4);
  rejectPulse = Math.max(0, rejectPulse - dt * 4.2);

  if (sceneRef?.fog instanceof Fog) {
    const reveal = MathUtils.smoothstep(context.runTime, 14, 18) * (1 - MathUtils.smoothstep(context.runTime, 20, 24));
    const quickening = MathUtils.smoothstep(context.runTime, 34, 48);
    const color = WATER_DEEP.clone().lerp(WATER_NEAR, 0.34 + reveal * 0.42 + quickening * 0.16);
    sceneRef.background = color;
    sceneRef.fog.color.copy(color);
    sceneRef.fog.far = 295 + reveal * 95;
  }

  if (bellInner) {
    bellInner.scale.setScalar(1 + Math.sin(context.runTime * Math.PI) * 0.018 + beatPulse * 0.012);
    const material = bellInner.material as MeshBasicMaterial;
    material.opacity = 0.15 + beatPulse * 0.09 + MathUtils.smoothstep(context.runTime, 34, 52) * 0.08;
  }
  if (crownAura) {
    crownAura.rotation.z += dt * (webRoots > 0 ? 0.15 : 0.52);
    crownAura.scale.setScalar(1 + beatPulse * 0.08);
  }
  for (let i = 0; i < strandMaterials.length; i += 1) {
    const material = strandMaterials[i];
    const clean = MathUtils.smoothstep(context.runTime, 32 + (i % 8) * 0.35, 52);
    const liberation = liberationAt >= 0 ? MathUtils.smoothstep(context.runTime, liberationAt, liberationAt + 4) : 0;
    const crownClear = 1 - MathUtils.smoothstep(context.runTime, 44, 49) * 0.62;
    const visibility = MathUtils.lerp(crownClear, 1, liberation);
    material.color.copy(STRAND).lerp(STRAND_HOT, clean * 0.46 + liberation * 0.54);
    material.opacity = Math.min(0.82, ((material.userData.baseOpacity as number) + beatPulse * 0.045 + liberation * 0.14) * visibility);
  }

  for (const visual of enemies.values()) {
    const entrance = MathUtils.smoothstep(now - visual.born, 0, 0.32);
    const denied = Math.max(0, Number(visual.mesh.userData.denied ?? 0) - dt * 3.6);
    visual.mesh.userData.denied = denied;
    visual.pulse = Math.max(0, visual.pulse - dt * 3.8);
    const targetScale = visual.kind === 'parent' ? 1 : 0.82;
    visual.mesh.scale.setScalar(targetScale * entrance * (1 + visual.pulse * 0.13 - denied * 0.2));
    if (denied <= 0.01) {
      visual.mesh.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const material = child.material as MeshBasicMaterial;
        if (!visual.mesh.userData.locked) restoreBaseColor(material);
      });
    }
  }

  for (let i = transients.length - 1; i >= 0; i -= 1) {
    const transient = transients[i];
    transient.age += dt;
    transient.group.position.addScaledVector(transient.velocity, dt);
    transient.group.rotation.z += dt * transient.spin;
    const remaining = 1 - transient.age / transient.life;
    transient.group.scale.setScalar(1 + transient.age * 1.8);
    transient.group.traverse((child) => {
      if (child instanceof Mesh) (child.material as MeshBasicMaterial).opacity = Math.max(0, remaining) * 0.82;
    });
    if (transient.age >= transient.life) {
      transient.group.removeFromParent();
      disposeObject3D(transient.group);
      transients.splice(i, 1);
    }
  }

  // The successful ending belongs to the animal, not the target: after the
  // parent tears free, the camera retreats far enough to reveal bell, crown,
  // and the complete clean strandline in one serene composition.
  if (liberationAt >= 0) {
    if (!pullStart) pullStart = context.camera.position.clone();
    const t = MathUtils.smootherstep(context.runTime, liberationAt + 0.2, liberationAt + 6.2);
    const finalPosition = new Vector3(145, 150, 235);
    context.camera.position.lerpVectors(pullStart, finalPosition, t);
    context.camera.lookAt(new Vector3(0, 23, -286));
    context.camera.fov = MathUtils.lerp(context.camera.fov, 68, t);
    context.camera.updateProjectionMatrix();
  }

  if (reticleRef) reticleRef.visible = liberationAt < 0 || context.runTime < liberationAt + 0.45;
}
