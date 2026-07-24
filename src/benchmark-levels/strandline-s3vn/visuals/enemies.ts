import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { tubeGeometry } from './animal';
import type { ShardSpec } from './effects';
import { LUME_GREEN, SICK_CORE, SICK_DARK, SICK_PALE, SICK_VIOLET, hdr } from './palette';

// THE INFESTATION. Every parasite is built from the same three materials: a
// matte violet-black shell that reads as a silhouette against the water, pale
// sickly chitin along its edges so the silhouette survives with bloom at zero,
// and one hot magenta organ that tells you where its life is. Nothing here is
// green — green belongs to the animal — so a violet shape anywhere on screen is
// always something to shoot.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'fill' | 'edge' | 'core';
};

type PartsBuilder = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
  fill(mesh: Mesh, color?: Color): Mesh;
  edge(mesh: Mesh, color?: Color, intensity?: number): Mesh;
  core(mesh: Mesh, color?: Color, intensity?: number): Mesh;
  shard(direction: Vector3, color: Color, size: number): void;
};

function builder(): PartsBuilder {
  const group = new Group();
  const parts: TintPart[] = [];
  const shards: ShardSpec[] = [];
  const add = (mesh: Mesh, kind: TintPart['kind'], base: Color): Mesh => {
    parts.push({ material: mesh.material as MeshBasicMaterial, base, kind });
    group.add(mesh);
    return mesh;
  };
  return {
    group,
    parts,
    shards,
    fill(mesh, color = SICK_DARK) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = SICK_PALE, intensity = 0.85) {
      mesh.material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = SICK_CORE, intensity = 1.3) {
      mesh.material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      return add(mesh, 'core', hdr(color, intensity));
    },
    shard(direction, color, size) {
      shards.push({ direction, color, size });
    },
  };
}

function finish(b: PartsBuilder, lockRingScale = 1) {
  b.group.userData.parts = b.parts;
  b.group.userData.shardSpecs = b.shards;
  b.group.userData.lockRingScale = lockRingScale;
  return b.group;
}

function box(w: number, h: number, d: number) {
  return new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
}

function ball(radius: number, segments = 10) {
  return new Mesh(new SphereGeometry(radius, segments, Math.max(4, segments - 3)), new MeshBasicMaterial());
}

/** A tapered filament trailing back along -Z. */
function filament(length: number, thickness: number, curve: number, color: Color) {
  const points: Vector3[] = [];
  const radii: number[] = [];
  const colors: Color[] = [];
  const steps = 9;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push(new Vector3(Math.sin(t * 3.4) * curve, Math.cos(t * 2.6) * curve * 0.6 - curve * 0.6, -t * length));
    radii.push(thickness * (1 - t * 0.85));
    colors.push(color.clone().multiplyScalar(0.9 - t * 0.75));
  }
  return tubeGeometry(points, radii, colors, 4);
}

// ---- cling: a clamped parasite that lets go when you get close -------------------

export function createClingMesh() {
  const b = builder();

  // The strand it has hold of, running clean through the frame. It goes dim
  // where the parasite bites and flushes green the moment it is cut off.
  const stubMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 0.45) });
  const stub = new Mesh(new CylinderGeometry(0.55, 0.55, 40, 7, 1, true), stubMaterial);
  stub.rotation.x = Math.PI / 2;
  stub.position.y = -1.15;
  b.group.add(stub);

  // Ribbed dome clamped down on the strand.
  const shellGeometry = new SphereGeometry(1.15, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const shell = new Mesh(shellGeometry, new MeshBasicMaterial({ side: DoubleSide }));
  shell.scale.set(1, 0.72, 1.15);
  b.fill(shell, SICK_DARK);

  const ribs: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI;
    ribs.push(new TorusGeometry(1.12, 0.055, 4, 16, Math.PI)
      .applyMatrix4(new Matrix4().makeRotationY(angle))
      .applyMatrix4(new Matrix4().makeScale(1, 0.74, 1.15)));
  }
  b.edge(new Mesh(mergeGeometries(ribs), new MeshBasicMaterial()), SICK_PALE, 0.8);
  for (const geometry of ribs) geometry.dispose();

  // Hooked legs wrapped under the strand — the grip you are breaking.
  const legs = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = box(0.16, 1.5, 0.16);
    leg.position.set(Math.cos(angle) * 0.85, -0.75, Math.sin(angle) * 0.95);
    leg.rotation.z = Math.cos(angle) * 0.55;
    leg.rotation.x = -Math.sin(angle) * 0.55;
    b.fill(leg, SICK_VIOLET.clone().multiplyScalar(0.4));
    legs.add(leg);
    b.shard(new Vector3(Math.cos(angle), -0.4, Math.sin(angle)), SICK_VIOLET.clone(), 0.3);
  }
  b.group.add(legs);

  const sac = ball(0.45, 10);
  sac.position.y = 0.62;
  sac.scale.set(1.1, 0.85, 1.1);
  b.core(sac, SICK_CORE, 1.35);

  b.shard(new Vector3(0, 1, 0), SICK_PALE.clone(), 0.45);
  b.shard(new Vector3(0, 0.3, 1), SICK_DARK.clone(), 0.4);
  b.shard(new Vector3(0, 0.3, -1), SICK_DARK.clone(), 0.4);

  const group = finish(b, 1.25);
  group.userData.stub = stubMaterial;
  group.userData.legs = legs;
  group.userData.sac = sac;
  return group;
}

