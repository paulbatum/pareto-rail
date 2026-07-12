import {
  BoxGeometry,
  BufferGeometry,
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
  Vector3,
} from 'three';
import type { Camera, PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { colorForLockCount } from '../../../engine/locks';
import { disposeObject3D } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { createSkyhook9uibRail, SKYHOOK_9UIB_RUN_DURATION } from '../gameplay';

const PANEL = new Color(0xd8e0df);
const PANEL_DARK = new Color(0x59636a);
const ORANGE = new Color(0xff6a16);
const BLACK = new Color(0x05080c);
const STORM = new Color(0x3e4a52);
const BLUE = new Color(0x2c74a8);
const INDIGO = new Color(0x111936);
const SPACE = new Color(0x02050d);
const SUN = new Color(0xffc87a);

type EnemyVisual = { mesh: Group; born: number; locked: boolean; pulse: number; denied: number };
type Burst = { group: Group; age: number; life: number; velocity: Vector3 };
const pending: Group[] = [];
const enemies = new Map<number, EnemyVisual>();
const bursts: Burst[] = [];
let root: Group | null = null;
let climber: Group | null = null;
let tetherPulse: Mesh | null = null;
let sceneRef: Scene | null = null;
let now = 0;
let beat = 0;

const basic = (color: Color | number, options: { transparent?: boolean; opacity?: number; side?: typeof DoubleSide } = {}) =>
  new MeshBasicMaterial({ color, transparent: options.transparent, opacity: options.opacity, side: options.side });

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  sceneRef = scene;
  scene.background = STORM.clone();
  scene.fog = new Fog(STORM, 22, 135);
  root = new Group();
  // Slender tether hardware and atmospheric dressing should never make a
  // target mechanically unavailable when their silhouettes cross.
  root.userData.raildIgnoreOcclusion = true;
  const rail = createSkyhook9uibRail();

  // The tether is the single visual invariant through every atmosphere.
  const tetherPositions: number[] = [];
  for (let i = 0; i < 180; i += 1) {
    const a = rail.getPoint(i / 180);
    const b = rail.getPoint((i + 1) / 180);
    tetherPositions.push(a.x, a.y + 1.2, a.z, b.x, b.y + 1.2, b.z);
  }
  const tetherGeo = new BufferGeometry();
  tetherGeo.setAttribute('position', new Float32BufferAttribute(tetherPositions, 3));
  root.add(new LineSegments(tetherGeo, new LineBasicMaterial({ color: 0xd9dee0 })));

  // Orange maintenance collars stream downward as the car climbs.
  for (let i = 0; i < 52; i += 1) {
    const frame = sampleRailFrame(rail, i / 51);
    const collar = new Mesh(new TorusGeometry(2.6, 0.09, 5, 18), basic(i % 4 === 0 ? ORANGE : PANEL_DARK));
    collar.position.copy(frame.position).addScaledVector(frame.up, 1.2);
    collar.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), frame.tangent);
    collar.userData.stream = i;
    root.add(collar);
  }

  // Low weather: layered, matte cloud chunks around (never across) the rail.
  const cloudMaterial = basic(0xaab6ba, { transparent: true, opacity: 0.32 });
  for (let i = 0; i < 90; i += 1) {
    const u = (i * 0.0713) % 0.38;
    const frame = sampleRailFrame(rail, u);
    const angle = i * 2.39996;
    const radius = 18 + (i * 17) % 34;
    const cloud = new Mesh(new IcosahedronGeometry(3 + (i % 5) * 1.2, 1), cloudMaterial.clone());
    cloud.scale.set(2.6, 0.7 + (i % 3) * 0.18, 1.4);
    cloud.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (i % 9) * 3 - 12);
    cloud.userData.cloud = true;
    root.add(cloud);
  }

  // High atmosphere and orbit: restrained pin stars, not neon confetti.
  const stars = new Float32Array(520 * 3);
  for (let i = 0; i < 520; i += 1) {
    const u = 0.5 + ((i * 0.618033) % 1) * 0.5;
    const frame = sampleRailFrame(rail, u);
    const angle = i * 2.39996;
    const radius = 45 + (i * 31) % 115;
    const p = frame.position.clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (i * 13) % 100 - 50);
    stars.set([p.x, p.y, p.z], i * 3);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new Float32BufferAttribute(stars, 3));
  root.add(new Points(starGeo, new PointsMaterial({ color: 0xdce6ec, size: 0.32, transparent: true, opacity: 0.8, depthWrite: false })));

  // Planet limb: an enormous dim sphere falling away under the route.
  const planet = new Mesh(new SphereGeometry(590, 48, 24), basic(0x315f79));
  planet.position.set(0, -565, -520);
  planet.scale.z = 0.78;
  root.add(planet);
  const limb = new Mesh(new TorusGeometry(590, 1.4, 5, 96), basic(0x9fc6d2));
  limb.position.copy(planet.position);
  limb.rotation.x = Math.PI / 2;
  limb.scale.z = 0.78;
  root.add(limb);

  createStation(root, rail.getPoint(1));
  climber = createClimber();
  root.add(climber);

  tetherPulse = new Mesh(new RingGeometry(0.7, 0.78, 24), basic(ORANGE, { transparent: true, opacity: 0 }));
  root.add(tetherPulse);
  scene.add(root);
}

