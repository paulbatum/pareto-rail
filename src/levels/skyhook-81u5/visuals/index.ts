import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Float32BufferAttribute,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';

/** The elevator is deliberately matte: warning paint and white work lights, not neon. */
const SPACE = new Color(0.004, 0.007, 0.015);
const STORM = new Color(0.12, 0.17, 0.23);
const CLOUD = new Color(0.58, 0.66, 0.72);
const ORANGE = new Color(1.0, 0.27, 0.025);
const SAFETY = new Color(0.95, 0.56, 0.08);
const WORK_WHITE = new Color(0.92, 0.96, 1.0);
const STEEL = new Color(0.22, 0.27, 0.32);
const DARK_STEEL = new Color(0.055, 0.075, 0.1);

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type EnemyRecord = { mesh: Group; kind: string; locked: boolean };
type Burst = { group: Group; age: number; duration: number; origin: Vector3; color: Color };
type Streak = { mesh: Mesh; speed: number; offset: number };

const enemyQueue: EnemyRecord[] = [];
const enemyById = new Map<number, EnemyRecord>();
const bursts: Burst[] = [];
const streaks: Streak[] = [];
const flashMaterials: Array<{ material: MeshBasicMaterial; base: Color }> = [];
let environmentRoot: Group | null = null;
let elapsedNow = 0;
let beatLift = 0;
let impactFlash = 0;
let bossWarning = 0;
let currentStage = 0;

const matte = (color: Color | number, opacity = 1) => new MeshLambertMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
});
const unlit = (color: Color | number, opacity = 1) => new MeshBasicMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: opacity >= 1,
});

const mergeParts = (parts: BufferGeometry[]) => mergeGeometries(parts.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry))!;

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = SPACE;

  const root = new Group();
  root.name = 'skyhook-environment';
  root.add(new AmbientLight(0x8ca6c5, 1.35));
  root.add(createPlanet());
  root.add(createTether());
  root.add(createClimberCar());
  root.add(createStationMouth());
  root.add(createCloudDeck());
  root.add(createSpeedCues());
  root.add(createStarfield());
  root.add(createStartReplaySigns());
  scene.add(root);
  environmentRoot = root;
  return root;
}

export function disposeEnvironment() {
  for (const burst of bursts) burst.group.removeFromParent();
  bursts.length = 0;
  streaks.length = 0;
  flashMaterials.length = 0;
  enemyQueue.length = 0;
  enemyById.clear();
  if (!environmentRoot) return;
  environmentRoot.removeFromParent();
  disposeTree(environmentRoot);
  environmentRoot = null;
}

function createPlanet() {
  const group = new Group();
  group.name = 'planet-limb';
  const world = new Mesh(new SphereGeometry(115, 32, 20), matte(new Color(0.035, 0.12, 0.28)));
  world.position.set(0, -116, -112);
  group.add(world);
  const limb = new Mesh(new TorusGeometry(114.8, 0.55, 10, 64, Math.PI * 0.78), unlit(new Color(0.23, 0.48, 0.74), 0.52));
  limb.position.copy(world.position);
  limb.rotation.x = Math.PI * 0.5;
  group.add(limb);
  return group;
}

function createTether() {
  const group = new Group();
  group.name = 'tether-rig';
  group.userData.raildIgnoreOcclusion = true;
  // A pair of very long cables makes the player visibly ride between them.
  for (const x of [-2.9, 2.9]) {
    const cable = new Mesh(new CylinderGeometry(0.08, 0.08, 230, 6), matte(DARK_STEEL));
    cable.position.set(x, 0, -104);
    cable.rotation.x = Math.PI * 0.5;
    group.add(cable);
    for (let z = -8; z > -218; z -= 12) {
      const band = new Mesh(new BoxGeometry(0.18, 0.34, 0.38), matte(SAFETY));
      band.position.set(x, 0, z);
      group.add(band);
    }
  }
  for (let z = -12; z > -215; z -= 12) {
    const brace = new Mesh(new BoxGeometry(5.95, 0.07, 0.12), matte(STEEL));
    brace.position.set(0, -0.8, z);
    group.add(brace);
  }
  return group;
}