// ---- drifter: free-swimming larva crossing the frame ------------------------------

export function createDrifterMesh() {
  const b = builder();

  const head = new Mesh(new OctahedronGeometry(0.62, 0), new MeshBasicMaterial());
  head.scale.set(0.85, 0.85, 2.3);
  head.position.z = 0.5;
  b.fill(head, SICK_DARK);

  const eye = ball(0.2, 8);
  eye.position.z = 1.5;
  b.core(eye, SICK_CORE, 1.5);

  // Two flat swimming vanes; the roll in its stroke is what you actually read.
  for (const side of [-1, 1]) {
    const vane = new Mesh(new PlaneGeometry(1.5, 0.5), new MeshBasicMaterial({ side: DoubleSide }));
    vane.position.set(side * 0.72, 0, 0.1);
    vane.rotation.z = side * 0.5;
    vane.rotation.y = side * 0.35;
    b.edge(vane, SICK_PALE, 0.5);
    b.shard(new Vector3(side, 0.2, 0), SICK_PALE.clone(), 0.35);
  }

  const spine = box(0.12, 0.12, 1.5);
  spine.position.z = -0.5;
  b.edge(spine, SICK_PALE, 0.65);

  const filaments = [
    filament(3.4, 0.1, 0.28, SICK_VIOLET),
    filament(2.8, 0.08, -0.32, SICK_VIOLET),
  ];
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(SICK_PALE, 0.6) });
  tailMaterial.vertexColors = true;
  const tail = new Mesh(mergeGeometries(filaments), tailMaterial);
  tail.position.z = -1.1;
  b.group.add(tail);
  for (const geometry of filaments) geometry.dispose();

  b.shard(new Vector3(0, 0, 1), SICK_DARK.clone(), 0.5);
  b.shard(new Vector3(0, 1, -0.4), SICK_VIOLET.clone(), 0.35);

  return finish(b, 1.1);
}

// ---- chewer: an armoured borer wound around a strand -------------------------------

export function createChewerMesh() {
  const b = builder();

  const stubMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 0.32) });
  const stub = new Mesh(new CylinderGeometry(0.62, 0.62, 30, 7, 1, true), stubMaterial);
  stub.rotation.x = Math.PI / 2;
  b.group.add(stub);

  const collar = new Mesh(new TorusGeometry(1.65, 0.62, 8, 20), new MeshBasicMaterial());
  b.fill(collar, SICK_DARK);

  const innerRing = new Mesh(new TorusGeometry(1.62, 0.12, 6, 24), new MeshBasicMaterial());
  innerRing.position.z = 0.55;
  b.core(innerRing, SICK_CORE, 0.95);

  // Shell plates: the first two hits take these off.
  const armour = new Group();
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const plate = box(1.35, 0.34, 1.5);
    plate.position.set(Math.cos(angle) * 1.85, Math.sin(angle) * 1.85, 0);
    plate.rotation.z = angle + Math.PI / 2;
    b.fill(plate, SICK_VIOLET.clone().multiplyScalar(0.42));
    armour.add(plate);
    const trim = box(1.3, 0.06, 0.1);
    trim.position.set(Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, 0.7);
    trim.rotation.z = angle + Math.PI / 2;
    b.edge(trim, SICK_PALE, 0.9);
    armour.add(trim);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0.2), SICK_VIOLET.clone(), 0.55);
  }
  b.group.add(armour);

  // Claw arms reaching forward around the strand.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    const arm = box(0.22, 0.22, 2.4);
    arm.position.set(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, -1.3);
    arm.rotation.x = Math.sin(angle) * 0.4;
    arm.rotation.y = -Math.cos(angle) * 0.4;
    b.fill(arm, SICK_DARK);
    const hook = box(0.3, 0.3, 0.5);
    hook.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, -2.4);
    b.edge(hook, SICK_PALE, 0.75);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.6), SICK_DARK.clone(), 0.4);
  }

  const snout = new Mesh(new ConeGeometry(0.85, 1.7, 10), new MeshBasicMaterial());
  snout.rotation.x = -Math.PI / 2;
  snout.position.z = -1.5;
  b.fill(snout, SICK_VIOLET.clone().multiplyScalar(0.55));

  const bite = new Mesh(new TorusGeometry(0.5, 0.09, 5, 14), new MeshBasicMaterial());
  bite.position.z = -2.3;
  b.core(bite, SICK_CORE, 1.6);

  const group = finish(b, 1.9);
  group.userData.armourGroup = armour;
  group.userData.stub = stubMaterial;
  return group;
}