function createStation(parent: Group, position: Vector3) {
  const station = new Group();
  station.position.copy(position).add(new Vector3(0, 1, -14));
  for (let i = 0; i < 5; i += 1) {
    const ring = new Mesh(new TorusGeometry(9 + i * 2.8, 0.5, 6, 32), basic(i % 2 ? PANEL_DARK : PANEL));
    ring.position.z = -i * 5;
    station.add(ring);
  }
  const doorL = new Mesh(new BoxGeometry(10, 18, 1.2), basic(PANEL));
  doorL.position.set(-8, 0, -22);
  doorL.rotation.z = -0.18;
  const doorR = doorL.clone();
  doorR.position.x = 8;
  doorR.rotation.z = 0.18;
  station.add(doorL, doorR);
  for (const x of [-5.8, 5.8]) {
    const stripe = new Mesh(new BoxGeometry(0.7, 16, 1.3), basic(ORANGE));
    stripe.position.set(x, 0, -22.7);
    station.add(stripe);
  }
  parent.add(station);
}

function createClimber() {
  const car = new Group();
  const body = new Mesh(new BoxGeometry(6.8, 2.2, 5.8), basic(PANEL));
  const belly = new Mesh(new BoxGeometry(5.8, 0.7, 5.2), basic(PANEL_DARK));
  belly.position.y = -1.25;
  car.add(body, belly);
  for (const x of [-3.5, 3.5]) {
    const bumper = new Mesh(new BoxGeometry(0.5, 1.2, 6.4), basic(ORANGE));
    bumper.position.x = x;
    car.add(bumper);
  }
  const tetherPort = new Mesh(new CylinderGeometry(0.7, 0.7, 2.6, 8), basic(BLACK));
  tetherPort.rotation.x = Math.PI / 2;
  tetherPort.position.z = -2.8;
  car.add(tetherPort);
  return car;
}

export function disposeEnvironment() {
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  root = null;
  climber = null;
  tetherPulse = null;
  sceneRef = null;
  enemies.clear();
  pending.length = 0;
  bursts.length = 0;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createLetter(letter ?? 'A') : createEnemy(kind);
  mesh.scale.setScalar(0.001);
  pending.push(mesh);
  return mesh;
}

