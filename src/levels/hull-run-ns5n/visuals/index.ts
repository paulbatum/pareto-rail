import {
  AdditiveBlending, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, PlaneGeometry, RingGeometry,
  Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial, createPendingVisualRecords, createTransientEffectPool, disposeObject3D } from '../../../engine/visual-kit';
import { createHullRunNs5nRail } from '../gameplay';

const GUNMETAL = new Color(0x171b20);
const PLATE = new Color(0x2a3036);
const SHADOW = new Color(0x080a0c);
const ALERT = new Color(1.0, 0.08, 0.025);
const AMBER = new Color(1.0, 0.38, 0.055);
const HOT = new Color(1.0, 0.78, 0.32);
const TARGET = new Color(0.92, 0.88, 0.72);
const hdr = (color: Color, strength: number) => color.clone().multiplyScalar(strength);

type EnemyRecord = { mesh: Group; bornAt: number };
type Burst = { root: Group; life: number; age: number; color: Color; shards: Mesh[] };
type VisualContext = { scene: Scene; camera: Camera; elapsed: number };

const enemies = createPendingVisualRecords<Group, EnemyRecord, [number]>({ createRecord: (mesh, bornAt) => ({ mesh, bornAt }) });
const projectiles = createPendingVisualRecords<Object3D, Object3D>({ createRecord: (mesh) => mesh });
const bursts = createTransientEffectPool<Burst, VisualContext>({
  update(item, progress, dt, context) {
    item.root.quaternion.copy(context.camera.quaternion);
    item.root.scale.setScalar(0.25 + progress * 4.5);
    item.root.rotation.z += dt * 1.8;
    for (const shard of item.shards) {
      shard.position.multiplyScalar(1 + dt * 2.4);
      (shard.material as MeshBasicMaterial).opacity = 1 - progress;
    }
  },
  dispose(item, context) { context.scene.remove(item.root); disposeObject3D(item.root); },
});

let root: Group | null = null;
let wakeLights: InstancedMesh | null = null;
let elapsedNow = 0;
let runProgressNow = 0;
let beatEnergy = 0;

function flat(color: Color, transparent = false) {
  return new MeshBasicMaterial({ color, transparent, opacity: 1, side: DoubleSide });
}

