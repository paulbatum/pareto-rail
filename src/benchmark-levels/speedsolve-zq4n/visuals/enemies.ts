import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BONE, GRAPHITE, HOT_WHITE, INK, MACHINE_GREY, MACHINE_WHITE, SOLVE_COLORS, hdr } from './palette';

// The escort is made of the same candy plastic as the cube's stickers, cut
// into Platonic solids so each kind is a different silhouette before it is a
// different color: tetrahedra wheel, octahedra dive, prisms plant and shoot.
// Every one of them is a saturated body inside a graphite cage, which is what
// keeps them readable against both the pale void and the cube's own colors.

export type TintPart = { material: MeshBasicMaterial; base: Color; kind: 'body' | 'cage' | 'core' };

function tint(mesh: Mesh, base: Color, kind: TintPart['kind'], parts: TintPart[]) {
  const material = mesh.material as MeshBasicMaterial;
  material.color.copy(base);
  parts.push({ material, base: base.clone(), kind });
  return mesh;
}

function finish(group: Group, parts: TintPart[], accent: Color, lockRingScale: number) {
  group.userData.parts = parts;
  group.userData.accent = accent.clone();
  group.userData.lockRingScale = lockRingScale;
  return group;
}

/** Thin box frame around the XY plane — the level's one recurring outline. */
function squareFrame(size: number, thickness: number, depth: number) {
  const parts: BufferGeometry[] = [];
  for (const [w, h, x, y] of [
    [size, thickness, 0, size / 2 - thickness / 2],
    [size, thickness, 0, -size / 2 + thickness / 2],
    [thickness, size - thickness * 2, size / 2 - thickness / 2, 0],
    [thickness, size - thickness * 2, -size / 2 + thickness / 2, 0],
  ] as const) {
    parts.push(new BoxGeometry(w, h, depth).applyMatrix4(new Matrix4().makeTranslation(x, y, 0)));
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged ?? new BoxGeometry(size, size, depth);
}

/** Edge cage for a convex solid: struts laid along a list of vertex pairs. */
function strutCage(points: Vector3[], radius: number) {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const length = a.distanceTo(b);
      const geometry = new CylinderGeometry(radius, radius, length, 4, 1);
      const matrix = new Matrix4();
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const direction = b.clone().sub(a).normalize();
      const up = new Vector3(0, 1, 0);
      const axis = new Vector3().crossVectors(up, direction);
      const angle = Math.acos(Math.min(1, Math.max(-1, up.dot(direction))));
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
      matrix.makeRotationAxis(axis.normalize(), angle);
      matrix.setPosition(mid);
      parts.push(geometry.applyMatrix4(matrix));
    }
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

// ---- solve pip ---------------------------------------------------------------

/**
 * The pip that hangs off a wrong square: an open bracket so the wrong color
 * still shows through it, and a solid cube in the middle painted the color the
 * square is supposed to become. Shooting it is the instruction being carried out.
 */
export function createPipMesh(hue: number) {
  const group = new Group();
  const parts: TintPart[] = [];
  const target = SOLVE_COLORS[hue % SOLVE_COLORS.length];

  group.add(tint(new Mesh(squareFrame(3.4, 0.34, 0.34), new MeshBasicMaterial()), hdr(INK, 1), 'cage', parts));
  group.add(tint(new Mesh(squareFrame(2.8, 0.2, 0.28), new MeshBasicMaterial()), hdr(target, 1.3), 'body', parts));

  const core = new Mesh(new BoxGeometry(1.05, 1.05, 1.05), new MeshBasicMaterial());
  tint(core, hdr(target, 1.7), 'core', parts);
  group.add(core);
  group.userData.spinner = core;

  // Four corner ticks: the machine's own crosshair on the square it wants.
  const ticks: BufferGeometry[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ticks.push(new BoxGeometry(0.9, 0.22, 0.22).applyMatrix4(new Matrix4().makeTranslation(sx * 1.6, sy * 2.05, 0)));
    ticks.push(new BoxGeometry(0.22, 0.9, 0.22).applyMatrix4(new Matrix4().makeTranslation(sx * 2.05, sy * 1.6, 0)));
  }
  const merged = mergeGeometries(ticks);
  if (merged) group.add(tint(new Mesh(merged, new MeshBasicMaterial()), hdr(BONE, 1.1), 'cage', parts));
  for (const geometry of ticks) geometry.dispose();

  group.userData.isPip = true;
  return finish(group, parts, target, 1.5);
}

// ---- weakpoint ---------------------------------------------------------------

/** What was under the face: a spindle head with a white-hot bearing in a yoke. */
export function createWeakMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const yoke: BufferGeometry[] = [
    new BoxGeometry(5.8, 1.05, 1.05).applyMatrix4(new Matrix4().makeTranslation(0, 2.4, 0)),
    new BoxGeometry(5.8, 1.05, 1.05).applyMatrix4(new Matrix4().makeTranslation(0, -2.4, 0)),
    new BoxGeometry(1.05, 5.9, 1.05).applyMatrix4(new Matrix4().makeTranslation(2.7, 0, 0)),
    new BoxGeometry(1.05, 5.9, 1.05).applyMatrix4(new Matrix4().makeTranslation(-2.7, 0, 0)),
  ];
  const merged = mergeGeometries(yoke);
  if (merged) group.add(tint(new Mesh(merged, new MeshBasicMaterial()), hdr(GRAPHITE, 1.7), 'cage', parts));
  for (const geometry of yoke) geometry.dispose();

  const collar = new Mesh(new TorusGeometry(2.3, 0.42, 6, 4), new MeshBasicMaterial());
  collar.rotation.z = Math.PI / 4;
  tint(collar, hdr(MACHINE_WHITE, 1.25), 'body', parts);
  group.add(collar);

  const bearing = new Mesh(new OctahedronGeometry(1.6, 0), new MeshBasicMaterial());
  tint(bearing, hdr(HOT_WHITE, 1.9), 'core', parts);
  group.add(bearing);
  group.userData.spinner = bearing;

  group.userData.isWeak = true;
  return finish(group, parts, MACHINE_WHITE, 2.2);
}

