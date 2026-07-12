import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, IcosahedronGeometry, Line, LineBasicMaterial,
  Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Points, PointsMaterial,
  Quaternion, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { sampleRailFrame } from '../../../engine/rail';
import { createMassDriverRail, massDriverRunProgress } from '../gameplay';
import { MASS_DRIVER_BPM, MASS_DRIVER_DURATION } from '../timing';

const INK = 0x01030a;
const STEEL = 0x07101f;
const ARC = 0x189cff;
const VIOLET = 0x7b38ff;
const WHITE = 0xe9f8ff;
const WARNING = 0xff2f9b;
const BEAT_SECONDS = 60 / MASS_DRIVER_BPM;
const BEAT_COUNT = Math.round(MASS_DRIVER_DURATION / BEAT_SECONDS);
const Z_AXIS = new Vector3(0, 0, 1);

const basic = (color: number, options: { transparent?: boolean; opacity?: number; side?: typeof DoubleSide } = {}) =>
  new MeshBasicMaterial({ color, transparent: options.transparent, opacity: options.opacity, side: options.side });

function hotMaterial(progress: number, boost = 1) {
  const color = new Color();
  if (progress < 0.62) color.lerpColors(new Color(ARC), new Color(VIOLET), progress / 0.62);
  else color.lerpColors(new Color(VIOLET), new Color(WHITE), (progress - 0.62) / 0.38);
  color.multiplyScalar((1.05 + progress * 1.55) * boost);
  return new MeshBasicMaterial({ color });
}

function orientToTangent(object: Object3D, tangent: Vector3) {
  object.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, tangent.clone().normalize()));
}

export type MassDriverEnvironment = {
  update(dt: number, runTime: number, running: boolean): void;
  dispose(): void;
};

export function createEnvironment(scene: Scene): MassDriverEnvironment {
  const root = new Group();
  root.name = 'mass-driver-environment';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  const curve = createMassDriverRail();
  const ringGeometry = new TorusGeometry(10.8, 0.115, 5, 56);
  const collarGeometry = new TorusGeometry(11.55, 0.035, 4, 40);
  const rings: Array<{ ring: Mesh; collar: Mesh; material: MeshBasicMaterial; base: Color; index: number }> = [];

  // One accelerator ring per beat. Each is placed at the distance the payload
  // reaches on that beat; spacing therefore stretches as the speed curve rises.
  for (let beat = 1; beat <= BEAT_COUNT; beat += 1) {
    const time = beat * BEAT_SECONDS;
    const u = massDriverRunProgress(time, MASS_DRIVER_DURATION);
    const frame = sampleRailFrame(curve, u);
    const progress = beat / BEAT_COUNT;
    const material = hotMaterial(progress);
    const ring = new Mesh(ringGeometry, material);
    ring.position.copy(frame.position);
    orientToTangent(ring, frame.tangent);
    root.add(ring);
    const collar = new Mesh(collarGeometry, basic(progress > 0.72 ? VIOLET : 0x163e75));
    collar.position.copy(frame.position);
    collar.quaternion.copy(ring.quaternion);
    collar.scale.setScalar(1.025);
    root.add(collar);
    rings.push({ ring, collar, material, base: material.color.clone(), index: beat - 1 });
  }

  // Eight dark rails and their electric conductor seams make the rings read as
  // one enormous machine rather than a loose neon tunnel.
  const length = 2860;
  for (let i = 0; i < 8; i += 1) {
    const a = i / 8 * Math.PI * 2;
    const x = Math.cos(a) * 12.1;
    const y = Math.sin(a) * 12.1;
    const beam = new Mesh(new BoxGeometry(0.65, 0.65, length), basic(STEEL));
    beam.position.set(x, y, -length / 2);
    beam.rotation.z = a;
    root.add(beam);
    const seam = new Mesh(new BoxGeometry(0.055, 0.055, length), basic(i % 2 ? 0x174d86 : 0x351d7e));
    seam.position.set(x * 0.986, y * 0.986, -length / 2);
    root.add(seam);
  }

  // Sparse exterior stars become visible through the muzzle during launch.
  const starPositions: number[] = [];
  for (let i = 0; i < 520; i += 1) {
    const seed = i * 12.9898;
    const a = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
    const radius = 45 + (((Math.sin(seed * 1.71) * 19231.13) % 1 + 1) % 1) * 180;
    const z = -2720 - (((Math.sin(seed * 2.31) * 7319.7) % 1 + 1) % 1) * 900;
    starPositions.push(Math.cos(a) * radius, Math.sin(a) * radius, z);
  }
  const starsGeometry = new BufferGeometry();
  starsGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  const stars = new Points(starsGeometry, new PointsMaterial({ color: WHITE, size: 0.38, sizeAttenuation: true }));
  root.add(stars);

  let charge = 0;
  return {
    update(dt, runTime, running) {
      const beatFloat = running ? runTime / BEAT_SECONDS : 0;
      const current = Math.floor(beatFloat);
      const pulse = Math.exp(-((beatFloat - current) % 1) * 7.5);
      for (const item of rings) {
        const distance = item.index - current;
        const wake = distance === 0 ? pulse : (distance > 0 && distance < 5 ? (5 - distance) * 0.035 : 0);
        item.material.color.copy(item.base).multiplyScalar(1 + wake * 2.8);
        item.ring.scale.setScalar(1 + wake * 0.028);
        item.collar.rotation.z += dt * (item.index % 2 ? 0.05 : -0.05);
      }
      if (running && runTime > MASS_DRIVER_DURATION * 0.72) charge = Math.min(1, charge + dt / 15);
      else charge = Math.max(0, charge - dt * 0.8);
      stars.material.color.setRGB(0.75 + charge * 1.3, 0.86 + charge * 1.1, 1 + charge * 1.6);
    },
    dispose() {
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof Mesh || object instanceof Points || object instanceof Line) {
          object.geometry.dispose();
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of mats) material.dispose();
        }
      });
    },
  };
}