function matrixAt(position: Vector3, scale: Vector3, tangent?: Vector3) {
  const dummy = new Object3D();
  dummy.position.copy(position);
  if (tangent) dummy.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), tangent.clone().normalize());
  dummy.scale.copy(scale);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = SHADOW;
  const environment = new Group();
  const curve = createHullRunNs5nRail();
  const deckEnd = 0.91;

  const slabGeometry = new BoxGeometry(1, 1, 1);
  const slabs = new InstancedMesh(slabGeometry, flat(GUNMETAL), 128);
  const seams = new InstancedMesh(new BoxGeometry(1, 1, 1), flat(PLATE), 256);
  const lights = new InstancedMesh(new BoxGeometry(1, 1, 1), createAdditiveBasicMaterial({ color: ALERT.clone() }), 128);
  const hatchFrames = new InstancedMesh(new BoxGeometry(1, 1, 1), flat(new Color(0x343a40)), 96);
  for (const detail of [seams, lights, hatchFrames]) detail.userData.raildIgnoreOcclusion = true;

  for (let i = 0; i < 128; i += 1) {
    const u = deckEnd * i / 127;
    const frame = sampleRailFrame(curve, u);
    const position = frame.position.clone().addScaledVector(frame.up, -4.15);
    slabs.setMatrixAt(i, matrixAt(position, new Vector3(38, 0.55, 12.5), frame.tangent));
    // Plate seams and welded longitudinal strips are deliberately close to the camera.
    for (let side = 0; side < 2; side += 1) {
      const seam = position.clone().addScaledVector(frame.right, side ? 11.8 : -11.8).addScaledVector(frame.up, 0.34);
      seams.setMatrixAt(i * 2 + side, matrixAt(seam, new Vector3(0.17, 0.12, 11.2), frame.tangent));
    }
  }

  for (let i = 0; i < 128; i += 1) {
    const u = 0.035 + deckEnd * i / 134;
    const frame = sampleRailFrame(curve, Math.min(deckEnd, u));
    const side = i % 2 ? 1 : -1;
    const position = frame.position.clone().addScaledVector(frame.right, side * (9.5 + (i % 3) * 2.4)).addScaledVector(frame.up, -3.48);
    lights.setMatrixAt(i, matrixAt(position, new Vector3(i % 4 === 0 ? 1.6 : 0.42, 0.12, 0.5), frame.tangent));
  }

  for (let i = 0; i < 48; i += 1) {
    const u = 0.055 + i * 0.0168;
    const frame = sampleRailFrame(curve, Math.min(deckEnd, u));
    const side = i % 2 ? 1 : -1;
    const position = frame.position.clone().addScaledVector(frame.right, side * (6 + (i % 4) * 2.7)).addScaledVector(frame.up, -3.48);
    hatchFrames.setMatrixAt(i * 2, matrixAt(position, new Vector3(3.2, 0.18, 4.8), frame.tangent));
    hatchFrames.setMatrixAt(i * 2 + 1, matrixAt(position.clone().addScaledVector(frame.up, 0.2), new Vector3(2.6, 0.08, 4.15), frame.tangent));
  }

  // Bulkhead ridges force the rail to hop without moving the horizon much.
  const ridgeGeometry = new BoxGeometry(1, 1, 1);
  const ridges = new InstancedMesh(ridgeGeometry, flat(new Color(0x30363c)), 8);
  [0.18, 0.31, 0.46, 0.59, 0.72, 0.82, 0.875, 0.9].forEach((u, i) => {
    const frame = sampleRailFrame(curve, u);
    ridges.setMatrixAt(i, matrixAt(frame.position.clone().addScaledVector(frame.up, -3.45), new Vector3(38, 1.15 + (i % 2) * 0.45, 4.6), frame.tangent));
  });

  // Eye-level masts: thin silhouettes that whip past, never large glowing areas.
  const mastPosts = new InstancedMesh(new CylinderGeometry(0.18, 0.32, 1, 6), flat(new Color(0x404850)), 30);
  const mastArms = new InstancedMesh(new BoxGeometry(1, 1, 1), flat(new Color(0x3a4148)), 30);
  mastPosts.userData.raildIgnoreOcclusion = true;
  mastArms.userData.raildIgnoreOcclusion = true;
  for (let i = 0; i < 30; i += 1) {
    const u = 0.06 + i * 0.0275;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 ? 1 : -1;
    const base = frame.position.clone().addScaledVector(frame.right, side * (13.5 + (i % 3))).addScaledVector(frame.up, 0.3);
    mastPosts.setMatrixAt(i, matrixAt(base, new Vector3(1, 7 + (i % 4) * 1.4, 1)));
    mastArms.setMatrixAt(i, matrixAt(base.clone().addScaledVector(frame.up, 4.4), new Vector3(5.5, 0.18, 0.2), frame.tangent));
  }

  // Bow lip and the giant turret socket are environmental silhouettes.
  const bow = sampleRailFrame(curve, 0.86);
  const turretSocket = new Mesh(new CylinderGeometry(9.5, 11, 2.6, 12), flat(new Color(0x272d33)));
  turretSocket.position.copy(bow.position).addScaledVector(bow.up, -2.8);
  const bowLip = new Mesh(new BoxGeometry(48, 3.4, 12), flat(new Color(0x22282d)));
  const lipFrame = sampleRailFrame(curve, 0.905);
  bowLip.position.copy(lipFrame.position).addScaledVector(lipFrame.up, -3.5);
  bowLip.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), lipFrame.tangent);

  environment.add(slabs, seams, lights, hatchFrames, ridges, mastPosts, mastArms, turretSocket, bowLip);
  scene.add(environment);
  root = environment;
  wakeLights = lights;
  lights.instanceColor = null;
  return environment;
}

