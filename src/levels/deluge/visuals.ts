import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { colorForLockCount } from '../../engine/locks';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import {
  CANAL_TIME,
  createDelugeRail,
  DELUGE_DURATION,
  OUTRO_TIME,
  PHASE2_TIME,
  railU,
  speedFactorAt,
  STREETFALL_TIME,
  TUBE_TIME,
  UNDER_TIME,
  VULTURE_TIME,
} from './gameplay';
import { flashUniform, speedBlurUniform, staticUniform } from './post-fx';

const CYAN = new Color(0.0, 0.88, 1.0);
const MAGENTA = new Color(1.0, 0.05, 0.75);
const BLUE = new Color(0.03, 0.10, 0.20);
const SLATE = new Color(0.018, 0.028, 0.045);
const WHITE = new Color(0.86, 0.96, 1.0);
const AMBER = new Color(1.0, 0.46, 0.12);
const GREEN = new Color(0.28, 1.0, 0.2);
const RED = new Color(1.0, 0.08, 0.05);

function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: 'fill' | 'edge' | 'core' };
type VisualContext = { scene: Scene; camera: Camera; elapsed: number; runTime: number; running: boolean };
type CameraEffectsContext = { camera: Camera; runTime: number; running: boolean; dt: number };
type EnemyRecord = { mesh: Group; lockRing: Group | null; bornAt: number | null };
type Effect = { mesh: Object3D; age: number; life: number; maxScale: number; material?: MeshBasicMaterial | LineBasicMaterial };

type Environment = {
  root: Group;
  rain: Group;
  lightning: Mesh;
  canal: Group;
  cityLights: Points;
  hologram: Group;
  vultureGhost: Group;
};

let environment: Environment | null = null;
let sceneRef: Scene | null = null;
let elapsedNow = 0;
let lastRunTime = -1;
let beatEnergy = 0;
let shakeEnergy = 0;
let blurPulse = 0;
let cameraRoll = 0;
let baseCameraPosition = new Vector3();

const pendingEnemyMeshes: Group[] = [];
const pendingProjectileMeshes: Object3D[] = [];
const enemyRecords = new Map<number, EnemyRecord>();
const projectileRecords = new Map<number, Object3D>();
const effects: Effect[] = [];
const rail = createDelugeRail();

export function createEnvironment(scene: Scene) {
  sceneRef = scene;
  scene.background = new Color(0x050914);
  scene.fog = new FogExp2(0x07101c, 0.012);
  const root = new Group();
  const rng = mulberry32(0xd3119e);
  root.add(createCloudDeck());
  root.add(createCity(rng));
  root.add(createNearMissFrames());
  root.add(createTube());
  root.add(createCanal());
  const rain = createRainVolume(rng);
  const lightning = createLightningFlash();
  const cityLights = createDistantLights(rng);
  const hologram = createMunicipalKoi();
  const vultureGhost = createVultureMesh();
  vultureGhost.visible = false;
  root.add(rain, lightning, cityLights, hologram, vultureGhost);
  scene.add(root);
  environment = { root, rain, lightning, canal: root.children.find((child) => child.userData.canal) as Group, cityLights, hologram, vultureGhost };
  return root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  pendingEnemyMeshes.push(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'D');
    case 'gnat': return createGnatMesh();
    case 'interceptor': return createInterceptorMesh();
    case 'turret': return createTurretMesh();
    case 'barrier': return createBarrierMesh();
    case 'dropvan': return createDropvanMesh();
    case 'bolt': return createBoltMesh('bolt');
    case 'flak': return createBoltMesh('flak');
    case 'vulturePod': return createVulturePodMesh();
    case 'vultureCore': return createVultureCoreMesh();
    default: return createGnatMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.42;
  spawnRing(mesh.position, hdr(RED, 1.4), 3.2, 0.28);
  staticUniform.value = Math.max(staticUniform.value, 0.9);
}

