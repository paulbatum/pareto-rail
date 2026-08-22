import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { hdr, MACH_BLACK, MACH_SHADE, MACH_WHITE, MARK_HOT, MARK_WHITE, SOLVE_COLORS } from './palette';

// Enemy construction: pale white-and-grey bodies with a candy-coloured hot
// core, so the six solve colours stay owned by the cube while hazards read in
// the cube's own language. Every factory records shard specs (its own facets)
// so deaths burst into the enemy's own pieces.

export function createCellMesh(): Group {
  const group = new Group();
  const size = 2.35;

  // Glowing square frame — the "active target" read.
  const frameGeometry = new BufferGeometry();
  const half = size / 2;
  const corners = [
    new Vector3(-half, -half, 0), new Vector3(half, -half, 0),
    new Vector3(half, half, 0), new Vector3(-half, half, 0),
    new Vector3(-half, -half, 0),
  ];
  frameGeometry.setFromPoints(corners);
  const frame = new LineSegments(frameGeometry, new LineBasicMaterial(additiveMaterialParameters({ color: hdr(MARK_WHITE, 1.7) })));
  group.add(frame);

  // Dark backing plate so the target pops on any tile colour.
  const plate = new Mesh(new PlaneGeometry(size * 1.04, size * 1.04), new MeshBasicMaterial({
    color: MACH_BLACK,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: DoubleSide,
  }));
  group.add(plate);

  // Soft inner quad.
  const quad = new Mesh(new PlaneGeometry(size * 0.86, size * 0.86), createAdditiveBasicMaterial({
    color: hdr(MARK_WHITE, 0.55),
    opacity: 0.4,
    side: DoubleSide,
  }));
  group.add(quad);

  // Four corner pips.
  const pipGeometry = new BoxGeometry(0.3, 0.3, 0.12);
  const pipMaterial = new MeshBasicMaterial({ color: hdr(MARK_WHITE, 1.4) });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pip = new Mesh(pipGeometry, pipMaterial);
      pip.position.set(sx * half, sy * half, 0.05);
      group.add(pip);
    }
  }

  group.userData.cellFrame = frame;
  group.userData.cellQuad = quad;
  group.userData.lockRingScale = 0.62;
  return group;
}

export function createWeakMesh(): Group {
  const group = new Group();
  const accent = SOLVE_COLORS[4];

  const ring = new Mesh(new TorusGeometry(1.55, 0.2, 10, 32), new MeshBasicMaterial({ color: MACH_WHITE.clone().multiplyScalar(0.8) }));
  group.add(ring);

  const spokes = new Group();
  const spokeMaterial = new MeshBasicMaterial({ color: MACH_SHADE });
  for (let i = 0; i < 3; i += 1) {
    const spoke = new Mesh(new BoxGeometry(2.9, 0.24, 0.24), spokeMaterial);
    spoke.rotation.z = (i / 3) * Math.PI;
    spokes.add(spoke);
  }
  group.add(spokes);

  const core = new Mesh(new OctahedronGeometry(0.72, 0), createAdditiveBasicMaterial({ color: hdr(MARK_HOT, 2.1) }));
  group.add(core);

  const halo = new Mesh(new SphereGeometry(1.05, 14, 10), createAdditiveBasicMaterial({ color: hdr(accent, 0.9), opacity: 0.3 }));
  group.add(halo);

  group.userData.weakSpokes = spokes;
  group.userData.weakCore = core;
  group.userData.lockRingScale = 0.8;
  return group;
}

function polyhedronBody(geometry: BufferGeometry, accent: typeof SOLVE_COLORS[number]): { group: Group; shardSpecs: ShardSpec[] } {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  const body = new Mesh(geometry, new MeshBasicMaterial({ color: MACH_SHADE }));
  const edges = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial(additiveMaterialParameters({ color: hdr(MACH_WHITE, 0.9) })),
  );
  const core = new Mesh(
    geometry.clone().scale(0.45, 0.45, 0.45),
    createAdditiveBasicMaterial({ color: hdr(accent, 1.7) }),
  );
  group.add(body, edges, core);

  const direction = new Vector3(0, 1, 0);
  shardSpecs.push(
    { direction, color: MACH_WHITE.clone(), size: 0.5 },
    { direction: direction.clone().negate(), color: accent.clone(), size: 0.42 },
    { direction: new Vector3(1, 0.3, 0).normalize(), color: MACH_WHITE.clone(), size: 0.36 },
  );
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = accent.clone();
  group.userData.polyCore = core;
  return { group, shardSpecs };
}

export function createTetraMesh(seed = 0): Group {
  const accent = SOLVE_COLORS[seed % SOLVE_COLORS.length];
  const { group } = polyhedronBody(new TetrahedronGeometry(0.95, 0), accent);
  group.userData.lockRingScale = 0.7;
  return group;
}