export function disposeEnvironment() {
  if (root) { root.removeFromParent(); disposeObject3D(root); }
  root = null; wakeLights = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = (kind === 'letter' || letter) ? createLetter(letter ?? 'A') : createDefense(kind);
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

function enemyMaterials(accent = AMBER) {
  const shell = flat(new Color(0x3b4248));
  const dark = flat(new Color(0x0b0d0f));
  const core = createAdditiveBasicMaterial({ color: hdr(accent, 1.65) });
  shell.userData.baseColor = shell.color.clone(); dark.userData.baseColor = dark.color.clone(); core.userData.baseColor = core.color.clone();
  return { shell, dark, core, list: [shell, dark, core] };
}

function createDefense(kind: string) {
  const group = new Group();
  const accent = kind === 'shell' ? ALERT : kind === 'turret' ? HOT : AMBER;
  const m = enemyMaterials(accent);
  if (kind === 'skimmer') {
    const body = new Mesh(new OctahedronGeometry(0.62, 0), m.shell); body.scale.set(1.7, 0.45, 1);
    const wing = new Mesh(new BoxGeometry(3.2, 0.1, 0.65), m.dark);
    const core = new Mesh(new SphereGeometry(0.2, 8, 5), m.core); core.position.z = 0.55;
    group.add(body, wing, core);
  } else if (kind === 'sentry') {
    group.add(new Mesh(new CylinderGeometry(0.68, 0.9, 0.7, 8), m.shell));
    const gun = new Mesh(new BoxGeometry(0.28, 0.25, 2.2), m.dark); gun.position.z = 0.8;
    const eye = new Mesh(new RingGeometry(0.18, 0.29, 8), m.core); eye.position.z = 1.92;
    group.add(gun, eye);
  } else if (kind === 'interceptor') {
    const nose = new Mesh(new ConeGeometry(0.52, 2.4, 5), m.shell); nose.rotation.x = Math.PI / 2;
    const blades = new Mesh(new BoxGeometry(4.2, 0.1, 0.5), m.dark);
    const eye = new Mesh(new SphereGeometry(0.19, 7, 5), m.core); eye.position.z = 1.15;
    group.add(nose, blades, eye);
  } else if (kind === 'mine') {
    group.add(new Mesh(new IcosahedronGeometry(0.75, 0), m.shell));
    for (let i = 0; i < 3; i += 1) { const ring = new Mesh(new TorusGeometry(1 + i * 0.18, 0.045, 5, 20), i === 1 ? m.core : m.dark); ring.rotation.set(i * 0.7, i * 1.1, 0); group.add(ring); }
  } else if (kind === 'shell') {
    const core = new Mesh(new OctahedronGeometry(0.32, 0), m.core); core.scale.set(0.55, 0.55, 2.8);
    const tracer = new Mesh(new BoxGeometry(0.08, 0.08, 3.6), m.core); tracer.position.z = -1.8;
    group.add(core, tracer);
  } else {
    const base = new Mesh(new CylinderGeometry(5.4, 6.4, 2.8, 12), m.shell); base.rotation.x = Math.PI / 2;
    const cradle = new Mesh(new BoxGeometry(8.8, 4.2, 5.2), m.dark);
    const barrels = [-2.6, 0, 2.6].map((x) => { const barrel = new Mesh(new CylinderGeometry(0.38, 0.5, 11, 8), m.shell); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 0.9, 6); return barrel; });
    const ventLeft = new Mesh(new BoxGeometry(2.8, 3.4, 0.35), m.shell); ventLeft.position.set(-3.3, 0, 2.7);
    const ventRight = ventLeft.clone(); ventRight.position.x = 3.3;
    const furnace = new Mesh(new PlaneGeometry(5.4, 2.7), m.core); furnace.position.z = 2.76;
    group.add(base, cradle, ...barrels, furnace, ventLeft, ventRight);
    group.userData.vents = [ventLeft, ventRight]; group.userData.furnace = furnace; group.scale.setScalar(1.6);
  }
  group.userData.materials = m.list; group.userData.accent = accent; group.userData.kind = kind;
  return group;
}