export function createProjectileMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.32, 0);
  dart.scale(0.45, 0.45, 2.4);
  group.add(new Mesh(dart, new MeshBasicMaterial({ color: hdr(CYAN, 2.0) })));
  const glow = new Mesh(new SphereGeometry(0.36, 10, 8), additiveMaterial(hdr(WHITE, 1.3), 0.45));
  group.add(glow);
  pendingProjectileMeshes.push(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const add = (mesh: Mesh, base: Color) => {
    const mat = mesh.material as MeshBasicMaterial;
    mat.transparent = true;
    mat.blending = AdditiveBlending;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.color.copy(base);
    parts.push({ material: mat, base });
    group.add(mesh);
  };
  add(new Mesh(new RingGeometry(0.62, 0.67, 6), new MeshBasicMaterial()), hdr(CYAN, 1.1));
  add(new Mesh(new RingGeometry(0.34, 0.38, 32, 1, 0.25, Math.PI * 1.55), new MeshBasicMaterial()), hdr(MAGENTA, 1.15));
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.035), new MeshBasicMaterial());
    const angle = i * Math.PI * 0.5;
    tick.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
    tick.rotation.z = angle;
    add(tick, hdr(WHITE, 1.0));
  }
  group.userData.parts = parts;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.08 + (active ? 0.05 : 0));
  const charge = lockCount > 0 ? colorForLockCount(lockCount, [CYAN, MAGENTA, WHITE]) : null;
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  for (const part of parts) part.material.color.copy(charge ? hdr(charge, active ? 1.8 : 1.2) : part.base.clone().multiplyScalar(active ? 1.35 : 1));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const mesh = pendingEnemyMeshes.shift();
    if (!mesh) return;
    enemyRecords.set(enemyId, { mesh, lockRing: null, bornAt: null });
    if (kind === 'vulturePod' || kind === 'vultureCore') {
      shakeEnergy = Math.max(shakeEnergy, 0.45);
      spawnRing(worldPosition, hdr(GREEN, 1.4), kind === 'vultureCore' ? 13 : 7, 0.7);
    } else if (kind !== 'bolt' && kind !== 'flak') {
      spawnRing(worldPosition, hdr(CYAN, 0.9), kind === 'barrier' ? 7 : 2.8, 0.35);
    }
  });
  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    const color = colorForLockCount(lockCount, [CYAN, MAGENTA, WHITE]);
    if (record && !record.lockRing) {
      record.lockRing = createLockRing(color);
      scene.add(record.lockRing);
    }
    spawnRing(worldPosition, hdr(color, 1.3), 2.4 + lockCount * 0.18, 0.24);
  });
  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) removeLockRing(record, scene);
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    const projectile = pendingProjectileMeshes.shift();
    if (projectile) projectileRecords.set(projectileId, projectile);
    spawnSpark(worldPosition, hdr(WHITE, 1.8), 0.9, 0.14);
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, stageCompleted }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) record.mesh.userData.damageFlashUntil = elapsedNow + 0.22;
    spawnSpark(worldPosition, hdr(lethal ? CYAN : WHITE, 1.5), lethal ? 1.5 : 1.0, 0.17);
    if (stageCompleted) {
      shakeEnergy = Math.max(shakeEnergy, 0.3);
      spawnRing(worldPosition, hdr(AMBER, 1.4), 6, 0.42);
      if (record) record.mesh.userData.stageBroken = true;
    }
  });
  bus.on('kill', ({ enemyId, worldPosition, scoreAwarded }) => {
    const record = enemyRecords.get(enemyId);
    const accent = record?.mesh.userData.accent as Color | undefined;
    spawnRing(worldPosition, hdr(accent ?? CYAN, 1.3), scoreAwarded > 1000 ? 22 : 5.5, scoreAwarded > 1000 ? 1.0 : 0.38);
    spawnDebris(worldPosition, accent ?? CYAN, scoreAwarded > 1000 ? 38 : 10);
    if (record) {
      if (record.mesh.userData.kind === 'vultureCore') {
        flashUniform.value = Math.max(flashUniform.value, 1.0);
        blurPulse = 1.0;
        shakeEnergy = 1.4;
      } else if (record.mesh.userData.kind === 'vulturePod') {
        shakeEnergy = Math.max(shakeEnergy, 0.75);
      }
      removeLockRing(record, scene);
      enemyRecords.delete(enemyId);
    }
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      removeLockRing(record, scene);
      enemyRecords.delete(enemyId);
    }
    spawnSpark(worldPosition, BLUE, 0.7, 0.18);
  });
  bus.on('reject', () => { staticUniform.value = Math.max(staticUniform.value, 0.7); });
  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      flashUniform.value = Math.max(flashUniform.value, 0.2);
      blurPulse = Math.max(blurPulse, 0.22);
    }
  });
  bus.on('beat', ({ isDownbeat }) => { beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.38); });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') flashUniform.value = Math.max(flashUniform.value, 1.2);
  });
  bus.on('playerhit', () => {
    shakeEnergy = Math.max(shakeEnergy, 1.1);
    staticUniform.value = Math.max(staticUniform.value, 1.0);
  });
  bus.on('runstart', () => {
    for (const record of enemyRecords.values()) removeLockRing(record, scene);
    enemyRecords.clear();
    projectileRecords.clear();
    pendingEnemyMeshes.length = 0;
    pendingProjectileMeshes.length = 0;
    for (const effect of effects) effect.mesh.removeFromParent();
    effects.length = 0;
    lastRunTime = -1;
    flashUniform.value = 0;
    speedBlurUniform.value = 0;
    staticUniform.value = 0;
    blurPulse = 0;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  shakeEnergy = Math.max(0, shakeEnergy - dt * 2.6);
  blurPulse = Math.max(0, blurPulse - dt * 0.75);
  staticUniform.value = Math.max(0, staticUniform.value - dt * 2.8);
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  updateSetPieceMoments(ctx);
  updateEnvironment(dt, ctx, speed, runTime);
  speedBlurUniform.value = Math.min(0.7, (ctx.running ? Math.max(0, speed - 0.75) * 0.105 : 0.015) + blurPulse * 0.42);
  flashUniform.value = Math.max(0, flashUniform.value - dt * 2.0);

  for (const [enemyId, record] of enemyRecords) {
    if (!record.mesh.parent) {
      if (sceneRef) removeLockRing(record, sceneRef);
      enemyRecords.delete(enemyId);
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)));
    updateEnemyMesh(record.mesh, dt, ctx);
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.8;
      record.lockRing.scale.setScalar(1.6 + Math.sin(elapsedNow * 10) * 0.08);
    }
  }
  for (const [projectileId, projectile] of projectileRecords) {
    if (!projectile.parent) projectileRecords.delete(projectileId);
    else spawnSpark(projectile.position, CYAN, 0.38, 0.08);
  }
  updateEffects(dt);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  if (ctx.running) {
    const u = railU(ctx.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.007, 0, 1));
    const speed = speedFactorAt(ctx.runTime);
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 24 * Math.min(1.35, speed), -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
    if (ctx.runTime >= TUBE_TIME && ctx.runTime < CANAL_TIME) {
      const tremble = 0.018 * speed;
      camera.position.x += Math.sin(ctx.runTime * 58) * tremble;
      camera.position.y += Math.cos(ctx.runTime * 43) * tremble;
    }
  }
  if (shakeEnergy > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeEnergy * 0.08;
    camera.position.y += (Math.random() - 0.5) * shakeEnergy * 0.08;
    camera.rotateZ((Math.random() - 0.5) * shakeEnergy * 0.012);
  }
  camera.updateMatrixWorld();
}

