import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_CYAN, FAULT_AMBER, FAULT_RED, hdr, STEEL } from './palette';

// Barrel defences. Three silhouettes that cannot be confused at a glance and do
// not move alike either: a flat blade that patrols the wall, a long needle that
// slaloms across the bore, and a heavy open claw that screws itself inward. All
// of them are cold steel with a fault-lit core, because in this barrel the only
// blue things are the gun and the player.
//
// Every geometry below is built once at module load and shared by every mesh of
// that kind; only materials are per-instance, because per-instance tinting is
// what the level actually needs. Cloning geometry per spawn would grow the
// geometry count without bound over a run.

export type TintKind = 'fill' | 'edge' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };
export type ShardSpec = { direction: Vector3; color: Color; size: number };

type PartSpec = {
  geometry: BufferGeometry;
  kind: TintKind;
  base: Color;
  /** Shared edge wireframe for solid parts. */
  edges?: BufferGeometry;
  edgeBase?: Color;
  /** Marks parts the gameplay needs to find again, such as breakable armour. */
  tag?: 'armour' | 'core';
};

type Template = {
  parts: PartSpec[];
  shards: ShardSpec[];
  accent: Color;
  lockRingScale: number;
};

function solid(geometry: BufferGeometry, base: Color, edgeBase?: Color, tag?: PartSpec['tag']): PartSpec {
  return {
    geometry,
    kind: 'fill',
    base,
    edges: edgeBase ? new EdgesGeometry(geometry) : undefined,
    edgeBase,
    tag,
  };
}

function glow(geometry: BufferGeometry, base: Color, tag?: PartSpec['tag']): PartSpec {
  return { geometry, kind: 'core', base, tag };
}

function shardRing(count: number, color: Color, size: number, spread = 1): ShardSpec[] {
  return Array.from({ length: count }, (_unused, i) => {
    const angle = (i / count) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle) * spread, Math.sin(angle) * spread, Math.sin(i * 2.7) * 0.6).normalize(),
      color: color.clone(),
      size,
    };
  });
}

function instantiate(template: Template, kind: string) {
  const group = new Group();
  const parts: TintPart[] = [];
  const armour: Mesh[] = [];
  let core: Mesh | null = null;

  for (const spec of template.parts) {
    const material = spec.kind === 'core'
      ? createAdditiveBasicMaterial({ color: spec.base.clone() })
      : new MeshBasicMaterial({ color: spec.base.clone() });
    const mesh = new Mesh(spec.geometry, material);
    group.add(mesh);
    parts.push({ material, base: spec.base.clone(), kind: spec.kind });
    if (spec.tag === 'armour') armour.push(mesh);
    if (spec.tag === 'core') core = mesh;

    if (!spec.edges || !spec.edgeBase) continue;
    const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: spec.edgeBase.clone() }));
    group.add(new LineSegments(spec.edges, edgeMaterial));
    parts.push({ material: edgeMaterial, base: spec.edgeBase.clone(), kind: 'edge' });
  }

  group.userData.kind = kind;
  group.userData.parts = parts;
  group.userData.shardSpecs = template.shards;
  group.userData.accent = template.accent.clone();
  group.userData.lockRingScale = template.lockRingScale;
  group.userData.armourPlates = armour;
  group.userData.coreMesh = core;
  return group;
}

// ---- SENTRY -----------------------------------------------------------------
// A flat triangular blade with two swept fins. From the payload it reads as a
// dart standing on edge against the wall it patrols.

const SENTRY_TEMPLATE: Template = (() => {
  const blade = new ConeGeometry(0.62, 2.0, 3);
  blade.rotateX(Math.PI / 2);
  blade.scale(1, 1, 0.32);

  const parts: PartSpec[] = [solid(blade, STEEL.clone().multiplyScalar(1.15), hdr(ARC_CYAN, 0.55))];
  for (const side of [-1, 1]) {
    const fin = new BoxGeometry(1.05, 0.1, 0.42);
    fin.translate(side * 0.72, -0.42, 0);
    fin.rotateZ(side * -0.42);
    parts.push(solid(fin, STEEL.clone(), hdr(ARC_CYAN, 0.4)));
  }
  const core = new SphereGeometry(0.24, 10, 8);
  core.translate(0, 0.52, 0);
  parts.push(glow(core, hdr(FAULT_AMBER, 1.9), 'core'));

  return { parts, shards: shardRing(7, FAULT_AMBER, 0.28), accent: FAULT_AMBER, lockRingScale: 1.0 };
})();

export function createSentryMesh() {
  return instantiate(SENTRY_TEMPLATE, 'sentry');
}

// ---- WEAVER -----------------------------------------------------------------
// A long needle with four tail vanes: nearly invisible head-on, unmistakable in
// profile, which suits something that only ever crosses your view.