type Transient = { object: Object3D; age: number; life: number; material?: MeshBasicMaterial; grow: number; spin: number };

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  const root = new Group();
  root.name = 'mass-driver-effects';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  const effects: Transient[] = [];
  const disposers: Array<() => void> = [];

  const pulse = (position: Vector3, color: number, radius: number, life: number, grow = 5) => {
    const material = basic(color, { transparent: true, opacity: 0.92, side: DoubleSide });
    const mesh = new Mesh(new RingGeometry(radius * 0.72, radius, 28), material);
    mesh.position.copy(position);
    root.add(mesh);
    effects.push({ object: mesh, age: 0, life, material, grow, spin: 2.2 });
  };
  const burst = (position: Vector3, color: number, count: number, scale: number) => {
    for (let i = 0; i < count; i += 1) {
      const shard = new Mesh(new OctahedronGeometry(scale * (0.45 + (i % 3) * 0.18), 0), hotMaterial(0.8, 1.25));
      const a = i / count * Math.PI * 2;
      shard.position.copy(position).add(new Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0));
      shard.userData.velocity = new Vector3(Math.cos(a) * (5 + i % 4), Math.sin(a) * (5 + (i + 2) % 4), (i % 2 - 0.5) * 5);
      root.add(shard);
      effects.push({ object: shard, age: 0, life: 0.55, grow: 0, spin: i % 2 ? 7 : -7 });
    }
  };

  disposers.push(bus.on('spawn', ({ worldPosition, kind }) => pulse(worldPosition, kind === 'interlock' ? WARNING : ARC, 0.28, 0.28, 2.5)));
  disposers.push(bus.on('lock', ({ worldPosition, lockCount }) => pulse(worldPosition, lockCount === 6 ? WHITE : VIOLET, 0.38, 0.3, 4.2)));
  disposers.push(bus.on('unlock', ({ worldPosition }) => pulse(worldPosition, 0x28486e, 0.42, 0.22, -1.5)));
  disposers.push(bus.on('fire', ({ worldPosition, volleySize }) => pulse(worldPosition, volleySize === 6 ? WHITE : ARC, 0.25, 0.32, 8)));
  disposers.push(bus.on('hit', ({ worldPosition, lethal }) => {
    pulse(worldPosition, lethal ? WHITE : VIOLET, 0.24, 0.34, 5);
    if (!lethal) burst(worldPosition, VIOLET, 4, 0.12);
  }));
  disposers.push(bus.on('kill', ({ worldPosition }) => { pulse(worldPosition, WHITE, 0.5, 0.7, 12); burst(worldPosition, ARC, 12, 0.2); }));
  disposers.push(bus.on('stage', ({ worldPosition }) => { pulse(worldPosition, WARNING, 0.7, 0.55, 8); burst(worldPosition, VIOLET, 8, 0.16); }));
  disposers.push(bus.on('miss', ({ worldPosition }) => pulse(worldPosition, WARNING, 0.34, 0.48, 5)));
  disposers.push(bus.on('reject', () => pulse(new Vector3(0, 0, -5), WARNING, 0.7, 0.32, 5)));
  disposers.push(bus.on('playerhit', () => {
    for (let i = 0; i < 5; i += 1) pulse(new Vector3(0, 0, -3 - i * 1.4), WARNING, 2 + i, 0.65, 18);
  }));

  return {
    update(dt: number) {
      for (let i = effects.length - 1; i >= 0; i -= 1) {
        const fx = effects[i];
        fx.age += dt;
        fx.object.rotation.z += dt * fx.spin;
        const velocity = fx.object.userData.velocity as Vector3 | undefined;
        if (velocity) fx.object.position.addScaledVector(velocity, dt);
        if (fx.grow) fx.object.scale.addScalar(dt * fx.grow);
        if (fx.material) fx.material.opacity = Math.max(0, 1 - fx.age / fx.life);
        if (fx.age >= fx.life) {
          root.remove(fx.object);
          fx.object.traverse((object) => {
            if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
          });
          effects.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const dispose of disposers) dispose();
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
      });
    },
  };
}

