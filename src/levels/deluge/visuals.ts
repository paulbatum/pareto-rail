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
  vultureWorldTransform,
} from './gameplay';
import { flashUniform, speedBlurUniform, staticUniform } from './post-fx';
import { CRASH_TIME, lightningIntensity, TRAIN_PASS_TIME } from './sync';

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
  lightningBolt: LineSegments;
  canal: Group;
  cityLights: Points;
  hologram: Group;
  traffic: Group;
  train: Group;
  tubeLights: Mesh[];
  crashBillboard: Group;
  outroSky: Group;
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
  root.add(createFreefallWorld(rng));
  root.add(createFreefallPanelSeams(rng));
  root.add(createCity(rng));
  root.add(createAvenueWalls(rng));
  root.add(createAvenueWindowCanyon(rng));
  root.add(createUnderworld(rng));
  root.add(createNearMissFrames());
  const tube = createTube();
  root.add(tube);
  root.add(createCitadel(rng));
  root.add(createBossPanelGrids(rng));
  const outroSky = createOutroSky(rng);
  root.add(outroSky);
  root.add(createCanal());
  const rain = createRainVolume(rng);
  const lightning = createLightningFlash();
  const lightningBolt = createLightningBolt();
  const cityLights = createDistantLights(rng);
  const hologram = createHologramCreature();
  const traffic = createTrafficStreams(rng);
  const crashBillboard = createCrashBillboard();
  const vultureGhost = createVultureMesh();
  vultureGhost.visible = false;
  root.add(traffic, rain, lightning, lightningBolt, cityLights, hologram, crashBillboard, vultureGhost);
  scene.add(root);
  environment = {
    root,
    rain,
    lightning,
    lightningBolt,
    canal: root.children.find((child) => child.userData.canal) as Group,
    cityLights,
    hologram,
    traffic,
    train: tube.userData.train as Group,
    tubeLights: tube.userData.tubeLights as Mesh[],
    crashBillboard,
    outroSky,
    vultureGhost,
  };
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
        if (environment) {
          environment.crashBillboard.visible = true;
          spawnRing(environment.crashBillboard.position, hdr(GREEN, 1.7), 34, 1.2);
          spawnDebris(environment.crashBillboard.position, CYAN, 48);
          spawnDebris(environment.crashBillboard.position, MAGENTA, 48);
        }
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
  const rim = new Group();
  for (const [x, y, sx, sy] of [[0, -1.65, 3.2, 0.08], [0, 1.65, 3.2, 0.08], [-1.65, 0, 0.08, 3.2], [1.65, 0, 0.08, 3.2]] as const) {
    const edge = new Mesh(new PlaneGeometry(sx, sy), additiveMaterial(hdr(WHITE, 1.25), 0.75));
    edge.position.set(x, y, 0.04);
    rim.add(edge);
  }
  rim.userData.gapRim = true;
  group.add(frame, rim);
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
  const dart = new OctahedronGeometry(flavor === 'flak' ? 0.22 : 0.32, 0);
  dart.scale(0.5, 0.5, flavor === 'flak' ? 1.0 : 2.4);
  group.add(new Mesh(dart, new MeshBasicMaterial({ color: hdr(color, flavor === 'flak' ? 0.95 : 1.5) })));
  group.add(new Mesh(new SphereGeometry(flavor === 'flak' ? 0.26 : 0.38, 10, 8), additiveMaterial(hdr(color, flavor === 'flak' ? 0.34 : 0.8), flavor === 'flak' ? 0.16 : 0.42)));
  group.userData.accent = color.clone();
  return group;
}

export function createVulturePodMesh() {
  const group = new Group();
  addFaceted(group, new BoxGeometry(3.2, 1.1, 3.0), SLATE.clone().multiplyScalar(1.1), GREEN, 1.1);
  const rotor = new Mesh(new RingGeometry(1.55, 1.76, 36), additiveMaterial(hdr(GREEN, 1.4), 0.62));
  rotor.rotation.x = Math.PI / 2;
  rotor.userData.spinSpeed = 16;
  group.add(rotor);
  const engine = new Mesh(new CylinderGeometry(0.55, 0.75, 1.0, 12), additiveMaterial(hdr(GREEN, 1.0), 0.55));
  engine.rotation.x = Math.PI / 2;
  engine.position.z = -1.5;
  group.add(engine);
  group.userData.spinParts = [rotor];
  group.userData.accent = GREEN.clone();
  group.scale.setScalar(1.6);
  return group;
}

export function createVultureCoreMesh() {
  const group = new Group();
  const housingFill = new Color(0.055, 0.066, 0.07);
  const plateFill = new Color(0.085, 0.096, 0.1);
  const upper = addFaceted(group, new BoxGeometry(2.8, 0.42, 1.7), plateFill, GREEN, 0.75);
  upper.position.set(0, 0.55, 0);
  upper.rotation.x = -0.12;
  const lower = addFaceted(group, new BoxGeometry(2.8, 0.42, 1.7), plateFill, GREEN, 0.75);
  lower.position.set(0, -0.55, 0);
  lower.rotation.x = 0.12;
  for (const side of [-1, 1] as const) {
    const cheek = addFaceted(group, new BoxGeometry(0.34, 1.35, 1.5), housingFill, GREEN, 0.55);
    cheek.position.set(side * 1.55, 0, 0);
  }
  const barrel = addFaceted(group, new CylinderGeometry(0.38, 0.52, 1.4, 12), housingFill, GREEN, 0.65);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.42;
  const core = new Mesh(new SphereGeometry(0.34, 16, 10), new MeshBasicMaterial({ color: hdr(GREEN, 1.35) }));
  core.position.z = 0.9;
  core.userData.chargeCore = true;
  const glow = new Mesh(new SphereGeometry(0.52, 16, 10), additiveMaterial(hdr(GREEN, 0.36), 0.14));
  glow.position.copy(core.position);
  glow.userData.chargeGlow = true;
  group.add(core, glow);
  group.userData.kind = 'vultureCore';
  group.userData.accent = GREEN.clone();
  group.userData.chargeParts = { core, glow };
  group.userData.lockRingScale = 1.4;
  return group;
}