function createEnemy(kind: string) {
  const group = new Group();
  const panel = basic(PANEL);
  const dark = basic(PANEL_DARK);
  const hazard = basic(ORANGE);

  if (kind === 'sailwing') {
    const body = new Mesh(new ConeGeometry(0.36, 2.4, 5), dark);
    body.rotation.x = Math.PI / 2;
    const wingGeo = new BufferGeometry();
    wingGeo.setAttribute('position', new Float32BufferAttribute([-5, 0, 0, 0, 0.45, 0, 0, -0.45, 0, 5, 0, 0, 0, 0.45, 0, 0, -0.45, 0], 3));
    const wings = new Mesh(wingGeo, basic(0xb5bdbb, { side: DoubleSide }));
    const stripe = new Mesh(new BoxGeometry(3.2, 0.15, 0.16), hazard);
    group.add(body, wings, stripe);
  } else if (kind === 'grappler') {
    group.add(new Mesh(new BoxGeometry(1.7, 1.2, 1.9), panel));
    for (const x of [-1, 1]) {
      const arm = new Mesh(new CylinderGeometry(0.11, 0.11, 2.6, 6), dark);
      arm.rotation.z = x * 0.7;
      arm.position.set(x * 1.2, -0.8, 0);
      const hook = new Mesh(new TorusGeometry(0.42, 0.1, 5, 12, Math.PI * 1.4), hazard);
      hook.position.set(x * 2, -1.7, 0);
      group.add(arm, hook);
    }
  } else if (kind === 'orbiter') {
    group.add(new Mesh(new OctahedronGeometry(0.75, 0), panel));
    const ring = new Mesh(new TorusGeometry(1.25, 0.14, 5, 24), dark);
    ring.rotation.x = 0.8;
    const vane = new Mesh(new BoxGeometry(3.4, 0.16, 0.5), hazard);
    group.add(ring, vane);
  } else {
    // A tether-sized industrial arachnid: clamp jaws, three breakable decks,
    // and descending legs that make its silhouette readable from far away.
    const core = new Mesh(new CylinderGeometry(2.3, 2.8, 5.5, 8), dark);
    core.rotation.x = Math.PI / 2;
    group.add(core);
    for (let deck = 0; deck < 3; deck += 1) {
      const band = new Mesh(new TorusGeometry(3.2 + deck * 0.25, 0.35, 6, 18), deck === 1 ? hazard : panel);
      band.position.z = (deck - 1) * 1.8;
      group.add(band);
    }
    for (let i = 0; i < 6; i += 1) {
      const angle = i / 6 * Math.PI * 2;
      const leg = new Mesh(new BoxGeometry(0.45, 5.8, 0.6), i % 2 ? panel : hazard);
      leg.position.set(Math.cos(angle) * 4.5, Math.sin(angle) * 4.5, 0);
      leg.rotation.z = angle - Math.PI / 2;
      group.add(leg);
      const claw = new Mesh(new ConeGeometry(0.55, 2.3, 4), dark);
      claw.position.set(Math.cos(angle) * 7.1, Math.sin(angle) * 7.1, 0);
      claw.rotation.z = angle - Math.PI / 2;
      group.add(claw);
    }
    group.scale.setScalar(1.35);
  }
  group.userData.baseScale = group.scale.x;
  group.traverse((object) => {
    if (object instanceof Mesh) object.userData.baseColor = (object.material as MeshBasicMaterial).color.clone();
  });
  return group;
}

function createLetter(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const plate = new BoxGeometry(0.22, 0.22, 0.08);
  for (const cell of cells) {
    const block = new Mesh(plate, basic(PANEL));
    block.position.set((cell.x - 2) * 0.27, (3 - cell.y) * 0.27, 0);
    const tab = new Mesh(new BoxGeometry(0.08, 0.22, 0.1), basic(ORANGE));
    tab.position.copy(block.position).add(new Vector3(-0.08, 0, 0.02));
    group.add(block, tab);
  }
  group.add(new Mesh(new BoxGeometry(1.7, 2.2, 0.035), basic(0x263038, { transparent: true, opacity: 0.55 })));
  group.userData.baseScale = 1;
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  const record = [...enemies.values()].find((item) => item.mesh === mesh);
  if (record) record.locked = locked;
  const lockColor = colorForLockCount(lockCount);
  mesh.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshBasicMaterial;
    const base = object.userData.baseColor as Color | undefined;
    if (locked) material.color.setRGB(lockColor.r, lockColor.g, lockColor.b);
    else if (base) material.color.copy(base);
  });
}

export function setEnemyDenied(mesh: Object3D) {
  const record = [...enemies.values()].find((item) => item.mesh === mesh);
  if (record) record.denied = 1;
  mesh.scale.multiplyScalar(0.78);
}

export function createProjectileMesh() {
  const shot = new Group();
  const core = new Mesh(new OctahedronGeometry(0.16, 0), basic(PANEL));
  const tracer = new Mesh(new BoxGeometry(0.055, 0.055, 1.8), basic(ORANGE));
  tracer.position.z = 0.8;
  shot.add(core, tracer);
  return shot;
}

