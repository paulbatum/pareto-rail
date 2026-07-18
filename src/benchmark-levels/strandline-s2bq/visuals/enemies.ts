import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { BIO_GREEN, PARASITE_HOT, PARASITE_MURK, PARASITE_VIOLET, VENOM_GREEN, WARM_WHITE, hdr } from './palette';

// The infestation: every hostile silhouette is built from the same grammar —
// murk-dark chitin mass, sickly violet membrane edges, and one hot magenta
// feeding organ. Nothing friendly in the level wears violet, so a parasite
// reads as a parasite at any distance, against strand-glow or open blue.

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
    fill(mesh, color = PARASITE_MURK) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = PARASITE_VIOLET, intensity = 0.9) {
      mesh.material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = PARASITE_HOT, intensity = 1.3) {
      mesh.material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      return add(mesh, 'core', hdr(color, intensity));
    },
    shard(direction, color, size) {
      shards.push({ direction, color, size });
    },
  };
}

function finish(b: PartsBuilder, accent: Color, lockRingScale = 1) {
  b.group.userData.parts = b.parts;
  b.group.userData.shardSpecs = b.shards;
  b.group.userData.accent = accent.clone();
  b.group.userData.lockRingScale = lockRingScale;
  return b.group;
}

function box(w: number, h: number, d: number) {
  return new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
}

function orb(radius: number, w = 10, h = 8) {
  return new Mesh(new SphereGeometry(radius, w, h), new MeshBasicMaterial());
}

// ---- leech: a hooked crescent that clamps strands and swims off them --------

export function createLeechMesh() {
  const b = builder();
  // Three chitin segments bent into a crescent, nose along +Z.
  const bends = [
    { z: 0.55, y: 0.0, scale: 0.85, tilt: -0.5 },
    { z: 0.0, y: 0.32, scale: 1.05, tilt: 0 },
    { z: -0.55, y: 0.0, scale: 0.85, tilt: 0.5 },
  ];
  for (const bend of bends) {
    const segment = orb(0.42);
    segment.scale.set(0.8, 0.62, 1.0).multiplyScalar(bend.scale);
    segment.position.set(0, bend.y, bend.z);
    segment.rotation.x = bend.tilt;
    b.fill(segment, PARASITE_MURK.clone().lerp(PARASITE_VIOLET, 0.18));
    b.shard(new Vector3(0, bend.y + 0.3, bend.z).normalize(), PARASITE_VIOLET.clone(), 0.4);
  }
  // Violet membrane fins along the back.
  for (const side of [-1, 1]) {
    const fin = box(0.06, 0.5, 1.3);
    fin.position.set(side * 0.22, 0.42, 0);
    fin.rotation.z = side * 0.5;
    b.edge(fin, PARASITE_VIOLET, 0.7);
  }
  // The mouth hooks: two dark barbs the clamp hangs from.
  for (const side of [-1, 1]) {
    const hook = new Mesh(new ConeGeometry(0.13, 0.55, 6), new MeshBasicMaterial());
    hook.position.set(side * 0.18, -0.18, 0.75);
    hook.rotation.x = Math.PI * 0.62;
    b.fill(hook, PARASITE_MURK.clone().multiplyScalar(1.4));
  }
  // Feeding organ: the hot mouth ring between the hooks.
  const mouth = new Mesh(new TorusGeometry(0.16, 0.05, 8, 16), new MeshBasicMaterial());
  mouth.position.set(0, -0.12, 0.72);
  b.core(mouth, PARASITE_HOT, 1.5);
  b.shard(new Vector3(0, -0.5, 0.8).normalize(), PARASITE_HOT.clone(), 0.32);
  b.shard(new Vector3(0, 0.2, -0.9).normalize(), PARASITE_VIOLET.clone(), 0.36);
  return finish(b, PARASITE_HOT);
}

// ---- mite: a spiked tick, all jitter ----------------------------------------