export function updateAttractCamera({ camera, modeTime }: { camera: PerspectiveCamera; modeTime: number }) {
  const frame = sampleRailFrame(rail, 0.18);
  camera.position.copy(frame.position).addScaledVector(frame.right, Math.sin(modeTime * 0.2) * 6).addScaledVector(frame.up, 10).addScaledVector(frame.tangent, -10);
  camera.lookAt(frame.position.clone().addScaledVector(frame.tangent, 60).addScaledVector(frame.up, 4));
}

// ---- models -----------------------------------------------------------------

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFaceted(group: Group, geometry: BoxGeometry | OctahedronGeometry | TetrahedronGeometry | CylinderGeometry, fillColor = SLATE, edgeColor = WHITE, edgeIntensity = 0.9) {
  const fillMat = new MeshBasicMaterial({ color: fillColor.clone() });
  const mesh = new Mesh(geometry, fillMat);
  const edgeMat = new LineBasicMaterial({ color: hdr(edgeColor, edgeIntensity), transparent: true, blending: AdditiveBlending, depthWrite: false });
  mesh.add(new LineSegments(new EdgesGeometry(geometry), edgeMat));
  group.add(mesh);
  tintable(group).push({ material: fillMat, base: fillColor.clone(), kind: 'fill' }, { material: edgeMat, base: hdr(edgeColor, edgeIntensity), kind: 'edge' });
  return mesh;
}

function addCore(group: Group, radius: number, color: Color, intensity = 1.4) {
  const mat = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), mat);
  group.add(core);
  tintable(group).push({ material: mat, base: hdr(color, intensity), kind: 'core' });
  return core;
}

export function createGnatMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.42, 0);
  body.scale(0.9, 0.5, 1.15);
  addFaceted(group, body, SLATE.clone().multiplyScalar(1.2), WHITE, 0.8);
  addCore(group, 0.12, CYAN, 1.6);
  const spinParts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const rotor = new Mesh(new RingGeometry(0.34, 0.38, 18), additiveMaterial(hdr(WHITE, 1.0), 0.75));
    rotor.position.x = side * 0.65;
    rotor.rotation.x = Math.PI / 2;
    rotor.userData.spinSpeed = side * 16;
    group.add(rotor);
    spinParts.push(rotor);
  }
  group.userData.spinParts = spinParts;
  group.userData.accent = CYAN.clone();
  return group;
}

export function createInterceptorMesh() {
  const group = new Group();
  const body = new BoxGeometry(1.7, 0.42, 2.2);
  const mesh = addFaceted(group, body, SLATE, WHITE, 1.0);
  mesh.rotation.z = Math.PI / 4;
  const nose = addFaceted(group, new TetrahedronGeometry(0.75, 0), SLATE.clone().multiplyScalar(1.3), MAGENTA, 1.1);
  nose.position.z = 1.25;
  nose.scale.set(0.8, 0.5, 1.5);
  const rider = new Mesh(new SphereGeometry(0.22, 8, 6), new MeshBasicMaterial({ color: new Color(0.01, 0.012, 0.016) }));
  rider.position.set(0, 0.45, -0.15);
  group.add(rider);
  group.userData.accent = MAGENTA.clone();
  return group;
}