export function createReticle() {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.48, 0.53, 32), basic(PANEL, { transparent: true, opacity: 0.82 }));
  group.add(ring);
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.26, 0.035), basic(ORANGE));
    tick.position.x = 0.68;
    tick.rotation.z = i * Math.PI / 2;
    group.add(tick);
  }
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? Math.sin(now * 12) * 0.03 : 0));
  reticle.rotation.z = active ? now * 0.35 : 0;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId }) => {
    const mesh = pending.shift();
    if (mesh) enemies.set(enemyId, { mesh, born: now, locked: false, pulse: 1, denied: 0 });
  });
  bus.on('lock', ({ enemyId }) => { const item = enemies.get(enemyId); if (item) item.pulse = 1; });
  bus.on('unlock', ({ enemyId }) => { const item = enemies.get(enemyId); if (item) item.pulse = 0.5; });
  bus.on('fire', ({ worldPosition, targetPosition }) => spawnBurst(scene, worldPosition.clone().lerp(targetPosition, 0.25), ORANGE, 0.22, 4));
  bus.on('hit', ({ worldPosition, stageCompleted }) => spawnBurst(scene, worldPosition, stageCompleted ? SUN : PANEL, 0.42, stageCompleted ? 12 : 6));
  bus.on('kill', ({ enemyId, worldPosition }) => {
    spawnBurst(scene, worldPosition, ORANGE, 0.9, enemyId ? 18 : 10);
    enemies.delete(enemyId);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    spawnBurst(scene, worldPosition, PANEL_DARK, 0.6, 5);
    enemies.delete(enemyId);
  });
  bus.on('reject', () => { beat = -1; });
  bus.on('beat', ({ isDownbeat }) => { beat = isDownbeat ? 1 : 0.45; });
  bus.on('playerhit', () => { beat = -1.5; });
}

function spawnBurst(scene: Scene, position: Vector3, color: Color, life: number, count: number) {
  const group = new Group();
  group.position.copy(position);
  for (let i = 0; i < count; i += 1) {
    const shard = new Mesh(new BoxGeometry(0.06, 0.06, 0.65 + (i % 4) * 0.22), basic(color));
    const angle = i * 2.39996;
    shard.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0);
    shard.rotation.z = angle;
    shard.userData.dir = new Vector3(Math.cos(angle), Math.sin(angle), (i % 3 - 1) * 0.35);
    group.add(shard);
  }
  scene.add(group);
  bursts.push({ group, age: 0, life, velocity: new Vector3() });
}

export function updateVisuals(dt: number, context: { camera: PerspectiveCamera; runTime: number; running: boolean }) {
  now += dt;
  const progress = context.running ? MathUtils.clamp(context.runTime / SKYHOOK_9UIB_RUN_DURATION, 0, 1) : 0.12;
  beat *= Math.exp(-dt * 5);

  if (sceneRef) {
    const sky = atmosphereColor(progress);
    if (sceneRef.background instanceof Color) sceneRef.background.copy(sky);
    if (sceneRef.fog instanceof Fog) {
      sceneRef.fog.color.copy(sky);
      sceneRef.fog.near = MathUtils.lerp(22, 75, progress);
      sceneRef.fog.far = MathUtils.lerp(130, 360, progress);
    }
  }

  if (climber) {
    climber.position.copy(context.camera.position);
    climber.quaternion.copy(context.camera.quaternion);
    climber.translateY(-3.4);
    climber.translateZ(-2.1);
    climber.rotation.z += Math.sin(now * 2.2) * 0.004;
  }
  if (tetherPulse) {
    tetherPulse.position.copy(context.camera.position);
    tetherPulse.quaternion.copy(context.camera.quaternion);
    tetherPulse.translateZ(-8);
    tetherPulse.scale.setScalar(1 + Math.max(0, beat) * 0.35);
    (tetherPulse.material as MeshBasicMaterial).opacity = Math.max(0, beat) * 0.35;
  }

  for (const item of enemies.values()) {
    item.pulse *= Math.exp(-dt * 8);
    item.denied *= Math.exp(-dt * 5);
    const base = item.mesh.userData.baseScale ?? 1;
    const born = MathUtils.smoothstep(now - item.born, 0, 0.24);
    item.mesh.scale.setScalar(base * born * (1 + item.pulse * 0.13 - item.denied * 0.2));
  }

  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const burst = bursts[i];
    burst.age += dt;
    const p = burst.age / burst.life;
    burst.group.children.forEach((child) => {
      const dir = child.userData.dir as Vector3;
      child.position.addScaledVector(dir, dt * 8 * (1 - p * 0.5));
      child.scale.setScalar(Math.max(0.001, 1 - p));
    });
    if (p >= 1) {
      burst.group.removeFromParent();
      disposeObject3D(burst.group);
      bursts.splice(i, 1);
    }
  }
}

function atmosphereColor(progress: number) {
  if (progress < 0.27) return STORM.clone().lerp(BLUE, MathUtils.smoothstep(progress, 0.08, 0.27));
  if (progress < 0.58) return BLUE.clone().lerp(INDIGO, MathUtils.smoothstep(progress, 0.27, 0.58));
  return INDIGO.clone().lerp(SPACE, MathUtils.smoothstep(progress, 0.58, 0.84));
}
