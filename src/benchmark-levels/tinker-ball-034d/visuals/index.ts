import { AmbientLight, Color, DirectionalLight, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, Scene, TorusGeometry, Vector3, CylinderGeometry, ConeGeometry, CircleGeometry, Object3D, PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import type { EventBus } from '../../../events';
import { createRail, zoomAt, DURATION } from '../gameplay';
import { box, sphere, piece, supply, bake } from './objects';
const C = { wood: 0xd4a46d, grain: 0xb98552, cream: 0xffedc5, teal: 0x22b5ae, red: 0xee6951, yellow: 0xf9c84e, blue: 0x6993bf, glue: 0x211c2c, steel: 0xb8c4c6 };
const colors = [C.teal, C.red, C.yellow, C.blue, C.cream];
const basic = (color: number) => new MeshBasicMaterial({ color, side: DoubleSide });
const solid = (color: number) => new MeshStandardMaterial({ color, roughness: .55 });
const pending: Object3D[] = [];
export function createEnemyMesh(kind: string, letter?: string) {
  const g = new Group();
  g.userData.kind = kind;
  if (kind === 'letter') {
    piece(g, box, solid(C.red), [0, 0, -.12], [1.68, 2.25, .22]);
    piece(g, box, solid(C.cream), [0, 0, .015], [1.5, 2.07, .065]);
    for (const c of glyphOnCells(letter ?? 'A'))
      piece(g, box, basic(C.glue), [(c.x - 2) * .245, (3 - c.y) * .245, .08], [.215, .215, .08]);
    for (const x of [-.65, .65])
      piece(g, sphere, solid(C.steel), [x, .92, .08], [.05, .05, .035]);
  }
  else {
    const boss = kind === 'spill-core';
    piece(g, sphere, new MeshStandardMaterial({ color: C.glue, roughness: .16, metalness: .25 }), [0, 0, 0], [boss ? 1.3 : .67, boss ? 1.25 : .62, .55]);
    const ring = new Mesh(new TorusGeometry(boss ? 1.05 : .5, .055, 7, 30), basic(C.yellow));
    ring.position.z = .52;
    ring.name = 'lock-ring';
    g.add(ring);
    for (const x of [-.19, .19]) {
      piece(g, sphere, basic(C.cream), [x, .11, .55], [.105, .15, .045]);
      piece(g, sphere, basic(C.glue), [x, .07, .596], [.035, .07, .015]);
    }
    const parts = new Group();
    parts.name = 'parts';
    g.add(parts);
    const add = (type: number, x: number, y: number, angle: number, scale = 1) => { const p = supply(type, colors[(type + parts.children.length) % colors.length], C.wood, C.steel, C.glue); p.position.set(x, y, .05); p.rotation.z = angle; p.scale.setScalar(scale); p.userData.home = p.position.clone(); parts.add(p); };
    if (kind === 'button-beetle') {
      add(0, -.7, .25, -.3, 1.3);
      add(0, .7, .25, .3, 1.3);
      add(3, 0, -.5, Math.PI / 2, .75);
      for (let i = 0; i < 4; i++)
        add(i % 2 ? 6 : 2, i < 2 ? -1 : 1, -.2 - (i % 2) * .5, (i < 2 ? -1 : 1) * .8, .42);
      add(1, -.5, .8, 0, .7);
      add(1, .5, .8, 0, .7);
    }
    else if (kind === 'pencil-skater') {
      for (const x of [-.75, .75])
        add(2, x, -.25, x * .5, 1.3);
      add(4, 0, .75, Math.PI / 2, .85);
      add(6, 0, -.55, Math.PI / 2, 1.1);
    }
    else if (kind === 'cardboard-bird') {
      add(5, -1.1, .22, -.45, 1.8);
      add(5, 1.1, .22, .45, 1.8);
      add(4, -.45, -.65, -.65, .5);
      add(4, .45, -.65, .65, .5);
      add(2, 0, .8, Math.PI / 2, .7);
    }
    else {
      for (let i = 0; i < 15; i++) {
        const a = i * Math.PI * 2 / 15;
        add([4, 7, 5, 2, 3][i % 5], Math.cos(a) * 1.9, Math.sin(a) * 1.9, a, 1.2);
      }
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        piece(g, sphere, solid(C.glue), [Math.cos(a) * 1.4, Math.sin(a) * 1.4, -.4], [.5, .5, .5]);
      }
    }
  }
  const halo = new Mesh(new TorusGeometry(kind === 'letter' ? 1.3 : kind === 'spill-core' ? 2.85 : 1.8, .035, 5, 40), basic(C.teal));
  halo.name = 'halo';
  halo.visible = false;
  halo.position.z = .7;
  g.add(halo);
  pending.push(g);
  return g;
}
export function setEnemyLocked(mesh: Object3D, locked: boolean) { mesh.userData.locked = locked; const halo = mesh.getObjectByName('halo'); if (halo)
  halo.visible = locked; const r = mesh.getObjectByName('lock-ring') as Mesh | undefined; if (r)
  (r.material as MeshBasicMaterial).color.setHex(locked ? C.teal : C.yellow); }