export function createTurretMesh() {
  const group = new Group();
  addFaceted(group, new CylinderGeometry(0.75, 0.95, 0.55, 6), SLATE, WHITE, 0.9);
  const barrel = addFaceted(group, new BoxGeometry(0.28, 0.28, 1.5), SLATE.clone().multiplyScalar(1.2), AMBER, 1.2);
  barrel.position.z = 0.85;
  addCore(group, 0.16, AMBER, 1.6);
  group.userData.accent = AMBER.clone();
  return group;
}

export function createBarrierMesh() {
  const group = new Group();
  const mat = additiveMaterial(hdr(CYAN, 1.05), 0.62);
  for (let i = -5; i <= 5; i += 1) {
    const barV = new Mesh(new PlaneGeometry(0.08, 8.5), mat);
    barV.position.x = i * 1.35;
    barV.userData.baseX = barV.position.x;
    group.add(barV);
    const barH = new Mesh(new PlaneGeometry(13.8, 0.08), mat);
    barH.position.y = i * 0.8;
    barH.userData.baseY = barH.position.y;
    group.add(barH);
  }
  const frame = new Mesh(new RingGeometry(5.4, 5.55, 4), additiveMaterial(hdr(MAGENTA, 1.2), 0.55));
  frame.scale.y = 0.65;
  frame.rotation.z = Math.PI / 4;
  group.add(frame);
  group.userData.accent = CYAN.clone();
  group.userData.isBarrier = true;
  return group;
}

export function createDropvanMesh() {
  const group = new Group();
  addFaceted(group, new BoxGeometry(2.2, 1.1, 1.7), SLATE.clone().multiplyScalar(1.1), WHITE, 0.9);
  for (const side of [-1, 1]) {
    const panel = addFaceted(group, new BoxGeometry(0.18, 1.3, 1.6), SLATE, MAGENTA, 1.1);
    panel.position.x = side * 1.28;
    panel.userData.side = side;
  }
  addCore(group, 0.2, CYAN, 1.3);
  group.userData.accent = MAGENTA.clone();
  return group;
}

export function createBoltMesh(flavor: 'bolt' | 'flak' = 'bolt') {
  const group = new Group();
  const color = flavor === 'flak' ? GREEN : WHITE;
  const dart = new OctahedronGeometry(flavor === 'flak' ? 0.42 : 0.32, 0);
  dart.scale(0.6, 0.6, flavor === 'flak' ? 1.4 : 2.4);
  group.add(new Mesh(dart, new MeshBasicMaterial({ color: hdr(color, flavor === 'flak' ? 1.8 : 1.5) })));
  group.add(new Mesh(new SphereGeometry(flavor === 'flak' ? 0.55 : 0.38, 10, 8), additiveMaterial(hdr(color, 0.8), 0.42)));
  group.userData.accent = color.clone();
  return group;
}

export function createVulturePodMesh() {
  const group = new Group();
  addFaceted(group, new BoxGeometry(2.1, 0.8, 2.4), SLATE.clone().multiplyScalar(1.1), GREEN, 1.0);
  const rotor = new Mesh(new RingGeometry(1.05, 1.18, 28), additiveMaterial(hdr(GREEN, 1.2), 0.55));
  rotor.rotation.x = Math.PI / 2;
  rotor.userData.spinSpeed = 12;
  group.add(rotor);
  group.userData.spinParts = [rotor];
  group.userData.accent = GREEN.clone();
  return group;
}

export function createVultureCoreMesh() {
  const group = createVultureMesh();
  group.userData.kind = 'vultureCore';
  group.userData.accent = GREEN.clone();
  return group;
}

export function createVultureMesh() {
  const group = new Group();
  const body = addFaceted(group, new BoxGeometry(5.0, 1.2, 2.2), SLATE.clone().multiplyScalar(1.15), GREEN, 1.0);
  body.scale.z = 1.15;
  const beak = addFaceted(group, new TetrahedronGeometry(1.3, 0), SLATE, GREEN, 1.2);
  beak.position.z = 1.9;
  beak.scale.set(1.0, 0.45, 1.8);
  for (const side of [-1, 1]) {
    const wing = addFaceted(group, new BoxGeometry(3.4, 0.25, 1.4), SLATE, WHITE, 0.65);
    wing.position.set(side * 3.6, 0.1, -0.1);
    wing.rotation.z = side * -0.16;
  }
  const core = addCore(group, 0.38, GREEN, 1.9);
  core.position.z = 0.85;
  const search = new Mesh(new CylinderGeometry(0.18, 1.25, 8, 18, 1, true), additiveMaterial(hdr(GREEN, 0.8), 0.18));
  search.rotation.x = Math.PI / 2;
  search.position.z = 4.5;
  group.add(search);
  group.scale.setScalar(0.75);
  group.userData.accent = GREEN.clone();
  return group;
}