export function createMiteMesh() {
  const b = builder();
  const body = new Mesh(new OctahedronGeometry(0.42, 0), new MeshBasicMaterial());
  body.scale.set(1, 0.75, 1);
  b.fill(body, PARASITE_MURK.clone().lerp(PARASITE_VIOLET, 0.28));
  // Six chitin spikes on the equator.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const spike = new Mesh(new ConeGeometry(0.09, 0.62, 5), new MeshBasicMaterial());
    spike.position.set(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5);
    spike.rotation.z = Math.PI / 2;
    spike.rotation.y = -angle;
    b.fill(spike, PARASITE_MURK.clone().multiplyScalar(1.5));
    if (i % 2 === 0) b.shard(new Vector3(Math.cos(angle), 0.2, Math.sin(angle)), PARASITE_VIOLET.clone(), 0.3);
  }
  const rim = new Mesh(new TorusGeometry(0.5, 0.035, 6, 18), new MeshBasicMaterial());
  rim.rotation.x = Math.PI / 2;
  b.edge(rim, PARASITE_VIOLET, 0.85);
  const eye = orb(0.16, 8, 6);
  b.core(eye, PARASITE_HOT, 1.6);
  b.shard(new Vector3(0, 1, 0), PARASITE_HOT.clone(), 0.26);
  return finish(b, PARASITE_HOT);
}

// ---- spitter: a bloated venom sac with a readable swelling telegraph --------

export function createSpitterMesh() {
  const b = builder();
  const sac = orb(0.62, 12, 10);
  sac.scale.set(1, 1.2, 0.95);
  b.fill(sac, PARASITE_MURK.clone().lerp(PARASITE_VIOLET, 0.22));
  // Venom glands glowing through the membrane.
  const glandMaterialMesh = orb(0.5, 10, 8);
  glandMaterialMesh.scale.set(0.85, 1.05, 0.8);
  const gland = b.core(glandMaterialMesh, VENOM_GREEN.clone().lerp(PARASITE_VIOLET, 0.35), 0.35);
  b.group.userData.chargeGland = (gland.material as MeshBasicMaterial);
  // A collar of drooping spines.
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const spine = new Mesh(new ConeGeometry(0.08, 0.7, 5), new MeshBasicMaterial());
    spine.position.set(Math.cos(angle) * 0.55, 0.55, Math.sin(angle) * 0.4);
    spine.rotation.z = Math.cos(angle) * 0.7;
    spine.rotation.x = -Math.sin(angle) * 0.5;
    b.fill(spine, PARASITE_MURK.clone().multiplyScalar(1.35));
  }
  // The siphon: a puckered mouth aimed at you.
  const siphon = new Mesh(new ConeGeometry(0.2, 0.5, 8), new MeshBasicMaterial());
  siphon.position.set(0, -0.35, 0.6);
  siphon.rotation.x = Math.PI * 0.5;
  b.fill(siphon, PARASITE_MURK.clone().multiplyScalar(1.5));
  const siphonLip = new Mesh(new TorusGeometry(0.14, 0.045, 8, 14), new MeshBasicMaterial());
  siphonLip.position.set(0, -0.35, 0.86);
  b.core(siphonLip, VENOM_GREEN, 1.2);
  b.group.userData.siphonLip = (siphonLip.material as MeshBasicMaterial);
  b.shard(new Vector3(0, 1, 0), PARASITE_VIOLET.clone(), 0.42);
  b.shard(new Vector3(0.7, -0.4, 0.3).normalize(), VENOM_GREEN.clone(), 0.36);
  b.shard(new Vector3(-0.7, -0.2, 0.4).normalize(), PARASITE_HOT.clone(), 0.3);
  return finish(b, VENOM_GREEN, 1.2);
}

// ---- cyst: an armored egg-case gripping a strand; cracks, then bursts -------