function createClimberCar() {
  const car = new Group();
  car.name = 'climber-car';
  car.position.set(0, -4.55, -10.2);
  car.scale.setScalar(0.62);
  const shell = new Mesh(new BoxGeometry(5.2, 2.65, 4.2), matte(WORK_WHITE));
  car.add(shell);
  const window = new Mesh(new PlaneGeometry(2.5, 0.68), unlit(new Color(0.08, 0.16, 0.24)));
  window.position.set(0, 0.35, -2.111);
  car.add(window);
  for (const x of [-2.15, 2.15]) {
    const rail = new Mesh(new BoxGeometry(0.45, 3.5, 4.5), matte(STEEL));
    rail.position.set(x, 0.55, 0);
    car.add(rail);
  }
  for (let x = -1.75; x <= 1.75; x += 0.7) {
    const stripe = new Mesh(new BoxGeometry(0.35, 0.48, 0.035), unlit(ORANGE));
    stripe.position.set(x, -0.78, -2.13);
    stripe.rotation.z = -0.6;
    car.add(stripe);
  }
  const lamp = new Mesh(new BoxGeometry(0.32, 0.15, 0.08), unlit(WORK_WHITE));
  lamp.position.set(0, 1.12, -2.15);
  car.add(lamp);
  return car;
}

function createStationMouth() {
  const station = new Group();
  station.name = 'station-mouth';
  station.position.set(0, 0, -215);
  const ring = new Mesh(new TorusGeometry(13, 1.1, 8, 16), matte(STEEL));
  station.add(ring);
  const voidMouth = new Mesh(new CircleGeometry(11.8, 24), unlit(new Color(0.002, 0.003, 0.006)));
  voidMouth.position.z = 0.2;
  station.add(voidMouth);
  for (let i = 0; i < 8; i += 1) {
    const arm = new Mesh(new BoxGeometry(1.1, 5.2, 1), matte(WORK_WHITE));
    const a = (i / 8) * Math.PI * 2;
    arm.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    arm.rotation.z = a;
    station.add(arm);
  }
  return station;
}

function createCloudDeck() {
  const clouds = new Group();
  clouds.name = 'cloud-deck';
  for (let i = 0; i < 42; i += 1) {
    const cloud = new Mesh(new SphereGeometry(1, 10, 7), matte(i % 4 === 0 ? STORM : CLOUD, 0.2));
    const side = i % 2 === 0 ? -1 : 1;
    cloud.position.set(side * (4 + (i * 7) % 23), -2 + ((i * 13) % 14), -18 - i * 4.3);
    cloud.scale.set(4 + (i % 5), 1.2 + (i % 3) * 0.55, 2.4 + (i % 4));
    clouds.add(cloud);
  }
  return clouds;
}

function createSpeedCues() {
  const group = new Group();
  for (let i = 0; i < 58; i += 1) {
    const streak = new Mesh(new BoxGeometry(0.028, 0.028, 3.5 + (i % 5) * 1.6), unlit(i % 7 === 0 ? WORK_WHITE : new Color(0.24, 0.36, 0.5), 0.5));
    streak.position.set(((i * 19) % 35) - 17.5, ((i * 11) % 20) - 8, -12 - ((i * 17) % 155));
    group.add(streak);
    streaks.push({ mesh: streak, speed: 23 + (i % 7) * 5, offset: i * 0.91 });
  }
  return group;
}

function createStarfield() {
  const count = 420;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.399963;
    const radius = 18 + ((i * 47) % 130);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = -22 - ((i * 31) % 180);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const stars = new Points(geometry, new PointsMaterial({ color: WORK_WHITE, size: 0.22, transparent: true, opacity: 0.82, depthWrite: false }));
  stars.name = 'starfield';
  stars.visible = false;
  return stars;
}

function createStartReplaySigns() {
  const signs = new Group();
  signs.add(createWord('START', new Vector3(-8.2, 8.5, -42), 0.31));
  signs.add(createWord('REPLAY', new Vector3(-9.6, 6.25, -42), 0.24));
  signs.userData.isSignage = true;
  return signs;
}

function createWord(word: string, position: Vector3, scale: number) {
  const group = new Group();
  const cell = new BoxGeometry(1, 1, 0.09);
  let cursor = 0;
  for (const character of word) {
    for (const bit of glyphOnCells(character)) {
      const block = new Mesh(cell, unlit(WORK_WHITE));
      block.position.set(cursor + bit.x * scale, -bit.y * scale, 0);
      group.add(block);
    }
    cursor += 6 * scale;
  }
  group.position.copy(position);
  return group;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const enemy = letter ? createLetterMesh(letter) : buildEnemy(kind);
  enemy.userData.kind = kind;
  enemy.userData.locked = false;
  enemyQueue.push({ mesh: enemy, kind, locked: false });
  return enemy;
}