function markMaterials(root: Object3D, base: MeshBasicMaterial[], hot: MeshBasicMaterial[]) {
  root.userData.baseMaterials = base;
  root.userData.hotMaterials = hot;
}

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  const group = new Group();
  const bases: MeshBasicMaterial[] = [];
  const hots: MeshBasicMaterial[] = [];
  const add = (geometry: BufferGeometry, color: number, position = new Vector3(), rotationZ = 0, hot = false) => {
    const material = hot ? hotMaterial(0.55) : basic(color);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.rotation.z = rotationZ;
    group.add(mesh);
    (hot ? hots : bases).push(material);
    return mesh;
  };

  if (kind === 'skimmer') {
    add(new ConeGeometry(0.72, 3.1, 3), STEEL, new Vector3(0, 0, 0), Math.PI / 2);
    add(new BoxGeometry(4.2, 0.16, 1.05), 0x102c50);
    add(new BoxGeometry(2.9, 0.05, 1.5), ARC, new Vector3(-0.15, 0, 0), 0, true);
    add(new SphereGeometry(0.32, 8, 6), WHITE, new Vector3(1.2, 0, 0), 0, true);
  } else if (kind === 'weaver') {
    add(new TorusGeometry(1.15, 0.18, 5, 18), 0x17355e);
    add(new TorusGeometry(0.72, 0.06, 4, 16), VIOLET, new Vector3(), Math.PI / 2, true);
    for (let i = 0; i < 3; i += 1) {
      const a = i / 3 * Math.PI * 2;
      add(new OctahedronGeometry(0.38, 0), STEEL, new Vector3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0));
    }
    add(new SphereGeometry(0.36, 10, 7), ARC, new Vector3(), 0, true);
  } else if (kind === 'clamp') {
    add(new BoxGeometry(2.8, 0.9, 1.2), STEEL);
    add(new BoxGeometry(0.55, 4.1, 0.85), 0x132a49);
    add(new BoxGeometry(0.16, 3.4, 1.05), VIOLET, new Vector3(), 0, true);
    add(new SphereGeometry(0.5, 10, 7), ARC, new Vector3(0, 0, 0.7), 0, true);
  } else {
    add(new BoxGeometry(3.7, 1.55, 1.3), 0x17243b);
    add(new BoxGeometry(0.7, 4.5, 1.0), 0x2b3150);
    add(new TorusGeometry(1.22, 0.13, 5, 20), WARNING, new Vector3(0, 0, 0.75), 0, true);
    add(new IcosahedronGeometry(0.58, 1), WHITE, new Vector3(0, 0, 1), 0, true);
    for (const x of [-1.45, 1.45]) add(new CylinderGeometry(0.18, 0.18, 2.8, 6), VIOLET, new Vector3(x, 0, 0), 0, true);
  }
  markMaterials(group, bases, hots);
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  const bases = mesh.userData.baseMaterials as MeshBasicMaterial[] | undefined;
  const hots = mesh.userData.hotMaterials as MeshBasicMaterial[] | undefined;
  for (const material of bases ?? []) material.color.set(locked ? 0x245da0 : STEEL);
  for (const material of hots ?? []) material.color.setRGB(locked ? 1.2 + lockCount * 0.18 : 0.18, locked ? 0.4 + lockCount * 0.08 : 0.65, locked ? 1.8 : 1.25);
  mesh.scale.setScalar(locked ? 1.08 + lockCount * 0.012 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  const materials = [...((mesh.userData.baseMaterials as MeshBasicMaterial[] | undefined) ?? []), ...((mesh.userData.hotMaterials as MeshBasicMaterial[] | undefined) ?? [])];
  for (const material of materials) material.color.set(WARNING);
  mesh.scale.set(1.28, 0.72, 1.28);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(0.18, 8, 6), hotMaterial(1, 1.8));
  const tail = new Mesh(new ConeGeometry(0.22, 1.6, 6), basic(VIOLET));
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 0.7;
  group.add(core, tail);
  return group;
}

