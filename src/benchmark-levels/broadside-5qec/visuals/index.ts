import { AdditiveBlending, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, RingGeometry, Scene, TorusGeometry, Vector3 } from 'three';
import type { Material, Object3D, PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import { bossPosition, TIMELINE, type BattleState } from '../gameplay';
import { buildEnvironment, type FleetPlacement } from './environment';
import { box, createCraft, solid, type Palette } from './models';

export const PALETTE: Palette = { hull: 0x697c88, enemy: 0x13111f, orange: 0xff7638, crimson: 0xff244d, cyan: 0x55e5ff, white: 0xd9f5ff, gold: 0xffc585, magenta: 0xe14faa, friendlyDark: 0x334453, enemyDark: 0x181424, panel: 0x142835, friendlyRim: 0x89bfd0, enemyRim: 0xb14a47, nebulaBase: 0x090818, nebulaPink: 0x6d174e, nebulaGold: 0xf3a656, stars: 0xb5a8c5, socket: 0x1d192b, debris: 0x364254 };
// No formation: elevations, yaws and distances separate the slow capitals.
const FLEET: FleetPlacement[] = [
  [true, 0, -60, 700, 1.45, 0], [true, -220, 75, -2050, 1.2, 0],
  [false, 40, 150, -3100, 1.05, 0.05],
  [true, -660, 130, -900, 0.95, 0.26], [false, 620, 180, -1250, 1.2, -0.35],
  [false, 490, -240, -2280, 1, 0.38], [true, -900, -200, -2600, 1.4, -0.2],
  [true, -420, 590, -3500, 1.2, 0.45], [false, 900, 430, -3700, 1.1, -0.5],
  [false, 560, -410, -4450, 0.9, 0.3], [true, -650, -380, -4550, 1, -0.5],
  [false, -870, 420, -5100, 1.2, 0.3], [false, 740, 320, -5450, 0.7, -0.25],
];
export const createEnemyMesh = (kind: string, letter?: string) => createCraft(kind, PALETTE, letter);
export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  const brackets = mesh.getObjectByName('acquisition'); if (brackets) brackets.visible = locked;
  const core = mesh.userData.core as MeshBasicMaterial | undefined;
  if (core) core.color.set(locked ? PALETTE.cyan : PALETTE.crimson).multiplyScalar(1.5);
  mesh.userData.locked = locked;
}
export function setEnemyDenied(mesh: Object3D) { const brackets = mesh.getObjectByName('acquisition'); if (brackets) { brackets.visible = true; brackets.traverse((o) => { if (o instanceof Mesh) (o.material as MeshBasicMaterial).color.set(PALETTE.magenta); }); } mesh.userData.denied = 0.4; const rim = mesh.userData.rim as MeshBasicMaterial | undefined; rim?.color.set(PALETTE.magenta).multiplyScalar(2); }
export function createProjectileMesh() {
  const group = new Group();
  const body = new Mesh(new OctahedronGeometry(0.42), solid(PALETTE.white, 2)); body.scale.set(0.6, 0.6, 2.8); group.add(body);
  box(group, [0.08, 0.08, 3], [0, 0, 1.4], solid(PALETTE.cyan, 2)); return group;
}
export function createReticle() {
  const group = new Group();
  group.add(new Mesh(new RingGeometry(0.24, 0.29, 32), solid(PALETTE.white)));
  for (let i = 0; i < 6; i++) {
    const arc = new Mesh(new RingGeometry(0.41, 0.48, 8, 1, i * Math.PI / 3 + 0.08, Math.PI / 3 - 0.16), solid(PALETTE.cyan)); arc.name = `pip-${i}`; group.add(arc);
  }
  for (const s of [-1, 1]) { box(group, [0.13, 0.03, 0.01], [s * 0.65, 0, 0], solid(PALETTE.white)); box(group, [0.03, 0.13, 0.01], [0, s * 0.65, 0], solid(PALETTE.white)); }
  group.traverse((o) => { if (o instanceof Mesh) { (o.material as MeshBasicMaterial).depthTest = false; o.renderOrder = 20; } });
  return group;
}
export function setReticleActive(reticle: Object3D, active: boolean, count: number) {
  reticle.scale.setScalar(active ? 1.06 : 1);
  for (let i = 0; i < 6; i++) { const pip = reticle.getObjectByName(`pip-${i}`) as Mesh; const mat = pip.material as MeshBasicMaterial; mat.color.set(i < count ? PALETTE.gold : active ? PALETTE.cyan : 0x537080); }
}

