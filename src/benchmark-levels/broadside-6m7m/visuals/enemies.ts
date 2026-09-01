import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, hdr, MOLTEN, OBSIDIAN, WHITE_HOT } from './palette';
import type { ShardSpec } from './effects';

// Enemy craft: obsidian hulls streaked with molten orange, crimson eyes and
// muzzles. Every kind has its own silhouette at a glance — dagger, X, crescent,
// dome, needle, caged sphere, reactor drum — and each is built from parts
// whose materials the runtime tints for lock, denial, damage, and distance.

export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; kind: 'hull' | 'edge' | 'glow'; base: Color };

const PLATE = OBSIDIAN.clone().multiplyScalar(1.9);
const ARMOUR = new Color(0.16, 0.12, 0.17);

type Builder = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
  hull(geometry: BufferGeometry, position?: Vector3, rotation?: Vector3, color?: Color, edges?: boolean): Mesh;
  glow(geometry: BufferGeometry, color: Color, position?: Vector3, rotation?: Vector3): Mesh;
  finish(kind: string, accent: Color, lockRingScale?: number): Group;
};

function builder(): Builder {
  const group = new Group();
  const parts: TintPart[] = [];
  const shards: ShardSpec[] = [];
  const place = (mesh: Mesh, position?: Vector3, rotation?: Vector3) => {
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    group.add(mesh);
    const direction = position && position.lengthSq() > 0.0001 ? position.clone().normalize() : new Vector3(0, 1, 0);
    shards.push({ direction, color: MOLTEN.clone(), size: 0.25 });
  };
  return {
    group,
    parts,
    shards,
    hull(geometry, position, rotation, color = PLATE, edges = true) {
      const material = new MeshBasicMaterial({ color: color.clone() });
      parts.push({ material, kind: 'hull', base: color.clone() });
      const mesh = new Mesh(geometry, material);
      place(mesh, position, rotation);
      if (edges) {
        const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(MOLTEN, 0.9) }));
        parts.push({ material: edgeMaterial, kind: 'edge', base: hdr(MOLTEN, 0.9) });
        mesh.add(new LineSegments(new EdgesGeometry(geometry, 25), edgeMaterial));
      }
      return mesh;
    },
    glow(geometry, color, position, rotation) {
      const material = createAdditiveBasicMaterial({ color: color.clone(), side: DoubleSide });
      parts.push({ material, kind: 'glow', base: color.clone() });
      const mesh = new Mesh(geometry, material);
      place(mesh, position, rotation);
      return mesh;
    },
    finish(kind, accent, lockRingScale = 1) {
      group.userData.kind = kind;
      group.userData.parts = parts;
      group.userData.shardSpecs = shards;
      group.userData.accent = accent.clone();
      group.userData.lockRingScale = lockRingScale;
      return group;
    },
  };
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

// Dart: a dagger with swept wings. Crosses the screen; the fastest silhouette.
export function createDartMesh() {
  const b = builder();
  const body = new OctahedronGeometry(0.55, 0);
  body.scale(0.42, 0.34, 1.7);
  b.hull(body);
  const wing = new BoxGeometry(1.15, 0.05, 0.55);
  b.hull(wing, v(0.72, 0, 0.25), v(0, 0.55, 0), ARMOUR);
  b.hull(wing, v(-0.72, 0, 0.25), v(0, -0.55, 0), ARMOUR);
  b.glow(new BoxGeometry(0.1, 0.06, 1.3), hdr(MOLTEN, 1.7), v(0, 0.2, 0.1));
  b.glow(new CircleGeometry(0.2, 10), hdr(CRIMSON, 2.2), v(0, 0, 0.95), v(0, 0, 0));
  return b.finish('dart', MOLTEN, 0.9);
}

// Wasp: an X of blades around a spindle. Corkscrews in from ahead.
export function createWaspMesh() {
  const b = builder();
  const spindle = new CylinderGeometry(0.22, 0.3, 1.6, 6);
  b.hull(spindle, v(0, 0, 0), v(Math.PI / 2, 0, 0));
  const blade = new BoxGeometry(1.7, 0.06, 0.34);
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    b.hull(blade, v(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0), v(0, 0, angle), ARMOUR);
    b.glow(new BoxGeometry(0.28, 0.1, 0.12), hdr(MOLTEN, 1.9), v(Math.cos(angle) * 1.65, Math.sin(angle) * 1.65, 0), v(0, 0, angle));
  }
  b.glow(new SphereGeometry(0.2, 8, 6), hdr(CRIMSON, 2.4), v(0, 0, -0.85));
  return b.finish('wasp', MOLTEN, 1.05);
}

// Hunter: a broad crescent with a pod at its heart; holds station and lunges.
// Its wing plates are the first hit; the second kills it.
export function createHunterMesh() {
  const b = builder();
  const crescent = new TorusGeometry(1.35, 0.26, 6, 18, Math.PI);
  b.hull(crescent, v(0, -0.4, 0), v(0, 0, 0));
  b.hull(new SphereGeometry(0.55, 10, 8), v(0, 0.1, 0.2), undefined, PLATE, false);
  const plate = new BoxGeometry(1.2, 0.55, 0.1);
  const left = b.hull(plate, v(-1.75, -0.3, 0), v(0, 0, 0.25), ARMOUR);
  const right = b.hull(plate, v(1.75, -0.3, 0), v(0, 0, -0.25), ARMOUR);
  b.glow(new TorusGeometry(1.35, 0.06, 4, 18, Math.PI), hdr(MOLTEN, 1.7), v(0, -0.4, 0.26));
  b.glow(new CircleGeometry(0.24, 12), hdr(CRIMSON, 2.4), v(0, 0.1, 0.78));
  const group = b.finish('hunter', MOLTEN, 1.35);
  group.userData.stripParts = [left, right];
  return group;
}