// ---- letters ----------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

function createLetterMesh(letter: string) {
  const group = new Group();
  const pattern = GLYPHS[letter.toUpperCase()] ?? GLYPHS.D;
  const mat = new MeshBasicMaterial({ color: hdr(CYAN, 1.2) });
  const offMat = new MeshBasicMaterial({ color: new Color(0.01, 0.04, 0.07) });
  for (let y = 0; y < pattern.length; y += 1) {
    for (let x = 0; x < pattern[y].length; x += 1) {
      if (pattern[y][x] !== '1') continue;
      const pixel = new Mesh(new BoxGeometry(0.42, 0.42, 0.06), mat);
      pixel.position.set((x - 2) * 0.48, (3 - y) * 0.48, 0);
      group.add(pixel);
    }
  }
  const backing = new Mesh(new PlaneGeometry(2.8, 4.0), offMat);
  backing.position.z = -0.04;
  group.add(backing);
  group.userData.isLetter = true;
  group.userData.accent = CYAN.clone();
  return group;
}

function setLetterLocked(group: Group, locked: boolean) {
  group.traverse((child) => {
    if (child instanceof Mesh && child.geometry instanceof BoxGeometry) {
      (child.material as MeshBasicMaterial).color.copy(locked ? hdr(WHITE, 1.7) : hdr(CYAN, 1.2));
    }
  });
}

// ---- environment -------------------------------------------------------------

function createCity(rng: () => number) {
  const group = new Group();
  const buildingGeo = new BoxGeometry(1, 1, 1);
  const buildingMat = new MeshBasicMaterial({ color: new Color(0.012, 0.018, 0.028) });
  const count = 190;
  const buildings = new InstancedMesh(buildingGeo, buildingMat, count);
  const windowGeo = new PlaneGeometry(0.22, 0.08);
  const windowMat = new MeshBasicMaterial({ color: hdr(CYAN, 0.55), transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false });
  const windows = new InstancedMesh(windowGeo, windowMat, count * 10);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let w = 0;
  for (let i = 0; i < count; i += 1) {
    const u = i / count;
    const frame = sampleRailFrame(rail, u);
    const side = rng() < 0.5 ? -1 : 1;
    const width = 10 + rng() * 22;
    const height = 45 + rng() * 120;
    const depth = 8 + rng() * 30;
    const pos = frame.position.clone().addScaledVector(frame.right, side * (12 + width * 0.5 + rng() * 22)).addScaledVector(frame.up, -8 + height * 0.48).addScaledVector(frame.tangent, (rng() - 0.5) * 20);
    quat.setFromUnitVectors(new Vector3(0, 0, 1), frame.tangent.clone().normalize());
    matrix.compose(pos, quat, new Vector3(width, height, depth));
    buildings.setMatrixAt(i, matrix);
    const rows = 10;
    for (let r = 0; r < rows && w < count * 10; r += 1) {
      const wx = side * (12 + width + 0.05);
      const wy = -height * 0.35 + r * (height * 0.07) + rng() * 2;
      const winPos = frame.position.clone().addScaledVector(frame.right, wx).addScaledVector(frame.up, wy + height * 0.45).addScaledVector(frame.tangent, (rng() - 0.5) * depth);
      const scale = new Vector3(1.8 + rng() * 3.5, 1, 1);
      matrix.compose(winPos, quat, scale);
      windows.setMatrixAt(w, matrix);
      const c = rng() < 0.55 ? CYAN : rng() < 0.8 ? MAGENTA : AMBER;
      windows.setColorAt(w, c.clone().multiplyScalar(0.3 + rng() * 0.6));
      w += 1;
    }
  }
  buildings.instanceMatrix.needsUpdate = true;
  windows.instanceMatrix.needsUpdate = true;
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  group.add(buildings, windows);
  group.add(createTrafficStreams(rng));
  group.add(createSignage());
  return group;
}

function createNearMissFrames() {
  const group = new Group();
  const girderMat = new MeshBasicMaterial({ color: new Color(0.025, 0.035, 0.048) });
  const edgeMat = new MeshBasicMaterial({ color: hdr(CYAN, 0.55) });
  const boxGeo = new BoxGeometry(1, 1, 1);
  const times: number[] = [];
  for (let b = 16; b < 40; b += 1) times.push((b * 240) / 176);
  for (let b = 64; b < 104; b += 1.5) times.push((b * 240) / 176);
  for (const t of times) {
    const frame = sampleRailFrame(rail, railU(t));
    const arch = new Group();
    arch.position.copy(frame.position);
    arch.lookAt(frame.position.clone().add(frame.tangent));
    const top = new Mesh(boxGeo, girderMat);
    top.position.y = 5.8;
    top.scale.set(16, 0.28, 0.5);
    const left = new Mesh(boxGeo, girderMat);
    left.position.set(-7.2, 2.6, 0);
    left.scale.set(0.35, 6.0, 0.5);
    const right = left.clone();
    right.position.x = 7.2;
    const neon = new Mesh(new BoxGeometry(16, 0.045, 0.08), edgeMat);
    neon.position.y = 5.52;
    arch.add(top, left, right, neon);
    group.add(arch);
  }
  return group;
}