function buildEnemy(kind: string) {
  switch (kind) {
    case 'kite': return createKite();
    case 'clamp': return createClamp();
    case 'sentinel': return createSentinel();
    case 'boss': return createBoss();
    case 'debris': return createDebris();
    default: return createDebris();
  }
}

function createKite() {
  const group = new Group();
  const parts: BufferGeometry[] = [new ConeGeometry(0.54, 1.65, 4).rotateX(Math.PI * 0.5)];
  for (const side of [-1, 1]) {
    parts.push(new ConeGeometry(0.15, 2.8, 3)
      .rotateX(Math.PI * 0.5).rotateZ(side * Math.PI * 0.55).translate(side * 0.95, 0, 0.18));
  }
  group.add(new Mesh(mergeParts(parts), matte(WORK_WHITE)));
  return group;
}

function createClamp() {
  const group = new Group();
  const parts: BufferGeometry[] = [new BoxGeometry(1.35, 0.82, 0.82)];
  for (const side of [-1, 1]) {
    parts.push(new BoxGeometry(0.3, 1.7, 0.42).rotateZ(side * 0.55).translate(side * 0.93, -0.62, 0));
    parts.push(new ConeGeometry(0.28, 0.55, 4).rotateZ(side * Math.PI * 0.5).translate(side * 1.28, -1.38, 0));
  }
  group.add(new Mesh(mergeParts(parts), matte(STEEL)));
  return group;
}

function createSentinel() {
  const group = new Group();
  const parts: BufferGeometry[] = [
    new IcosahedronGeometry(0.86, 1),
    new TorusGeometry(0.92, 0.15, 6, 12).rotateX(Math.PI * 0.5),
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = i * Math.PI * 0.5;
    parts.push(new BoxGeometry(0.78, 0.18, 0.42).rotateZ(a).translate(Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0));
  }
  parts.push(new SphereGeometry(0.22, 10, 6));
  group.add(new Mesh(mergeParts(parts), matte(WORK_WHITE)));
  return group;
}

function createBoss() {
  const group = new Group();
  const parts: BufferGeometry[] = [new CylinderGeometry(0.7, 1.05, 5.2, 8).rotateZ(Math.PI * 0.5)];
  for (let i = 0; i < 7; i += 1) {
    parts.push(new BoxGeometry(0.62, 1.7, 1.15).translate(-2.5 + i * 0.82, 0, 0));
  }
  for (const x of [-2.05, -0.7, 0.7, 2.05]) {
    for (const side of [-1, 1]) {
      parts.push(new BoxGeometry(1.2, 0.18, 0.22).rotateZ(side * 0.53).translate(x, side * 1.0, 0));
    }
  }
  group.add(new Mesh(mergeParts(parts), matte(STEEL)));
  const eye = new Mesh(new RingGeometry(0.35, 0.52, 12), unlit(ORANGE));
  eye.rotation.y = Math.PI;
  eye.position.z = 0.62;
  group.add(eye);
  group.scale.setScalar(3.1);
  return group;
}