export function createVultureMesh() {
  const group = new Group();
  const hullFill = new Color(0.105, 0.118, 0.12);
  const plateFill = new Color(0.075, 0.088, 0.092);
  const seam = new Color(0.22, 0.75, 0.28);

  for (const side of [-1, 1] as const) {
    const hull = addFaceted(group, new BoxGeometry(4.8, 2.4, 8.2), hullFill, seam, 0.55);
    hull.position.set(side * 2.9, 0.15, 0);
    hull.rotation.z = side * -0.035;
    const nosePlate = addFaceted(group, new BoxGeometry(4.2, 1.4, 2.2), plateFill, GREEN, 0.75);
    nosePlate.position.set(side * 2.9, -0.15, 4.7);
    const tailBoom = addFaceted(group, new BoxGeometry(1.2, 0.9, 6.6), plateFill, WHITE, 0.32);
    tailBoom.position.set(side * 3.0, 0.05, -7.0);
    const nacelle = addFaceted(group, new CylinderGeometry(1.05, 1.25, 2.4, 14), hullFill, GREEN, 0.65);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 7.4, 0.0, -1.2);
    const rotor = new Mesh(new TorusGeometry(2.35, 0.11, 8, 48), additiveMaterial(hdr(GREEN, 0.72), 0.46));
    rotor.position.set(side * 7.4, 0.0, 0.2);
    rotor.rotation.x = Math.PI / 2;
    rotor.userData.spinSpeed = side * 13;
    group.add(rotor);
    (group.userData.spinParts ??= []).push(rotor);
    const engineGlow = new Mesh(new CircleGeometry(0.34, 18), additiveMaterial(hdr(GREEN, 1.35), 0.54));
    engineGlow.position.set(side * 3.0, 0.1, -10.5);
    group.add(engineGlow);
    const runningA = new Mesh(new SphereGeometry(0.24, 8, 6), additiveMaterial(hdr(GREEN, 1.8), 0.8));
    runningA.position.set(side * 4.7, 1.28, 3.3);
    runningA.userData.runningLight = true;
    group.add(runningA);
    const hardpoint = addFaceted(group, new BoxGeometry(1.7, 0.8, 1.5), plateFill, GREEN, 0.85);
    hardpoint.position.set(side * 6.2, -0.8, 1.0);
  }

  const spine = addFaceted(group, new BoxGeometry(3.2, 1.4, 10.6), hullFill, WHITE, 0.35);
  spine.position.y = 0.45;
  const cockpit = addFaceted(group, new TetrahedronGeometry(2.6, 0), new Color(0.07, 0.083, 0.095), GREEN, 0.9);
  cockpit.position.set(0, 0.15, 5.9);
  cockpit.scale.set(1.25, 0.8, 2.0);
  const chin = addFaceted(group, new BoxGeometry(3.4, 0.9, 2.3), plateFill, GREEN, 0.65);
  chin.position.set(0, -1.35, 3.2);

  const maw = new Group();
  const upper = addFaceted(maw, new BoxGeometry(3.0, 0.35, 1.8), plateFill, GREEN, 1.0);
  upper.position.y = 0.45;
  const lower = addFaceted(maw, new BoxGeometry(3.0, 0.35, 1.8), plateFill, GREEN, 1.0);
  lower.position.y = -0.45;
  const core = addCore(maw, 0.26, GREEN, 1.25);
  core.position.z = 0.35;
  maw.position.set(0, -1.9, 3.9);
  maw.userData.maw = true;
  maw.userData.upper = upper;
  maw.userData.lower = lower;
  group.add(maw);

  for (const y of [-0.85, 0.85]) {
    const seamLine = new Mesh(new BoxGeometry(11.5, 0.055, 0.08), additiveMaterial(hdr(GREEN, 0.55), 0.38));
    seamLine.position.set(0, y, 2.6);
    group.add(seamLine);
  }
  const search = new Mesh(new CylinderGeometry(0.08, 0.55, 12, 16, 1, true), additiveMaterial(hdr(GREEN, 0.18), 0.018));
  search.rotation.x = Math.PI / 2 + 0.48;
  search.rotation.z = -0.22;
  search.position.set(0, -3.6, 8.8);
  search.userData.searchCone = true;
  group.add(search);

  group.scale.setScalar(2.65);
  group.userData.accent = GREEN.clone();
  group.userData.mawGroup = maw;
  return group;
}