function createTube() {
  const group = new Group();
  const ringMat = new MeshBasicMaterial({ color: new Color(0.025, 0.025, 0.03) });
  const lightMat = additiveMaterial(hdr(AMBER, 0.85), 0.42);
  for (let b = 40; b <= 64; b += 0.5) {
    const t = (b * 240) / 176;
    const frame = sampleRailFrame(rail, railU(t));
    const ring = new Group();
    ring.position.copy(frame.position);
    ring.lookAt(frame.position.clone().add(frame.tangent));
    const body = new Mesh(new TorusGeometry(8.0, 0.22, 6, 36), ringMat);
    const light = new Mesh(new TorusGeometry(7.15, 0.045, 5, 36, Math.PI * 1.7), lightMat);
    ring.add(body, light);
    group.add(ring);
  }
  const train = new Group();
  for (let i = 0; i < 18; i += 1) {
    const car = new Mesh(new BoxGeometry(2.6, 2.1, 7.5), new MeshBasicMaterial({ color: new Color(0.025, 0.03, 0.038) }));
    car.position.z = -i * 8;
    const win = new Mesh(new PlaneGeometry(2.2, 0.5), additiveMaterial(hdr(WHITE, 0.85), 0.5));
    win.position.set(0, 0.4, 3.8);
    car.add(win);
    train.add(car);
  }
  const frame = sampleRailFrame(rail, railU((56 * 240) / 176));
  train.position.copy(frame.position).addScaledVector(frame.right, -6.2).addScaledVector(frame.up, 0.3);
  train.lookAt(train.position.clone().add(frame.tangent));
  group.add(train);
  return group;
}

function createCanal() {
  const group = new Group();
  group.userData.canal = true;
  const water = new Mesh(new PlaneGeometry(260, 260), new MeshBasicMaterial({ color: new Color(0.006, 0.018, 0.028), transparent: true, opacity: 0.72, side: DoubleSide }));
  const frame = sampleRailFrame(rail, railU(CANAL_TIME + 2));
  water.position.copy(frame.position).addScaledVector(frame.up, -4);
  water.rotation.x = -Math.PI / 2;
  group.add(water);
  const rippleMat = additiveMaterial(hdr(CYAN, 0.45), 0.26);
  for (let i = 0; i < 80; i += 1) {
    const ring = new Mesh(new RingGeometry(0.8, 0.86, 20), rippleMat);
    ring.position.copy(water.position).add(new Vector3((Math.random() - 0.5) * 160, 0.04, (Math.random() - 0.5) * 160));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.7 + Math.random() * 2.2);
    group.add(ring);
  }
  return group;
}

function createCloudDeck() {
  const group = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(0.09, 0.12, 0.16), transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
  for (const t of [9, OUTRO_TIME + 1]) {
    const frame = sampleRailFrame(rail, railU(t));
    for (let i = 0; i < 6; i += 1) {
      const shell = new Mesh(new PlaneGeometry(150 + i * 24, 48 + i * 8), mat.clone());
      shell.position.copy(frame.position).addScaledVector(frame.tangent, i * 5 - 12).addScaledVector(frame.up, i * 2 - 4);
      shell.lookAt(shell.position.clone().add(frame.tangent));
      group.add(shell);
    }
  }
  return group;
}

function createRainVolume(rng: () => number) {
  const group = new Group();
  const count = 520;
  const positions = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i += 1) {
    const x = (rng() - 0.5) * 70;
    const y = (rng() - 0.5) * 45;
    const z = -rng() * 86 - 4;
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x + (rng() - 0.5) * 0.3;
    positions[i * 6 + 4] = y - 2.2 - rng() * 2.8;
    positions[i * 6 + 5] = z - 0.8 - rng() * 1.8;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geo, new LineBasicMaterial({ color: hdr(CYAN, 0.6), transparent: true, opacity: 0.42, blending: AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  group.add(lines);
  return group;
}

function createDistantLights(rng: () => number) {
  const count = 1100;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(rail, u);
    const angle = rng() * Math.PI * 2;
    const radius = 80 + rng() * 260;
    const p = frame.position.clone().addScaledVector(frame.right, Math.cos(angle) * radius).addScaledVector(frame.up, (rng() - 0.2) * 130).addScaledVector(frame.tangent, (rng() - 0.5) * 70);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    const c = rng() < 0.45 ? CYAN : rng() < 0.75 ? MAGENTA : AMBER;
    colors[i * 3] = c.r * (0.2 + rng() * 0.6);
    colors[i * 3 + 1] = c.g * (0.2 + rng() * 0.6);
    colors[i * 3 + 2] = c.b * (0.2 + rng() * 0.6);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Points(geo, new PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false }));
}

