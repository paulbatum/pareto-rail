import { BoxGeometry, Color, Group, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Scene, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import { climbSpeed } from '../gameplay';
import { buildEnvironment } from './environment';
import { makeHardware, makeLetter, paint, panel, ring } from './hardware';

// Sky owns the color. Hardware has four finishes: enamel, hazard paint,
// carbon and bare steel. Orange never becomes a neon emissive wash.
const WHITE = 0xbcc5c0, ORANGE = 0xd16b25, DARK = 0x202a30, STEEL = 0x6d7c83;
const HOT = new Color(1.7, 1.04, 0.45);
const SKY_KEYS: Array<[number, number, number]> = [[0, 0x303c47, 0x77848b], [10, 0x566674, 0xacb4b2], [16, 0x1e74b7, 0x7faccc], [25, 0x123657, 0x6c9eb6], [34, 0x080f24, 0x27395c], [44, 0x02040a, 0x0a1320], [60, 0x010309, 0x03060a]];
type TargetRecord = { mesh: Group; rim: Group; indicator: MeshBasicMaterial; denied: number; born: number; locked: boolean; kind: string };
const targets = new Map<number, TargetRecord>();
const pending: TargetRecord[] = [];
let now = 0;
let flash = 0;
let energy = 0;
let environment: ReturnType<typeof buildEnvironment> | null = null;
let shards: InstancedMesh | null = null;
const particles: Array<{ p: Vector3; v: Vector3; age: number; life: number; scale: number; color: Color }> = [];
const pulses: Array<{ mesh: Mesh<RingGeometry, MeshBasicMaterial>; age: number; life: number; size: number }> = [];
const pulseGeometry = new RingGeometry(0.95, 1, 48);
const dummy = new Object3D();

export function createEnvironment(scene: Scene) {
  targets.clear(); pending.length = 0; particles.length = 0; pulses.length = 0; now = 0; flash = 0;
  environment = buildEnvironment(scene, { white: paint(WHITE), orange: paint(ORANGE), dark: paint(DARK), steel: paint(STEEL), cloudColor: 0x71828c, ocean: 0x235d79, land: 0x698c76, atmosphere: 0x619cbd, cloudCount: 130, starCount: 1200 });
  shards = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: WHITE }), 240);
  shards.count = 0; shards.frustumCulled = false; scene.add(shards);
}
function brackets(g: Group, m: MeshBasicMaterial, radius: number) {
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    panel(g, m, [0.5, 0.07, 0.08], [x * (radius - 0.2), y * radius, 0]);
    panel(g, m, [0.07, 0.5, 0.08], [x * radius, y * (radius - 0.2), 0]);
  }
}
export function createEnemyMesh(kind: string, letter?: string) {
  const white = paint(WHITE), orange = paint(ORANGE), dark = paint(DARK), steel = paint(STEEL);
  const mesh = kind === 'letter' ? makeLetter(letter ?? 'A', white, orange, dark) : makeHardware(kind, white, orange, dark, steel);
  const indicator = paint(HOT);
  const rim = new Group(); rim.name = 'target-brackets';
  brackets(rim, indicator, kind === 'tether-eater' ? 3.5 : kind === 'letter' ? 1.3 : kind === 'kite' ? 2.65 : 2.35);
  rim.position.z = kind === 'tether-eater' ? 2.6 : 1;
  rim.visible = false; mesh.add(rim);
  const rec: TargetRecord = { mesh, rim, indicator, denied: -100, born: now, locked: false, kind };
  mesh.userData.skyhook = rec; pending.push(rec);
  return mesh;
}
export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  const rec = mesh.userData.skyhook as TargetRecord | undefined;
  if (!rec) return;
  rec.locked = locked; rec.rim.visible = locked; rec.indicator.color.copy(HOT);
  rec.rim.scale.setScalar(1 + Math.min(6, lockCount) * 0.018);
}
export function setEnemyDenied(mesh: Object3D) {
  const rec = mesh.userData.skyhook as TargetRecord | undefined;
  if (!rec) return;
  rec.denied = now; rec.rim.visible = true; rec.indicator.color.set(0xef4e2c);
}
export function createProjectileMesh() {
  const g = new Group();
  panel(g, paint(HOT), [0.1, 0.1, 0.8], [0, 0, 0]);
  panel(g, paint(WHITE), [0.24, 0.24, 0.15], [0, 0, 0.4]);
  return g;
}
export function createReticle() {
  const g = new Group(), material = paint(WHITE);
  brackets(g, material, 0.42);
  ring(g, paint(DARK), 0.48, 0.025);
  const pips = new Group(); pips.name = 'pips';
  for (let i = 0; i < 6; i++) panel(pips, paint(ORANGE), [0.1, 0.11, 0.05], [(i - 2.5) * 0.15, -0.66, 0]);
  g.add(pips); g.userData.material = material; return g;
}
export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const m = reticle.userData.material as MeshBasicMaterial; m.color.set(active ? HOT : WHITE);
  reticle.scale.setScalar(1 + energy * 0.025 + (lockCount === 6 ? 0.12 : 0));
  reticle.getObjectByName('pips')?.children.forEach((p, i) => { p.visible = i < lockCount; });
}
function pulse(scene: Scene, position: Vector3, color: Color | number, size: number, life: number) {
  const mesh = new Mesh(pulseGeometry, new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
  mesh.position.copy(position); scene.add(mesh); pulses.push({ mesh, age: 0, life, size });
}
function burst(position: Vector3, count: number, color: Color | number, force = 1) {
  for (let i = 0; i < count && particles.length < 240; i++) {
    const a = i * 2.399 + now, r = 3 + (i % 7);
    particles.push({ p: position.clone(), v: new Vector3(Math.cos(a) * r, Math.sin(a) * r, ((i % 5) - 1) * 2).multiplyScalar(force), age: 0, life: 0.6 + (i % 5) * 0.1, scale: 0.12 + (i % 3) * 0.06, color: new Color(color) });
  }
}
export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  const off = [
    bus.on('spawn', ({ enemyId, worldPosition }) => { const rec = pending.shift(); if (rec) targets.set(enemyId, rec); pulse(scene, worldPosition, ORANGE, 2.3, 0.32); }),
    bus.on('lock', ({ worldPosition, lockCount }) => { pulse(scene, worldPosition, HOT, 1.2 + lockCount * 0.05, 0.22); energy = Math.max(energy, 0.25); }),
    bus.on('unlock', ({ worldPosition }) => pulse(scene, worldPosition, STEEL, 1.5, 0.18)),
    bus.on('fire', ({ worldPosition, volleySize, indexInVolley }) => { burst(worldPosition, 3, WHITE); if ((indexInVolley ?? 0) === 0) { energy = volleySize === 6 ? 1 : 0.3; flash = volleySize === 6 ? 0.1 : 0.025; } }),
    bus.on('hit', ({ enemyId, worldPosition, lethal }) => { pulse(scene, worldPosition, HOT, lethal ? 2.5 : 1.8, 0.25); if (!lethal) burst(worldPosition, 8, ORANGE); const rec = targets.get(enemyId); if (rec) rec.mesh.userData.hitFlash = now; }),
    bus.on('kill', ({ enemyId, worldPosition }) => { const rec = targets.get(enemyId); const boss = rec?.kind === 'tether-eater'; burst(worldPosition, boss ? 100 : 18, WHITE, boss ? 3 : 1); burst(worldPosition, boss ? 40 : 5, ORANGE); pulse(scene, worldPosition, WHITE, boss ? 22 : 3.5, boss ? 1.8 : 0.45); if (boss) { flash = 0.25; energy = 1.3; } targets.delete(enemyId); }),
    bus.on('miss', ({ enemyId, worldPosition }) => { if (targets.get(enemyId)?.kind === 'limpet') { flash = 0.14; energy = 0.9; burst(worldPosition, 24, ORANGE); } pulse(scene, worldPosition, 0xad5030, 2, 0.4); targets.delete(enemyId); }),
    bus.on('stage', ({ worldPosition }) => { burst(worldPosition, 22, ORANGE, 1.5); pulse(scene, worldPosition, HOT, 6, 0.5); energy = 0.6; }),
    bus.on('reject', () => { flash = 0.045; energy = 0.5; }),
    bus.on('playerhit', () => { flash = 0.17; energy = 0.7; }),
    bus.on('beat', ({ isDownbeat }) => { energy = Math.max(energy, isDownbeat ? 0.18 : 0.08); }),
    bus.on('runstart', () => { targets.clear(); pending.length = 0; particles.length = 0; pulses.forEach((p) => { scene.remove(p.mesh); p.mesh.material.dispose(); }); pulses.length = 0; }),
  ];
  return () => off.forEach((stop) => stop());
}
export function updateVisuals(dt: number, elapsed: number, time: number, running: boolean, camera: PerspectiveCamera, status: { impactTime: number; integrity: number; bossDead: boolean }) {
  now = elapsed; flash *= Math.exp(-dt * 6); energy *= Math.exp(-dt * 5);
  const env = environment; if (!env) return;
  const t = running || time > 0 ? time : 0;
  let a = SKY_KEYS[0], b = SKY_KEYS[1];
  for (let i = 1; i < SKY_KEYS.length; i++) { a = SKY_KEYS[i - 1]; b = SKY_KEYS[i]; if (t <= b[0]) break; }
  const blend = MathUtils.smoothstep(t, a[0], b[0]);
  const top = new Color(a[1]).lerp(new Color(b[1]), blend), bottom = new Color(a[2]).lerp(new Color(b[2]), blend);
  const skyPos = env.skyGeometry.attributes.position, skyColor = env.skyGeometry.attributes.color;
  for (let i = 0; i < skyPos.count; i++) {
    const f = MathUtils.clamp(skyPos.getY(i) / 900 + 0.5, 0, 1);
    const c = bottom.clone().lerp(top, f); c.addScalar(flash * 0.15);
    skyColor.setXYZ(i, c.r, c.g, c.b);
  }
  skyColor.needsUpdate = true; env.sky.position.copy(camera.position); env.stars.position.copy(camera.position);
  (env.stars.material as import('three').PointsMaterial).opacity = MathUtils.smoothstep(t, 25, 39);
  const cloudFade = 1 - MathUtils.smoothstep(t, 16, 25);
  env.clouds.visible = cloudFade > 0.001;
  env.clouds.material.opacity = cloudFade * (t > 12 && t < 16 ? 0.24 : 0.18);
  env.clouds.material.color.copy(new Color(0x596977).lerp(new Color(0xd6e3e7), MathUtils.smoothstep(t, 7, 16)));
  env.cloudData.forEach((p, i) => {
    p.z += dt * (running ? 17 * climbSpeed(t) : 2); if (p.z > 30) p.z -= 210;
    dummy.position.copy(camera.position).add(new Vector3(p.x, p.y, p.z)); dummy.scale.set(p.sx, p.sy, p.sz); dummy.rotation.set(0, i, 0); dummy.updateMatrix(); env.clouds.setMatrixAt(i, dummy.matrix);
  }); env.clouds.instanceMatrix.needsUpdate = true;
  env.planet.visible = t > 21;
  env.planet.position.copy(camera.position).add(new Vector3(-170, -590 - MathUtils.smoothstep(t, 20, 48) * 65, -600));
  env.planet.rotation.z = -0.22; env.planet.rotation.y = t * 0.002;
  env.planet.scale.setScalar(MathUtils.lerp(1.25, 1, MathUtils.smoothstep(t, 20, 44)));
  env.skin.rotation.y = t * 0.005;
  env.car.position.copy(camera.position); env.car.quaternion.copy(camera.quaternion); env.car.position.y -= 1.3;
  const hit = running && time - status.impactTime < 0.5;
  env.car.position.x += hit ? Math.sin(elapsed * 60) * 0.13 : 0;
  env.station.visible = t > 29;
  const open = status.bossDead ? MathUtils.smoothstep(t, 50, 54) : MathUtils.smoothstep(t, 53, 55);
  const left = env.station.getObjectByName('door-left'), right = env.station.getObjectByName('door-right');
  if (left) left.position.x = -open * 13; if (right) right.position.x = open * 13;
  env.debris.visible = running && t < 55;
  for (let i = 0; i < 60; i++) {
    const z = ((elapsed * (22 + i % 5) + i * 31) % 180) - 150;
    dummy.position.copy(camera.position).add(new Vector3(Math.sin(i * 47) * 26, Math.cos(i * 61) * 22, z));
    dummy.scale.set(0.035, 0.035, t < 22 ? 2.3 : 0.9); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); env.debris.setMatrixAt(i, dummy.matrix);
  } env.debris.instanceMatrix.needsUpdate = true;
  for (const [id, rec] of targets) {
    if (!rec.mesh.parent) { targets.delete(id); continue; }
    const denied = now - rec.denied < 0.32;
    rec.rim.visible = rec.locked || denied;
    rec.rim.scale.setScalar(1 + (denied ? Math.sin(elapsed * 60) * 0.07 : Math.sin(elapsed * 8) * 0.018));
    if (!denied) rec.indicator.color.copy(HOT);
    rec.rim.traverse((o) => { if (o instanceof Mesh) (o.material as MeshBasicMaterial).color.copy(rec.indicator.color); });
    if (rec.kind === 'tether-eater') {
      const age = Number(rec.mesh.userData.bossAge ?? 0), damage = Number(rec.mesh.userData.bossDamage ?? 0);
      rec.mesh.children.filter((o) => o.name === 'gripper').forEach((o, i) => { o.position.z = -0.8 + Math.sin(age * 2 + i * Math.PI / 3) * 1.2; });
      rec.mesh.children.filter((o) => o.name === 'phase-lamp').forEach((o, i) => { o.visible = i >= Math.floor(damage / 6); });
      if (rec.mesh.userData.phaseWaiting) rec.indicator.color.set(STEEL);
      rec.rim.rotation.z = damage > 24 ? Math.sin(elapsed * 16) * 0.03 : 0;
    }
  }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i]; p.age += dt;
    if (p.age >= p.life) { p.mesh.removeFromParent(); p.mesh.material.dispose(); pulses.splice(i, 1); continue; }
    p.mesh.quaternion.copy(camera.quaternion); p.mesh.scale.setScalar(p.size * (0.25 + p.age / p.life)); p.mesh.material.opacity = 0.8 * (1 - p.age / p.life);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.age += dt;
    if (p.age > p.life) { particles.splice(i, 1); continue; }
    p.p.addScaledVector(p.v, dt); p.v.y -= dt * 3;
  }
  if (shards) {
    shards.count = particles.length;
    particles.forEach((p, i) => { dummy.position.copy(p.p); dummy.scale.setScalar(p.scale * (1 - p.age / p.life)); dummy.rotation.set(p.age * 3, i, p.age * 2); dummy.updateMatrix(); shards!.setMatrixAt(i, dummy.matrix); shards!.setColorAt(i, p.color); });
    shards.instanceMatrix.needsUpdate = true; if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
  }
}
export function disposeVisuals() {
  environment = null; shards = null; targets.clear(); pending.length = 0; particles.length = 0;
  for (const p of pulses) { p.mesh.removeFromParent(); p.mesh.material.dispose(); } pulses.length = 0;
}