// ---- core --------------------------------------------------------------------

/** The naked core: a spiked white heart in three graphite gimbal rings. */
export function createCoreMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const heart = new Mesh(new OctahedronGeometry(4.6, 1), new MeshBasicMaterial());
  tint(heart, hdr(HOT_WHITE, 1.45), 'core', parts);
  group.add(heart);
  group.userData.spinner = heart;

  const spikes: BufferGeometry[] = [];
  for (const axis of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
    const cone = new ConeGeometry(1.15, 4.4, 4);
    const matrix = new Matrix4();
    const direction = axis.clone();
    const up = new Vector3(0, 1, 0);
    const cross = new Vector3().crossVectors(up, direction);
    const angle = Math.acos(Math.min(1, Math.max(-1, up.dot(direction))));
    if (cross.lengthSq() < 1e-6) cross.set(1, 0, 0);
    matrix.makeRotationAxis(cross.normalize(), angle);
    matrix.setPosition(direction.clone().multiplyScalar(5.6));
    spikes.push(cone.applyMatrix4(matrix));
  }
  const spikeMesh = mergeGeometries(spikes);
  if (spikeMesh) group.add(tint(new Mesh(spikeMesh, new MeshBasicMaterial()), hdr(MACHINE_WHITE, 1.15), 'body', parts));
  for (const geometry of spikes) geometry.dispose();

  // The cage: three rings that shut the core away between salvos.
  const cage = new Group();
  for (let i = 0; i < 3; i += 1) {
    const ring = new Mesh(new TorusGeometry(7.4, 0.62, 6, 26), new MeshBasicMaterial());
    tint(ring, hdr(GRAPHITE, 2.4), 'cage', parts);
    if (i === 1) ring.rotation.x = Math.PI / 2;
    if (i === 2) ring.rotation.y = Math.PI / 2;
    cage.add(ring);
  }
  group.add(cage);
  group.userData.cage = cage;
  group.userData.isCore = true;
  return finish(group, parts, HOT_WHITE, 4.2);
}

// ---- escort ------------------------------------------------------------------

const TETRA_VERTS = [
  new Vector3(1, 1, 1),
  new Vector3(-1, -1, 1),
  new Vector3(-1, 1, -1),
  new Vector3(1, -1, -1),
].map((v) => v.multiplyScalar(1.36));

/** Orbiter: a candy tetrahedron in a graphite edge cage. */
export function createTetraMesh(hue: number) {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = SOLVE_COLORS[hue % SOLVE_COLORS.length];

  group.add(tint(new Mesh(new TetrahedronGeometry(2.0, 0), new MeshBasicMaterial()), hdr(color, 1.15), 'body', parts));
  const cage = strutCage(TETRA_VERTS, 0.2);
  if (cage) group.add(tint(new Mesh(cage, new MeshBasicMaterial()), hdr(INK, 1), 'cage', parts));
  const core = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial());
  tint(core, hdr(BONE, 1.5), 'core', parts);
  group.add(core);
  return finish(group, parts, color, 1.4);
}

