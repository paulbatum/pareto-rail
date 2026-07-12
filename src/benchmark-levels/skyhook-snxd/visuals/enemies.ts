import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { COLD_WHITE, GRAPHITE, GUNMETAL, HAZARD_ORANGE, PANEL_SHADOW, PANEL_WHITE, SIGNAL_RED, THRUSTER_BLUE, hdr } from './palette';

// Hostile hardware: gunmetal bodies, pale worklight edges, signal-red slits.
// Dark mass reads as silhouette against the daylight acts; the pale edges and
// red slits carry the same silhouettes once the sky goes black. Nothing here
// shares the car's white-and-hazard-orange livery.

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
    fill(mesh, color = GUNMETAL) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = COLD_WHITE, intensity = 0.9) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = SIGNAL_RED, intensity = 1.3) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
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

// ---- glider: a swept-wing kite riding the storm ------------------------------

export function createGliderMesh() {
  const b = builder();
  // Two swept wings meeting at a slim pod, nose along +Z (motion uses lookAt).
  for (const side of [-1, 1]) {
    const wing = box(1.5, 0.08, 0.5);
    wing.position.set(side * 0.78, 0, -0.3);
    wing.rotation.y = side * 0.62;
    b.fill(wing, GUNMETAL);
    const leading = box(1.42, 0.05, 0.09);
    leading.position.set(side * 0.76, 0.02, -0.06);
    leading.rotation.y = side * 0.62;
    b.edge(leading, COLD_WHITE, 0.75);
    const tip = new Mesh(new SphereGeometry(0.075, 6, 5), new MeshBasicMaterial());
    tip.position.set(side * 1.42, 0, -0.72);
    b.core(tip, HAZARD_ORANGE.clone().lerp(SIGNAL_RED, 0.5), 1.2);
    b.shard(new Vector3(side, -0.2, 0), GUNMETAL.clone().lerp(COLD_WHITE, 0.3), 0.4);
  }
  const pod = box(0.26, 0.2, 0.9);
  b.fill(pod, GRAPHITE);
  const slit = box(0.1, 0.07, 0.42);
  slit.position.set(0, 0.09, 0.18);
  b.core(slit, SIGNAL_RED, 1.4);
  b.shard(new Vector3(0, 1, 0.3), SIGNAL_RED.clone(), 0.3);
  b.shard(new Vector3(0, -0.6, -0.5), GRAPHITE.clone().lerp(COLD_WHITE, 0.2), 0.35);
  return finish(b, SIGNAL_RED);
}

// ---- sprite: a slender updraft-rider, all flutter ---------------------------

export function createSpriteMesh() {
  const b = builder();
  const spine = box(0.16, 1.7, 0.16);
  b.fill(spine, GRAPHITE);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const vane = box(0.5, 0.9, 0.03);
    vane.position.set(Math.cos(angle) * 0.32, 0.25 - i * 0.28, Math.sin(angle) * 0.32);
    vane.rotation.y = -angle;
    vane.rotation.z = 0.3;
    b.fill(vane, GUNMETAL.clone().lerp(PANEL_SHADOW, 0.4));
    const vaneEdge = box(0.5, 0.06, 0.035);
    vaneEdge.position.copy(vane.position).y += 0.44;
    vaneEdge.rotation.copy(vane.rotation);
    b.edge(vaneEdge, COLD_WHITE, 0.6);
    b.shard(new Vector3(Math.cos(angle), 0.2, Math.sin(angle)), GUNMETAL.clone().lerp(COLD_WHITE, 0.25), 0.32);
  }
  const eye = box(0.1, 0.34, 0.1);
  eye.position.y = 0.62;
  b.core(eye, SIGNAL_RED, 1.5);
  b.shard(new Vector3(0, 1, 0), SIGNAL_RED.clone(), 0.28);
  return finish(b, SIGNAL_RED);
}

// ---- sapper: a squat tick that goes for the car ------------------------------