// Turret: an armoured dome hanging from a belly plate, twin barrels tracking you.
export function createTurretMesh() {
  const b = builder();
  b.hull(new BoxGeometry(2.8, 2.8, 0.4), v(0, 0, -0.9), undefined, ARMOUR);
  b.hull(new SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), v(0, 0, -0.7), v(Math.PI / 2, 0, 0), PLATE, false);
  const barrel = new CylinderGeometry(0.14, 0.18, 2.4, 6);
  b.hull(barrel, v(-0.5, 0.15, 0.9), v(Math.PI / 2, 0, 0), ARMOUR, false);
  b.hull(barrel, v(0.5, 0.15, 0.9), v(Math.PI / 2, 0, 0), ARMOUR, false);
  const armour = new BoxGeometry(0.5, 1.6, 1.4);
  const left = b.hull(armour, v(-1.3, 0, -0.2), undefined, ARMOUR);
  const right = b.hull(armour, v(1.3, 0, -0.2), undefined, ARMOUR);
  b.glow(new BoxGeometry(2.2, 0.08, 0.1), hdr(MOLTEN, 1.6), v(0, -0.9, 0.05));
  b.glow(new CircleGeometry(0.16, 8), hdr(CRIMSON, 2.6), v(-0.5, 0.15, 2.12));
  b.glow(new CircleGeometry(0.16, 8), hdr(CRIMSON, 2.6), v(0.5, 0.15, 2.12));
  const group = b.finish('turret', MOLTEN, 1.5);
  group.userData.stripParts = [left, right];
  return group;
}

// Bolt: a crimson needle. Lockable, interceptable, and it hurts.
export function createBoltMesh() {
  const b = builder();
  const core = new OctahedronGeometry(0.34, 0);
  core.scale(0.5, 0.5, 2.6);
  b.glow(core, hdr(CRIMSON, 2.6));
  b.glow(new BoxGeometry(0.09, 0.09, 3.2), hdr(CRIMSON, 1.4), v(0, 0, -1.9));
  b.glow(new SphereGeometry(0.2, 6, 4), hdr(WHITE_HOT, 2.2), v(0, 0, 0.5));
  const group = b.finish('bolt', CRIMSON, 0.8);
  group.userData.isHostileShot = true;
  group.userData.trailColor = CRIMSON.clone().multiplyScalar(0.9);
  return group;
}

// Shield generator: a burning sphere in an armoured cage on the flagship's flank.
// The first hit shatters the cage; the second kills the node.
export function createGeneratorMesh() {
  const b = builder();
  b.hull(new BoxGeometry(3.2, 3.2, 2.2), v(-2.6, 0, 0), undefined, ARMOUR);
  const cage = new Group();
  for (let i = 0; i < 3; i += 1) {
    const ring = new TorusGeometry(2.1, 0.11, 6, 20);
    const mesh = b.hull(ring, v(0, 0, 0), v(i * 1.05, i * 0.7, i * 0.3), ARMOUR, false);
    cage.add(mesh);
    const glowRing = b.glow(new TorusGeometry(2.1, 0.04, 4, 20), hdr(MOLTEN, 1.3), v(0, 0, 0), v(i * 1.05, i * 0.7, i * 0.3));
    cage.add(glowRing);
  }
  b.group.add(cage);
  b.glow(new SphereGeometry(1.35, 14, 10), hdr(CRIMSON, 1.9));
  b.glow(new SphereGeometry(0.75, 10, 8), hdr(WHITE_HOT, 2.4));
  const group = b.finish('generator', CRIMSON, 2.4);
  group.userData.stripParts = [cage];
  group.userData.pulse = true;
  return group;
}

// Power core: a reactor drum set into the trench floor, three hits deep.
// While the shield holds, a crimson bubble shows the shot will be swatted.
export function createCoreMesh() {
  const b = builder();
  b.hull(new CylinderGeometry(2.4, 2.6, 3.2, 10, 1, true), v(0, 0, 0), undefined, ARMOUR);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    b.hull(new BoxGeometry(0.4, 3.6, 0.5), v(Math.cos(angle) * 2.5, 0.1, Math.sin(angle) * 2.5), v(0, -angle, 0), PLATE, false);
  }
  b.glow(new CylinderGeometry(1.7, 1.7, 3.4, 12, 1, true), hdr(MOLTEN, 1.5));
  b.glow(new CircleGeometry(1.7, 16), hdr(CRIMSON, 2.2), v(0, 1.75, 0), v(-Math.PI / 2, 0, 0));
  const bubble = new Mesh(
    new SphereGeometry(3.8, 18, 12),
    createAdditiveBasicMaterial({ color: hdr(CRIMSON, 0.55), opacity: 0.22, side: DoubleSide }),
  );
  bubble.userData.raildIgnoreOcclusion = true;
  b.group.add(bubble);
  const group = b.finish('core', CRIMSON, 2.6);
  group.userData.shieldBubble = bubble;
  group.userData.pulse = true;
  return group;
}

export function setStripped(group: Group, stripped: boolean) {
  const parts = group.userData.stripParts as Array<Mesh | Group> | undefined;
  if (!parts) return;
  for (const part of parts) part.visible = !stripped;
}