export function createCystMesh() {
  const b = builder();
  // Overlapping shell plates around a swollen case.
  const caseMesh = orb(0.62, 10, 8);
  caseMesh.scale.set(0.95, 1.15, 0.95);
  b.fill(caseMesh, PARASITE_MURK.clone().multiplyScalar(1.25));
  const plates: Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    const plate = box(0.5, 0.66, 0.14);
    plate.position.set(Math.cos(angle) * 0.5, 0.12 + (i % 2) * 0.18, Math.sin(angle) * 0.5);
    plate.rotation.y = -angle + Math.PI / 2;
    plate.rotation.z = 0.15;
    b.fill(plate, PARASITE_MURK.clone().lerp(PARASITE_VIOLET, 0.3).multiplyScalar(1.1));
    plates.push(plate);
    b.shard(new Vector3(Math.cos(angle), 0.3, Math.sin(angle)), PARASITE_VIOLET.clone(), 0.44);
  }
  b.group.userData.plates = plates;
  // The seam: an equatorial glow line that goes hot when the shell cracks.
  const seam = new Mesh(new TorusGeometry(0.58, 0.045, 8, 22), new MeshBasicMaterial());
  seam.rotation.x = Math.PI / 2;
  seam.position.y = 0.1;
  const seamPart = b.core(seam, PARASITE_VIOLET, 0.8);
  b.group.userData.seam = (seamPart.material as MeshBasicMaterial);
  // Grip roots below: it is fastened to the strand it is strangling.
  for (const side of [-1, 0.2, 1]) {
    const root = new Mesh(new ConeGeometry(0.1, 0.7, 5), new MeshBasicMaterial());
    root.position.set(side * 0.3, -0.72, 0);
    root.rotation.x = Math.PI;
    b.fill(root, PARASITE_MURK.clone().multiplyScalar(1.4));
  }
  b.shard(new Vector3(0, -1, 0), PARASITE_HOT.clone(), 0.4);
  b.shard(new Vector3(0, 1, 0), PARASITE_VIOLET.clone(), 0.4);
  return finish(b, PARASITE_VIOLET, 1.15);
}

// ---- bolt: a swimming venom glob ---------------------------------------------

export function createBoltMesh() {
  const b = builder();
  const bead = orb(0.24, 8, 6);
  b.core(bead, VENOM_GREEN, 2.0);
  const halo = orb(0.4, 8, 6);
  const haloPart = b.core(halo, VENOM_GREEN.clone().lerp(PARASITE_VIOLET, 0.4), 0.5);
  (haloPart.material as MeshBasicMaterial).opacity = 0.5;
  const tail = new Mesh(new ConeGeometry(0.16, 0.8, 6), new MeshBasicMaterial());
  tail.position.z = -0.5;
  tail.rotation.x = -Math.PI / 2;
  b.edge(tail, VENOM_GREEN, 0.8);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = VENOM_GREEN.clone().multiplyScalar(0.5);
  b.shard(new Vector3(0, 0, 1), VENOM_GREEN.clone(), 0.3);
  return finish(b, VENOM_GREEN, 0.8);
}

// ---- brood: a larval wriggler off the Matriarch ------------------------------

export function createBroodMesh() {
  const b = builder();
  // A tapering chain of larval segments, tail curling — merged to one draw.
  const segmentGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const radius = 0.34 - i * 0.055;
    const segment = new SphereGeometry(radius, 10, 8);
    segment.translate(0, i * -0.42 + 0.5, Math.sin(i * 1.1) * 0.12);
    segmentGeometries.push(segment);
    if (i % 2 === 1) b.shard(new Vector3(Math.sin(i), -0.4, 0.3).normalize(), PARASITE_HOT.clone(), 0.32);
  }
  const chain = new Mesh(mergeGeometries(segmentGeometries), new MeshBasicMaterial());
  for (const geometry of segmentGeometries) geometry.dispose();
  b.fill(chain, PARASITE_MURK.clone().lerp(PARASITE_HOT, 0.24));
  // A translucent yolk glow in the head — fresh from the sac.
  const yolk = orb(0.24, 8, 6);
  yolk.position.y = 0.5;
  b.core(yolk, PARASITE_HOT, 1.5);
  // Cilia fringe.
  for (const side of [-1, 1]) {
    const fringe = box(0.05, 1.4, 0.28);
    fringe.position.set(side * 0.28, -0.1, 0);
    fringe.rotation.z = side * 0.25;
    b.edge(fringe, PARASITE_VIOLET, 0.75);
  }
  b.shard(new Vector3(0, 1, 0), PARASITE_HOT.clone(), 0.3);
  b.shard(new Vector3(0, -1, 0.2).normalize(), PARASITE_VIOLET.clone(), 0.34);
  return finish(b, PARASITE_HOT);
}