function createTrafficStreams(rng: () => number) {
  const group = new Group();
  const mat1 = additiveMaterial(hdr(CYAN, 0.7), 0.5);
  const mat2 = additiveMaterial(hdr(MAGENTA, 0.65), 0.45);
  for (let i = 0; i < 90; i += 1) {
    const u = 0.08 + rng() * 0.58;
    const frame = sampleRailFrame(rail, u);
    const stream = new Mesh(new BoxGeometry(0.08, 0.08, 14 + rng() * 22), rng() < 0.5 ? mat1 : mat2);
    stream.position.copy(frame.position).addScaledVector(frame.right, (rng() < 0.5 ? -1 : 1) * (18 + rng() * 60)).addScaledVector(frame.up, -6 + rng() * 32).addScaledVector(frame.tangent, (rng() - 0.5) * 60);
    stream.lookAt(stream.position.clone().add(frame.tangent));
    group.add(stream);
  }
  return group;
}

function createSignage() {
  const group = new Group();
  for (const [word, t, x, y] of [
    ['DELUGE', 18, -10, 8],
    ['DRONE', 26, 11, 5],
    ['REPLAY', 34, -12, 7],
    ['PAY', 73, 10, 6],
  ] as const) {
    const sign = new Group();
    for (let i = 0; i < word.length; i += 1) {
      const letter = createLetterMesh(word[i]);
      letter.position.x = (i - word.length / 2) * 2.4;
      sign.add(letter);
    }
    const frame = sampleRailFrame(rail, railU(t));
    sign.position.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y);
    sign.lookAt(sign.position.clone().add(frame.tangent));
    sign.scale.setScalar(1.3);
    group.add(sign);
  }
  return group;
}

function createMunicipalKoi() {
  const group = new Group();
  const body = new Mesh(new SphereGeometry(2.4, 16, 10), additiveMaterial(hdr(CYAN, 0.7), 0.28));
  body.scale.set(1.6, 0.45, 0.7);
  group.add(body);
  for (let i = 0; i < 7; i += 1) {
    const fin = new Mesh(new PlaneGeometry(2.5 - i * 0.2, 1.5), additiveMaterial(hdr(MAGENTA, 0.55), 0.2));
    fin.position.z = -2 - i * 1.1;
    fin.rotation.y = Math.sin(i) * 0.6;
    group.add(fin);
  }
  const frame = sampleRailFrame(rail, railU(28));
  group.position.copy(frame.position).addScaledVector(frame.right, 0).addScaledVector(frame.up, 10);
  group.lookAt(group.position.clone().add(frame.tangent));
  group.scale.setScalar(2.0);
  return group;
}

function createLightningFlash() {
  const mesh = new Mesh(new SphereGeometry(260, 24, 12), new MeshBasicMaterial({ color: hdr(WHITE, 0.8), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}

// ---- updates/effects --------------------------------------------------------

function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(STREETFALL_TIME) || crossed(UNDER_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.9);
    blurPulse = Math.max(blurPulse, 0.85);
    shakeEnergy = Math.max(shakeEnergy, 0.75);
  }
  if (crossed(VULTURE_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.55);
    shakeEnergy = Math.max(shakeEnergy, 0.9);
  }
  if (crossed(OUTRO_TIME)) flashUniform.value = Math.max(flashUniform.value, 0.35);
  lastRunTime = ctx.runTime;
}

function updateEnvironment(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment || !(ctx.camera instanceof PerspectiveCamera)) return;
  environment.rain.position.copy(ctx.camera.position);
  environment.rain.quaternion.copy(ctx.camera.quaternion);
  environment.rain.rotation.x += MathUtils.lerp(0.15, 1.15, MathUtils.clamp((speed - 0.5) / 1.5, 0, 1));
  const rainMat = (environment.rain.children[0] as LineSegments).material as LineBasicMaterial;
  rainMat.opacity = runTime > OUTRO_TIME ? Math.max(0, 0.42 * (1 - (runTime - OUTRO_TIME) / 6)) : runTime > TUBE_TIME && runTime < CANAL_TIME ? 0.12 : 0.42;
  environment.hologram.rotation.y += dt * 0.28;
  environment.hologram.position.y += Math.sin(elapsedNow * 0.8) * dt * 0.5;
  environment.vultureGhost.visible = ctx.running && runTime >= VULTURE_TIME && runTime < OUTRO_TIME;
  if (environment.vultureGhost.visible) {
    const frame = sampleRailFrame(rail, railU(Math.min(DELUGE_DURATION, runTime + 5)));
    environment.vultureGhost.position.copy(frame.position).addScaledVector(frame.up, 5).addScaledVector(frame.right, Math.sin(runTime * 0.38) * 8);
    environment.vultureGhost.lookAt(environment.vultureGhost.position.clone().add(frame.tangent));
  }
  const flash = (environment.lightning.material as MeshBasicMaterial);
  const lightningPulse = Math.max(flashUniform.value, beatEnergy > 0.95 && (Math.floor(runTime / 5.45) % 4 === 0) ? 0.18 : 0);
  flash.opacity = lightningPulse * 0.28;
  environment.lightning.position.copy(ctx.camera.position);
}