function createLetter(character: string) {
  const group = new Group();
  const frameMaterial = flat(new Color(0x464d52));
  const cellMaterial = createAdditiveBasicMaterial({ color: hdr(AMBER, 1.4), side: DoubleSide });
  const coreMaterial = flat(HOT);
  frameMaterial.userData.baseColor = frameMaterial.color.clone(); cellMaterial.userData.baseColor = cellMaterial.color.clone(); coreMaterial.userData.baseColor = coreMaterial.color.clone();
  group.add(new Mesh(new BoxGeometry(1.95, 2.55, 0.15), frameMaterial));
  for (const cell of glyphOnCells(character)) {
    const lamp = new Mesh(new PlaneGeometry(0.2, 0.2), cellMaterial); lamp.position.set((cell.x - 2) * 0.31, (3 - cell.y) * 0.31, 0.1);
    const core = new Mesh(new PlaneGeometry(0.09, 0.09), coreMaterial); core.position.copy(lamp.position); core.position.z += 0.015;
    group.add(lamp, core);
  }
  group.userData.materials = [frameMaterial, cellMaterial, coreMaterial]; group.userData.accent = AMBER; group.userData.kind = 'letter';
  return group;
}

function tint(mesh: Object3D, color?: Color) {
  for (const material of (mesh.userData.materials as MeshBasicMaterial[] | undefined) ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? hdr(color, 1.8) : (base ?? TARGET));
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  tint(mesh, locked ? colorForLockCount(lockCount, [AMBER, HOT, ALERT]) : undefined);
}

export function setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = elapsedNow + 0.48; tint(mesh, ALERT); }

export function createProjectileMesh() {
  const group = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(HOT, 2.1) });
  const core = new Mesh(new OctahedronGeometry(0.2, 0), material); core.scale.set(0.6, 0.6, 3.2);
  const ring = new Mesh(new RingGeometry(0.36, 0.43, 6), material); group.add(core, ring);
  projectiles.enqueue(group); return group;
}

export function createReticle() {
  const group = new Group();
  const material = flat(HOT);
  const outer = new Mesh(new RingGeometry(0.64, 0.69, 4), material); outer.rotation.z = Math.PI / 4;
  const inner = new Mesh(new RingGeometry(0.28, 0.32, 16), material);
  const bars = [0, 1].map((i) => { const barMesh = new Mesh(new PlaneGeometry(i ? 0.05 : 1.75, i ? 1.75 : 0.05), material); return barMesh; });
  group.add(outer, inner, ...bars); return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active; reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.09 : 0));
}