function createDebris() {
  const group = new Group();
  const geometry = mergeParts([
    new IcosahedronGeometry(0.62, 0),
    new BoxGeometry(0.22, 0.92, 0.16).rotateZ(0.7),
  ]);
  group.add(new Mesh(geometry, matte(STEEL)));
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  const record = enemyQueue.find((candidate) => candidate.mesh === mesh) ?? [...enemyById.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.locked = locked;
  mesh.scale.setScalar(locked ? 1.13 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  mesh.scale.set(1.35, 0.72, 1.35);
}

export function createProjectileMesh() {
  const group = new Group();
  const dart = new Mesh(new ConeGeometry(0.11, 0.9, 5), unlit(WORK_WHITE));
  dart.rotation.x = Math.PI * 0.5;
  group.add(dart);
  const tail = new Mesh(new CylinderGeometry(0.025, 0.08, 1.4, 5), unlit(new Color(0.62, 0.78, 1.0), 0.62));
  tail.rotation.x = Math.PI * 0.5;
  tail.position.z = 0.65;
  group.add(tail);
  return group;
}

export function createReticle() {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.64, 0.69, 32), unlit(WORK_WHITE, 0.84));
  group.add(ring);
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new BoxGeometry(0.22, 0.045, 0.02), unlit(SAFETY));
    const a = i * Math.PI * 0.5;
    tick.position.set(Math.cos(a) * 0.88, Math.sin(a) * 0.88, 0);
    tick.rotation.z = a;
    group.add(tick);
  }
  group.userData.ring = ring;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.08 : 0));
  const ring = reticle.userData.ring as Mesh | undefined;
  if (ring) (ring.material as MeshBasicMaterial).color.copy(active ? SAFETY : WORK_WHITE);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyQueue.shift();
    if (record) enemyById.set(enemyId, record);
    if (kind === 'boss') bossWarning = 1;
    addBurst(scene, worldPosition, kind === 'boss' ? ORANGE : WORK_WHITE, kind === 'boss' ? 3.7 : 1.1, 0.32);
  });
  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyById.get(enemyId);
    if (record) record.locked = true;
    addBurst(scene, worldPosition, lockCount > 3 ? SAFETY : WORK_WHITE, 1.05, 0.22);
  });
  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyById.get(enemyId);
    if (record) record.locked = false;
    addBurst(scene, worldPosition, new Color(0.38, 0.52, 0.7), 0.72, 0.18);
  });
  bus.on('fire', ({ worldPosition }) => addBurst(scene, worldPosition, WORK_WHITE, 0.35, 0.12));
  bus.on('hit', ({ enemyId, projectileId: _projectileId, worldPosition, lethal }) => {
    const record = enemyById.get(enemyId);
    if (record) record.mesh.userData.hitUntil = elapsedNow + 0.2;
    addBurst(scene, worldPosition, lethal ? ORANGE : WORK_WHITE, lethal ? 2.0 : 0.82, 0.28);
    impactFlash = Math.max(impactFlash, lethal ? 0.68 : 0.3);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyById.get(enemyId);
    const color = record?.kind === 'sentinel' ? SAFETY : ORANGE;
    enemyById.delete(enemyId);
    addBurst(scene, worldPosition, color, 2.7, 0.48);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyById.delete(enemyId);
    addBurst(scene, worldPosition, new Color(0.26, 0.35, 0.44), 1.1, 0.32);
  });
  bus.on('reject', ({ enemyIds }) => {
    for (const enemyId of enemyIds) {
      const record = enemyById.get(enemyId);
      if (record) record.mesh.userData.deniedUntil = elapsedNow + 0.42;
    }
  });
  bus.on('beat', ({ isDownbeat }) => { beatLift = Math.max(beatLift, isDownbeat ? 1 : 0.35); });
  bus.on('playerhit', () => { impactFlash = 1; });
  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    currentStage = stageIndex;
    const record = enemyById.get(enemyId);
    if (record) record.mesh.userData.stageUntil = elapsedNow + 0.45;
    addBurst(scene, worldPosition, SAFETY, 2.1, 0.34);
  });
  bus.on('bossphase', ({ phase }) => {
    bossWarning = phase === 'destroyed' ? 0.2 : 1;
    if (phase === 'destroyed') addBurst(scene, new Vector3(0, 0, -24), ORANGE, 5, 0.8);
  });
}

function addBurst(scene: Scene, position: Vector3, color: Color, size: number, duration: number) {
  // Lock volleys can emit several events in one frame. Keep the effects rig
  // bounded so a long run never turns transient hardware sparks into a scene
  // graph leak.
  while (bursts.length >= 12) {
    const oldest = bursts.shift();
    if (!oldest) break;
    oldest.group.removeFromParent();
    disposeTree(oldest.group);
  }
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.72, 0.81, 20), unlit(color, 0.9));
  group.add(ring);
  for (let i = 0; i < 2; i += 1) {
    const shard = new Mesh(new BoxGeometry(0.06, 0.06, 0.7), unlit(color, 0.85));
    shard.rotation.set((i * 0.7) % 2, i * 1.1, i * 0.43);
    shard.position.set(((i % 3) - 1) * 0.35, (Math.floor(i / 3) - 0.5) * 0.4, 0);
    group.add(shard);
  }
  group.position.copy(position);
  scene.add(group);
  bursts.push({ group, age: 0, duration, origin: position.clone(), color: color.clone() });
  void size;
  group.scale.setScalar(size);
}