function updateVultureAnimatedParts(group: Group, dt: number, charge: number, camera?: PerspectiveCamera) {
  const spinParts = group.userData.spinParts as Mesh[] | undefined;
  if (spinParts) for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
  const maw = group.userData.mawGroup as Group | undefined;
  if (maw) {
    const upper = maw.userData.upper as Mesh | undefined;
    const lower = maw.userData.lower as Mesh | undefined;
    if (upper) upper.position.y = 0.35 + charge * 0.35;
    if (lower) lower.position.y = -0.35 - charge * 0.35;
  }
  group.traverse((child) => {
    if (child instanceof Mesh && child.userData.runningLight) {
      const mat = child.material as MeshBasicMaterial;
      mat.opacity = 0.34 + Math.max(0, Math.sin(elapsedNow * 9 + child.id)) * 0.38;
    }
    if (child instanceof Mesh && child.userData.searchCone) {
      child.rotation.z = -0.22 + Math.sin(elapsedNow * 1.2) * 0.28;
      const mat = child.material as MeshBasicMaterial;
      const world = new Vector3();
      child.getWorldPosition(world);
      const distance = camera ? world.distanceTo(camera.position) : 40;
      const proximityFade = MathUtils.clamp((distance - 11) / 24, 0, 1);
      mat.opacity = (0.012 + charge * 0.024) * proximityFade;
    }
  });
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
  const buildingMat = new MeshBasicMaterial({ color: new Color(0.010, 0.015, 0.026) });
  const edgeGeo = new BoxGeometry(0.12, 1, 0.12);
  const edgeMat = additiveMaterial(hdr(CYAN, 0.42), 0.42);
  const buildingCount = 520;
  const buildings = new InstancedMesh(buildingGeo, buildingMat, buildingCount);
  const edgeCount = buildingCount * 2;
  const edges = new InstancedMesh(edgeGeo, edgeMat, edgeCount);
  const windowCount = 14500;
  const windowGeo = new PlaneGeometry(0.22, 0.11);
  const windowMat = new MeshBasicMaterial({ color: hdr(CYAN, 0.42), transparent: true, opacity: 0.62, blending: AdditiveBlending, depthWrite: false });
  const windows = new InstancedMesh(windowGeo, windowMat, windowCount);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let buildingIndex = 0;
  let edgeIndex = 0;
  let windowIndex = 0;

  for (let b = 0; b < 110 && buildingIndex < buildingCount; b += 1) {
    const time = MathUtils.lerp(0, OUTRO_TIME + 8, b / 109);
    const u = railU(time);
    const frame = sampleRailFrame(rail, u);
    for (const side of [-1, 1] as const) {
      if (buildingIndex >= buildingCount) break;
      const inAvenue = time >= STREETFALL_TIME - 2 && time < UNDER_TIME + 1;
      const inFreefall = time < STREETFALL_TIME;
      const inOutro = time >= OUTRO_TIME;
      const close = inAvenue ? 15 + rng() * 12 : inFreefall || inOutro ? 44 + rng() * 42 : 24 + rng() * 55;
      const width = inAvenue ? 9 + rng() * 14 : 8 + rng() * 20;
      const height = inFreefall || inOutro ? 35 + rng() * 100 : inAvenue ? 80 + rng() * 170 : 30 + rng() * 80;
      const depth = 12 + rng() * 34;
      const setback = rng() < 0.28 ? rng() * 8 : 0;
      const pos = frame.position
        .clone()
        .addScaledVector(frame.right, side * (close + width * 0.5 + setback))
        .addScaledVector(frame.up, (inFreefall ? -70 : -42) + height * 0.5)
        .addScaledVector(frame.tangent, (rng() - 0.5) * 18);
      quat.setFromUnitVectors(new Vector3(0, 0, 1), frame.tangent.clone().normalize());
      matrix.compose(pos, quat, new Vector3(width, height, depth));
      buildings.setMatrixAt(buildingIndex, matrix);

      for (const ex of [-0.48, 0.48] as const) {
        if (edgeIndex >= edgeCount) break;
        const edgePos = pos.clone().addScaledVector(frame.right, side * ex * width);
        matrix.compose(edgePos, quat, new Vector3(1, height, 1));
        edges.setMatrixAt(edgeIndex, matrix);
        edges.setColorAt(edgeIndex, (rng() < 0.55 ? CYAN : MAGENTA).clone().multiplyScalar(0.35 + rng() * 0.45));
        edgeIndex += 1;
      }

      const cols = Math.max(3, Math.floor(width / 1.6));
      const rows = Math.max(8, Math.floor(height / 3.2));
      const maxWindowsForBuilding = inAvenue ? 46 : 24;
      let placed = 0;
      for (let row = 0; row < rows && placed < maxWindowsForBuilding && windowIndex < windowCount; row += 1) {
        for (let col = 0; col < cols && placed < maxWindowsForBuilding && windowIndex < windowCount; col += 1) {
          if (rng() < 0.68) continue;
          const wx = side * (close + width + setback + 0.06);
          const wy = -height * 0.43 + row * 3.1 + rng() * 0.35;
          const wz = (col / Math.max(1, cols - 1) - 0.5) * depth * 0.82;
          const winPos = frame.position.clone().addScaledVector(frame.right, wx).addScaledVector(frame.up, (inFreefall ? -70 : -42) + height * 0.5 + wy).addScaledVector(frame.tangent, wz);
          const scale = new Vector3(1.6 + rng() * 1.6, 1.0, 1.0);
          matrix.compose(winPos, quat, scale);
          windows.setMatrixAt(windowIndex, matrix);
          const dark = rng() < 0.35;
          const c = dark ? BLUE : rng() < 0.45 ? CYAN : rng() < 0.75 ? MAGENTA : AMBER;
          windows.setColorAt(windowIndex, c.clone().multiplyScalar(dark ? 0.06 : 0.18 + rng() * 0.32));
          windowIndex += 1;
          placed += 1;
        }
      }

      if (rng() < 0.35) group.add(createRooftopCluster(frame, pos, height, width, depth, side, rng));
      buildingIndex += 1;
    }
  }
  buildings.count = buildingIndex;
  edges.count = edgeIndex;
  windows.count = windowIndex;
  buildings.instanceMatrix.needsUpdate = true;
  edges.instanceMatrix.needsUpdate = true;
  windows.instanceMatrix.needsUpdate = true;
  if (edges.instanceColor) edges.instanceColor.needsUpdate = true;
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  group.add(buildings, edges, windows);
  group.add(createSignage());
  return group;
}

function createRooftopCluster(frame: ReturnType<typeof sampleRailFrame>, base: Vector3, height: number, width: number, depth: number, side: -1 | 1, rng: () => number) {
  const cluster = new Group();
  const dark = new MeshBasicMaterial({ color: new Color(0.012, 0.016, 0.024) });
  const red = additiveMaterial(hdr(RED, 1.1), 0.7);
  const top = base.clone().addScaledVector(frame.up, height * 0.52 + 1.8);
  const tank = new Mesh(new CylinderGeometry(1.1, 1.1, 1.8, 10), dark);
  tank.position.copy(top).addScaledVector(frame.right, side * (rng() - 0.5) * width * 0.4).addScaledVector(frame.tangent, (rng() - 0.5) * depth * 0.5);
  cluster.add(tank);
  for (let i = 0; i < 2 + Math.floor(rng() * 4); i += 1) {
    const mast = new Mesh(new BoxGeometry(0.14, 5 + rng() * 12, 0.14), dark);
    mast.position.copy(top).addScaledVector(frame.right, side * (rng() - 0.5) * width * 0.6).addScaledVector(frame.tangent, (rng() - 0.5) * depth * 0.7).addScaledVector(frame.up, mast.scale.y * 0.5);
    const strobe = new Mesh(new SphereGeometry(0.22, 8, 6), red);
    strobe.position.copy(mast.position).addScaledVector(frame.up, 3.5);
    cluster.add(mast, strobe);
  }
  return cluster;
}

function createFreefallWorld(rng: () => number) {
  const group = new Group();
  const mastGeo = new BoxGeometry(0.32, 1, 0.32);
  const mastMat = new MeshBasicMaterial({ color: new Color(0.02, 0.025, 0.035) });
  const strobeMat = additiveMaterial(hdr(RED, 1.4), 0.7);
  const wireMat = new LineBasicMaterial({ color: hdr(WHITE, 0.35), transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false });
  const count = 150;
  const masts = new InstancedMesh(mastGeo, mastMat, count);
  const strobes = new InstancedMesh(new SphereGeometry(0.45, 8, 6), strobeMat, count);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let i = 0;
  const wirePositions: number[] = [];
  for (let b = 0; b < 18 && i < count; b += 0.6) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    for (const side of [-1, 1] as const) {
      const h = 18 + rng() * 70;
      const p = frame.position.clone().addScaledVector(frame.right, side * (5 + rng() * 26)).addScaledVector(frame.up, -44 + rng() * 32).addScaledVector(frame.tangent, (rng() - 0.5) * 18);
      quat.setFromUnitVectors(new Vector3(0, 1, 0), frame.up);
      matrix.compose(p.clone().addScaledVector(frame.up, h * 0.5), quat, new Vector3(1, h, 1));
      masts.setMatrixAt(i, matrix);
      matrix.compose(p.clone().addScaledVector(frame.up, h + 0.4), quat, new Vector3(1, 1, 1));
      strobes.setMatrixAt(i, matrix);
      if (rng() < 0.55) {
        const q = p.clone().addScaledVector(frame.right, -side * (8 + rng() * 10)).addScaledVector(frame.up, h * (0.35 + rng() * 0.45));
        wirePositions.push(p.x, p.y + h * 0.9, p.z, q.x, q.y, q.z);
      }
      i += 1;
      if (i >= count) break;
    }
  }
  masts.count = i;
  strobes.count = i;
  masts.instanceMatrix.needsUpdate = true;
  strobes.instanceMatrix.needsUpdate = true;
  group.add(masts, strobes);
  const wireGeo = new BufferGeometry();
  wireGeo.setAttribute('position', new Float32BufferAttribute(wirePositions, 3));
  group.add(new LineSegments(wireGeo, wireMat));
  return group;
}