type Effect = { mesh: Mesh; age: number; life: number; velocity: Vector3; size: number; ring: boolean };
export function createVisualWorld(scene: Scene, bus: EventBus, state: BattleState) {
  const ownedGeometry = new Set<BufferGeometry>();
  const ownedMaterial = new Set<Material>();
  const track = (object: Object3D) => { object.traverse((o) => { if (o instanceof Mesh) { ownedGeometry.add(o.geometry); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach((m) => ownedMaterial.add(m)); } }); return object; };
  const env = buildEnvironment(scene, PALETTE, state, { scale: 0.55, fleet: FLEET, broadsideWindow: [14, 20], sockets: TIMELINE.filter((e) => e.kind === 'generator' || e.kind === 'power').map((e) => ({ position: bossPosition(e), power: e.kind === 'power' })) });
  const root = new Group(); scene.add(root);
  const effects: Effect[] = [];
  const ringGeo = new TorusGeometry(1, 0.025, 4, 28);
  const shardGeo = new OctahedronGeometry(0.6);
  let trauma = 0, beatPulse = 0;
  const add = (pos: Vector3, color: number, size: number, life: number, ring = true, velocity = new Vector3()) => {
    if (effects.length > 190) { const old = effects.shift(); if (old) { root.remove(old.mesh); (old.mesh.material as MeshBasicMaterial).dispose(); } }
    const mesh = new Mesh(ring ? ringGeo : shardGeo, new MeshBasicMaterial({ color: new Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
    mesh.position.copy(pos); mesh.scale.setScalar(size); root.add(mesh); effects.push({ mesh, age: 0, life, velocity, size, ring });
  };
  const subscriptions = [
    bus.on('spawn', (e) => add(e.worldPosition, PALETTE.orange, 3, 0.6)),
    bus.on('lock', (e) => add(e.worldPosition, PALETTE.cyan, 4, 0.24)),
    bus.on('unlock', (e) => add(e.worldPosition, PALETTE.white, 3.5, 0.2)),
    bus.on('fire', (e) => { add(e.worldPosition, PALETTE.cyan, 0.7, 0.16); if (e.volleySize === 6 && e.indexInVolley === 0) { trauma = 0.8; add(e.worldPosition, PALETTE.gold, 3, 0.5); } }),
    bus.on('hit', (e) => { add(e.worldPosition, PALETTE.white, 3.8, 0.24); if (!e.lethal) add(e.worldPosition, PALETTE.orange, 5, 0.4); trauma = Math.max(trauma, 0.2); }),
    bus.on('kill', (e) => {
      const boss = state.kinds.get(e.enemyId) === 'power' || state.kinds.get(e.enemyId) === 'generator';
      add(e.worldPosition, PALETTE.gold, boss ? 10 : 5, boss ? 1.3 : 0.6);
      for (let i = 0; i < (boss ? 20 : 10); i++) {
        const a = i * 2.399; const v = new Vector3(Math.cos(a) * (10 + i), Math.sin(a) * (10 + i), Math.sin(i * 4) * 12);
        add(e.worldPosition, i % 3 ? PALETTE.orange : PALETTE.white, boss ? 2 : 0.9, 0.7 + (i % 4) * 0.15, false, v);
      }
      trauma = boss ? 0.9 : 0.3;
    }),
    bus.on('miss', (e) => add(e.worldPosition, PALETTE.crimson, 5, 0.65)),
    bus.on('reject', () => { beatPulse = -1; trauma = 0.1; }),
    bus.on('playerhit', () => { trauma = 1.2; }),
    bus.on('beat', () => { beatPulse = 0.8; }),
    bus.on('bossphase', (e) => { trauma = e.phase === 'destroyed' ? 1.6 : 1; }),
    bus.on('runstart', () => { for (const e of effects) { root.remove(e.mesh); (e.mesh.material as MeshBasicMaterial).dispose(); } effects.length = 0; trauma = 0; }),
  ];
  return {
    createEnemyMesh: (kind: string, letter?: string) => track(createEnemyMesh(kind, letter)),
    createProjectileMesh: () => track(createProjectileMesh()),
    createReticle: () => track(createReticle()),
    update(dt: number, t: number, camera: PerspectiveCamera, elapsed: number) {
      env.update(t, camera, elapsed);
      trauma = Math.max(0, trauma - dt * 2.3); beatPulse *= Math.exp(-dt * 8);
      if (trauma > 0) { camera.rotateX(Math.sin(elapsed * 71) * trauma * 0.003); camera.rotateY(Math.cos(elapsed * 57) * trauma * 0.003); }
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]; e.age += dt;
        if (e.age >= e.life) { root.remove(e.mesh); (e.mesh.material as MeshBasicMaterial).dispose(); effects.splice(i, 1); continue; }
        const f = e.age / e.life;
        (e.mesh.material as MeshBasicMaterial).opacity = (1 - f) * 0.85;
        if (e.ring) { e.mesh.quaternion.copy(camera.quaternion); e.mesh.scale.setScalar(e.size * (1 + f * 2)); }
        else { e.mesh.position.addScaledVector(e.velocity, dt); e.mesh.rotateX(dt * 3); e.mesh.rotateZ(dt * 5); }
      }
      scene.traverse((o) => {
        if (!o.userData.kind) return;
        if (o.userData.denied > 0) { o.userData.denied -= dt; if (o.userData.denied <= 0) { (o.userData.rim as MeshBasicMaterial).color.set(PALETTE.orange); const brackets = o.getObjectByName('acquisition'); if (brackets) { brackets.visible = !!o.userData.locked; brackets.traverse((b) => { if (b instanceof Mesh) (b.material as MeshBasicMaterial).color.set(PALETTE.cyan).multiplyScalar(1.8); }); } } }
        if (o.userData.kind === 'power') {
          const core = o.userData.core as MeshBasicMaterial;
          core.color.set(o.userData.shielded ? 0x784385 : o.userData.locked ? PALETTE.cyan : PALETTE.crimson).multiplyScalar(1.3 + Math.max(0, beatPulse) * 0.3);
        }
      });
    },
    dispose() { subscriptions.forEach((off) => off()); env.dispose(); scene.remove(root); effects.forEach((e) => (e.mesh.material as MeshBasicMaterial).dispose()); effects.length = 0; ringGeo.dispose(); shardGeo.dispose(); ownedGeometry.forEach((g) => g.dispose()); ownedMaterial.forEach((m) => m.dispose()); ownedGeometry.clear(); ownedMaterial.clear(); },
  };
}