function burst(scene: Scene, position: Vector3, color: Color, life = 0.42, count = 7) {
  const group = new Group(); group.position.copy(position);
  group.userData.raildIgnoreOcclusion = true;
  const shards: Mesh[] = [];
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.6) });
  const ring = new Mesh(new RingGeometry(0.92, 1, 24), material.clone()); group.add(ring);
  for (let i = 0; i < count; i += 1) {
    const shard = new Mesh(new PlaneGeometry(0.06, 0.52), material.clone());
    const angle = i / count * Math.PI * 2; shard.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, 0); shard.rotation.z = angle;
    shards.push(shard); group.add(shard);
  }
  scene.add(group); bursts.add({ root: group, life, age: 0, color, shards });
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => { enemies.claim(enemyId, elapsedNow); burst(scene, worldPosition, kind === 'turret' ? HOT : AMBER, kind === 'turret' ? 0.8 : 0.24, kind === 'turret' ? 14 : 5); });
  bus.on('lock', ({ worldPosition, lockCount }) => { burst(scene, worldPosition, colorForLockCount(lockCount, [AMBER, HOT, ALERT]), 0.2, 4); });
  bus.on('unlock', ({ worldPosition }) => { burst(scene, worldPosition, TARGET, 0.16, 3); });
  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => { projectiles.claim(projectileId); burst(scene, worldPosition, volleySize === 6 ? HOT : AMBER, volleySize === 6 ? 0.38 : 0.16, volleySize + 2); });
  bus.on('hit', ({ projectileId, worldPosition, stageCompleted }) => { projectiles.delete(projectileId); burst(scene, worldPosition, stageCompleted ? HOT : TARGET, stageCompleted ? 0.56 : 0.28, stageCompleted ? 12 : 6); });
  bus.on('stage', ({ worldPosition }) => { burst(scene, worldPosition, HOT, 0.75, 16); });
  bus.on('kill', ({ enemyId, worldPosition }) => { enemies.delete(enemyId); burst(scene, worldPosition, ALERT, 0.75, 18); burst(scene, worldPosition, HOT, 0.45, 10); });
  bus.on('miss', ({ enemyId, worldPosition }) => { enemies.delete(enemyId); burst(scene, worldPosition, ALERT, 0.2, 3); });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => { for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) { const record = enemies.get(id); if (record) burst(scene, record.mesh.position, ALERT, 0.32, 8); } });
  bus.on('playerhit', () => { beatEnergy = 1.8; });
  bus.on('beat', ({ isDownbeat }) => { beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.38); });
  bus.on('runstart', () => { enemies.clear(); projectiles.clear(); runProgressNow = 0; });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: Camera; elapsed: number; runProgress: number; running: boolean }) {
  elapsedNow = context.elapsed; if (context.running) runProgressNow = context.runProgress;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.2);
  if (wakeLights) {
    const material = wakeLights.material as MeshBasicMaterial;
    const wake = Math.min(1, runProgressNow * 2.4);
    material.color.copy(ALERT).lerp(AMBER, Math.max(0, runProgressNow - 0.48) * 1.7).multiplyScalar(0.35 + wake * 1.15 + beatEnergy * 0.22);
    material.opacity = 0.22 + wake * 0.78;
  }
  for (const record of enemies.values()) {
    const age = context.elapsed - record.bornAt;
    const intro = Math.min(1, age / (record.mesh.userData.kind === 'turret' ? 1.15 : 0.3));
    const denied = (record.mesh.userData.deniedUntil as number | undefined ?? -1) > context.elapsed;
    const locked = record.mesh.userData.locked === true;
    const baseScale = record.mesh.userData.kind === 'turret' ? 1.6 : 1;
    record.mesh.scale.setScalar(baseScale * intro * intro * (3 - 2 * intro) * (locked ? 1 + Math.sin(context.elapsed * 13) * 0.045 : 1));
    if (denied) tint(record.mesh, Math.floor(context.elapsed * 28) % 2 ? ALERT : TARGET); else if (!locked) tint(record.mesh);
    if (record.mesh.userData.kind === 'turret') {
      const vents = record.mesh.userData.vents as Mesh[];
      const open = record.mesh.userData.ventOpen === true;
      vents[0].rotation.y += ((open ? -1.05 : 0) - vents[0].rotation.y) * Math.min(1, dt * 8);
      vents[1].rotation.y += ((open ? 1.05 : 0) - vents[1].rotation.y) * Math.min(1, dt * 8);
      const furnace = record.mesh.userData.furnace as Mesh;
      furnace.visible = open; (furnace.material as MeshBasicMaterial).color.copy(HOT).multiplyScalar(open ? 2.2 + Math.sin(context.elapsed * 18) * 0.5 : 0.2);
    }
  }
  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 11);
  bursts.update(dt, context);
}