function createFreefallPanelSeams(rng: () => number) {
  const group = new Group();
  const seamMat = new MeshBasicMaterial({ color: hdr(CYAN, 0.28), transparent: true, opacity: 0.34, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const bandMat = new MeshBasicMaterial({ color: hdr(WHITE, 0.22), transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  for (let b = 1; b < 16; b += 0.8) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    for (const side of [-1, 1] as const) {
      const facade = new Group();
      facade.position.copy(frame.position).addScaledVector(frame.right, side * (36 + rng() * 16)).addScaledVector(frame.up, -22 + rng() * 14).addScaledVector(frame.tangent, (rng() - 0.5) * 12);
      facade.lookAt(frame.position);
      for (let y = -20; y <= 26; y += 7.5) {
        const band = new Mesh(new PlaneGeometry(26 + rng() * 14, 0.12), rng() < 0.35 ? bandMat : seamMat);
        band.position.set((rng() - 0.5) * 4, y, 0.03);
        facade.add(band);
      }
      for (let x = -12; x <= 12; x += 6) {
        const seam = new Mesh(new PlaneGeometry(0.09, 46 + rng() * 16), seamMat);
        seam.position.set(x + (rng() - 0.5) * 1.5, 2, 0.02);
        facade.add(seam);
      }
      group.add(facade);
    }
  }
  return group;
}


function createAvenueWalls(rng: () => number) {
  const group = new Group();
  const panelGeo = new BoxGeometry(1, 1, 1);
  const panelMat = new MeshBasicMaterial({ color: new Color(0.013, 0.019, 0.03) });
  const panels = new InstancedMesh(panelGeo, panelMat, 220);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let i = 0;
  for (let b = 16; b <= 40 && i < 220; b += 0.45) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    quat.setFromUnitVectors(new Vector3(0, 0, 1), frame.tangent.clone().normalize());
    for (const side of [-1, 1] as const) {
      const height = 150 + rng() * 110;
      const p = frame.position.clone().addScaledVector(frame.right, side * (16 + rng() * 9)).addScaledVector(frame.up, -36 + height * 0.5).addScaledVector(frame.tangent, (rng() - 0.5) * 8);
      matrix.compose(p, quat, new Vector3(5 + rng() * 6, height, 16 + rng() * 8));
      panels.setMatrixAt(i, matrix);
      i += 1;
      if (i >= 220) break;
    }
  }
  panels.count = i;
  panels.instanceMatrix.needsUpdate = true;
  group.add(panels);
  return group;
}

function createAvenueWindowCanyon(rng: () => number) {
  const group = new Group();
  const count = 9000;
  const geo = new PlaneGeometry(0.48, 0.22);
  const mat = new MeshBasicMaterial({ color: hdr(CYAN, 0.62), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const windows = new InstancedMesh(geo, mat, count);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let i = 0;
  for (let b = 16; b < 40 && i < count; b += 0.32) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    for (const side of [-1, 1] as const) {
      quat.setFromUnitVectors(new Vector3(0, 0, 1), frame.right.clone().multiplyScalar(-side).normalize());
      const faceX = side * (16 + rng() * 8);
      for (let row = 0; row < 26 && i < count; row += 1) {
        for (let col = 0; col < 4 && i < count; col += 1) {
          if (rng() < 0.68) continue;
          const y = -30 + row * 4.2 + rng() * 0.4;
          const z = (col - 1.5) * 5.4 + (rng() - 0.5) * 0.7;
          const p = frame.position.clone().addScaledVector(frame.right, faceX).addScaledVector(frame.up, y).addScaledVector(frame.tangent, z);
          const scale = new Vector3(1.45 + rng() * 1.1, 1.0, 1);
          matrix.compose(p, quat, scale);
          windows.setMatrixAt(i, matrix);
          const c = rng() < 0.52 ? CYAN : rng() < 0.76 ? MAGENTA : AMBER;
          windows.setColorAt(i, c.clone().multiplyScalar(0.22 + rng() * 0.42));
          i += 1;
        }
      }
    }
  }
  windows.count = i;
  windows.instanceMatrix.needsUpdate = true;
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  group.add(windows);
  return group;
}


function createUnderworld(rng: () => number) {
  const group = new Group();
  const slabMat = new MeshBasicMaterial({ color: new Color(0.03, 0.026, 0.022) });
  const amber = additiveMaterial(hdr(AMBER, 0.8), 0.55);
  const pipeMat = new MeshBasicMaterial({ color: new Color(0.035, 0.035, 0.04) });
  for (let b = 40; b < 48; b += 0.5) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    const deck = new Group();
    deck.position.copy(frame.position);
    deck.lookAt(frame.position.clone().add(frame.tangent));
    const slab = new Mesh(new BoxGeometry(34, 0.55, 7.5), slabMat);
    slab.position.y = 5.6;
    deck.add(slab);
    for (const x of [-9.5, 9.5]) {
      const col = new Mesh(new BoxGeometry(0.75, 10, 0.75), slabMat);
      col.position.set(x, 0.4, 0);
      const lamp = new Mesh(new SphereGeometry(0.22, 8, 6), amber);
      lamp.position.set(x * 0.92, 3.9, -1.5 + rng() * 3);
      deck.add(col, lamp);
    }
    for (const x of [-6.5, -5.5, 5.5, 6.5]) {
      const pipe = new Mesh(new CylinderGeometry(0.12, 0.12, 7.2, 8), pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, 4.8 + rng() * 0.6, 0);
      deck.add(pipe);
    }
    group.add(deck);
  }
  return group;
}

function createCitadel(rng: () => number) {
  const group = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(0.014, 0.02, 0.032) });
  const edge = additiveMaterial(hdr(CYAN, 0.18), 0.28);
  for (let b = 64; b < 110; b += 1.0) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    const tower = new Group();
    tower.position.copy(frame.position).addScaledVector(frame.right, (Math.sin(b * 0.7) >= 0 ? 1 : -1) * (28 + rng() * 14)).addScaledVector(frame.up, -36 + rng() * 14);
    tower.lookAt(tower.position.clone().add(frame.tangent));
    const core = new Mesh(new BoxGeometry(18 + rng() * 12, 120 + rng() * 120, 14 + rng() * 18), mat);
    tower.add(core);
    for (const y of [-18, 4, 25, 47]) {
      const gantry = new Mesh(new BoxGeometry(42, 0.42, 1.0), edge);
      gantry.position.set(0, y, 0);
      tower.add(gantry);
    }
    group.add(tower);
  }
  return group;
}