export function createSapperMesh() {
  const b = builder();
  const shell = new Mesh(new SphereGeometry(0.52, 8, 6), new MeshBasicMaterial());
  shell.scale.set(1, 0.62, 1.1);
  b.fill(shell, GUNMETAL);
  const band = box(1.06, 0.08, 0.5);
  band.position.y = 0.12;
  b.edge(band, COLD_WHITE, 0.55);
  for (const [x, z] of [[-0.42, 0.34], [0.42, 0.34], [-0.42, -0.34], [0.42, -0.34]] as const) {
    const leg = box(0.1, 0.52, 0.1);
    leg.position.set(x * 1.35, -0.32, z * 1.35);
    leg.rotation.z = x > 0 ? 0.55 : -0.55;
    leg.rotation.x = z > 0 ? -0.4 : 0.4;
    b.fill(leg, GRAPHITE);
    b.shard(new Vector3(x, -0.4, z), GUNMETAL.clone().lerp(COLD_WHITE, 0.2), 0.3);
  }
  const snout = new Mesh(new ConeGeometry(0.16, 0.5, 6), new MeshBasicMaterial());
  snout.position.set(0, -0.42, 0);
  snout.rotation.x = Math.PI;
  b.fill(snout, GRAPHITE);
  // Drill lamp: the countdown the player reads. It pulses while drilling.
  const lamp = new Mesh(new SphereGeometry(0.14, 8, 6), new MeshBasicMaterial());
  lamp.position.set(0, 0.2, 0.42);
  const lampPart = b.core(lamp, SIGNAL_RED, 1.5);
  b.group.userData.drillLamp = lampPart.material;
  b.shard(new Vector3(0, 1, 0), SIGNAL_RED.clone(), 0.4);
  b.shard(new Vector3(0, -1, 0.4), GUNMETAL.clone().lerp(COLD_WHITE, 0.3), 0.36);
  return finish(b, SIGNAL_RED, 0.9);
}

// ---- spiker: vacuum-hardened weapons platform --------------------------------

export function createSpikerMesh() {
  const b = builder();
  const core = new Mesh(new OctahedronGeometry(0.55, 0), new MeshBasicMaterial());
  b.fill(core, GUNMETAL);
  const coreEdge = new Mesh(new OctahedronGeometry(0.58, 0), new MeshBasicMaterial({ wireframe: true }));
  b.edge(coreEdge, COLD_WHITE, 0.5);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fin = box(0.06, 1.15, 0.42);
    fin.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.75, 0);
    fin.rotation.z = angle - Math.PI / 2;
    b.fill(fin, PANEL_SHADOW);
    const finEdge = box(0.07, 1.05, 0.06);
    finEdge.position.copy(fin.position);
    finEdge.rotation.copy(fin.rotation);
    b.edge(finEdge, THRUSTER_BLUE, 0.55);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0), PANEL_SHADOW.clone().lerp(COLD_WHITE, 0.3), 0.42);
  }
  // Rail muzzle: brightens through the wind-up so the shot is telegraphed.
  const muzzle = new Mesh(new SphereGeometry(0.18, 8, 6), new MeshBasicMaterial());
  muzzle.position.set(0, 0, 0.5);
  const muzzlePart = b.core(muzzle, SIGNAL_RED, 0.8);
  b.group.userData.chargeLamp = muzzlePart.material;
  b.shard(new Vector3(0, 0, 1), SIGNAL_RED.clone(), 0.34);
  return finish(b, THRUSTER_BLUE, 1.05);
}

// ---- breaker: armored crawler descending the tether --------------------------