// ---- the Matriarch: the parent organism dug into the crown -------------------

export function createMatriarchMesh() {
  const b = builder();

  // Carapace: three stacked chitin discs, widest forward, like a burrowing
  // tick seen head-on. Scaled to read at 100 m and still hold up at 20.
  const discs = [
    { radius: 3.2, y: 0, depth: 1.4 },
    { radius: 2.4, y: 1.6, depth: 1.2 },
    { radius: 1.5, y: 2.9, depth: 1.0 },
  ];
  for (const disc of discs) {
    const shell = orb(disc.radius, 14, 10);
    shell.scale.set(1, 0.55, disc.depth / disc.radius);
    shell.position.y = disc.y;
    b.fill(shell, PARASITE_MURK.clone().multiplyScalar(1.3));
    const rim = new Mesh(new TorusGeometry(disc.radius * 0.92, 0.09, 8, 26), new MeshBasicMaterial());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = disc.y + 0.12;
    b.edge(rim, PARASITE_VIOLET, 0.9);
  }

  // Grip hooks: eight segmented legs arched up and outward into the crown.
  const hooks: Group[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + 0.2;
    const leg = new Group();
    const upper = box(0.32, 2.6, 0.32);
    upper.position.y = 1.3;
    upper.rotation.z = 0.5;
    b.fill(upper, PARASITE_MURK.clone().multiplyScalar(1.5));
    leg.add(upper);
    const clawMesh = new Mesh(new ConeGeometry(0.22, 1.5, 6), new MeshBasicMaterial());
    clawMesh.position.set(1.15, 2.4, 0);
    clawMesh.rotation.z = -0.9;
    b.fill(clawMesh, PARASITE_MURK.clone().lerp(PARASITE_VIOLET, 0.35).multiplyScalar(1.2));
    leg.add(clawMesh);
    // b.fill added them to b.group; re-home into the leg group.
    leg.add(upper, clawMesh);
    leg.position.set(Math.cos(angle) * 2.6, 0.4, Math.sin(angle) * 2.0);
    leg.rotation.y = -angle;
    b.group.add(leg);
    hooks.push(leg);
    b.shard(new Vector3(Math.cos(angle), 0.5, Math.sin(angle)), PARASITE_VIOLET.clone(), 0.6);
  }
  b.group.userData.hooks = hooks;

  // The egg sac: her one soft place, hanging beneath the carapace — the
  // stage target. Hot membrane over a churning brood mass.
  const sacGroup = new Group();
  const sacOuter = orb(1.5, 14, 12);
  sacOuter.scale.set(1, 1.25, 1);
  const sacOuterPart = b.core(sacOuter, PARASITE_VIOLET, 0.45);
  (sacOuterPart.material as MeshBasicMaterial).opacity = 0.55;
  const sacInner = orb(1.0, 12, 10);
  sacInner.scale.set(1, 1.2, 1);
  const sacInnerPart = b.core(sacInner, PARASITE_HOT, 1.1);
  sacGroup.add(sacOuter, sacInner);
  sacGroup.position.y = -2.3;
  b.group.add(sacGroup);
  b.group.userData.sac = sacGroup;
  b.group.userData.sacMembrane = (sacOuterPart.material as MeshBasicMaterial);
  b.group.userData.sacCore = (sacInnerPart.material as MeshBasicMaterial);

  // Feeding mouthparts between sac and carapace: one merged ring of barbs.
  const barbGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const barb = new ConeGeometry(0.16, 0.9, 5);
    barb.rotateX(Math.PI + Math.sin(angle) * 0.4);
    barb.rotateZ(Math.cos(angle) * 0.8);
    barb.translate(Math.cos(angle) * 1.1, -1.0, Math.sin(angle) * 1.1);
    barbGeometries.push(barb);
  }
  const barbs = new Mesh(mergeGeometries(barbGeometries), new MeshBasicMaterial());
  for (const geometry of barbGeometries) geometry.dispose();
  b.fill(barbs, PARASITE_MURK.clone().multiplyScalar(1.6));

  // Warning eyes: a crescent of hot points across the forward carapace.
  const eyeGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const eye = new SphereGeometry(0.14, 6, 5);
    eye.translate((i - 2) * 0.7, 0.4, 2.0);
    eyeGeometries.push(eye);
  }
  const eyes = new Mesh(mergeGeometries(eyeGeometries), new MeshBasicMaterial());
  for (const geometry of eyeGeometries) geometry.dispose();
  b.core(eyes, PARASITE_HOT, 1.7);

  b.shard(new Vector3(0, 1, 0), PARASITE_VIOLET.clone(), 0.9);
  b.shard(new Vector3(0, -1, 0), PARASITE_HOT.clone(), 0.9);
  b.shard(new Vector3(1, 0.2, 0), PARASITE_VIOLET.clone(), 0.7);
  b.shard(new Vector3(-1, 0.2, 0), PARASITE_VIOLET.clone(), 0.7);
  b.shard(new Vector3(0, 0, 1), PARASITE_HOT.clone(), 0.8);
  b.group.userData.isMatriarch = true;
  return finish(b, PARASITE_HOT, 3.2);
}

