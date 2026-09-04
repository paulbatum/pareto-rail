import {
  AdditiveBlending, AmbientLight, BoxGeometry, Color, DirectionalLight, DoubleSide,
  EdgesGeometry, FogExp2, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial,
  LineSegments, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, Quaternion, RingGeometry, Vector3, type PerspectiveCamera, type Scene,
  type Material, type BufferGeometry,
} from 'three';
import type { EventBus } from '../../../events';
import type { VisualFactories } from '../../../engine/types';
import { BELLY_BATTERIES, CORE_SOCKETS, FLAGSHIP, SHIELD_SOCKETS, WORLD_SCALE, type BattleState } from '../gameplay';
import { TIME } from '../timing';
import { makeSky } from './environment';
import { effectGeometry, flashGeometry, makeCapital, makeFighter, makeHalo, Parts, type Paint, type ShipSpec } from './models';

const C = {
  void: 0x030714, nebula: 0x7e255b, gold: 0xf4b56c, haze: 0xad7aa3,
  cyan: 0x63e5ff, white: 0xd6e6ec, crimson: 0xf92b50, orange: 0xff7b26,
  friendlyHull: 0x879ba9, friendlyPlate: 0xc6d2d6, enemyHull: 0x12121e,
  enemyPlate: 0x292333, dark: 0x080c16, lock: 0x8ffff9,
};
const FLEET = ([
  { friendly: true, length: 680, width: 140, height: 65, position: [0, -40, -80], rotation: [0, 0, 0], deck: true },
  { friendly: true, length: 1100, width: 230, height: 160, position: [-170, 76, -1690], rotation: [0, 0, -0.03] },
  { friendly: false, length: 730, width: 180, height: 110, position: [240, 110, -2560], rotation: [0, 0, 0] },
  { friendly: false, length: 1120, width: 330, height: 84, position: [100, 10, -3630], rotation: [0, 0, 0], split: true },
  { friendly: false, length: 930, width: 150, height: 92, position: [570, 110, -870], rotation: [0.08, -0.55, 0.18] },
  { friendly: true, length: 880, width: 160, height: 95, position: [-670, -190, -940], rotation: [-0.12, 0.48, -0.24] },
  { friendly: false, length: 1040, width: 195, height: 115, position: [790, -210, -1930], rotation: [0.18, 0.7, 0.26] },
  { friendly: true, length: 960, width: 145, height: 95, position: [-740, 360, -2430], rotation: [0.2, -0.38, 0.33] },
  { friendly: false, length: 690, width: 120, height: 76, position: [580, 490, -3250], rotation: [-0.16, 0.55, -0.33] },
  { friendly: true, length: 700, width: 110, height: 72, position: [-690, -400, -3320], rotation: [-0.2, 0.5, 0.4] },
  { friendly: false, length: 820, width: 170, height: 100, position: [1290, 130, -3710], rotation: [0.22, -0.9, 0.23] },
  { friendly: true, length: 900, width: 150, height: 80, position: [-1200, 170, -1750], rotation: [-0.15, 0.7, 0.08] },
  { friendly: false, length: 620, width: 120, height: 70, position: [820, -430, -4300], rotation: [0.33, 0.25, -0.4] },
  { friendly: true, length: 710, width: 130, height: 95, position: [-1130, -150, -4180], rotation: [0.2, -0.7, 0.2] },
  { friendly: false, length: 1020, width: 180, height: 110, position: [1400, 730, -2370], rotation: [-0.2, -0.5, 0.18] },
  { friendly: true, length: 730, width: 135, height: 85, position: [-1250, 710, -700], rotation: [-0.06, 0.9, -0.2] },
] satisfies ShipSpec[]).map(spec => ({ ...spec, length: spec.length * WORLD_SCALE, width: spec.width * WORLD_SCALE, height: spec.height * WORLD_SCALE, position: spec.position.map(n => n * WORLD_SCALE) as [number, number, number] }));