function createNearMissFrames() {
  const group = new Group();
  const dark = new MeshBasicMaterial({ color: new Color(0.025, 0.035, 0.048) });
  const cyan = additiveMaterial(hdr(CYAN, 0.55), 0.45);
  const amber = additiveMaterial(hdr(AMBER, 0.7), 0.5);
  const boxGeo = new BoxGeometry(1, 1, 1);
  const times: number[] = [];
  for (let b = 3; b < 16; b += 1) times.push((b * 240) / 176);
  for (let b = 16; b < 40; b += 0.75) times.push((b * 240) / 176);
  for (let b = 64; b < 104; b += 1.0) times.push((b * 240) / 176);
  times.forEach((t, index) => {
    const frame = sampleRailFrame(rail, railU(t));
    const rig = new Group();
    rig.position.copy(frame.position);
    rig.lookAt(frame.position.clone().add(frame.tangent));
    // Act-4 rigs frame the boss fight from the sides; overhead crossings there
    // would sweep through the Vulture's flight corridor once a bar.
    const kind = t >= (64 * 240) / 176 ? 3 : index % 3;
    if (kind === 3) {
      for (const side of [-1, 1] as const) {
        const pylon = new Mesh(boxGeo, dark);
        pylon.position.set(side * 8.5, 3.2, 0);
        pylon.scale.set(0.6, 9.5, 0.9);
        const lamp = new Mesh(new SphereGeometry(0.2, 8, 6), side < 0 ? cyan : amber);
        lamp.position.set(side * 8.5, 8.2, 0);
        rig.add(pylon, lamp);
      }
      const cross = new Mesh(boxGeo, dark);
      cross.position.y = 10.6;
      cross.scale.set(17.6, 0.4, 0.8);
      const neon = new Mesh(new BoxGeometry(17.6, 0.05, 0.08), cyan);
      neon.position.y = 10.2;
      rig.add(cross, neon);
    } else if (kind === 0) {
      const top = new Mesh(boxGeo, dark);
      top.position.y = 5.6;
      top.scale.set(18, 0.34, 0.7);
      const left = new Mesh(boxGeo, dark);
      left.position.set(-7.5, 2.4, 0);
      left.scale.set(0.45, 6.4, 0.7);
      const right = left.clone();
      right.position.x = 7.5;
      const neon = new Mesh(new BoxGeometry(18, 0.045, 0.08), cyan);
      neon.position.y = 5.28;
      rig.add(top, left, right, neon);
    } else if (kind === 1) {
      const tube = new Mesh(new CylinderGeometry(2.3, 2.3, 18, 12, 1, true), dark);
      tube.rotation.z = Math.PI / 2;
      tube.position.y = 4.2;
      const lamps = new Group();
      for (let i = -3; i <= 3; i += 1) {
        const lamp = new Mesh(new SphereGeometry(0.16, 8, 6), amber);
        lamp.position.set(i * 2.2, 2.25, 0.2);
        lamps.add(lamp);
      }
      for (const face of [-1, 1] as const) {
        const windows = new Mesh(new BoxGeometry(16, 0.5, 0.06), cyan);
        windows.position.set(0, 4.0, face * 2.1);
        rig.add(windows);
      }
      rig.add(tube, lamps);
    } else {
      for (let c = -4; c <= 4; c += 1) {
        const cable = new Mesh(new CylinderGeometry(0.05, 0.05, 18, 6), dark);
        cable.rotation.z = Math.PI / 2;
        cable.position.set(0, 4.8 + Math.sin(c) * 0.7, c * 0.18);
        const lamp = new Mesh(new SphereGeometry(0.18, 8, 6), c % 2 ? cyan : amber);
        lamp.position.set(c * 1.6, 3.2 + Math.cos(c), 0);
        rig.add(cable, lamp);
      }
    }
    group.add(rig);
  });
  return group;
}

function createTube() {
  const group = new Group();
  const ringMat = new MeshBasicMaterial({ color: new Color(0.025, 0.025, 0.03) });
  const panelMat = new MeshBasicMaterial({ color: new Color(0.018, 0.020, 0.026) });
  const cableMat = new MeshBasicMaterial({ color: new Color(0.035, 0.032, 0.035) });
  const lightMat = additiveMaterial(hdr(AMBER, 0.85), 0.42);
  const tubeLights: Mesh[] = [];
  for (let b = 40; b <= 64; b += 0.5) {
    const t = (b * 240) / 176;
    const frame = sampleRailFrame(rail, railU(t));
    const ring = new Group();
    ring.position.copy(frame.position);
    ring.lookAt(frame.position.clone().add(frame.tangent));
    const wide = (b > 52 && b < 54.2) || (b > 59 && b < 60.4);
    const radius = wide ? 10.4 : 7.8;
    const body = new Mesh(new TorusGeometry(radius, 0.24, 6, 42), ringMat);
    const light = new Mesh(new TorusGeometry(radius - 0.65, 0.055, 5, 42, Math.PI * 1.72), lightMat.clone());
    light.userData.time = t;
    light.userData.baseOpacity = 0.42;
    tubeLights.push(light);
    ring.add(body, light);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const panel = new Mesh(new BoxGeometry(1.3, 0.16, 2.2), panelMat);
      panel.position.set(Math.cos(angle) * (radius - 0.4), Math.sin(angle) * (radius - 0.4), 0);
      panel.rotation.z = angle;
      ring.add(panel);
    }
    for (const side of [-1, 1] as const) {
      const cable = new Mesh(new CylinderGeometry(0.08, 0.08, 6.5, 6), cableMat);
      cable.rotation.x = Math.PI / 2;
      cable.position.set(side * (radius - 1.3), 2.7 + Math.sin(b) * 0.35, 0);
      ring.add(cable);
    }
    group.add(ring);
  }
  const train = new Group();
  const trainMat = new MeshBasicMaterial({ color: new Color(0.018, 0.023, 0.03) });
  const windowMat = additiveMaterial(hdr(WHITE, 0.95), 0.62);
  for (let i = 0; i < 24; i += 1) {
    const car = new Mesh(new BoxGeometry(3.0, 2.6, 7.6), trainMat);
    car.position.z = -i * 8;
    for (let w = -1; w <= 1; w += 1) {
      const win = new Mesh(new PlaneGeometry(0.8, 0.46), windowMat);
      win.position.set(w * 0.85, 0.45, 3.86);
      car.add(win);
    }
    train.add(car);
  }
  train.userData.baseTime = TRAIN_PASS_TIME;
  group.userData.train = train;
  group.userData.tubeLights = tubeLights;
  group.add(train);
  return group;
}

