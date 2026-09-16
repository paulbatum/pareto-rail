import { AmbientLight, Color, DirectionalLight, DoubleSide, FogExp2, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry, TorusGeometry, Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import type { EventBus } from '../../../events';
import { CENTER, bossYaw, type Fight } from '../gameplay';
import { harbor, inkClouds } from './harbor';
import { box, letterMesh, merged, octopus, target } from './models';

const P = { haze: 0x453c28, rust: 0x4f2c1a, cream: 0x93794c, dark: 0x14130f, sea: 0x2b2313, skin: 0x2f2a22, suckers: 0x77684a, signal: 0xff4023, lamp: 0xffc779, heat: 0xf5f0de };
export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus, fight: Fight) {
  const root = new Group(); scene.add(root);
  const lit = (color: number, roughness = 0.85) => new MeshStandardMaterial({ color, roughness, metalness: 0.25 });
  const basic = (color: number) => new MeshBasicMaterial({ color });
  const rust = lit(P.rust), cream = lit(P.cream), dark = lit(P.dark), sea = lit(P.sea, 0.3);
  const skin = lit(P.skin, 0.28), suckers = lit(P.suckers, 0.5);
  const lamp = basic(P.lamp); lamp.color.setRGB(2.6, 1.9, 1.0);
  const flesh = basic(0x8d7f58), shell = basic(0x5f4029), signal = basic(P.signal), trim = basic(0xffdf93);
  const ember = basic(0xe06a2a);
  const bossSkin = basic(P.heat), bossUnder = basic(0x9d9c92);
  const brightFlesh = basic(P.heat), brightShell = basic(0xbab8ac);
  for (const material of [bossSkin, bossUnder, brightFlesh, brightShell, flesh, shell, ember, signal]) material.fog = false;
  const world = harbor(rust, cream, dark, sea, lamp); root.add(world.root);
  const boss = octopus(skin, suckers, dark, signal); boss.root.position.copy(CENTER); root.add(boss.root);
  boss.root.traverse(o => { if (o instanceof Mesh && !o.name) o.name = 'octopus anatomy'; });
  const ambient = new AmbientLight(0xd7b47b, 1.7); const key = new DirectionalLight(0xffd5a0, 2.4); key.position.set(20, 40, 30); root.add(ambient, key);
  const fog = new FogExp2(P.haze, 0.0105); scene.fog = fog; scene.background = new Color(P.haze);
  const inkMat = new MeshBasicMaterial({ color: 0x010202, transparent: true, opacity: 0, depthWrite: false });
  const clouds = inkClouds(inkMat); root.add(clouds);
  const targetMeshes = new Set<Object3D>();
  const ownedMeshes = new Set<Object3D>();
  function disposeGeometry(mesh: Object3D) {
    mesh.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  }
  const effects: Array<{ mesh: Mesh; life: number; duration: number; speed: number; velocity: Vector3 }> = [];
  const ringGeometry = new TorusGeometry(1, 0.035, 4, 24);
  const shardGeometry = new SphereGeometry(0.15, 5, 3);
  const fxMats = [basic(P.lamp), basic(P.signal), basic(P.heat)];
  fxMats.forEach(m => { m.depthWrite = false; });
  let beat = 0, pulse = 0;
  function burst(position: Vector3, color: number, size: number, shards = false) {
    if (effects.length > 130) return;
    const mesh = new Mesh(ringGeometry, fxMats[color]); mesh.name = 'signal echo'; mesh.position.copy(position); mesh.quaternion.copy(camera.quaternion); mesh.scale.setScalar(size); root.add(mesh);
    effects.push({ mesh, life: 0.6, duration: 0.6, speed: size * 4, velocity: new Vector3() });
    if (shards) for (let i = 0; i < 9; i++) {
      const m = new Mesh(shardGeometry, fxMats[color]); m.name = 'impact fragment'; m.position.copy(position); root.add(m);
      effects.push({ mesh: m, life: 0.65, duration: 0.65, speed: 0, velocity: new Vector3(Math.sin(i * 2.4) * 6, Math.cos(i * 2.4) * 6, Math.sin(i) * 4) });
    }
  }
  const off = [
    bus.on('spawn', e => { if (!e.letter) burst(e.worldPosition, 0, 0.8); }),
    bus.on('lock', e => burst(e.worldPosition, 0, 0.45)),
    bus.on('unlock', e => burst(e.worldPosition, 1, 0.65)),
    bus.on('fire', e => { burst(e.targetPosition, 0, 0.2); if (e.volleySize === 6) pulse = 0.25; }),
    bus.on('hit', e => { burst(e.worldPosition, 2, e.lethal ? 1.3 : 0.75, true); fight.hit = 0.25; }),
    bus.on('kill', e => burst(e.worldPosition, 0, 1.5, true)),
    bus.on('stage', e => burst(e.worldPosition, 2, 1.2, true)),
    bus.on('miss', e => burst(e.worldPosition, 1, 1)),
    bus.on('reject', () => { pulse = -0.4; }),
    bus.on('beat', e => { beat = e.isDownbeat ? 1 : 0.35; }),
    bus.on('runstart', () => { fight.infrared = false; }),
  ];
  function createEnemyMesh(kind: string, letter?: string) {
    const mesh = kind === 'letter' || letter ? letterMesh(letter ?? 'A', trim, shell) : target(kind, flesh, shell, kind === 'arm' || kind === 'core' ? signal : ember, trim);
    mesh.userData.kind = kind;
    if (kind !== 'letter') targetMeshes.add(mesh);
    ownedMeshes.add(mesh);
    return mesh;
  }
  function setEnemyLocked(mesh: Object3D, locked: boolean) {
    const ring = mesh.getObjectByName('lock'); if (ring) ring.visible = locked;
    mesh.userData.locked = locked;
    if (mesh.userData.isLetter) mesh.scale.setScalar(locked ? 1.08 : 1);
  }
  function setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = 0.3; burst(mesh.position, 1, 1); }
  function createReticle() {
    const g = new Group();
    const m = new MeshBasicMaterial({ color: P.lamp, depthTest: false, depthWrite: false, side: DoubleSide });
    g.add(new Mesh(new RingGeometry(0.68, 0.70, 48), m));
    g.add(merged([box(-0.87, 0, 0, 0.26, 0.025, 0.01), box(0.87, 0, 0, 0.26, 0.025, 0.01), box(0, -0.87, 0, 0.025, 0.26, 0.01), box(0, 0.87, 0, 0.025, 0.26, 0.01)], m));
    for (let i = 0; i < 6; i++) { const pip = new Mesh(new RingGeometry(0.035, 0.065, 10), m); pip.position.set((i - 2.5) * 0.18, -1.15, 0); pip.name = `pip${i}`; g.add(pip); }
    return g;
  }
  const factories = {
    createEnemyMesh, setEnemyLocked, setEnemyDenied, createReticle,
    createProjectileMesh() { const g = new Group(); const m = new Mesh(new SphereGeometry(0.15, 8, 6), trim); m.scale.z = 3.5; g.add(m); ownedMeshes.add(g); return g; },
    setReticleActive(reticle: Object3D, active: boolean, count: number) {
      reticle.rotation.z = active ? 0.04 : 0;
      for (let i = 0; i < 6; i++) { const p = reticle.getObjectByName(`pip${i}`); if (p) p.visible = i < count; }
    },
  };
  function update(dt: number) {
    if (fight.coreDead && fight.collapse > 0.8) fight.infrared = false;
    const ir = fight.infrared, blind = fight.ink > 0.72 && !ir;
    beat *= Math.exp(-dt * 6); pulse *= Math.exp(-dt * 5); fight.hit *= Math.exp(-dt * 9);
    fight.collapse = Math.min(1, fight.collapse + (fight.coreDead ? dt * 0.5 : 0));
    const bg = scene.background as Color;
    bg.setHex(ir ? 0x15191a : blind ? 0x030302 : P.haze);
    fog.color.copy(bg); fog.density = ir ? 0.012 : 0.009 + fight.ink * 0.045;
    rust.color.setHex(ir ? 0x25292a : P.rust); cream.color.setHex(ir ? 0x535657 : P.cream); dark.color.setHex(ir ? 0x0b0e0f : P.dark); sea.color.setHex(ir ? 0x111516 : P.sea);
    if (ir) lamp.color.setHex(0x515556).multiplyScalar(0.35);
    else lamp.color.setRGB(2.6, 1.9, 1).multiplyScalar(blind ? 0.08 : 1 + beat * 0.25);
    boss.root.rotation.y = bossYaw(camera);
    boss.root.position.y = CENTER.y - fight.collapse * 19;
    boss.root.scale.y = 1 - fight.collapse * 0.65;
    boss.root.visible = !blind && fight.collapse < 1;
    boss.root.traverse(o => { if (o instanceof Mesh) { if (o.material === skin || o.material === bossSkin) o.material = ir ? bossSkin : skin; if (o.material === suckers || o.material === bossUnder) o.material = ir ? bossUnder : suckers; } });
    boss.mantle.scale.y = 8.4 * (1 + Math.sin(fight.time * 1.4) * 0.025);
    boss.arms.forEach((arm, i) => {
      const severed = fight.dead.has(i);
      const current = arm.userData.fall ?? 0;
      arm.userData.fall = severed ? Math.min(1, current + dt * 0.75) : 0;
      arm.position.y = -arm.userData.fall * 20;
      arm.rotation.z = Math.sin(fight.time * 0.8 + i) * 0.025 + arm.userData.fall * (i % 2 ? 0.3 : -0.3);
      arm.visible = arm.userData.fall < 1;
    });
    clouds.position.copy(camera.position); clouds.quaternion.copy(camera.quaternion);
    clouds.visible = fight.ink > 0.01 && fight.ink < 0.9;
    if (ir) { clouds.translateZ(-65); clouds.scale.setScalar(3); } else clouds.scale.setScalar(1);
    inkMat.opacity = fight.ink * 0.98;
    clouds.children.forEach((m, i) => { m.rotation.z += dt * (i % 2 ? 0.12 : -0.1); });
    for (const mesh of ownedMeshes) {
      if (!mesh.parent) { disposeGeometry(mesh); ownedMeshes.delete(mesh); targetMeshes.delete(mesh); }
    }
    for (const mesh of targetMeshes) {
      if (!mesh.parent) { targetMeshes.delete(mesh); continue; }
      mesh.traverse(o => { if (o instanceof Mesh) {
        if (o.material === flesh || o.material === brightFlesh) o.material = ir ? brightFlesh : flesh;
        if (o.material === shell || o.material === brightShell) o.material = ir ? brightShell : shell;
      } });
      const denied = Math.max(0, (mesh.userData.deniedUntil ?? 0) - dt); mesh.userData.deniedUntil = denied;
      const lock = mesh.getObjectByName('lock'); if (lock) { lock.rotation.z += dt; lock.scale.setScalar(1 + Math.sin(fight.time * 10) * 0.06); }
      mesh.scale.setScalar(denied > 0 ? 0.85 : 1);
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.life -= dt;
      if (e.life <= 0) { root.remove(e.mesh); effects.splice(i, 1); continue; }
      e.mesh.position.addScaledVector(e.velocity, dt); e.mesh.scale.addScalar(e.speed * dt); e.mesh.visible = e.life > 0.08;
    }
    trim.color.setHex(pulse < -0.02 ? P.signal : ir ? P.heat : P.lamp);
    world.ripples.scale.setScalar(1 + Math.sin(fight.time * 0.6) * 0.045);
  }
  function dispose() {
    off.forEach(f => f()); scene.remove(root);
    const geometries = new Set<import('three').BufferGeometry>(); const materials = new Set<import('three').Material>();
    root.traverse(o => { if (o instanceof Mesh) { geometries.add(o.geometry); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => materials.add(m)); } });
    [rust, cream, dark, sea, skin, suckers, lamp, flesh, shell, signal, ember, trim, bossSkin, bossUnder, brightFlesh, brightShell, inkMat, ...fxMats].forEach(m => materials.add(m));
    geometries.add(ringGeometry); geometries.add(shardGeometry);
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    ownedMeshes.forEach(disposeGeometry); ownedMeshes.clear();
    targetMeshes.clear(); scene.fog = null;
  }
  return { factories, update, dispose };
}