const WEAVER_TEMPLATE: Template = (() => {
  const spine = new OctahedronGeometry(0.34, 0);
  spine.scale(0.62, 0.62, 4.2);
  const parts: PartSpec[] = [solid(spine, STEEL.clone().multiplyScalar(1.05), hdr(ARC_CYAN, 0.5))];

  for (let i = 0; i < 4; i += 1) {
    const vane = new BoxGeometry(0.075, 0.7, 0.9);
    vane.translate(0, 0.42, 0);
    vane.rotateZ((i / 4) * Math.PI * 2 + Math.PI / 4);
    vane.translate(0, 0, 0.95);
    parts.push(solid(vane, STEEL.clone().multiplyScalar(0.9), hdr(ARC_CYAN, 0.38)));
  }

  const nose = new OctahedronGeometry(0.2, 0);
  nose.scale(1, 1, 2.6);
  nose.translate(0, 0, -1.35);
  parts.push(glow(nose, hdr(FAULT_AMBER, 2.1), 'core'));

  return { parts, shards: shardRing(6, FAULT_AMBER, 0.22, 0.5), accent: FAULT_AMBER, lockRingScale: 0.95 };
})();

export function createWeaverMesh() {
  return instantiate(WEAVER_TEMPLATE, 'weaver');
}

// ---- CLAMP ------------------------------------------------------------------
// A heavy open claw with an exposed core in the gap. Armoured: the first stage
// shears the jaw plates, the second gets the core.

const CLAMP_TEMPLATE: Template = (() => {
  const claw = new TorusGeometry(1.15, 0.36, 4, 14, Math.PI * 1.42);
  claw.rotateZ(-Math.PI * 0.21);
  const parts: PartSpec[] = [solid(claw, STEEL.clone().multiplyScalar(1.2), hdr(ARC_CYAN, 0.6))];

  for (const side of [-1, 1]) {
    const jaw = new BoxGeometry(0.52, 0.62, 0.9);
    jaw.translate(side * 1.12, 0.72, 0);
    parts.push(solid(jaw, STEEL.clone().multiplyScalar(1.35), hdr(ARC_CYAN, 0.7), 'armour'));
  }

  const spindle = new CylinderGeometry(0.2, 0.2, 1.5, 8);
  spindle.rotateX(Math.PI / 2);
  parts.push(solid(spindle, STEEL.clone().multiplyScalar(0.8)));
  parts.push(glow(new SphereGeometry(0.42, 12, 10), hdr(FAULT_AMBER, 1.7), 'core'));

  return { parts, shards: shardRing(10, FAULT_AMBER, 0.34, 1.2), accent: FAULT_AMBER, lockRingScale: 1.35 };
})();

export function createClampMesh() {
  return instantiate(CLAMP_TEMPLATE, 'clamp');
}

/** Shear the jaw plates off a clamp when its first hit stage breaks. */
export function breakClampArmour(group: Group) {
  for (const plate of (group.userData.armourPlates as Mesh[] | undefined) ?? []) plate.visible = false;
  const core = group.userData.coreMesh as Mesh | undefined;
  if (core) core.scale.setScalar(1.45);
}

// ---- LANCE ------------------------------------------------------------------
// The barrel's homing shot: a thin bright needle, all warning light.

const LANCE_TEMPLATE: Template = (() => {
  const shaft = new CylinderGeometry(0.055, 0.2, 2.1, 6);
  shaft.rotateX(Math.PI / 2);
  const halo = new OctahedronGeometry(0.34, 0);
  halo.scale(0.7, 0.7, 2.4);
  return {
    parts: [glow(shaft, hdr(FAULT_RED, 2.2), 'core'), glow(halo, hdr(FAULT_AMBER, 0.9))],
    shards: shardRing(5, FAULT_RED, 0.2, 0.4),
    accent: FAULT_RED,
    lockRingScale: 0.85,
  };
})();

export function createLanceMesh() {
  const group = instantiate(LANCE_TEMPLATE, 'lance');
  group.userData.isHostileShot = true;
  return group;
}

// ---- INTERLOCK --------------------------------------------------------------
// Not a drone. A hexagonal breech clamp bolted to the bore with a seized bolt
// glowing through the middle of it — clearly machinery, and clearly the thing
// the barrel is straining to hold shut.

const INTERLOCK_TEMPLATE: Template = (() => {
  const hex = new TorusGeometry(1.85, 0.5, 4, 6);
  const plate = new CylinderGeometry(1.42, 1.42, 0.42, 6);
  plate.rotateX(Math.PI / 2);
  const parts: PartSpec[] = [
    solid(hex, STEEL.clone().multiplyScalar(1.3), hdr(ARC_CYAN, 0.75)),
    solid(plate, STEEL.clone().multiplyScalar(0.62), hdr(ARC_CYAN, 0.45)),
    // The seized bolt: the only thing in this barrel that is not moving.
    glow(new BoxGeometry(2.5, 0.46, 0.5), hdr(FAULT_AMBER, 1.8), 'core'),
  ];
  for (const side of [-1, 1]) {
    const tick = new BoxGeometry(0.26, 0.9, 0.3);
    tick.translate(0, side * 1.5, 0.22);
    parts.push(glow(tick, hdr(FAULT_RED, 1.3)));
  }
  return { parts, shards: shardRing(14, FAULT_AMBER, 0.42, 1.4), accent: FAULT_AMBER, lockRingScale: 1.7 };
})();

export function createInterlockMesh() {
  const group = instantiate(INTERLOCK_TEMPLATE, 'interlock');
  group.userData.isInterlock = true;
  return group;
}