function updateEnemyMesh(mesh: Group, dt: number, ctx: VisualContext) {
  const denied = (mesh.userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;
  const locked = mesh.userData.locked === true;
  const flash = (mesh.userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const parts = mesh.userData.parts as TintPart[] | undefined;
  if (parts) {
    const distance = mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
    const closeness = 1 - MathUtils.clamp((distance - 18) / 60, 0, 1);
    for (const part of parts) {
      if (denied) part.material.color.copy(part.kind === 'fill' ? new Color(0.22, 0.01, 0.01) : hdr(RED, 1.3));
      else if (locked) part.material.color.copy(part.kind === 'fill' ? BLUE.clone().multiplyScalar(1.5) : hdr(WHITE, 1.55));
      else if (flash) part.material.color.copy(hdr(WHITE, 1.8));
      else part.material.color.copy(part.base).multiplyScalar(0.42 + closeness * 0.58);
    }
  }
  const spinParts = mesh.userData.spinParts as Mesh[] | undefined;
  if (spinParts) for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
  if (mesh.userData.isBarrier) {
    const gapX = mesh.userData.gapX as number | undefined ?? 99;
    const gapWidth = mesh.userData.gapWidth as number | undefined ?? 0;
    for (const child of mesh.children) {
      if (child.userData.baseX !== undefined) child.visible = Math.abs((child.userData.baseX as number) - gapX) > gapWidth * 0.5;
    }
  }
  if (mesh.userData.kind === 'dropvan') {
    const unfold = mesh.userData.unfold as number | undefined ?? 0;
    for (const child of mesh.children) {
      if (child.userData.side !== undefined) child.rotation.z = (child.userData.side as number) * unfold * 0.9;
    }
  }
  if (mesh.userData.kind === 'vultureCore') {
    const charge = mesh.userData.charge as number | undefined ?? 0;
    mesh.scale.setScalar(mesh.scale.x * (1 + charge * 0.04));
  }
}

function spawnRing(position: Vector3, color: Color, scale: number, life: number) {
  if (!sceneRef) return;
  const mesh = new Mesh(new RingGeometry(0.8, 0.88, 36), additiveMaterial(color, 0.75));
  mesh.position.copy(position);
  mesh.quaternion.copy((sceneRef.children.find(Boolean) as Object3D | undefined)?.quaternion ?? new Quaternion());
  sceneRef.add(mesh);
  effects.push({ mesh, age: 0, life, maxScale: scale, material: mesh.material as MeshBasicMaterial });
}

function spawnSpark(position: Vector3, color: Color, scale: number, life: number) {
  if (!sceneRef) return;
  const mesh = new Mesh(new SphereGeometry(0.18, 8, 6), additiveMaterial(color, 0.75));
  mesh.position.copy(position);
  sceneRef.add(mesh);
  effects.push({ mesh, age: 0, life, maxScale: scale, material: mesh.material as MeshBasicMaterial });
}

function spawnDebris(position: Vector3, color: Color, count: number) {
  for (let i = 0; i < count; i += 1) {
    const offset = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.random() * 1.5);
    spawnSpark(position.clone().add(offset), hdr(color, 0.7 + Math.random()), 0.4 + Math.random() * 0.9, 0.25 + Math.random() * 0.35);
  }
}

function updateEffects(dt: number) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    effect.age += dt;
    const t = MathUtils.clamp(effect.age / effect.life, 0, 1);
    effect.mesh.scale.setScalar(MathUtils.lerp(0.2, effect.maxScale, t));
    if (effect.material) effect.material.opacity = (1 - t) * 0.75;
    if (t >= 1) {
      effect.mesh.removeFromParent();
      effects.splice(i, 1);
    }
  }
}

function createLockRing(color: Color) {
  const group = new Group();
  group.add(new Mesh(new RingGeometry(0.82, 0.88, 6), additiveMaterial(hdr(color, 1.4), 0.75)));
  group.add(new Mesh(new RingGeometry(1.05, 1.08, 32, 1, 0.2, Math.PI * 1.55), additiveMaterial(hdr(WHITE, 1.0), 0.55)));
  return group;
}

function removeLockRing(record: EnemyRecord, scene: Scene) {
  if (record.lockRing) {
    scene.remove(record.lockRing);
    record.lockRing = null;
  }
}

function additiveMaterial(color: Color, opacity: number) {
  return new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function mulberry32(seed: number) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
