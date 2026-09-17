import { Color, DoubleSide, FogExp2, Group, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, PerspectiveCamera, RingGeometry, Scene, Vector3 } from 'three';
import type { EventBus } from '../../../events';
import { JEWELS, ROSE_Z } from '../gameplay';
import { buildCathedral } from './architecture';
import { buildThief } from './models';

const IVORY = 0xe3d9bd;
const STONE = 0x15171f;
const ringGeometry = new RingGeometry(0.9, 1, 48);
const shardGeometry = new OctahedronGeometry(0.18, 0);
type Effect = { mesh: Mesh; age: number; life: number; velocity: Vector3; from?: Vector3; to?: Vector3; radius: number };
export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus) {
  const cathedral = buildCathedral(JEWELS, ROSE_Z, STONE); scene.add(cathedral.root);
  scene.fog = new FogExp2(0x020309, 0.007);
  const pending: Group[] = [], records = new Map<number, Group>();
  const effects: Effect[] = [];
  const allocated = new Set<Object3D>();
  let elapsed = 0, runTime = 0, running = false, roseLight = 0, won = false, pulse = 0, flash = 0;
  let bossId = -1;
  const off: Array<() => void> = [];
  function effect(position: Vector3, color: Color | number, radius = 2, life = 0.65, velocity?: Vector3, to?: Vector3) {
    if (effects.length >= 220) return;
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(velocity || to ? shardGeometry : ringGeometry, mat); mesh.position.copy(position); scene.add(mesh);
    effects.push({ mesh, age: 0, life, radius, velocity: velocity ?? new Vector3(), from: to ? position.clone() : undefined, to });
  }
  function burst(position: Vector3, color: Color | number, count: number, size = 1) {
    effect(position, color, size * 3, 0.7);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996;
      effect(position, color, size, 0.65 + i % 4 * 0.13, new Vector3(Math.cos(angle) * (2 + i % 5), Math.sin(angle) * (2 + i % 5), Math.sin(i * 4) * 2).multiplyScalar(size));
    }
  }
  function tint(mesh?: Group) { return new Color(JEWELS[Number(mesh?.userData.tint ?? 0)]).multiplyScalar(1.8); }
  function clearEffects() { for (const e of effects) { scene.remove(e.mesh); (e.mesh.material as MeshBasicMaterial).dispose(); } effects.length = 0; }
  off.push(bus.on('runstart', () => {
    running = true; runTime = 0; won = false; roseLight = 0; bossId = -1; records.clear(); pending.length = 0; clearEffects();
    for (const pane of cathedral.panes) { pane.restored = false; pane.goal = pane.value = 0.6; }
  }));
  off.push(bus.on('runend', () => { running = false; }));
  off.push(bus.on('spawn', e => {
    const mesh = pending.shift(); if (!mesh) return; records.set(e.enemyId, mesh);
    mesh.userData.born = elapsed;
    if (e.kind === 'letter') return;
    if (e.kind === 'vesper') { bossId = e.enemyId; bus.emit('bossphase', { phase: 'summoned' }); burst(e.worldPosition, 0x62574e, 24, 3); }
    else {
      const pane = cathedral.panes[mesh.userData.pane];
      if (pane && !pane.restored) pane.goal = 0.015;
      effect(e.worldPosition, tint(mesh), 2.8, 0.9);
    }
  }));
  off.push(bus.on('lock', e => { effect(e.worldPosition, IVORY, 1.9, 0.3); pulse += 0.08; }));
  off.push(bus.on('unlock', e => effect(e.worldPosition, 0x767d93, 1.3, 0.35)));
  off.push(bus.on('fire', e => {
    effect(e.worldPosition, IVORY, e.volleySize === 6 ? 3 : 1.5, 0.3);
    if (e.volleySize === 6) { pulse = 1; flash = 0.5; }
  }));
  off.push(bus.on('hit', e => {
    const mesh = records.get(e.enemyId); if (mesh) mesh.userData.hitUntil = elapsed + 0.22;
    burst(e.worldPosition, tint(mesh), e.lethal ? 9 : 4, e.enemyId === bossId ? 1.8 : 1);
  }));
  off.push(bus.on('stage', e => {
    if (e.enemyId === bossId) { burst(e.worldPosition, IVORY, 32, 3); bus.emit('bossphase', { phase: 'exposed' }); }
  }));
  off.push(bus.on('kill', e => {
    const mesh = records.get(e.enemyId);
    if (e.enemyId === bossId) {
      won = true; flash = 2; pulse = 2;
      burst(new Vector3(0, 0, ROSE_Z + 3), IVORY, 64, 5);
      for (const pane of cathedral.panes) { pane.restored = true; pane.goal = 1.4; }
      bus.emit('bossphase', { phase: 'destroyed' });
    } else if (mesh && !e.letter) {
      const pane = cathedral.panes[mesh.userData.pane];
      if (pane) {
        pane.restored = true; pane.goal = 1.7;
        const destination = pane.group.position.clone();
        for (let i = 0; i < 9; i++) effect(e.worldPosition, tint(mesh), 1, 0.6 + i * 0.045, undefined, destination);
      }
    }
    records.delete(e.enemyId);
  }));
  off.push(bus.on('miss', e => { effect(e.worldPosition, 0x615c64, 1.6, 0.6); records.delete(e.enemyId); }));
  off.push(bus.on('reject', () => { flash = 0.6; pulse = 0.4; }));
  off.push(bus.on('beat', e => { if (e.isDownbeat) pulse = Math.max(pulse, 0.18); }));

  function createEnemyMesh(kind: string, letter?: string) {
    const mesh = buildThief(kind, JEWELS, letter); mesh.userData.kind = kind;
    pending.push(mesh); allocated.add(mesh); return mesh;
  }
  function setEnemyLocked(mesh: Object3D, locked: boolean) { mesh.userData.locked = locked; const lock = mesh.getObjectByName('lock'); if (lock) lock.visible = locked; }
  function setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = elapsed + 0.55; effect(mesh.position, 0xbf745a, 2, 0.5); }
  function createProjectileMesh() {
    const group = new Group();
    const core = new Mesh(new OctahedronGeometry(0.22), new MeshBasicMaterial({ color: new Color(1.8, 1.55, 0.95) })); core.scale.set(0.65, 0.65, 3); group.add(core);
    allocated.add(group); return group;
  }
  function createReticle() {
    const group = new Group();
    const mat = new MeshBasicMaterial({ color: IVORY, depthTest: false, side: DoubleSide });
    for (let i = 0; i < 4; i++) group.add(new Mesh(new RingGeometry(0.72, 0.755, 12, 1, i * Math.PI / 2 + 0.12, 1), mat));
    for (let i = 0; i < 6; i++) { const pip = new Mesh(new RingGeometry(0.83, 0.91, 5, 1, i * Math.PI / 3 + 0.14, 0.3), new MeshBasicMaterial({ color: IVORY, depthTest: false, side: DoubleSide })); pip.name = 'pip' + i; pip.visible = false; group.add(pip); }
    allocated.add(group); return group;
  }
  function setReticleActive(reticle: Object3D, active: boolean, count: number) {
    reticle.scale.setScalar(active ? 1.06 : 1);
    for (let i = 0; i < 6; i++) { const pip = reticle.getObjectByName('pip' + i); if (pip) pip.visible = i < count; }
    reticle.rotation.z = active ? Math.sin(elapsed * 1.3) * 0.06 : 0;
  }
  return {
    createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive,
    update(dt: number) {
      elapsed += dt; if (running) runTime += dt;
      for (const object of allocated) {
        if (object.parent) continue;
        const geometries = new Set<import('three').BufferGeometry>(), materials = new Set<import('three').Material>();
        object.traverse(child => { if (child instanceof Mesh) { geometries.add(child.geometry); for (const mat of Array.isArray(child.material) ? child.material : [child.material]) materials.add(mat); } });
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); allocated.delete(object);
      }
      pulse *= Math.exp(-dt * 3); flash *= Math.exp(-dt * 5);
      roseLight += ((won ? 1 : 0) - roseLight) * (1 - Math.exp(-dt * 4));
      const quiet = running && runTime > 35.7 && runTime < 42;
      const darkness = quiet ? 0.035 : 1;
      for (const pane of cathedral.panes) {
        pane.value += (pane.goal - pane.value) * (1 - Math.exp(-dt * 4));
        const localDarkness = pane.restored ? 1 : darkness;
        pane.material.color.copy(pane.base).multiplyScalar(pane.value * localDarkness);
        pane.spill.color.copy(pane.base).multiplyScalar(pane.value * 0.14 * localDarkness);
      }
      for (const mat of cathedral.roseMaterials) mat.color.copy(mat.userData.base as Color).multiplyScalar(0.002 + roseLight * 2.2);
      cathedral.ambient.intensity = (0.65 + roseLight * 1.5 + flash * 0.17) * (quiet ? 0.15 : 1);
      cathedral.candles.visible = !quiet;
      for (const mesh of records.values()) {
        const core = mesh.userData.core as MeshBasicMaterial;
        const isLetter = mesh.userData.kind === 'letter';
        core.color.set(isLetter ? IVORY : JEWELS[mesh.userData.tint ?? 0]).multiplyScalar(mesh.userData.deniedUntil > elapsed ? 0.3 : mesh.userData.hitUntil > elapsed ? 3 : 1.7);
        if (mesh.userData.kind === 'moth') {
          const left = mesh.getObjectByName('left'), right = mesh.getObjectByName('right');
          if (left && right) { left.rotation.y = Math.sin(elapsed * 7) * 0.35; right.rotation.y = -left.rotation.y; }
        }
        if (mesh.userData.kind === 'vesper') {
          const crown = mesh.getObjectByName('crown'); if (crown) crown.rotation.z = elapsed * 0.06;
          for (let i = 0; i < 3; i++) { const seal = mesh.getObjectByName('seal' + i); if (seal) { seal.visible = i >= Number(mesh.userData.open ?? 0); seal.rotation.z = elapsed * (i % 2 ? -0.2 : 0.2); } }
        }
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]; e.age += dt; const p = e.age / e.life;
        if (p >= 1) { scene.remove(e.mesh); (e.mesh.material as MeshBasicMaterial).dispose(); effects.splice(i, 1); continue; }
        if (e.to && e.from) {
          e.mesh.position.lerpVectors(e.from, e.to, p * p * (3 - 2 * p)); e.mesh.scale.setScalar(1.7 * Math.sin(Math.PI * p));
        } else if (e.velocity.lengthSq()) { e.mesh.position.addScaledVector(e.velocity, dt); e.mesh.rotation.x += dt * 3; e.mesh.rotation.z += dt * 2; e.mesh.scale.setScalar(e.radius * (1 - p)); }
        else { e.mesh.scale.setScalar(0.4 + p * e.radius); e.mesh.quaternion.copy(camera.quaternion); }
        (e.mesh.material as MeshBasicMaterial).opacity = (1 - p) ** 1.3;
      }
    },
    dispose() {
      off.forEach(fn => fn()); clearEffects();
      allocated.add(cathedral.root);
      const geometries = new Set<import('three').BufferGeometry>(), materials = new Set<import('three').Material>();
      for (const object of allocated) object.traverse(child => { if (child instanceof Mesh) { geometries.add(child.geometry); for (const mat of Array.isArray(child.material) ? child.material : [child.material]) materials.add(mat); } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      scene.remove(cathedral.root); scene.fog = null; allocated.clear(); records.clear(); pending.length = 0;
    },
  };
}