function createBossPanelGrids(rng: () => number) {
  const group = new Group();
  const count = 6200;
  const panelGeo = new PlaneGeometry(0.65, 0.22);
  const panelMat = new MeshBasicMaterial({ color: hdr(WHITE, 0.42), transparent: true, opacity: 0.72, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const panels = new InstancedMesh(panelGeo, panelMat, count);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  let i = 0;
  for (let b = 64; b < 106 && i < count; b += 0.42) {
    const frame = sampleRailFrame(rail, railU((b * 240) / 176));
    for (const side of [-1, 1] as const) {
      const normal = frame.right.clone().multiplyScalar(-side);
      quat.setFromUnitVectors(new Vector3(0, 0, 1), normal.normalize());
      const x = side * (18 + rng() * 12);
      for (let row = 0; row < 14 && i < count; row += 1) {
        for (let col = 0; col < 2 && i < count; col += 1) {
          if (rng() < 0.22) continue;
          const y = -24 + row * 3.4 + rng() * 0.35;
          const z = (col - 0.5) * 4.2 + (rng() - 0.5);
          const p = frame.position.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.tangent, z);
          matrix.compose(p, quat, new Vector3(1.3 + rng() * 1.1, 1, 1));
          panels.setMatrixAt(i, matrix);
          const c = rng() < 0.55 ? WHITE : rng() < 0.78 ? CYAN : GREEN;
          panels.setColorAt(i, c.clone().multiplyScalar(0.28 + rng() * 0.45));
          i += 1;
        }
      }
    }
  }
  panels.count = i;
  panels.instanceMatrix.needsUpdate = true;
  if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
  group.add(panels);
  return group;
}

function createOutroSky(rng: () => number) {
  const group = new Group();
  const count = 900;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 18 + rng() * 140;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = -20 + rng() * 95;
    positions[i * 3 + 2] = -15 - rng() * 70;
    const bright = 0.35 + rng() * 0.9;
    colors[i * 3] = WHITE.r * bright;
    colors[i * 3 + 1] = WHITE.g * bright;
    colors[i * 3 + 2] = WHITE.b * bright;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  group.add(new Points(geo, new PointsMaterial({ size: 1.8, vertexColors: true, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, depthTest: false })));
  const glow = new Mesh(new CircleGeometry(14, 40), additiveMaterial(new Color(0.10, 0.13, 0.14), 0.08));
  (glow.material as MeshBasicMaterial).depthTest = false;
  glow.position.set(-18, 14, -45.2);
  group.add(glow);
  const moon = new Mesh(new CircleGeometry(6.5, 40), new MeshBasicMaterial({ color: new Color(0.95, 0.95, 0.92), transparent: true, opacity: 0.96, side: DoubleSide, depthWrite: false, depthTest: false }));
  moon.position.set(-18, 14, -45);
  group.add(moon);
  const cityGlow = new Mesh(new PlaneGeometry(150, 34), additiveMaterial(hdr(CYAN, 0.22), 0.18));
  (cityGlow.material as MeshBasicMaterial).depthTest = false;
  cityGlow.position.set(0, -28, -18);
  group.add(cityGlow);
  group.visible = false;
  return group;
}

function createCanal() {
  const group = new Group();
  group.userData.canal = true;
  const water = new Mesh(new PlaneGeometry(320, 280), new MeshBasicMaterial({ color: new Color(0.004, 0.014, 0.024), transparent: true, opacity: 0.78, side: DoubleSide }));
  const frame = sampleRailFrame(rail, railU(CANAL_TIME + 2));
  water.position.copy(frame.position).addScaledVector(frame.up, -4);
  water.rotation.x = -Math.PI / 2;
  group.add(water);
  const rippleMat = additiveMaterial(hdr(CYAN, 0.55), 0.34);
  const mirrorCyan = additiveMaterial(hdr(CYAN, 0.42), 0.28);
  const mirrorMagenta = additiveMaterial(hdr(MAGENTA, 0.38), 0.25);
  const rng = mulberry32(0xc0a1);
  for (let i = 0; i < 180; i += 1) {
    const ring = new Mesh(new RingGeometry(0.45, 0.5, 18), rippleMat);
    ring.position.copy(water.position).add(new Vector3((rng() - 0.5) * 220, 0.04, (rng() - 0.5) * 190));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.4 + rng() * 2.5);
    group.add(ring);
  }
  for (let i = 0; i < 90; i += 1) {
    const streak = new Mesh(new PlaneGeometry(0.18 + rng() * 0.4, 4 + rng() * 14), rng() < 0.55 ? mirrorCyan : mirrorMagenta);
    streak.position.copy(water.position).add(new Vector3((rng() - 0.5) * 180, 0.05, (rng() - 0.5) * 160));
    streak.rotation.x = -Math.PI / 2;
    streak.rotation.z = (rng() - 0.5) * 0.35;
    group.add(streak);
  }
  const bridgeMat = new MeshBasicMaterial({ color: new Color(0.025, 0.032, 0.042) });
  for (const dt of [1.2, 3.6]) {
    const f = sampleRailFrame(rail, railU(CANAL_TIME + dt));
    const bridge = new Group();
    bridge.position.copy(f.position).addScaledVector(f.up, 6.2);
    bridge.lookAt(bridge.position.clone().add(f.tangent));
    const deck = new Mesh(new BoxGeometry(48, 0.6, 4.2), bridgeMat);
    const neon = new Mesh(new BoxGeometry(48, 0.06, 0.08), additiveMaterial(hdr(MAGENTA, 0.65), 0.5));
    neon.position.y = -0.36;
    bridge.add(deck, neon);
    group.add(bridge);
  }
  return group;
}