export function setEnemyDenied(mesh: Object3D) { mesh.userData.denied = .5; const halo = mesh.getObjectByName('halo') as Mesh; if (halo) {
  halo.visible = true;
  (halo.material as MeshBasicMaterial).color.setHex(C.red);
} }
export function createProjectileMesh() { const g = new Group(); piece(g, sphere, basic(C.teal), [0, 0, 0], [.15, .15, .42]); const r = new Mesh(new TorusGeometry(.22, .035, 4, 12), basic(C.cream)); g.add(r); return g; }
export function createReticle() { const g = new Group(); const r = new Mesh(new RingGeometry(.96, 1.02, 40), basic(C.glue)); g.add(r); const r2 = new Mesh(new RingGeometry(.89, .95, 40), basic(C.cream)); g.add(r2); for (let i = 0; i < 6; i++) {
  const a = i * Math.PI / 3;
  piece(g, box, basic(C.teal), [Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0], [.13, .13, .03]);
} return g; }
export function setReticleActive(g: Object3D, active: boolean, n: number) { g.rotation.z = active ? .08 : 0; g.children.slice(2).forEach((m, i) => { ((m as Mesh).material as MeshBasicMaterial).color.setHex(i < n ? C.yellow : C.teal); }); }
export function createWorld(scene: Scene, bus: EventBus, camera: PerspectiveCamera) {
  pending.length = 0;
  const root = new Group();
  scene.add(root);
  scene.background = new Color(0x584c43);
  root.add(new AmbientLight(0xffe8cc, .95));
  const sun = new DirectionalLight(0xffdfac, 1.6);
  sun.position.set(-45, 75, 45);
  root.add(sun);
  const fill = new DirectionalLight(0xc1eaff, .65);
  fill.position.set(55, 35, -40);
  root.add(fill);
  piece(root, box, solid(C.wood), [0, -1.5, 0], [230, 3, 240]);
  const grain = solid(C.grain);
  for (let i = 0; i < 115; i++) {
    const z = -116 + i * 2.03;
    piece(root, box, grain, [Math.sin(i * 5.3) * 38, .012, z], [115 + (i % 9) * 12, .014, .024 + (i % 4) * .013]);
  }
  // Repeated oblique scores read as roads at marble scale.
  for (let i = 0; i < 90; i++) {
    const m = piece(root, box, grain, [Math.sin(i * 3.17) * 92, .025, Math.cos(i * 6.19) * 100], [2 + i % 8, .014, .035]);
    m.rotation.y = i * 1.73;
  }
  const shadowMat = new MeshBasicMaterial({ color: 0x664628, transparent: true, opacity: .18, depthWrite: false });
  const shadow = (x: number, z: number, s: number) => { const m = new Mesh(new CircleGeometry(1, 20), shadowMat); m.rotation.x = -Math.PI / 2; m.position.set(x, .032, z); m.scale.set(s * 1.4, s * .65, 1); root.add(m); return m; };
  // Fixed landmarks establish that every act occupies the same table.
  for (let i = 0; i < 95; i++) {
    const x = Math.sin(i * 27.1) * 97, z = Math.cos(i * 9.71) * 106;
    const type = i % 7, s = i < 40 ? .7 : 1.6 + (i % 4) * .75;
    const p = supply(type, colors[i % 5], C.wood, C.steel, C.glue);
    p.position.set(x, .25, z);
    p.rotation.set(-Math.PI / 2, 0, i * 1.9);
    p.scale.setScalar(s);
    root.add(p);
    shadow(x + 1, z + 1, s);
  }
  // Paint pots, a folded notebook, ruler and lamp: familiar objects with fixed dimensions.
  for (let i = 0; i < 5; i++) {
    const x = -62 + i * 9, z = -70;
    const jar = new Mesh(new CylinderGeometry(3, 2.8, 6, 24), solid(colors[i]));
    jar.position.set(x, 3, z);
    root.add(jar);
    const lid = new Mesh(new CylinderGeometry(3.2, 3.2, .7, 24), solid(C.cream));
    lid.position.set(x, 6.3, z);
    root.add(lid);
    shadow(x + 3, z + 3, 4);
    piece(root, box, solid(C.cream), [x, 3, z + 2.85], [3.3, 2.2, .14]);
  }
  const notebook = new Group();
  piece(notebook, box, solid(C.teal), [0, 0, 0], [30, .9, 40]);
  piece(notebook, box, solid(C.cream), [0, .6, 0], [28, .6, 38]);
  for (let i = 0; i < 13; i++)
    piece(notebook, box, solid(C.blue), [0, .92, i * 2.4 - 14], [25, .018, .035]);
  notebook.position.set(70, 1, 35);
  notebook.rotation.y = -.2;
  root.add(notebook);
  const ruler = supply(4, C.yellow, C.wood, C.steel, C.glue);
  ruler.scale.set(9, 18, 5);
  ruler.rotation.set(-Math.PI / 2, 0, 1.1);
  ruler.position.set(-70, .6, 20);
  root.add(ruler);
  const lamp = new Group();
  piece(lamp, sphere, solid(C.teal), [0, 1, 0], [11, 1.3, 8]);
  const arm = piece(lamp, box, solid(C.teal), [0, 22, 0], [1.5, 44, 1.5]);
  arm.rotation.z = -.18;
  const shade = new Mesh(new ConeGeometry(12, 13, 32, 1, true), new MeshStandardMaterial({ color: C.teal, side: DoubleSide }));
  shade.position.set(4, 43, 0);
  lamp.add(shade);
  piece(lamp, sphere, basic(C.cream), [4, 39, 0], [6, .6, 6]);
  lamp.position.set(-83, 0, 57);
  root.add(lamp);
  const clutterRail = createRail();
  for (let i = 0; i < 140; i++) {
    const u = (i + .5) / 140, p = clutterRail.getPointAt(u), f = clutterRail.getTangentAt(u), r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
    p.addScaledVector(r, (i % 2 ? 1 : -1) * (8 + (i % 7) * 1.8));
    p.y = .2;
    const item = supply(i % 7, colors[i % 5], C.wood, C.steel, C.glue);
    item.position.copy(p);
    item.rotation.set(-Math.PI / 2, 0, i * 2.4);
    item.scale.setScalar(.6 + u * 1.8);
    root.add(item);
    shadow(p.x + .6, p.z + .7, .65 + u);
  }
  root.updateMatrixWorld(true);
  const shadowGeometries: CircleGeometry[] = [];
  const shadowMeshes: Mesh[] = [];
  root.traverse(o => { if (o instanceof Mesh && o.material === shadowMat) {
    const g = o.geometry.clone() as CircleGeometry;
    g.applyMatrix4(o.matrixWorld);
    shadowGeometries.push(g);
    shadowMeshes.push(o);
  } });
  const combinedShadows = mergeGeometries(shadowGeometries);
  shadowGeometries.forEach(g => g.dispose());
  shadowMeshes.forEach(m => m.removeFromParent());
  if (combinedShadows)
    root.add(new Mesh(combinedShadows, shadowMat));
  bake(root);
  root.children[root.children.length - 1].name = 'table-and-landmarks';
  const spill = new Group();
  spill.position.set(0, .07, -12);
  root.add(spill);
  for (let i = 0; i < 13; i++) {
    const p = piece(spill, sphere, new MeshStandardMaterial({ color: C.glue, roughness: .19 }), [Math.cos(i * 2.4) * 12, 0, Math.sin(i * 2.4) * 10], [9, .17, 7]);
    p.rotation.y = i;
    p.name = 'glue-puddle';
  }
  for (let i = 0; i < 12; i++) {
    const p = supply(i % 7, colors[i % 5], C.wood, C.steel, C.glue);
    p.position.set(Math.sin(i * 2.4) * 12, .5, Math.cos(i * 2.4) * 10);
    p.rotation.set(-1.4, 0, i);
    p.scale.setScalar(2);
    spill.add(p);
  }
  const ball = new Group(), skin = new Group();
  ball.name = 'collection-ball';
  skin.name = 'collected-supplies';
  ball.add(skin);
  root.add(ball);
  const marble = piece(skin, sphere, new MeshStandardMaterial({ color: C.teal, metalness: .25, roughness: .2 }), [0, 0, 0], [.72, .72, .72]);
  for (let i = 0; i < 3; i++) {
    const r = new Mesh(new TorusGeometry(.72, .04, 6, 32), solid(i === 0 ? C.cream : C.yellow));
    r.rotation.set(i * .8, i * 1.2, 0);
    skin.add(r);
  }
  const ballShadow = shadow(0, 0, 1);
  const curve = createRail(), enemies = new Map<number, Object3D>();
  type Scrap = {
    mesh: Object3D;
    velocity: Vector3;
    age: number;
    land: Vector3;
    settled: boolean;
  };
  const scraps: Scrap[] = [], attached: Object3D[] = [], effects: {
    mesh: Mesh;
    age: number;
    life: number;
  }[] = [];
  let now = 0, run = 0, running = false, count = 0, radius = .75, steer = 0, shock = 0, clean = false;
  const forward = new Vector3(), right = new Vector3();
  function ring(pos: Vector3, color: number, size = 1) { const m = new Mesh(new TorusGeometry(size, .04, 5, 24), new MeshBasicMaterial({ color, transparent: true, depthWrite: false })); m.position.copy(pos); m.quaternion.copy(camera.quaternion); root.add(m); effects.push({ mesh: m, age: 0, life: .5 }); }
  function dismantle(id: number, partial = false) {
    const enemy = enemies.get(id);
    if (!enemy)
      return;
    const parts = enemy.getObjectByName('parts');
    if (!parts)
      return;
    const selected = partial ? parts.children.slice(0, 5) : [...parts.children];
    enemy.updateMatrixWorld(true);
    const lane = curve.getPointAt(Math.min(1, (run + 2.4 * zoomAt(run) + 1.5) / DURATION));
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      root.attach(p);
      p.traverse(o => { o.name = 'rescued-' + enemy.userData.kind; });
      const land = lane.clone().addScaledVector(right, Math.sin(i * 2.4 + id) * 1.6);
      land.y = .2;
      const flight = .65 + (i % 3) * .1;
      const v = land.clone().sub(p.position).divideScalar(flight);
      v.y += 9 * flight;
      scraps.push({ mesh: p, velocity: v, age: 0, land, settled: false });
    }
    ring(enemy.position, C.yellow, partial ? 1.5 : 1);
  }
  const off = [
    bus.on('spawn', e => { const mesh = pending.shift(); if (mesh)
      enemies.set(e.enemyId, mesh); if (!e.letter)
      ring(e.worldPosition, C.cream, .8); }),
    bus.on('lock', e => ring(e.worldPosition, C.teal, .65)),
    bus.on('unlock', e => ring(e.worldPosition, C.cream, .4)),
    bus.on('fire', e => { shock = Math.max(shock, e.volleySize * .018); ring(e.worldPosition, C.teal, .3); }),
    bus.on('hit', e => { ring(e.worldPosition, C.cream, .5); const m = enemies.get(e.enemyId); if (m)
      m.userData.flash = .18; }),
    bus.on('stage', e => { dismantle(e.enemyId, true); const m = enemies.get(e.enemyId); if (m)
      m.userData.rebuild = 1.2; shock = .2; }),
    bus.on('kill', e => { if (!e.letter)
      dismantle(e.enemyId); const m = enemies.get(e.enemyId); if (m?.userData.kind === 'spill-core') {
      clean = true;
      shock = .35;
    } enemies.delete(e.enemyId); }),
    bus.on('miss', e => { ring(e.worldPosition, C.red, .7); enemies.delete(e.enemyId); }),
    bus.on('reject', () => { shock = .18; ring(ball.position, C.red, 1.5); }),
    bus.on('beat', e => { if (e.isDownbeat && running)
      ring(ball.position, C.cream, radius * 1.1); }),
    bus.on('runstart', () => { run = 0; running = true; count = 0; radius = .75; clean = false; steer = 0; for (const p of scraps)
      p.mesh.removeFromParent(); scraps.length = 0; for (const p of attached)
      p.removeFromParent(); attached.length = 0; enemies.clear(); pending.length = 0; skin.quaternion.identity(); spill.scale.setScalar(1); }),
    bus.on('runend', () => { running = false; }),
  ];
  return {
    get count() { return count; }, get clean() { return clean; },
    update(dt: number) {
      now += dt;
      if (running)
        run += dt;
      const s = zoomAt(run), u = Math.min(1, run / DURATION);
      forward.copy(curve.getTangentAt(u)).normalize();
      right.crossVectors(forward, new Vector3(0, 1, 0)).normalize();
      const base = curve.getPointAt(Math.min(1, (run + 2.4 * s) / DURATION));
      const field = scraps.find(p => p.age > .5 && p.mesh.position.distanceTo(base) < 18);
      const desired = field ? Math.max(-5, Math.min(5, field.land.clone().sub(base).dot(right))) : Math.sin(run * 2.1) * .35;
      steer += (desired - steer) * Math.min(1, dt * 3);
      const old = ball.position.clone();
      ball.position.copy(base).addScaledVector(right, steer);
      ball.position.y = radius;
      const travel = old.distanceTo(ball.position);
      if (running && travel < 10)
        skin.rotateOnWorldAxis(right, -travel / radius);
      ballShadow.position.set(ball.position.x, .045, ball.position.z);
      ballShadow.scale.set(radius * 1.3, radius * .9, 1);
      for (let i = scraps.length - 1; i >= 0; i--) {
        const p = scraps[i];
        p.age += dt;
        if (!p.settled) {
          p.velocity.y -= 18 * dt;
          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mesh.rotateX(dt * 4);
          p.mesh.rotateZ(dt * 2);
          if (p.mesh.position.y <= .23) {
            p.mesh.position.copy(p.land);
            p.mesh.rotation.x = -Math.PI / 2;
            p.settled = true;
          }
        }
        if (p.settled && p.mesh.position.distanceTo(ball.position) < radius + 2.2) {
          skin.attach(p.mesh);
          const n = new Vector3(Math.sin(count * 2.4), Math.cos(count * 2.4), Math.sin(count * 4.7)).normalize();
          p.mesh.position.copy(n.multiplyScalar(radius * .96));
          p.mesh.scale.clampScalar(.15, .7 + s * .18);
          attached.push(p.mesh);
          count++;
          radius = Math.min(3.9, .75 + Math.sqrt(count) * .17);
          marble.scale.setScalar(radius);
          for (const item of attached)
            item.position.normalize().multiplyScalar(radius * .99);
          ring(ball.position, C.teal, radius);
          scraps.splice(i, 1);
        }
      }
      for (const m of enemies.values()) {
        const age = m.userData.age ?? now;
        const parts = m.getObjectByName('parts');
        if (parts) {
          parts.children.forEach((p, i) => { if (m.userData.kind === 'cardboard-bird' && i < 2)
            p.rotation.y = Math.sin(age * 8) * (i ? 1 : -1) * .55; if (m.userData.kind === 'button-beetle' && i > 2)
            p.rotation.x = Math.sin(age * 11 + i) * .24; if (m.userData.kind === 'spill-core') {
            p.rotation.z += dt * (.4 + (m.userData.stage ?? 0) * .3);
            if (p.userData.home)
              p.position.copy(p.userData.home).multiplyScalar(1 + Math.sin(Math.max(0, m.userData.rebuild ?? 0) / 1.2 * Math.PI) * .75);
          } });
        }
        m.userData.rebuild = Math.max(0, (m.userData.rebuild ?? 0) - dt);
        if (m.userData.denied > 0) {
          m.userData.denied -= dt;
          if (m.userData.denied <= 0) {
            const h = m.getObjectByName('halo') as Mesh;
            if (h) {
              h.visible = !!m.userData.locked;
              (h.material as MeshBasicMaterial).color.setHex(C.teal);
            }
          }
        }
        if (m.userData.flash > 0) {
          m.userData.flash -= dt;
          m.rotation.z += Math.sin(now * 90) * .035;
        }
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.age += dt;
        e.mesh.scale.setScalar(1 + e.age * 3);
        (e.mesh.material as MeshBasicMaterial).opacity = 1 - e.age / e.life;
        if (e.age > e.life) {
          e.mesh.removeFromParent();
          e.mesh.geometry.dispose();
          (e.mesh.material as MeshBasicMaterial).dispose();
          effects.splice(i, 1);
        }
      }
      if (clean) {
        const k = Math.max(.001, spill.scale.x - dt * .65);
        spill.scale.setScalar(k);
      }
      shock *= Math.exp(-dt * 10);
      camera.rotateZ(Math.sin(now * 45) * shock * .025);
    },
    dispose() { off.forEach(f => f()); root.removeFromParent(); const gs = new Set<unknown>(), ms = new Set<unknown>(); root.traverse(o => { if (o instanceof Mesh) {
      if (!gs.has(o.geometry)) {
        gs.add(o.geometry);
        o.geometry.dispose();
      }
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!ms.has(m)) {
          ms.add(m);
          m.dispose();
        }
    } }); pending.length = 0; },
  };
}