export function createOctaMesh(seed = 1): Group {
  const accent = SOLVE_COLORS[(seed + 2) % SOLVE_COLORS.length];
  const { group } = polyhedronBody(new OctahedronGeometry(0.9, 0), accent);
  group.userData.lockRingScale = 0.7;
  return group;
}

export function createPrismMesh(): Group {
  const accent = SOLVE_COLORS[2];
  const geometry = new CylinderGeometry(0.62, 0.62, 1.7, 3);
  const { group } = polyhedronBody(geometry, accent);
  group.userData.lockRingScale = 0.7;
  return group;
}

// Hostile bolt: a candy-coloured dart — enemy fire wears the cube's colours.
export function createBoltMesh(): Group {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, createAdditiveBasicMaterial({ color: hdr(MARK_WHITE, 2.2) })));
  const shellGeometry = new OctahedronGeometry(0.44, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(SOLVE_COLORS[0], 1.1), opacity: 0.55 })));
  group.userData.isHostileShot = true;
  group.userData.trailColor = SOLVE_COLORS[0].clone().multiplyScalar(0.85);
  return group;
}

export function createMoteMesh(): Group {
  const group = new Group();
  const color = SOLVE_COLORS[Math.floor(Math.random() * SOLVE_COLORS.length)];
  const cube = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial({ color: color.clone().multiplyScalar(1.05) }));
  const edges = new LineSegments(
    new EdgesGeometry(cube.geometry),
    new LineBasicMaterial(additiveMaterialParameters({ color: hdr(MARK_WHITE, 1.1) })),
  );
  group.add(cube, edges);
  group.userData.accent = color.clone();
  group.userData.lockRingScale = 0.5;
  return group;
}

// The naked core: spinning gyro assembly — the level's final target.
export function createCoreEnemyMesh(): Group {
  const group = new Group();

  const body = new Mesh(new OctahedronGeometry(2.4, 0), new MeshBasicMaterial({ color: MACH_SHADE }));
  group.add(body);

  const glow = new Mesh(new SphereGeometry(1.6, 18, 12), createAdditiveBasicMaterial({ color: hdr(MARK_HOT, 1.7), opacity: 0.8 }));
  group.add(glow);

  const rings: Group[] = [];
  const ringSpecs: Array<[number, number, number]> = [
    [3.5, 0.17, 0],
    [4.4, 0.14, 1],
    [5.3, 0.12, 2],
  ];
  for (const [radius, tube, colorIndex] of ringSpecs) {
    const holder = new Group();
    holder.rotation.set(colorIndex * 0.9, colorIndex * 0.5, 0);
    const ring = new Mesh(new TorusGeometry(radius, tube, 10, 48), new MeshBasicMaterial({ color: MACH_SHADE.clone().multiplyScalar(1.15) }));
    holder.add(ring);
    for (const sign of [-1, 1]) {
      const tip = new Mesh(new BoxGeometry(0.46, 0.46, 0.46), new MeshBasicMaterial({ color: hdr(SOLVE_COLORS[colorIndex], 1.3) }));
      tip.position.set(sign * radius, 0, 0);
      ring.add(tip);
    }
    group.add(holder);
    rings.push(holder);
  }

  group.userData.coreRings = rings;
  group.userData.coreGlow = glow;
  group.userData.coreBody = body;
  group.userData.lockRingScale = 2.1;
  return group;
}

export function animateCoreEnemy(mesh: Group, dt: number, elapsed: number, spinRate: number) {
  const rings = mesh.userData.coreRings as Group[] | undefined;
  if (!rings) return;
  mesh.rotation.y += dt * 0.4 * (0.3 + spinRate);
  mesh.rotation.x = Math.sin(elapsed * 0.7) * 0.25;
  for (let i = 0; i < rings.length; i += 1) {
    rings[i].rotation.z += dt * (0.8 + i * 0.5) * (0.3 + spinRate * 0.9) * (i % 2 === 0 ? 1 : -1);
  }
  const glow = mesh.userData.coreGlow as Mesh;
  const material = glow.material as MeshBasicMaterial;
  material.opacity = 0.35 + Math.min(0.55, spinRate * 0.09) + Math.sin(elapsed * 9) * 0.05;
}

export function animateCell(mesh: Group, elapsed: number) {
  const quad = mesh.userData.cellQuad as Mesh | undefined;
  if (quad) {
    const material = quad.material as MeshBasicMaterial;
    material.opacity = 0.26 + Math.sin(elapsed * 6.5) * 0.09;
  }
}

export function animateWeak(mesh: Group, dt: number, elapsed: number) {
  const spokes = mesh.userData.weakSpokes as Group | undefined;
  if (spokes) spokes.rotation.z += dt * 2.6;
  const core = mesh.userData.weakCore as Mesh | undefined;
  if (core) core.rotation.set(elapsed * 2.2, elapsed * 1.7, 0);
}
