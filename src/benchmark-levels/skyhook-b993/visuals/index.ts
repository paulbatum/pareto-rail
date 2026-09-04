import { BoxGeometry, Color, DoubleSide, Fog, Group, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { EventBus } from '../../../events';
import { createPendingVisualRecords } from '../../../engine/visual-kit';
import { BOSS_TIME, climbSpeed, climbZ, type ClimbState } from '../gameplay';
import { buildEnemy, buildLetter, block, ring, type Palette } from './models';
import { buildEnvironment, paintSky } from './environment';

export const PALETTE: Palette = { white: 0xd8ddd7, shadow: 0x535b5d, orange: 0xc97832, dark: 0x202a31, steel: 0x8b979a, lamp: 0xead7a1, ocean: 0x244e68, land: 0x5f786c, cloud: 0xc0ccd0, atmosphere: 0x809eac, stars: 0xc4c9ca, streak: 0xa3afad };
const SKY_KEYS = [
  { t: 0, zenith: 0x273843, horizon: 0x87969b, cloud: 0x819096 },
  { t: 11, zenith: 0x3b566c, horizon: 0xb1bfc0, cloud: 0xb7c4c6 },
  { t: 16, zenith: 0x226299, horizon: 0xaac3c9, cloud: 0xd0d8d3 },
  { t: 28, zenith: 0x132641, horizon: 0x607786, cloud: 0x9baeb8 },
  { t: 38, zenith: 0x030812, horizon: 0x192a3b, cloud: 0x72818b },
  { t: 54, zenith: 0x010306, horizon: 0x0a1420, cloud: 0x606974 },
];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function disposeObject(object: Object3D) {
  const disposed = new Set();
  object.traverse(child => {
    if (!(child instanceof Mesh)) return;
    if (!disposed.has(child.geometry)) { child.geometry.dispose(); disposed.add(child.geometry); }
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) if (!disposed.has(m)) { m.dispose(); disposed.add(m); }
  });
  object.removeFromParent();
}
export function createEnemyMesh(kind: string, letter?: string) {
  return kind === 'letter' || letter ? buildLetter(letter ?? 'A', PALETTE) : buildEnemy(kind, PALETTE);
}
export function createSkyhookVisuals(bus: EventBus, scene: Scene, camera: PerspectiveCamera) {
  const env = buildEnvironment(PALETTE); scene.add(env.root);
  const looming = buildEnemy('harvester', PALETTE); env.root.add(looming); looming.visible = false;
  scene.background = new Color(SKY_KEYS[0].horizon);
  const fog = new Fog(SKY_KEYS[0].horizon, 25, 150); scene.fog = fog;
  let now = 0, beat = 0, shake = 0, recoil = 0, lastCarHits = 0, paintAt = -1, stationLight = 0.45;
  const records = createPendingVisualRecords<Object3D, Object3D>({ createRecord: m => m, disposeRecord: disposeObject });
  const projectiles = new Set<Object3D>();
  const effects: Array<{ mesh: Mesh; age: number; life: number; size: number; velocity?: Vector3 }> = [];
  const listeners: Array<() => void> = [];
  function pulse(position: Vector3, size: number, color = PALETTE.orange, life = 0.45) {
    const m = new Mesh(new RingGeometry(0.87, 1, 32), new MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: DoubleSide }));
    m.position.copy(position); m.quaternion.copy(camera.quaternion); scene.add(m);
    effects.push({ mesh: m, age: 0, life, size });
  }
  function burst(position: Vector3, count: number, force: number) {
    for (let i = 0; i < count; i++) {
      const m = new Mesh(new BoxGeometry(0.14, 0.32, 0.08), new MeshBasicMaterial({ color: i % 3 ? PALETTE.white : PALETTE.orange, transparent: true, depthWrite: false }));
      m.position.copy(position); scene.add(m);
      const a = i * 2.39996;
      effects.push({ mesh: m, age: 0, life: 0.7 + (i % 4) * 0.15, size: 1, velocity: new Vector3(Math.cos(a) * force, Math.sin(a) * force, force * (0.3 + (i % 3) * 0.2)) });
    }
  }
  listeners.push(bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const mesh = records.claim(enemyId); if (mesh) { mesh.userData.kind = kind; mesh.userData.born = now; }
    pulse(worldPosition, kind === 'harvester' ? 12 : 2.7, PALETTE.white, 0.5);
  }));
  listeners.push(bus.on('lock', ({ worldPosition, lockCount }) => { pulse(worldPosition, 1.5 + lockCount * 0.1, PALETTE.lamp, 0.22); }));
  listeners.push(bus.on('unlock', ({ worldPosition }) => pulse(worldPosition, 1.7, PALETTE.steel, 0.2)));
  listeners.push(bus.on('fire', ({ worldPosition, volleySize }) => { pulse(worldPosition, 0.45, PALETTE.lamp, 0.12); recoil = Math.max(recoil, volleySize * 0.017); }));
  listeners.push(bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    const mesh = records.get(enemyId); if (mesh) mesh.userData.flashUntil = now + 0.12;
    burst(worldPosition, lethal ? 7 : 4, lethal ? 7 : 4);
    pulse(worldPosition, lethal ? 3.2 : 1.8, PALETTE.lamp, 0.25);
  }));
  listeners.push(bus.on('stage', ({ enemyId, worldPosition }) => { if (records.get(enemyId)?.userData.kind === 'harvester') { burst(worldPosition, 18, 13); pulse(worldPosition, 12, PALETTE.orange, 0.7); shake = 0.08; } }));
  listeners.push(bus.on('kill', ({ enemyId, worldPosition }) => {
    const m = records.get(enemyId);
    if (m?.userData.kind === 'harvester') { burst(worldPosition, 54, 24); pulse(worldPosition, 35, PALETTE.lamp, 1.8); pulse(worldPosition, 19, PALETTE.orange, 1.2); shake = 0.2; }
    else pulse(worldPosition, 3.7, PALETTE.orange, 0.4);
    records.delete(enemyId, { dispose: true });
  }));
  listeners.push(bus.on('miss', ({ enemyId, worldPosition }) => { pulse(worldPosition, 2.7, 0x954f36, 0.3); records.delete(enemyId, { dispose: true }); }));
  listeners.push(bus.on('reject', () => { recoil = 0.15; shake = 0.045; }));
  listeners.push(bus.on('volley', ({ size }) => { if (size === 6) { beat = 1; recoil = 0.15; } }));
  listeners.push(bus.on('beat', ({ isDownbeat }) => { beat = Math.max(beat, isDownbeat ? 0.4 : 0.15); }));
  listeners.push(bus.on('playerhit', () => { shake = 0.14; }));
  listeners.push(bus.on('runstart', () => { lastCarHits = 0; shake = 0; recoil = 0; records.clear({ dispose: true, pending: true }); for (const e of effects) disposeObject(e.mesh); effects.length = 0; }));
  const sight = new Group();
  ring(sight, 0.65, 0.065, PALETTE.dark, 40);
  ring(sight, 0.6, 0.027, PALETTE.white, 40);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const b = block(sight, [0.22, 0.065, 0.04], [Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0], PALETTE.white); b.rotation.z = a;
  }
  const ammo = new Group();
  for (let i = 0; i < 6; i++) { const a = -Math.PI * 0.75 + i * Math.PI / 10; const m = block(ammo, [0.13, 0.1, 0.03], [Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0], PALETTE.orange); m.visible = false; }
  sight.add(ammo);
  return {
    factories: {
      createEnemyMesh(kind: string, letter?: string) { const m = createEnemyMesh(kind, letter); records.enqueue(m); return m; },
      setEnemyLocked(mesh: Object3D, locked: boolean) { mesh.userData.locked = locked; },
      setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = now + 0.45; pulse(mesh.position, 3.4, 0xb64f30, 0.35); },
      createProjectileMesh() {
        const g = new Group(); block(g, [0.08, 0.08, 1.6], [0, 0, 0], new Color(1.6, 1.4, 1)); block(g, [0.22, 0.22, 0.25], [0, 0, 0], PALETTE.white);
        projectiles.add(g); return g;
      },
      createReticle() { return sight; },
      setReticleActive(reticle: Object3D, active: boolean, count: number) {
        reticle.scale.setScalar(active ? 0.93 + count * 0.025 : 1);
        ammo.children.forEach((m, i) => { m.visible = i < count; });
      },
    },
    update(dt: number, elapsed: number, time: number, running: boolean, state: ClimbState) {
      now = elapsed; beat = Math.max(0, beat - dt * 2.5); recoil = Math.max(0, recoil - dt * 0.65); shake = Math.max(0, shake - dt * 0.26);
      const t = time;
      looming.visible = t >= 29 && t < BOSS_TIME;
      looming.position.set(0, 4.8, climbZ(t) - (230 - clamp((t - 29) / 7) * 154));
      env.sky.position.copy(camera.position);
      env.stars.position.copy(camera.position);
      env.stars.material.opacity = clamp((t - 25) / 12) * 0.8;
      if (now - paintAt > 0.08) {
        paintAt = now;
        let a = SKY_KEYS[0], b = SKY_KEYS[1];
        for (let i = 1; i < SKY_KEYS.length; i++) { a = SKY_KEYS[i - 1]; b = SKY_KEYS[i]; if (t < b.t) break; }
        const f = clamp((t - a.t) / (b.t - a.t));
        const zenith = new Color(a.zenith).lerp(new Color(b.zenith), f), horizon = new Color(a.horizon).lerp(new Color(b.horizon), f);
        paintSky(env, { zenith, horizon, cloud: new Color(a.cloud).lerp(new Color(b.cloud), f), ocean: new Color(0x24485b) });
        fog.color.copy(horizon); (scene.background as Color).copy(horizon);
      }
      fog.near = 22 + clamp((t - 14) / 15) * 500;
      fog.far = 145 + clamp((t - 12) / 23) * 2100;
      const orbit = clamp((t - 12) / 29);
      const radius = 2500 - orbit * 1950;
      env.planet.visible = t > 11;
      env.planet.scale.setScalar(radius);
      env.planet.position.copy(camera.position).add(new Vector3(0, -radius - 170 + orbit * 80, -740));
      env.planet.rotation.z = -0.13;
      env.planet.rotation.y = t * 0.0009;
      env.limb.visible = t > 20;
      env.limb.position.copy(env.planet.position); env.limb.position.z += 10;
      env.limb.scale.setScalar(radius * 1.009);
      env.clouds.visible = t < 29;
      env.clouds.material.opacity = (0.65 + Math.sin(t * 0.7) * 0.05) * (1 - clamp((t - 18) / 10));
      env.clouds.position.copy(camera.position);
      const motion = running ? climbZ(t) : -elapsed * 6;
      for (let i = 0; i < env.clouds.count; i++) {
        const a = i * 2.39996, r = 28 + (i % 11) * 5;
        env.scratch.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.6, -210 + ((i * 13.47 - motion * 1.9) % 250));
        env.scratch.scale.set(9 + i % 9, 2.1 + i % 4, 5 + i % 6); env.scratch.rotation.set(i, i * 0.3, 0); env.scratch.updateMatrix(); env.clouds.setMatrixAt(i, env.scratch.matrix);
      }
      env.clouds.instanceMatrix.needsUpdate = true;
      env.streaks.position.copy(camera.position); env.streaks.material.opacity = t < 18 ? 0.27 : 0.12;
      env.streaks.visible = t < 58;
      for (let i = 0; i < env.streaks.count; i++) {
        const a = i * 2.39996, r = 13 + i % 28;
        env.scratch.position.set(Math.cos(a) * r, Math.sin(a) * r, -130 + ((i * 7.37 - motion * 3) % 150));
        env.scratch.scale.setScalar(0.5 + i % 3 * 0.3); env.scratch.rotation.set(Math.PI / 2, 0, 0); env.scratch.updateMatrix(); env.streaks.setMatrixAt(i, env.scratch.matrix);
      }
      env.streaks.instanceMatrix.needsUpdate = true;
      env.car.position.copy(camera.position); env.car.position.y -= recoil;
      env.car.rotation.z = Math.sin(elapsed * 18) * shake;
      stationLight = t < 36 ? 0.45 : state.bossDead ? Math.min(1, stationLight + dt * 0.3) : 0.24;
      env.station.traverse(child => {
        if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) return;
        child.userData.stationBase ??= child.material.color.clone();
        child.material.color.copy(child.userData.stationBase as Color).multiplyScalar(stationLight);
      });
      env.doors.forEach((door, i) => { door.position.x = (i === 0 ? -1 : 1) * (9.5 + clamp((t - 51.5) / 5) * 20); });
      env.lamps.forEach((lamp, i) => (lamp.material as MeshBasicMaterial).color.set(i < state.carHull ? PALETTE.orange : PALETTE.dark));
      if (state.carHits > lastCarHits) { lastCarHits = state.carHits; shake = 0.2; burst(camera.position.clone().add(new Vector3(0, -3.3, -5)), 20, 6); }
      for (const [id, mesh] of records.entries()) {
        if (!mesh.parent) { records.delete(id, { dispose: true }); continue; }
        const denied = mesh.userData.deniedUntil > now, flash = mesh.userData.flashUntil > now;
        const accent = mesh.userData.accent as Group | undefined;
        accent?.traverse(child => {
          if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) return;
          if (!child.userData.originalColor) child.userData.originalColor = child.material.color.clone();
          child.material.color.copy(child.userData.originalColor as Color);
          if (denied) child.material.color.set(0xb54425);
          else if (flash || mesh.userData.locked) child.material.color.set(PALETTE.lamp).multiplyScalar(1.25);
        });
        if (mesh.userData.kind === 'harvester') {
          const mechanism = mesh.userData.mechanism as Group;
          mechanism.children.forEach(leg => { leg.rotation.z = Math.sin(t * 3.4 + Number(leg.userData.phase)) * 0.12; leg.position.z = Math.sin(t * 3.4 + Number(leg.userData.phase)) * 1.7; });
          mesh.traverse(child => { if (typeof child.userData.armorStage === 'number') child.visible = child.userData.armorStage >= state.bossStage; });
          (mesh.userData.iris as Mesh).visible = mesh.userData.shielded === true;
        }
      }
      for (const m of projectiles) if (!m.parent) { disposeObject(m); projectiles.delete(m); }
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]; e.age += dt;
        if (e.age >= e.life) { disposeObject(e.mesh); effects.splice(i, 1); continue; }
        const p = e.age / e.life;
        (e.mesh.material as MeshBasicMaterial).opacity = 1 - p;
        if (e.velocity) { e.mesh.position.addScaledVector(e.velocity, dt); e.velocity.z += dt * 18; e.mesh.rotation.z += dt * 4; }
        else { e.mesh.scale.setScalar(e.size * (0.4 + p)); e.mesh.quaternion.copy(camera.quaternion); }
      }
    },
    cameraEffects(time: number) {
      camera.rotateZ(Math.sin(now * 21) * shake * 0.08);
      const fov = 60 + (climbSpeed(time) - 0.7) * 4 + beat * 0.4;
      if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix(); }
    },
    dispose() {
      listeners.forEach(off => off()); records.clear({ dispose: true, pending: true });
      for (const p of projectiles) disposeObject(p);
      for (const e of effects) disposeObject(e.mesh);
      disposeObject(env.root); disposeObject(sight); scene.fog = null;
    },
  };
}