/** Diver: a candy octahedron wearing an equator belt. */
export function createOctaMesh(hue: number) {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = SOLVE_COLORS[hue % SOLVE_COLORS.length];

  group.add(tint(new Mesh(new OctahedronGeometry(2.2, 0), new MeshBasicMaterial()), hdr(color, 1.15), 'body', parts));
  const belt = new Mesh(new TorusGeometry(1.95, 0.2, 4, 4), new MeshBasicMaterial());
  belt.rotation.z = Math.PI / 4;
  tint(belt, hdr(INK, 1), 'cage', parts);
  group.add(belt);
  const belt2 = new Mesh(new TorusGeometry(1.95, 0.2, 4, 4), new MeshBasicMaterial());
  belt2.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  tint(belt2, hdr(INK, 1), 'cage', parts);
  group.add(belt2);
  const core = new Mesh(new BoxGeometry(0.55, 0.55, 0.55), new MeshBasicMaterial());
  tint(core, hdr(BONE, 1.6), 'core', parts);
  group.add(core);
  group.userData.spinner = core;
  return finish(group, parts, color, 1.45);
}

/** Gunner: a squat triangular prism, muzzle forward, armor plates on the flanks. */
export function createPrismMesh(hue: number) {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = SOLVE_COLORS[hue % SOLVE_COLORS.length];

  const body = new Mesh(new CylinderGeometry(2.35, 2.35, 1.9, 3, 1), new MeshBasicMaterial());
  body.rotation.x = Math.PI / 2;
  tint(body, hdr(color, 1.1), 'body', parts);
  group.add(body);

  const rim = new Mesh(new TorusGeometry(2.5, 0.24, 4, 3), new MeshBasicMaterial());
  tint(rim, hdr(INK, 1), 'cage', parts);
  group.add(rim);

  const barrel = new Mesh(new CylinderGeometry(0.5, 0.74, 2.5, 6, 1), new MeshBasicMaterial());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 1.8;
  tint(barrel, hdr(GRAPHITE, 2.0), 'cage', parts);
  group.add(barrel);

  const muzzleMaterial = createAdditiveBasicMaterial({ color: hdr(MACHINE_WHITE, 0.7) });
  const muzzle = new Mesh(new BoxGeometry(1.05, 1.05, 0.34), muzzleMaterial);
  muzzle.position.z = 3.0;
  group.add(muzzle);
  group.userData.muzzle = muzzleMaterial;
  group.userData.isPrism = true;
  return finish(group, parts, color, 1.6);
}

/** Enemy fire: a tumbling cubie in the shooter's own color. Lockable, so it
 * must read as a target, not as a particle — hence the ink cage on it too. */
export function createBoltMesh(hue: number) {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = SOLVE_COLORS[hue % SOLVE_COLORS.length];

  group.add(tint(new Mesh(new BoxGeometry(1.35, 1.35, 1.35), new MeshBasicMaterial()), hdr(color, 1.5), 'body', parts));
  group.add(tint(new Mesh(squareFrame(2.0, 0.2, 2.0), new MeshBasicMaterial()), hdr(INK, 1), 'cage', parts));
  // Deliberately small: the shared impact model brakes a bolt to within a
  // metre of the lens, and anything wide here becomes a screen-filling smear.
  const halo = new Mesh(
    new BoxGeometry(1.5, 1.5, 0.16),
    createAdditiveBasicMaterial({ color: hdr(color, 0.6), opacity: 0.4 }),
  );
  group.add(halo);
  group.userData.isHostileShot = true;
  group.userData.trailColor = color.clone();
  return finish(group, parts, color, 1.3);
}

export function setPrismCharge(mesh: Group, charge: number) {
  const muzzle = mesh.userData.muzzle as MeshBasicMaterial | undefined;
  if (!muzzle) return;
  muzzle.color.copy(MACHINE_WHITE).lerp(HOT_WHITE, charge).multiplyScalar(0.6 + charge * 3.4);
  const scale = 1 + charge * 0.9;
  muzzle.opacity = 0.5 + charge * 0.5;
  mesh.scale.z = 1;
  const spinner = mesh.userData.spinner as Mesh | undefined;
  if (spinner) spinner.scale.setScalar(scale);
}

export function setCoreCaged(mesh: Group, caged: boolean, elapsed: number) {
  const cage = mesh.userData.cage as Group | undefined;
  if (!cage) return;
  cage.rotation.y += caged ? 0.02 : 0.006;
  cage.rotation.z = caged ? 0 : Math.sin(elapsed * 0.9) * 0.4;
  cage.scale.setScalar(caged ? 1 : 1.28);
  for (const child of cage.children) {
    const material = (child as Mesh).material as MeshBasicMaterial;
    material.color.copy(caged ? hdr(MACHINE_GREY, 1.1) : hdr(GRAPHITE, 2.2));
  }
}