export function updateVisuals(dt: number, context: VisualContext) {
  elapsedNow = context.elapsed;
  beatLift = Math.max(0, beatLift - dt * 2.3);
  impactFlash = Math.max(0, impactFlash - dt * 2.8);
  bossWarning = Math.max(0, bossWarning - dt * 0.18);

  const ascent = Math.min(1, context.runTime / 50);
  const blue = new Color(0.24, 0.49, 0.76);
  const indigo = new Color(0.055, 0.08, 0.19);
  const sky = context.runTime < 15
    ? new Color().lerpColors(STORM, CLOUD, context.runTime / 15)
    : context.runTime < 28
      ? new Color().lerpColors(blue, indigo, (context.runTime - 15) / 13)
      : new Color().lerpColors(indigo, SPACE, Math.min(1, (context.runTime - 28) / 15));
  context.scene.background = sky;
  if (environmentRoot) {
    // The rail is a genuine kilometer-scale Y climb. This rig is the elevator
    // car's local view of the hardware and sky around it; enemies remain in
    // world/rail space while these immediate references ride with the camera.
    environmentRoot.position.copy(context.camera.position);
    environmentRoot.quaternion.copy(context.camera.quaternion);
    const cloudDeck = environmentRoot.getObjectByName('cloud-deck');
    if (cloudDeck) {
      cloudDeck.visible = context.runTime < 19;
      for (const cloud of cloudDeck.children) {
        cloud.position.z += dt * (18 + ascent * 34);
        if (cloud.position.z > 7) cloud.position.z -= 190;
      }
    }
    const stars = environmentRoot.getObjectByName('starfield');
    if (stars) stars.visible = context.runTime > 27;
    const planet = environmentRoot.getObjectByName('planet-limb');
    if (planet) {
      planet.visible = context.runTime > 25;
      planet.position.y = -28 - Math.min(55, Math.max(0, context.runTime - 25) * 1.6);
    }
    const station = environmentRoot.getObjectByName('station-mouth');
    if (station) {
      station.visible = !context.running || context.runTime > 45;
      station.position.z = -215 + Math.max(0, context.runTime - 45) / 15 * 188;
      station.rotation.z += dt * 0.035;
    }
    const sign = environmentRoot.children.find((child) => child.userData.isSignage === true);
    if (sign) sign.visible = !context.running;
  }
  for (const streak of streaks) {
    if (!context.running) continue;
    streak.mesh.position.z += dt * streak.speed * (0.7 + beatLift * 0.45);
    if (streak.mesh.position.z > 6) streak.mesh.position.z = -175 - streak.offset % 25;
    // Alternate near/far lanes once the cloud deck falls away; this preserves
    // speed without filling orbital black with a uniform curtain.
    streak.mesh.visible = ascent > 0.12 && Math.round(streak.offset / 0.91) % 2 === 0;
  }
  for (const record of enemyById.values()) {
    const { mesh } = record;
    const denied = (mesh.userData.deniedUntil as number | undefined) ?? -1;
    const hit = (mesh.userData.hitUntil as number | undefined) ?? -1;
    const stage = (mesh.userData.stageUntil as number | undefined) ?? -1;
    const pulse = elapsedNow < denied ? 0.75 + Math.sin(elapsedNow * 44) * 0.26 : 1;
    mesh.scale.setScalar(record.locked ? 1.13 * pulse : pulse);
    mesh.rotation.z += dt * (record.kind === 'kite' ? 1.2 : 0.32);
    if (elapsedNow < hit || elapsedNow < stage) mesh.rotation.y += dt * 8;
  }
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const burst = bursts[i];
    burst.age += dt;
    const t = burst.age / burst.duration;
    burst.group.scale.multiplyScalar(1 + dt * 4.4);
    for (const child of burst.group.children) {
      const material = (child as Mesh).material as MeshBasicMaterial;
      material.opacity = Math.max(0, 0.86 * (1 - t));
    }
    if (t >= 1) {
      burst.group.removeFromParent();
      disposeTree(burst.group);
      bursts.splice(i, 1);
    }
  }
  // Briefly brighten physical work lights on impacts; the palette stays restrained.
  for (const item of flashMaterials) item.material.color.copy(item.base).multiplyScalar(1 + impactFlash * 0.6 + bossWarning * 0.2);
  void currentStage;
}

function createLetterMesh(character: string) {
  const group = new Group();
  const geometry = new BoxGeometry(0.24, 0.24, 0.12);
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(geometry, matte(WORK_WHITE));
    block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    group.add(block);
  }
  group.add(new Mesh(new TorusGeometry(0.98, 0.045, 6, 20), matte(SAFETY)));
  return group;
}

function disposeTree(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