export function createBreakerMesh() {
  const b = builder();
  const hull = box(1.9, 1.3, 1.5);
  b.fill(hull, GUNMETAL);
  // Rail shoes above the hull, gripping the ribbon it rides.
  for (const side of [-0.55, 0.55]) {
    const shoe = box(0.42, 0.5, 0.6);
    shoe.position.set(side, 0.95, 0);
    b.fill(shoe, GRAPHITE);
  }
  // Armor plates that shear off at the stage break.
  const armor: Mesh[] = [];
  for (const [x, y] of [[-0.62, 0.28], [0.62, 0.28], [-0.62, -0.42], [0.62, -0.42]] as const) {
    const plate = box(0.82, 0.72, 0.14);
    plate.position.set(x, y, 0.82);
    b.fill(plate, PANEL_SHADOW.clone().lerp(GUNMETAL, 0.4));
    armor.push(plate);
    b.shard(new Vector3(x * 1.4, y, 0.6), PANEL_SHADOW.clone().lerp(COLD_WHITE, 0.35), 0.5);
  }
  const trim = box(1.94, 0.1, 0.1);
  trim.position.set(0, 0.62, 0.78);
  b.edge(trim, COLD_WHITE, 0.6);
  // The core lattice hides behind the plates until the armor goes.
  const lattice = new Mesh(new BoxGeometry(1.1, 0.8, 0.5), new MeshBasicMaterial({ wireframe: true }));
  lattice.position.z = 0.55;
  const latticePart = b.core(lattice, SIGNAL_RED, 0.35);
  b.group.userData.armorPlates = armor;
  b.group.userData.coreLattice = latticePart.material;
  b.shard(new Vector3(0, -1, 0.5), SIGNAL_RED.clone(), 0.5);
  return finish(b, SIGNAL_RED, 1.5);
}

export function breakBreakerArmor(group: Group) {
  const plates = group.userData.armorPlates as Mesh[] | undefined;
  if (plates) {
    for (const plate of plates) plate.visible = false;
  }
  const lattice = group.userData.coreLattice as MeshBasicMaterial | undefined;
  if (lattice) lattice.color.copy(hdr(SIGNAL_RED, 1.6));
}

// ---- bolt: hurled debris slug --------------------------------------------------

export function createBoltMesh() {
  const b = builder();
  const slug = new Mesh(new OctahedronGeometry(0.26, 0), new MeshBasicMaterial());
  slug.scale.set(0.6, 0.6, 1.9);
  b.fill(slug, GRAPHITE);
  const glow = new Mesh(new OctahedronGeometry(0.34, 0), new MeshBasicMaterial());
  glow.scale.set(0.55, 0.55, 1.7);
  b.core(glow, SIGNAL_RED, 1.1);
  b.shard(new Vector3(0, -1, 0), SIGNAL_RED.clone(), 0.3);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = SIGNAL_RED.clone().multiplyScalar(0.55);
  return finish(b, SIGNAL_RED, 0.8);
}

// ---- the Lamprey ---------------------------------------------------------------

// Grip claw: a hooked handling arm the size of the car.
export function createClawMesh() {
  const b = builder();
  const upper = box(0.7, 2.0, 0.7);
  upper.position.y = 0.8;
  upper.rotation.z = 0.18;
  b.fill(upper, GUNMETAL);
  const joint = new Mesh(new SphereGeometry(0.5, 8, 6), new MeshBasicMaterial());
  joint.position.y = -0.3;
  b.fill(joint, GRAPHITE);
  const jointRing = box(1.1, 0.14, 0.9);
  jointRing.position.y = -0.3;
  b.core(jointRing, SIGNAL_RED, 0.9);
  const hook = box(0.5, 1.5, 0.5);
  hook.position.set(0.35, -1.25, 0);
  hook.rotation.z = -0.5;
  b.fill(hook, GUNMETAL);
  const hookTip = box(0.42, 0.62, 0.42);
  hookTip.position.set(0.86, -1.98, 0);
  hookTip.rotation.z = -1.05;
  b.edge(hookTip, COLD_WHITE, 0.7);
  for (const direction of [new Vector3(0.6, -1, 0), new Vector3(-0.4, 1, 0.3), new Vector3(0.2, 0.4, -0.6)]) {
    b.shard(direction, GUNMETAL.clone().lerp(COLD_WHITE, 0.3), 0.55);
  }
  return finish(b, SIGNAL_RED, 1.7);
}