// ---- stinger: a spitter holding station -----------------------------------------

export function createStingerMesh() {
  const b = builder();

  const bulb = ball(1.05, 12);
  bulb.scale.set(1, 1.05, 0.82);
  b.fill(bulb, SICK_DARK);

  const bands: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    bands.push(new TorusGeometry(1.02 - i * 0.12, 0.05, 4, 18)
      .applyMatrix4(new Matrix4().makeTranslation(0, 0, -0.15 + i * 0.28))
      .applyMatrix4(new Matrix4().makeScale(1, 1.05, 1)));
  }
  b.edge(new Mesh(mergeGeometries(bands), new MeshBasicMaterial()), SICK_PALE, 0.8);
  for (const geometry of bands) geometry.dispose();

  // Long proboscis: it is always pointed at you, which is the tell.
  const proboscis = new Mesh(new CylinderGeometry(0.09, 0.22, 2.3, 7), new MeshBasicMaterial());
  proboscis.rotation.x = Math.PI / 2;
  proboscis.position.z = 1.5;
  b.fill(proboscis, SICK_VIOLET.clone().multiplyScalar(0.5));

  const muzzle = ball(0.24, 8);
  muzzle.position.z = 2.6;
  const sac = b.core(muzzle, SICK_CORE, 1.2);

  // Splayed spines rearward: an unmistakable star silhouette.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const spine = box(0.14, 0.14, 2.1);
    spine.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.75, -1.3);
    spine.rotation.x = -Math.sin(angle) * 0.55;
    spine.rotation.y = Math.cos(angle) * 0.55;
    b.edge(spine, SICK_PALE, 0.7);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.7), SICK_PALE.clone(), 0.4);
  }

  const gill = new Mesh(new TorusGeometry(0.7, 0.1, 5, 16), new MeshBasicMaterial());
  gill.position.z = -0.6;
  b.core(gill, SICK_VIOLET, 0.9);

  b.shard(new Vector3(0, 1, 0.3), SICK_DARK.clone(), 0.5);
  b.shard(new Vector3(0, -1, 0.3), SICK_DARK.clone(), 0.5);

  const group = finish(b, 1.35);
  group.userData.chargeSac = sac;
  return group;
}

// ---- spore: the spat seed ---------------------------------------------------------

export function createSporeMesh() {
  const b = builder();

  const seed = new Mesh(new OctahedronGeometry(0.34, 0), new MeshBasicMaterial());
  seed.scale.set(0.8, 0.8, 1.7);
  b.core(seed, SICK_CORE, 1.9);

  const husk = new Mesh(new OctahedronGeometry(0.52, 0), new MeshBasicMaterial({ side: DoubleSide }));
  husk.scale.set(0.9, 0.9, 1.4);
  b.edge(husk, SICK_VIOLET, 0.8);

  const filaments = [filament(1.6, 0.06, 0.2, SICK_VIOLET), filament(1.2, 0.05, -0.22, SICK_VIOLET)];
  const sporeTailMaterial = createAdditiveBasicMaterial({ color: hdr(SICK_PALE, 0.7) });
  sporeTailMaterial.vertexColors = true;
  const tail = new Mesh(mergeGeometries(filaments), sporeTailMaterial);
  tail.position.z = -0.3;
  b.group.add(tail);
  for (const geometry of filaments) geometry.dispose();

  b.shard(new Vector3(0, 1, 0), SICK_VIOLET.clone(), 0.25);
  b.shard(new Vector3(0, -1, 0), SICK_VIOLET.clone(), 0.25);

  const group = finish(b, 0.9);
  group.userData.isHostileShot = true;
  return group;
}

// ---- brood: the parent's answer ----------------------------------------------------