function createCloudDeck() {
  const group = new Group();
  const rng = mulberry32(0xc10dd);
  for (const t of [7.4, OUTRO_TIME + 2.0]) {
    const frame = sampleRailFrame(rail, railU(t));
    for (let layer = 0; layer < 18; layer += 1) {
      const mat = new MeshBasicMaterial({
        color: new Color(0.12 + rng() * 0.04, 0.15 + rng() * 0.04, 0.19 + rng() * 0.05),
        transparent: true,
        opacity: 0.10 + rng() * 0.10,
        depthWrite: false,
        side: DoubleSide,
      });
      const shell = new Mesh(new PlaneGeometry(130 + layer * 18, 42 + layer * 7), mat);
      shell.position.copy(frame.position)
        .addScaledVector(frame.tangent, layer * 3.5 - 26)
        .addScaledVector(frame.up, layer * 0.9 - 7)
        .addScaledVector(frame.right, (rng() - 0.5) * 35);
      shell.lookAt(shell.position.clone().add(frame.tangent));
      shell.rotation.z += (rng() - 0.5) * 0.45;
      shell.userData.cloud = true;
      shell.userData.phase = rng() * Math.PI * 2;
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
  const mat1 = additiveMaterial(hdr(CYAN, 0.82), 0.56);
  const mat2 = additiveMaterial(hdr(MAGENTA, 0.76), 0.52);
  const mat3 = additiveMaterial(hdr(AMBER, 0.62), 0.42);
  for (let i = 0; i < 260; i += 1) {
    const u = 0.08 + rng() * 0.64;
    const frame = sampleRailFrame(rail, u);
    const side = rng() < 0.5 ? -1 : 1;
    const laneOffset = side * (34 + Math.floor(rng() * 6) * 9 + rng() * 5);
    const height = -10 + rng() * 48;
    const stream = new Mesh(new BoxGeometry(0.055, 0.055, 5 + rng() * 15), rng() < 0.45 ? mat1 : rng() < 0.78 ? mat2 : mat3);
    stream.position.copy(frame.position).addScaledVector(frame.right, laneOffset).addScaledVector(frame.up, height).addScaledVector(frame.tangent, (rng() - 0.5) * 80);
    stream.lookAt(stream.position.clone().add(frame.tangent));
    stream.userData.baseU = u;
    stream.userData.laneOffset = laneOffset;
    stream.userData.height = height;
    stream.userData.speed = (rng() < 0.5 ? -1 : 1) * (0.018 + rng() * 0.04);
    stream.userData.phase = rng();
    group.add(stream);
  }
  return group;
}

function createSignage() {
  const group = new Group();
  for (const [word, t, x, y, scale] of [
    ['DELUGE', 18, -13, 9, 2.0],
    ['RUN', 21, 12, 5, 1.4],
    ['DRONE', 26, 12, 7, 1.7],
    ['CITY', 32, -13, 8, 1.5],
    ['REPLAY', 34, -12, 5, 1.4],
    ['VULTURE', 78, 14, 9, 1.8],
    ['PAY', 73, 10, 6, 1.5],
  ] as const) {
    const sign = new Group();
    const panel = new Mesh(new PlaneGeometry(word.length * 2.8 + 2, 5.0), new MeshBasicMaterial({ color: new Color(0.006, 0.012, 0.022), transparent: true, opacity: 0.86, side: DoubleSide }));
    panel.position.z = -0.12;
    sign.add(panel);
    for (let i = 0; i < word.length; i += 1) {
      const letter = createLetterMesh(word[i]);
      letter.position.x = (i - (word.length - 1) / 2) * 2.4;
      letter.userData.marqueePhase = i * 0.55;
      sign.add(letter);
    }
    const frame = sampleRailFrame(rail, railU(t));
    sign.position.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y);
    sign.lookAt(sign.position.clone().add(frame.tangent));
    sign.scale.setScalar(scale);
    sign.userData.sign = true;
    sign.userData.word = word;
    group.add(sign);
  }
  return group;
}

export function createHologramCreature() {
  const group = new Group();
  const segmentMat = additiveMaterial(hdr(CYAN, 0.72), 0.25);
  const finMat = additiveMaterial(hdr(MAGENTA, 0.55), 0.18);
  const scanMat = additiveMaterial(hdr(WHITE, 0.55), 0.16);
  const segments: Mesh[] = [];
  for (let i = 0; i < 22; i += 1) {
    const radius = 2.8 * Math.sin((i / 21) * Math.PI) + 0.7;
    const seg = new Mesh(new TorusGeometry(radius, 0.055, 5, 26), segmentMat);
    seg.position.z = -i * 1.15;
    seg.scale.y = 0.42;
    seg.userData.index = i;
    group.add(seg);
    segments.push(seg);
    if (i % 2 === 0) {
      const fin = new Mesh(new PlaneGeometry(radius * 1.4, 2.1), finMat);
      fin.position.set(0, radius * 0.28, -i * 1.15);
      fin.rotation.x = Math.PI / 2;
      group.add(fin);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    const scan = new Mesh(new PlaneGeometry(7.2, 0.04), scanMat);
    scan.position.set(0, -1.4 + i * 0.35, -12);
    group.add(scan);
  }
  const frame = sampleRailFrame(rail, railU(28));
  group.position.copy(frame.position).addScaledVector(frame.right, -1).addScaledVector(frame.up, 12);
  group.lookAt(group.position.clone().add(frame.tangent));
  group.scale.setScalar(2.3);
  group.userData.hologramSegments = segments;
  return group;
}

function createCrashBillboard() {
  const group = new Group();
  const frame = sampleRailFrame(rail, railU(CRASH_TIME));
  group.position.copy(frame.position).addScaledVector(frame.right, -14).addScaledVector(frame.up, 8);
  group.lookAt(group.position.clone().add(frame.tangent));
  const panel = new Mesh(new PlaneGeometry(26, 12), new MeshBasicMaterial({ color: new Color(0.008, 0.014, 0.024), transparent: true, opacity: 0.88, side: DoubleSide }));
  group.add(panel);
  for (const [word, y] of [['DELUGE', 2.5], ['PAY', -2.3]] as const) {
    for (let i = 0; i < word.length; i += 1) {
      const letter = createLetterMesh(word[i]);
      letter.position.set((i - word.length / 2) * 2.3, y, 0.12);
      letter.scale.setScalar(1.2);
      group.add(letter);
    }
  }
  group.userData.crashBillboard = true;
  group.visible = false;
  return group;
}

function createLightningBolt() {
  const pts: number[] = [];
  let x = -18;
  let y = 38;
  for (let i = 0; i < 11; i += 1) {
    const nx = x + 3 + Math.sin(i * 2.1) * 3.5;
    const ny = y - 6 - Math.cos(i) * 2;
    pts.push(x, y, -80, nx, ny, -80);
    x = nx;
    y = ny;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const bolt = new LineSegments(geo, new LineBasicMaterial({ color: hdr(WHITE, 1.7), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  bolt.frustumCulled = false;
  return bolt;
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
  rainMat.opacity = runTime > OUTRO_TIME ? Math.max(0, 0.42 * (1 - (runTime - OUTRO_TIME) / 6)) : runTime > TUBE_TIME && runTime < CANAL_TIME ? 0.12 : 0.48;

  for (const child of environment.traffic.children) {
    const mesh = child as Mesh;
    const baseU = mesh.userData.baseU as number;
    const phase = mesh.userData.phase as number;
    const laneOffset = mesh.userData.laneOffset as number;
    const height = mesh.userData.height as number;
    const laneSpeed = mesh.userData.speed as number;
    const u = (baseU + phase + elapsedNow * laneSpeed) % 1;
    const positiveU = u < 0 ? u + 1 : u;
    const frame = sampleRailFrame(rail, positiveU);
    mesh.position.copy(frame.position).addScaledVector(frame.right, laneOffset).addScaledVector(frame.up, height);
    mesh.lookAt(mesh.position.clone().addScaledVector(frame.tangent, laneSpeed >= 0 ? 1 : -1));
  }

  for (const light of environment.tubeLights) {
    const t = light.userData.time as number;
    const pulse = Math.max(0, 1 - Math.abs(runTime - t) / 0.18);
    const mat = light.material as MeshBasicMaterial;
    mat.opacity = 0.28 + pulse * 0.68;
    mat.color.copy(hdr(AMBER, 0.7 + pulse * 1.4));
  }

  const trainDt = runTime - TRAIN_PASS_TIME;
  environment.train.visible = trainDt > -1.0 && trainDt < 2.4;
  if (environment.train.visible) {
    const frame = sampleRailFrame(rail, railU(TRAIN_PASS_TIME));
    environment.train.position.copy(frame.position)
      .addScaledVector(frame.right, -5.4)
      .addScaledVector(frame.up, 0.2)
      .addScaledVector(frame.tangent, 36 - trainDt * 68);
    environment.train.lookAt(environment.train.position.clone().addScaledVector(frame.tangent, -1));
  }

  const segments = environment.hologram.userData.hologramSegments as Mesh[] | undefined;
  if (segments) {
    const frame = sampleRailFrame(rail, railU(27.5 + Math.sin(elapsedNow * 0.07) * 0.8));
    environment.hologram.position.copy(frame.position)
      .addScaledVector(frame.right, MathUtils.lerp(-13, 8, MathUtils.clamp((runTime - 25) / 8, 0, 1)))
      .addScaledVector(frame.up, 11 + Math.sin(elapsedNow * 0.45) * 1.2);
    environment.hologram.lookAt(environment.hologram.position.clone().add(frame.tangent));
    for (const segment of segments) {
      const i = segment.userData.index as number;
      segment.position.x = Math.sin(elapsedNow * 1.4 + i * 0.42) * 0.55;
      segment.position.y = Math.cos(elapsedNow * 1.1 + i * 0.33) * 0.28;
      segment.rotation.z = Math.sin(elapsedNow * 1.2 + i * 0.3) * 0.25;
    }
  }

  const strike = lightningIntensity(runTime);
  const flash = environment.lightning.material as MeshBasicMaterial;
  const visibleFlash = Math.max(flashUniform.value * 0.4, strike);
  flash.opacity = visibleFlash * 0.34;
  environment.lightning.position.copy(ctx.camera.position);
  const boltMat = environment.lightningBolt.material as LineBasicMaterial;
  boltMat.opacity = strike > 0.25 ? strike : 0;
  environment.lightningBolt.position.copy(ctx.camera.position).add(new Vector3(0, 0, -40));
  (environment.cityLights.material as PointsMaterial).opacity = 0.72 + strike * 0.28;

  environment.outroSky.visible = runTime > OUTRO_TIME - 2;
  if (environment.outroSky.visible) {
    const forward = new Vector3();
    ctx.camera.getWorldDirection(forward);
    const up = new Vector3(0, 1, 0).applyQuaternion(ctx.camera.quaternion).normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(ctx.camera.quaternion).normalize();
    environment.outroSky.position.copy(ctx.camera.position).addScaledVector(forward, 45).addScaledVector(up, 2).addScaledVector(right, -2);
    environment.outroSky.quaternion.copy(ctx.camera.quaternion);
  }

  environment.crashBillboard.visible = runTime > 92 && runTime < OUTRO_TIME + 2;
  if (environment.crashBillboard.visible) {
    const shudder = runTime > CRASH_TIME ? Math.sin(elapsedNow * 42) * 0.05 : 0;
    environment.crashBillboard.rotation.z = shudder;
  }

  environment.vultureGhost.visible = ctx.running && runTime >= VULTURE_TIME && runTime < OUTRO_TIME;
  if (environment.vultureGhost.visible) {
    const transform = vultureWorldTransform(runTime);
    environment.vultureGhost.position.copy(transform.position);
    environment.vultureGhost.quaternion.copy(transform.rotation);
    environment.vultureGhost.scale.setScalar(transform.scale);
    const charge = runTime >= PHASE2_TIME ? Math.max(0, Math.sin(runTime * 4.5)) : 0;
    environment.vultureGhost.userData.charge = charge;
    updateVultureAnimatedParts(environment.vultureGhost, dt, charge, ctx.camera);
  }

  environment.root.traverse((child) => {
    if (child.userData.cloud && child instanceof Mesh) {
      const phase = child.userData.phase as number;
      child.position.x += Math.sin(elapsedNow * 0.2 + phase) * dt * 0.35;
      const mat = child.material as MeshBasicMaterial;
      mat.opacity = Math.max(0.06, mat.opacity + Math.sin(elapsedNow * 0.6 + phase) * dt * 0.015);
    }
    if (child.userData.sign && child instanceof Group) {
      const buzz = 0.8 + Math.max(0, Math.sin(elapsedNow * 18 + child.id) - 0.75) * 0.8;
      child.scale.setScalar(child.scale.x * 0.98 + buzz * child.scale.x * 0.02);
    }
  });
}

function updateEnemyMesh(mesh: Group, dt: number, ctx: VisualContext) {
  const kind = mesh.userData.kind as string | undefined;
  if (ctx.runTime > OUTRO_TIME && (kind === 'bolt' || kind === 'flak' || kind === 'vultureCore')) {
    mesh.visible = false;
    return;
  }
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
    const gapY = mesh.userData.gapY as number | undefined ?? 99;
    const gapWidth = mesh.userData.gapWidth as number | undefined ?? 0;
    const hasGap = gapWidth > 0.1;
    for (const child of mesh.children) {
      if (child.userData.baseX !== undefined) child.visible = !hasGap || Math.abs((child.userData.baseX as number) - gapX) > gapWidth * 0.5;
      if (child.userData.baseY !== undefined) child.visible = !hasGap || Math.abs((child.userData.baseY as number) - gapY) > 1.65;
      if (child.userData.gapRim) {
        child.visible = hasGap;
        child.position.set(gapX, gapY, 0.08);
        child.scale.set(gapWidth / 3.2, 1, 1);
      }
    }
  }
  if (mesh.userData.kind === 'dropvan') {
    const unfold = mesh.userData.unfold as number | undefined ?? 0;
    for (const child of mesh.children) {
      if (child.userData.side !== undefined) child.rotation.z = (child.userData.side as number) * unfold * 0.9;
    }
  }
  if (kind === 'vultureCore') {
    if (ctx.runTime > OUTRO_TIME) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const charge = mesh.userData.charge as number | undefined ?? 0;
    const parts = mesh.userData.chargeParts as { core?: Mesh; glow?: Mesh } | undefined;
    if (parts?.core) parts.core.scale.setScalar(1 + charge * 0.1);
    if (parts?.glow) {
      parts.glow.scale.setScalar(1 + charge * 0.28);
      (parts.glow.material as MeshBasicMaterial).opacity = 0.08 + charge * 0.14;
    }
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