export function createReticle() {
  const group = new Group();
  const material = hotMaterial(0.5, 1.25);
  const outer = new Mesh(new RingGeometry(0.48, 0.53, 32), material);
  const inner = new Mesh(new RingGeometry(0.12, 0.15, 20), basic(WHITE));
  const ticks = new Group();
  for (let i = 0; i < 6; i += 1) {
    const tick = new Mesh(new BoxGeometry(0.08, 0.26, 0.03), basic(ARC));
    const a = i / 6 * Math.PI * 2;
    tick.position.set(Math.cos(a) * 0.68, Math.sin(a) * 0.68, 0);
    tick.rotation.z = a;
    ticks.add(tick);
  }
  group.add(outer, inner, ticks);
  group.userData.outer = outer;
  group.userData.ticks = ticks;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.rotation.z += active ? 0.014 + lockCount * 0.002 : 0.004;
  reticle.scale.setScalar(1 + lockCount * 0.035 + (active ? 0.08 : 0));
  const outer = reticle.userData.outer as Mesh | undefined;
  if (outer) (outer.material as MeshBasicMaterial).color.set(lockCount === 6 ? WHITE : active ? VIOLET : ARC);
  const ticks = reticle.userData.ticks as Group | undefined;
  if (ticks) ticks.children.forEach((tick, i) => { tick.visible = i < Math.max(1, lockCount); });
}

function createLetterMesh(character: string) {
  const group = new Group();
  const base: MeshBasicMaterial[] = [];
  const hot: MeshBasicMaterial[] = [];
  const frameMaterial = basic(0x17355e);
  base.push(frameMaterial);
  group.add(new Mesh(new BoxGeometry(2.2, 3.0, 0.16), frameMaterial));
  const cellGeometry = new BoxGeometry(0.29, 0.29, 0.13);
  for (const cell of glyphOnCells(character)) {
    const material = hotMaterial(cell.y / 8 + 0.3);
    hot.push(material);
    const pad = new Mesh(cellGeometry, material);
    pad.position.set((cell.x - 2) * 0.36, (3 - cell.y) * 0.36, 0.18);
    group.add(pad);
  }
  const frame = new Mesh(new TorusGeometry(1.82, 0.045, 5, 32), basic(VIOLET));
  frame.scale.y = 0.88;
  group.add(frame);
  hot.push(frame.material as MeshBasicMaterial);
  markMaterials(group, base, hot);
  return group;
}