export function createSquadronStudy() {
  const paint: Paint = {
    hull: new MeshStandardMaterial({ color: 0x35313d, roughness: 0.74, flatShading: true }),
    plate: new MeshStandardMaterial({ color: 0x76636a, roughness: 0.74, flatShading: true }),
    dark: new MeshBasicMaterial({ color: C.dark }),
    trim: new MeshBasicMaterial({ color: new Color(C.orange).multiplyScalar(1.6) }),
    hot: new MeshBasicMaterial({ color: new Color(C.crimson).multiplyScalar(2) }),
    glass: new MeshBasicMaterial({ color: new Color(0xffdfaa).multiplyScalar(1.8) }),
  };
  const root = new Group();
  root.add(new AmbientLight(0xb0b7d2, 2));
  const keyLight = new DirectionalLight(0xffca9a, 3);
  keyLight.position.set(5, 12, 15);
  root.add(keyLight);
  ['raptor', 'helix', 'bomber'].forEach((kind, i) => {
    const craft = makeFighter(kind, paint);
    craft.position.x = (i - 1) * 5.5;
    root.add(craft);
  });
  return root;
}

export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus, state: BattleState) {
  const resources = new Set<Material | BufferGeometry>();
  function own<T extends Object3D>(object: T) {
    object.traverse(o => {
      const mesh = o as Mesh;
      if (mesh.geometry) resources.add(mesh.geometry);
      if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(m);
    });
    return object;
  }
  const basic = (color: number, hdr = 1, transparent = false) => new MeshBasicMaterial({ color: new Color(color).multiplyScalar(hdr), side: DoubleSide, transparent, depthWrite: !transparent, blending: transparent ? AdditiveBlending : undefined });
  const standard = (color: number, metalness = 0.35) => new MeshStandardMaterial({ color, metalness, roughness: 0.74, flatShading: true });
  const paint = (friendly: boolean): Paint => ({
    hull: standard(friendly ? C.friendlyHull : C.enemyHull),
    plate: standard(friendly ? C.friendlyPlate : C.enemyPlate), dark: standard(C.dark, 0.6),
    trim: basic(friendly ? C.cyan : C.orange, 0.9), hot: basic(friendly ? C.cyan : C.crimson, 2),
    glass: basic(friendly ? C.white : C.gold, 1.25),
  });
  const friendlyPaint = paint(true), enemyPaint = paint(false);
  const targetPaint: Paint = { ...enemyPaint, hull: standard(0x35313d), plate: standard(0x76636a), glass: basic(0xffdfaa, 1.8), trim: basic(C.orange, 1.6) };
  const world = new Group();
  scene.add(world);
  scene.background = new Color(C.void);
  scene.fog = new FogExp2(C.void, 0.000065);
  camera.far = 16000;
  camera.updateProjectionMatrix();
  world.add(new AmbientLight(0x9a8fad, 1.6));
  const rim = new DirectionalLight(0xff9a5b, 3.5);
  rim.position.set(1000, 1600, -2700); world.add(rim);
  const cold = new DirectionalLight(0x65bfff, 2.3);
  cold.position.set(-1200, 350, 1200); world.add(cold);
  const fill = new DirectionalLight(0xb847c3, 1.5);
  fill.position.set(600, -400, -400); world.add(fill);
  const sky = own(makeSky({ void: C.void, magenta: C.nebula, gold: C.gold, haze: C.haze }));
  world.add(sky);
  const ships = FLEET.map((spec, index) => {
    const ship = makeCapital(spec, spec.friendly ? friendlyPaint : enemyPaint);
    ship.root.traverse(o => { if (o instanceof Mesh) o.name = `capital-${index}`; });
    world.add(own(ship.root));
    return ship;
  });
  const flagship = ships[3];
  const shieldMaterial = new LineBasicMaterial({ color: C.orange, transparent: true, opacity: 0.11, depthWrite: false });
  const shield = own(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(1, 2)), shieldMaterial));
  shield.position.copy(FLAGSHIP); shield.scale.set(210, 117, 605).multiplyScalar(WORLD_SCALE); world.add(shield);
  const socketParts = new Parts();
  for (const position of BELLY_BATTERIES) {
    socketParts.box(enemyPaint.hull, [position.x, position.y + 3, position.z], [2, 6, 2]);
    socketParts.box(enemyPaint.dark, [position.x, position.y + 6, position.z], [4, 1, 4]);
  }
  for (const position of SHIELD_SOCKETS) {
    socketParts.box(enemyPaint.dark, [position.x + 8.5, position.y, position.z - 2.1], [14, 2.2, 2.5]);
    socketParts.box(enemyPaint.trim, [position.x + 9, position.y + 1.2, position.z - 2.1], [12, 0.16, 0.2]);
  }
  for (const position of CORE_SOCKETS) {
    socketParts.box(enemyPaint.dark, [position.x, 38 * WORLD_SCALE, position.z], [5.2, 4, 7.2]);
    for (const side of [-1, 1]) socketParts.box(enemyPaint.hot, [position.x + side * 3.2, 42 * WORLD_SCALE, position.z], [0.4, 2, 6.4]);
  }
  world.add(own(socketParts.finish()));

  const shaft = new BoxGeometry(1, 1, 1);
  const cyanFire = own(new InstancedMesh(shaft, basic(C.cyan, 2), 96));
  const redFire = own(new InstancedMesh(shaft, basic(C.crimson, 1.8), 96));
  cyanFire.frustumCulled = redFire.frustumCulled = false;
  world.add(cyanFire, redFire);
  const friendlyIndices = FLEET.flatMap((s, i) => s.friendly ? [i] : []);
  const enemyIndices = FLEET.flatMap((s, i) => s.friendly ? [] : [i]);
  const salvos = [true, false].map(friendly => Array.from({ length: 96 }, (_, i) => {
    const sources = friendly ? friendlyIndices : enemyIndices;
    const targets = friendly ? enemyIndices : friendlyIndices;
    const from = ships[sources[i % sources.length]];
    const to = FLEET[targets[(i * 3 + 1) % targets.length]];
    const start = from.barrels[(i * 7) % from.barrels.length].clone();
    const end = new Vector3(...to.position).add(new Vector3(Math.sin(i * 6) * 50, Math.cos(i * 3) * 35, Math.sin(i * 11) * to.length * 0.35));
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), end.clone().sub(start).normalize());
    return { start, end, q, period: 2.5 + (i % 7) * 0.31, phase: i * 0.287 };
  }));
  const muzzle = own(new InstancedMesh(flashGeometry, basic(C.cyan, 2.4), 12));
  muzzle.frustumCulled = false; world.add(muzzle);
  const broadside = own(new InstancedMesh(shaft, basic(C.cyan, 2.2), 12));
  broadside.frustumCulled = false; world.add(broadside);
  const barrage = Array.from({ length: 12 }, (_, i) => new Vector3(-8, 125 + (i % 2) * 4, -1230 - i * 74).multiplyScalar(WORLD_SCALE));

  // Distant dogfights are a separate, smaller visual scale from lockable craft.
  const distant = own(new InstancedMesh(effectGeometry, basic(C.orange, 1.1), 110));
  const allies = own(new InstancedMesh(effectGeometry, basic(C.cyan, 1.1), 80));
  distant.frustumCulled = allies.frustumCulled = false; world.add(distant, allies);
  const fires = own(new InstancedMesh(flashGeometry, basic(C.orange, 1.4), 56));
  fires.frustumCulled = false; world.add(fires);
  const debris = own(new InstancedMesh(effectGeometry, enemyPaint.hull, 64));
  debris.frustumCulled = false; world.add(debris);
  const shock = own(new Mesh(new RingGeometry(1, 1.035, 96), basic(C.gold, 1.2, true)));
  shock.visible = false; world.add(shock);

  const effects = Array.from({ length: 76 }, (_, i) => {
    const mat = basic(i % 3 === 0 ? C.cyan : C.orange, 1.3, true);
    const mesh = own(new Mesh(i % 4 === 0 ? new RingGeometry(0.9, 1, 24) : effectGeometry, mat));
    mesh.visible = false; world.add(mesh);
    return { mesh, velocity: new Vector3(), life: 0, maxLife: 1, size: 1, ring: i % 4 === 0 };
  });
  let effectIndex = 0, clock = 0, beat = 0, flash = 0;
  function burst(position: Vector3, color: number, count: number, size = 1) {
    for (let i = 0; i < count; i++) {
      const e = effects[effectIndex++ % effects.length];
      e.mesh.visible = true; e.mesh.position.copy(position); e.mesh.quaternion.copy(camera.quaternion);
      const a = i * 2.399 + effectIndex;
      e.velocity.set(Math.cos(a), Math.sin(a), Math.sin(a * 3.7)).normalize().multiplyScalar(size * (9 + i));
      e.life = e.maxLife = e.ring ? 0.38 : 0.65 + (i % 3) * 0.13;
      e.size = size; e.mesh.scale.setScalar(size * 0.3);
      e.mesh.material.color.set(color).multiplyScalar(1.7);
    }
  }
  const templates = new Map<string, Group>();
  const records = new Set<Object3D>();
  const ringMaterial = basic(C.orange, 1.05, true);
  const lockedMaterial = basic(C.lock, 1.8, true);
  const deniedMaterial = basic(C.crimson, 1.8, true);
  const projectileGeometry = new IcosahedronGeometry(0.19, 0);
  const projectileMaterial = basic(C.cyan, 2.7);
  resources.add(projectileGeometry); resources.add(projectileMaterial);
  const factories: VisualFactories = {
    createEnemyMesh(kind, letter) {
      const key = kind + (letter ?? '');
      if (!templates.has(key)) templates.set(key, own(makeFighter(kind, kind === 'letter' ? friendlyPaint : targetPaint, letter)));
      const root = templates.get(key)!.clone(true);
      const radius = kind === 'letter' ? 1.38 : kind === 'generator' ? 7.3 : kind === 'reactor' ? 5.6 : kind === 'shell' ? 0.98 : 2.6;
      const halo = own(makeHalo(ringMaterial, radius));
      halo.name = 'lock-halo'; halo.position.z = kind === 'letter' ? -0.2 : 2.5;
      halo.visible = kind !== 'letter';
      root.add(halo);
      root.userData.born = clock;
      root.userData.kind = kind;
      records.add(root);
      return root;
    },
    setEnemyLocked(mesh, locked) {
      mesh.userData.locked = locked;
      const halo = mesh.getObjectByName('lock-halo') as Mesh;
      halo.material = locked ? lockedMaterial : ringMaterial;
      halo.visible = locked || mesh.userData.kind !== 'letter';
      mesh.userData.lockPulse = clock;
    },
    setEnemyDenied(mesh) {
      mesh.userData.deniedUntil = clock + 0.45;
      const halo = mesh.getObjectByName('lock-halo') as Mesh;
      halo.visible = true; halo.material = deniedMaterial;
    },
    createProjectileMesh() {
      const mesh = new Mesh(projectileGeometry, projectileMaterial);
      mesh.scale.set(1, 1, 4.5);
      return mesh;
    },
    createReticle() {
      const root = new Group();
      const dark = own(new Mesh(new RingGeometry(0.57, 0.72, 48), basic(C.dark)));
      dark.material.depthTest = false; dark.renderOrder = 98; root.add(dark);
      const outer = own(new Mesh(new RingGeometry(0.635, 0.665, 48), basic(C.cyan, 1.5)));
      outer.material.depthTest = false; outer.renderOrder = 100; root.add(outer);
      for (let i = 0; i < 6; i++) {
        const tick = own(new Mesh(new RingGeometry(0.7, 0.79, 8, 1, i * Math.PI / 3 + 0.08, 0.85), basic(C.cyan)));
        tick.material.depthTest = false; tick.renderOrder = 100; root.add(tick);
      }
      const center = own(new Mesh(new RingGeometry(0.035, 0.07, 8), basic(C.white)));
      center.material.depthTest = false; center.renderOrder = 101; root.add(center);
      return root;
    },
    setReticleActive(reticle, active, count) {
      reticle.scale.setScalar(active ? 0.95 : 1);
      for (let i = 0; i < 6; i++) {
        const mesh = reticle.children[i + 2] as Mesh<RingGeometry, MeshBasicMaterial>;
        mesh.material.color.set(i < count ? C.white : active ? C.cyan : 0x355c6b).multiplyScalar(i < count ? 1.6 : 1);
      }
    },
  };
  const off = [
    bus.on('spawn', e => { if (!e.letter) burst(e.worldPosition, C.orange, 3, 0.7); }),
    bus.on('lock', e => burst(e.worldPosition, C.lock, 2, 0.65)),
    bus.on('unlock', e => burst(e.worldPosition, C.cyan, 2, 0.4)),
    bus.on('fire', e => { burst(e.worldPosition, C.cyan, 1, 0.8); if (e.volleySize === 6) flash = 0.4; }),
    bus.on('hit', e => burst(e.worldPosition, C.white, e.lethal ? 3 : 6, e.hitStageCount > 1 ? 2.5 : 1.2)),
    bus.on('stage', e => { burst(e.worldPosition, C.gold, 10, 3); flash = 0.5; }),
    bus.on('kill', e => burst(e.worldPosition, e.letter ? C.cyan : C.orange, e.letter ? 6 : 10, e.scoreAwarded > 600 ? 3 : 1.4)),
    bus.on('miss', e => { if (!e.letter) burst(e.worldPosition, C.crimson, 4, 0.8); }),
    bus.on('reject', () => { flash = -1; }),
    bus.on('beat', e => { beat = e.isDownbeat ? 1 : 0.6; }),
    bus.on('bossphase', e => { if (e.phase === 'destroyed') flash = 1.5; if (e.phase === 'exposed') { flash = 0.8; burst(FLAGSHIP, C.cyan, 24, 18); } }),
    bus.on('runstart', () => { clock = 0; flash = 0; effects.forEach(e => { e.life = 0; e.mesh.visible = false; }); }),
  ];
  const matrix = new Matrix4(), q = new Quaternion(), zeroQ = new Quaternion(), p = new Vector3(), scale = new Vector3();
  const localForward = new Vector3(0, 0, 1);
  function update(dt: number, elapsed: number, running: boolean, runTime: number) {
    clock = elapsed;
    const t = running ? runTime : elapsed * 0.35;
    sky.position.copy(camera.position);
    beat *= Math.exp(-dt * 7);
    flash *= Math.exp(-dt * 6);
    for (const target of records) {
      if (!target.parent) {
        if (elapsed > target.userData.born + 0.1) {
          const halo = target.getObjectByName('lock-halo') as Mesh;
          halo.geometry.dispose(); resources.delete(halo.geometry); records.delete(target);
        }
        continue;
      }
      const denied = target.userData.deniedUntil > elapsed;
      const halo = target.getObjectByName('lock-halo') as Mesh;
      halo.material = denied ? deniedMaterial : target.userData.locked ? lockedMaterial : ringMaterial;
      halo.rotation.z = elapsed * (target.userData.locked ? -1.2 : 0.3);
      const birth = Math.min(1, Math.max(0, (elapsed - target.userData.born) / 0.22));
      const pulse = Math.max(0, 1 - (elapsed - (target.userData.lockPulse ?? -20)) / 0.18);
      const targetScale = target.userData.kind === 'letter' ? 1 : target.userData.kind === 'generator' || target.userData.kind === 'reactor' ? WORLD_SCALE : target.userData.kind === 'shell' ? 0.55 : 0.7;
      target.scale.setScalar(targetScale * (0.65 + birth * 0.35) * (1 + pulse * 0.06));
      if (denied) target.rotateZ(Math.sin(elapsed * 65) * 0.06);
      const rotor = target.getObjectByName('rotor');
      if (rotor) { rotor.rotation.z = elapsed * 0.8; rotor.scale.setScalar(1 + (target.userData.damage ?? 0) * 0.35); }
    }
    for (const e of effects) {
      if (e.life <= 0) continue;
      e.life -= dt;
      e.mesh.visible = e.life > 0;
      if (e.ring) {
        e.mesh.quaternion.copy(camera.quaternion);
        e.mesh.scale.setScalar(e.size * (1 + (1 - e.life / e.maxLife) * 9));
      } else {
        e.mesh.position.addScaledVector(e.velocity, dt);
        e.mesh.rotateX(dt * 4); e.mesh.rotateZ(dt * 3);
        e.mesh.scale.setScalar(e.size * Math.max(0.01, e.life / e.maxLife) * 0.4);
      }
      e.mesh.material.opacity = Math.max(0, e.life / e.maxLife);
    }
    salvos.forEach((list, faction) => {
      const mesh = faction === 0 ? cyanFire : redFire;
      list.forEach((shot, i) => {
        const progress = ((t + shot.phase) % shot.period) / shot.period;
        p.lerpVectors(shot.start, shot.end, progress);
        scale.set(0.3, 0.3, 11 + (i % 4) * 3);
        if (state.victoryTime >= 0 && faction === 1) scale.multiplyScalar(Math.max(0, 1 - (runTime - state.victoryTime) / 4));
        mesh.setMatrixAt(i, matrix.compose(p, shot.q, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
    for (let i = 0; i < barrage.length; i++) {
      const active = t > TIME.bar(8) && t < TIME.bar(12);
      const cycle = (t * 128 / 60 - i * 0.18) % 2;
      const strength = active && cycle >= 0 && cycle < 0.38 ? 1 - cycle / 0.38 : 0;
      p.copy(barrage[i]); scale.setScalar(1 + strength * 8);
      if (!active || strength === 0) scale.setScalar(0);
      muzzle.setMatrixAt(i, matrix.compose(p, zeroQ, scale));
      p.x += Math.max(0, cycle) * 540;
      scale.set(active ? 26 : 0, active ? 0.48 : 0, active ? 0.48 : 0);
      broadside.setMatrixAt(i, matrix.compose(p, zeroQ, scale));
    }
    muzzle.instanceMatrix.needsUpdate = broadside.instanceMatrix.needsUpdate = true;
    for (const [mesh, count, sign] of [[distant, 110, 1], [allies, 80, -1]] as const) {
      for (let i = 0; i < count; i++) {
        const anchor = FLEET[4 + i % (FLEET.length - 4)];
        const a = t * (0.5 + (i % 4) * 0.04) * sign + i * 2.4;
        p.set(anchor.position[0] + Math.sin(a) * 72, anchor.position[1] + Math.cos(a * 1.3) * 40, anchor.position[2] + Math.cos(a) * 104);
        q.setFromAxisAngle(localForward, -a);
        scale.set(0.6, 0.26, 1.6);
        mesh.setMatrixAt(i, matrix.compose(p, q, scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    const victoryAge = state.victoryTime < 0 ? -1 : Math.max(0, runTime - state.victoryTime);
    ships.forEach((ship, i) => {
      if (i === 3 || FLEET[i].friendly) return;
      ship.root.position.set(...FLEET[i].position);
      ship.root.rotation.set(...FLEET[i].rotation);
      if (victoryAge >= 0) {
        ship.root.position.x += victoryAge * (7 + i);
        ship.root.position.y += Math.sin(i) * victoryAge * 6;
        ship.root.rotation.z += Math.sin(i * 3) * victoryAge * 0.015;
        ship.root.rotation.y += victoryAge * 0.02;
      }
    });
    shield.visible = !state.shieldsDown;
    shieldMaterial.opacity = 0.07 + beat * 0.035;
    if (victoryAge >= 0) {
      flagship.halves.forEach((half, i) => {
        half.position.x = (i === 0 ? -1 : 1) * (330 * 0.305 + victoryAge * 8) * WORLD_SCALE;
        half.rotation.z = (i === 0 ? -1 : 1) * victoryAge * 0.015;
        half.rotation.x = (i === 0 ? 1 : -1) * victoryAge * 0.006;
      });
    } else flagship.halves.forEach((half, i) => { half.position.x = (i === 0 ? -1 : 1) * 330 * 0.305 * WORLD_SCALE; half.rotation.set(0, 0, 0); });
    for (let i = 0; i < 56; i++) {
      const shipIndex = enemyIndices[i % enemyIndices.length];
      const ship = FLEET[shipIndex];
      const finale = victoryAge >= 0;
      const hot = finale ? Math.max(0, victoryAge - i * 0.035) : Math.max(0, Math.sin(t * 1.7 + i * 12) - 0.91) * 7;
      p.set(ship.position[0] + Math.sin(i * 33) * ship.width * 0.32, ship.position[1] + ship.height * 0.5, ship.position[2] + Math.sin(i * 7) * ship.length * 0.38);
      if (finale && i < 24) p.set(100 + Math.sin(i * 33) * 90, 55 + i * 3, -3630 + Math.sin(i * 7) * 490).multiplyScalar(WORLD_SCALE);
      const size = (finale ? Math.min(40, hot * 13) * (0.75 + Math.sin(t * 15 + i) * 0.12) : hot * 12) * WORLD_SCALE;
      scale.set(size, size * 1.6, size);
      fires.setMatrixAt(i, matrix.compose(p, zeroQ, scale));
    }
    fires.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 64; i++) {
      const a = i * 2.399;
      const age = Math.max(0, victoryAge - (i % 8) * 0.15);
      p.set(100 + Math.cos(a) * age * (18 + i), 35 + Math.sin(a) * age * 35, -3630 + Math.sin(i * 7) * 520 + Math.cos(a) * age * 40).multiplyScalar(WORLD_SCALE);
      q.setFromAxisAngle(new Vector3(0.3, 0.8, 0.5).normalize(), age * 0.6 + i);
      scale.setScalar(victoryAge < 0 ? 0 : (2 + i % 7) * WORLD_SCALE);
      debris.setMatrixAt(i, matrix.compose(p, q, scale));
    }
    debris.instanceMatrix.needsUpdate = true;
    shock.visible = victoryAge >= 0;
    if (shock.visible) {
      shock.position.copy(FLAGSHIP); shock.quaternion.copy(camera.quaternion);
      shock.scale.setScalar((80 + victoryAge * 240) * WORLD_SCALE);
      shock.material.opacity = Math.max(0, 0.7 - victoryAge * 0.08);
    }
    if (Math.abs(flash) > 0.02) {
      const sign = flash > 0 ? 1 : -1;
      camera.rotateZ(Math.sin(elapsed * 73) * Math.abs(flash) * 0.0025);
      fill.intensity = 1.5 + Math.abs(flash) * 2;
      fill.color.set(sign > 0 ? C.gold : C.crimson);
    } else { fill.intensity = 1.5; fill.color.set(0xb847c3); }
  }
  return {
    factories, update,
    dispose() {
      off.forEach(remove => remove());
      for (const resource of resources) resource.dispose();
      world.removeFromParent(); records.clear(); templates.clear();
    },
  };
}