// Per-frame boss dressing: the sac churns; bare, it burns bright enough to
// aim by; flinching, everything guts to grey-violet.
export function updateMatriarchMesh(mesh: Group, elapsed: number) {
  const sac = mesh.userData.sac as Group | undefined;
  const membrane = mesh.userData.sacMembrane as MeshBasicMaterial | undefined;
  const core = mesh.userData.sacCore as MeshBasicMaterial | undefined;
  const exposed = mesh.userData.exposed === true;
  const flinching = mesh.userData.flinching === true;
  if (sac) {
    const churn = 1 + Math.sin(elapsed * (exposed ? 6.5 : 2.2)) * 0.08;
    sac.scale.setScalar(churn);
  }
  if (membrane && mesh.userData.locked !== true) {
    membrane.color.copy(exposed ? hdr(PARASITE_HOT, 0.9) : hdr(PARASITE_VIOLET, flinching ? 0.2 : 0.45));
  }
  if (core && mesh.userData.locked !== true) {
    const pulse = exposed ? 1.6 + Math.max(0, Math.sin(elapsed * 9)) * 1.2 : flinching ? 0.4 : 1.1;
    core.color.copy(exposed ? hdr(WARM_WHITE.clone().lerp(PARASITE_HOT, 0.5), pulse) : hdr(PARASITE_HOT, pulse));
  }
  const hooks = mesh.userData.hooks as Group[] | undefined;
  if (hooks) {
    for (const [index, hook] of hooks.entries()) {
      hook.rotation.x = Math.sin(elapsed * (flinching ? 7 : 1.6) + index * 1.3) * (flinching ? 0.3 : 0.1);
    }
  }
}

// The cyst's first hit: plates shear outward, the seam goes hot.
export function crackCystShell(mesh: Group) {
  const plates = mesh.userData.plates as Mesh[] | undefined;
  const seam = mesh.userData.seam as MeshBasicMaterial | undefined;
  if (plates) {
    for (const [index, plate] of plates.entries()) {
      plate.position.multiplyScalar(1.3);
      plate.rotation.z += (index % 2 === 0 ? 1 : -1) * 0.5;
    }
  }
  if (seam) seam.color.copy(hdr(PARASITE_HOT, 2.0));
}

export { BIO_GREEN };