// The maw itself: a segmented head wrapping the ribbon, iris of plates over a
// core that only means something once the claws are gone.
export function createMawMesh() {
  const b = builder();

  // Segmented carapace, widest at the face.
  for (const [scale, z] of [[1, 0], [0.86, -2.2], [0.7, -4.2], [0.52, -6.0]] as const) {
    const segment = box(7.2 * scale, 5.4 * scale, 2.0);
    segment.position.z = z;
    b.fill(segment, z === 0 ? GUNMETAL : GRAPHITE);
  }
  const brow = box(7.6, 0.5, 0.5);
  brow.position.set(0, 2.9, 0.9);
  b.edge(brow, COLD_WHITE, 0.75);

  // Six grip arms arcing back around the tether.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const arm = box(0.9, 5.2, 0.9);
    arm.position.set(Math.cos(angle) * 4.6, Math.sin(angle) * 4.0, -3.2);
    arm.rotation.z = angle + Math.PI / 2;
    arm.rotation.x = 0.55;
    b.fill(arm, GRAPHITE);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.3), GUNMETAL.clone().lerp(COLD_WHITE, 0.25), 0.8);
  }

  // The iris: eight plates around the core. They swing open when exposed.
  const irisPlates: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const plate = box(1.5, 1.9, 0.35);
    plate.position.set(Math.cos(angle) * 1.55, Math.sin(angle) * 1.55, 1.15);
    plate.rotation.z = angle + Math.PI / 2;
    b.fill(plate, PANEL_SHADOW.clone().lerp(GUNMETAL, 0.3));
    irisPlates.push(plate);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0.6), PANEL_SHADOW.clone().lerp(COLD_WHITE, 0.4), 0.7);
  }
  const core = new Mesh(new SphereGeometry(1.05, 12, 9), new MeshBasicMaterial());
  core.position.z = 1.0;
  const corePart = b.core(core, SIGNAL_RED, 0.5);

  // Worklamp eyes: four pale lamps across the brow — visible from hundreds of
  // metres up the tether, which is the point.
  const eyes: MeshBasicMaterial[] = [];
  for (const [x, y] of [[-2.6, 1.9], [-0.9, 2.2], [0.9, 2.2], [2.6, 1.9]] as const) {
    const eye = new Mesh(new SphereGeometry(0.34, 8, 6), new MeshBasicMaterial());
    eye.position.set(x, y, 1.1);
    eyes.push(b.core(eye, COLD_WHITE, 1.6).material as MeshBasicMaterial);
  }

  b.group.userData.irisPlates = irisPlates;
  b.group.userData.coreMaterial = corePart.material;
  b.group.userData.eyeMaterials = eyes;
  b.group.userData.isMaw = true;
  b.shard(new Vector3(0, 0, 1), SIGNAL_RED.clone(), 1.0);
  b.shard(new Vector3(0, -1, 0.4), SIGNAL_RED.clone(), 0.9);
  return finish(b, SIGNAL_RED, 4.2);
}

/** Iris/core animation driven per frame from the maw's userData flags. */
export function updateMawMesh(group: Group, elapsed: number) {
  const exposed = group.userData.exposed === true;
  const flinching = group.userData.flinching === true;
  const plates = group.userData.irisPlates as Mesh[] | undefined;
  const core = group.userData.coreMaterial as MeshBasicMaterial | undefined;
  const eyes = group.userData.eyeMaterials as MeshBasicMaterial[] | undefined;
  const open = group.userData.irisOpen as number | undefined ?? 0;
  const target = exposed ? 1 : 0;
  const next = open + (target - open) * 0.12;
  group.userData.irisOpen = next;
  if (plates) {
    for (const [index, plate] of plates.entries()) {
      const angle = (index / plates.length) * Math.PI * 2;
      const reach = 1.55 + next * 1.35;
      plate.position.set(Math.cos(angle) * reach, Math.sin(angle) * reach, 1.15 - next * 0.4);
    }
  }
  if (core) {
    const pulse = exposed ? 1.7 + Math.sin(elapsed * 9) * 0.5 : flinching ? 0.25 : 0.55 + Math.sin(elapsed * 2.2) * 0.12;
    core.color.copy(exposed ? hdr(HAZARD_ORANGE, pulse) : hdr(SIGNAL_RED, pulse));
  }
  if (eyes) {
    for (const [index, eye] of eyes.entries()) {
      const flickerPhase = elapsed * (flinching ? 14 : 3.5) + index * 1.7;
      eye.color.copy(hdr(COLD_WHITE, 1.1 + Math.sin(flickerPhase) * (flinching ? 0.8 : 0.35)));
    }
  }
}