export function createBroodMesh() {
  const b = builder();

  const bellGeometry = new SphereGeometry(1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bell = new Mesh(bellGeometry, new MeshBasicMaterial({ side: DoubleSide }));
  bell.rotation.x = -Math.PI / 2;
  bell.scale.set(1, 1, 0.8);
  b.fill(bell, SICK_DARK);

  const rim = new Mesh(new TorusGeometry(1.06, 0.09, 5, 24), new MeshBasicMaterial());
  b.edge(rim, SICK_PALE, 1.0);

  const heart = ball(0.42, 10);
  heart.position.z = 0.35;
  b.core(heart, SICK_CORE, 1.7);

  const arms: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    arms.push(filament(2.6, 0.13, 0.3, SICK_VIOLET)
      .applyMatrix4(new Matrix4().makeTranslation(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0)));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.3), SICK_VIOLET.clone(), 0.4);
  }
  const armMaterial = createAdditiveBasicMaterial({ color: hdr(SICK_PALE, 0.7) });
  armMaterial.vertexColors = true;
  const armMesh = new Mesh(mergeGeometries(arms), armMaterial);
  b.group.add(armMesh);
  for (const geometry of arms) geometry.dispose();

  b.shard(new Vector3(0, 0, 1), SICK_PALE.clone(), 0.5);

  return finish(b, 1.4);
}

// ---- the parent ----------------------------------------------------------------------

const WEB_PANELS = 3;

export function createParentMesh() {
  const b = builder();

  // Mantle: a lumpy sac wedged into the crown.
  const mantle = ball(11, 20);
  mantle.scale.set(1.15, 0.92, 1.0);
  b.fill(mantle, SICK_DARK);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const lump = ball(4.4 + (i % 2) * 1.4, 10);
    lump.position.set(Math.cos(angle) * 8.6, Math.sin(angle) * 6.4, -2.4);
    b.fill(lump, SICK_DARK.clone().multiplyScalar(1.25));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.4), SICK_VIOLET.clone(), 1.5);
  }

  const seams: BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI;
    seams.push(new TorusGeometry(11.2, 0.16, 4, 28, Math.PI * 1.2)
      .applyMatrix4(new Matrix4().makeRotationY(angle))
      .applyMatrix4(new Matrix4().makeScale(1.15, 0.92, 1)));
  }
  b.edge(new Mesh(mergeGeometries(seams), new MeshBasicMaterial()), SICK_PALE, 0.9);
  for (const geometry of seams) geometry.dispose();

  // The heart, visible through the mouth of the mantle.
  const heart = ball(4.6, 16);
  heart.position.z = 6.2;
  const heartMesh = b.core(heart, SICK_CORE, 1.5);

  const mouth = new Mesh(new TorusGeometry(6.4, 0.5, 6, 30), new MeshBasicMaterial());
  mouth.position.z = 5.4;
  b.edge(mouth, SICK_VIOLET, 1.1);

  // Anchor roots: it is physically dug into the crown behind it.
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const root = box(1.1, 1.1, 17);
    root.position.set(Math.cos(angle) * 8, Math.sin(angle) * 8, -11);
    root.rotation.x = -Math.sin(angle) * 0.35;
    root.rotation.y = Math.cos(angle) * 0.35;
    b.fill(root, SICK_VIOLET.clone().multiplyScalar(0.38));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -1), SICK_DARK.clone(), 0.9);
  }

  // Webbing: three fans of lattice hung in front of the mantle. Each dies back
  // when the brood it was feeding is cut down.
  const panels: Group[] = [];
  for (let panel = 0; panel < WEB_PANELS; panel += 1) {
    const group = new Group();
    const bars: BufferGeometry[] = [];
    const sector = (Math.PI * 2) / WEB_PANELS;
    const spanStart = panel * sector;
    // Radial spokes, thrown forward off the mantle.
    for (let i = 0; i <= 6; i += 1) {
      const angle = spanStart + (i / 6) * sector;
      bars.push(new BoxGeometry(22, 0.42, 0.42)
        .applyMatrix4(new Matrix4().makeTranslation(17, 0, 0))
        .applyMatrix4(new Matrix4().makeRotationZ(angle))
        .applyMatrix4(new Matrix4().makeTranslation(0, 0, 9)));
    }
    // Concentric strands strung between them, bellying out toward you.
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = 8 + ring * 6.5;
      bars.push(new TorusGeometry(radius, 0.32, 4, 30, sector)
        .applyMatrix4(new Matrix4().makeRotationZ(spanStart))
        .applyMatrix4(new Matrix4().makeTranslation(0, 0, 12 - ring * 1.6)));
    }
    const material = createAdditiveBasicMaterial({ color: hdr(SICK_VIOLET, 0.95) });
    const mesh = new Mesh(mergeGeometries(bars), material);
    group.add(mesh);
    group.userData.material = material;
    b.group.add(group);
    panels.push(group);
    for (const geometry of bars) geometry.dispose();
  }

  const group = finish(b, 14);
  group.userData.isParent = true;
  group.userData.webPanelGroups = panels;
  group.userData.heart = heartMesh;
  return group;
}

/** Take a chewer's shell plates off when its first stage breaks. */
export function breakChewerArmour(mesh: Group) {
  const armour = mesh.userData.armourGroup as Group | undefined;
  if (armour) armour.visible = false;
}
