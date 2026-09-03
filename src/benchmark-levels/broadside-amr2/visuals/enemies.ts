import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CORE_WHITE, CRIMSON, hdr, MOLTEN, OBSIDIAN } from './palette';

export type EnemyMeshKind =
  | 'dart'
  | 'gunship'
  | 'weaver'
  | 'bolt'
  | 'shield-gen'
  | 'power-node'
  | 'flag-core';

import type * as THREE from 'three';

function hullMesh(geometry: THREE.BufferGeometry, edgeColor: Color, fillIntensity: number) {
  const group = new Group();
  const fill = new Mesh(
    geometry,
    new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(fillIntensity) }),
  );
  const edges = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial({ color: edgeColor }),
  );
  group.add(fill, edges);
  group.userData.fillMaterial = fill.material;
  group.userData.edgeMaterial = edges.material;
  return group;
}

// One LineSegments for several static parts: fewer scene objects without
// losing the wireframe read.
function mergedEdges(
  parts: Array<{ geometry: BufferGeometry; position?: Vector3; rotationZ?: number }>,
  color: Color,
): LineSegments {
  const geos = parts.map(({ geometry, position, rotationZ }) => {
    const edges = new EdgesGeometry(geometry);
    const matrix = new Matrix4().compose(
      position ?? new Vector3(),
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotationZ ?? 0),
      new Vector3(1, 1, 1),
    );
    const merged = edges.applyMatrix4(matrix);
    edges.dispose();
    return merged;
  });
  const lines = new LineSegments(
    mergeGeometries(geos),
    new LineBasicMaterial({ color }),
  );
  for (const geometry of geos) geometry.dispose();
  return lines;
}

function glowDot(color: Color, size: number, intensity: number): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(size, 10, 8),
    createAdditiveBasicMaterial({ color: hdr(color, intensity) }),
  );
  mesh.userData.glowBase = color.clone();
  mesh.userData.glowIntensity = intensity;
  return mesh;
}

function shardSpecsFor(group: Group, accent: Color, size: number): ShardSpec[] {
  const specs: ShardSpec[] = [];
  group.updateMatrixWorld(true);
  const center = new Vector3();
  group.getWorldPosition(center);
  group.traverse((child) => {
    if (child instanceof Mesh) {
      const p = new Vector3();
      child.getWorldPosition(p);
      const dir = p.sub(center);
      if (dir.lengthSq() > 0.0001) {
        specs.push({ direction: dir.normalize().clone(), color: accent.clone(), size });
      }
    }
  });
  return specs;
}

function finish(group: Group, kind: EnemyMeshKind, accent: Color, lockRingScale: number, shardSize: number) {
  group.userData.kind = kind;
  group.userData.accent = accent.clone();
  group.userData.lockRingScale = lockRingScale;
  group.userData.shardSpecs = shardSpecsFor(group, accent, shardSize);
  group.userData.locked = false;
  return group;
}

// --- Swarm craft: enemy carriers' fast small attack craft -------------------

// Dart: a needle-nosed arrowhead, the most numerous swarm craft.
export function createDartMesh(): Group {
  const group = new Group();
  const body = hullMesh(new ConeGeometry(0.42, 1.9, 4), hdr(MOLTEN, 1.1), 1.0);
  body.rotation.x = Math.PI / 2;
  const cockpit = glowDot(MOLTEN, 0.2, 1.6);
  cockpit.position.set(0, 0.18, 0.25);
  const engine = glowDot(CRIMSON, 0.18, 1.7);
  engine.position.set(0, 0, -0.95);
  group.add(body, cockpit, engine);
  return finish(group, 'dart', MOLTEN.clone(), 1.0, 0.42);
}

// Gunship: a twin-hull bruiser with a molten view-slit, slow and heavy.
export function createGunshipMesh(): Group {
  const group = new Group();
  const leftHull = hullMesh(new BoxGeometry(0.5, 0.5, 2.6), hdr(MOLTEN, 1.0), 1.0);
  leftHull.position.x = -0.75;
  const rightHull = hullMesh(new BoxGeometry(0.5, 0.5, 2.6), hdr(MOLTEN, 1.0), 1.0);
  rightHull.position.x = 0.75;
  const spar = hullMesh(new BoxGeometry(1.9, 0.28, 0.5), hdr(MOLTEN, 0.9), 0.8);
  spar.position.z = 0.5;
  const slit = new Mesh(
    new BoxGeometry(1.1, 0.12, 0.1),
    createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.8) }),
  );
  slit.position.set(0, 0.1, -0.45);
  const engines = new Group();
  for (const x of [-0.75, 0.75]) {
    const engine = glowDot(CRIMSON, 0.2, 1.7);
    engine.position.set(x, 0, -1.35);
    engines.add(engine);
  }
  group.add(leftHull, rightHull, spar, slit, engines);
  return finish(group, 'gunship', CRIMSON.clone(), 1.7, 0.6);
}

// Weaver: a tri-blade spinner built to corkscrew.
export function createWeaverMesh(): Group {
  const group = new Group();
  const core = glowDot(MOLTEN, 0.3, 1.8);
  const blades = new Group();
  const bladeGeo = new BoxGeometry(0.22, 1.7, 0.5);
  const bladePositions: Vector3[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const position = new Vector3(Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, 0);
    const blade = new Mesh(
      bladeGeo,
      new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(1.0) }),
    );
    blade.position.copy(position);
    blade.rotation.z = angle + Math.PI / 2;
    blades.add(blade);
    bladePositions.push(position);
  }
  const bladeEdges = mergedEdges(
    bladePositions.map((position, i) => ({
      geometry: bladeGeo,
      position,
      rotationZ: (i / 3) * Math.PI * 2 + Math.PI / 2,
    })),
    hdr(CRIMSON, 1.2),
  );
  blades.add(bladeEdges);
  group.add(core, blades);
  group.userData.spinner = blades;
  return finish(group, 'weaver', CRIMSON.clone(), 1.25, 0.5);
}

// Bolt: point-defense flak the capital ships throw at the player. Hazard.
export function createBoltMesh(): Group {
  const group = new Group();
  const spike = new Mesh(
    new OctahedronGeometry(0.4, 0),
    new MeshBasicMaterial({ color: hdr(CORE_WHITE, 1.6) }),
  );
  spike.scale.set(0.55, 0.55, 2.2);
  const halo = glowDot(CRIMSON, 0.5, 1.1);
  group.add(spike, halo);
  group.userData.isBolt = true;
  return finish(group, 'bolt', CRIMSON.clone(), 0.8, 0.35);
}

// --- Flagship systems -------------------------------------------------------

// Shield generator: a hex ring shrine with a crimson heart.
export function createShieldGenMesh(): Group {
  const group = new Group();
  const ringGeo = new TorusGeometry(1.15, 0.22, 8, 6);
  const ring = new Mesh(
    ringGeo,
    new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.6) }),
  );
  const ringEdges = new LineSegments(
    new EdgesGeometry(ringGeo),
    new LineBasicMaterial({ color: hdr(MOLTEN, 1.3) }),
  );
  const heart = glowDot(CRIMSON, 0.5, 2.0);
  const cage = new Group();
  const strutGeo = new BoxGeometry(0.18, 2.6, 0.18);
  for (let i = 0; i < 3; i += 1) {
    const strut = new Mesh(
      strutGeo,
      new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) }),
    );
    strut.rotation.z = (i / 3) * Math.PI;
    cage.add(strut);
  }
  cage.add(mergedEdges(
    [0, 1, 2].map((i) => ({ geometry: strutGeo, rotationZ: (i / 3) * Math.PI })),
    hdr(MOLTEN, 0.8),
  ));
  group.add(ring, ringEdges, heart, cage);
  group.userData.edgeMaterial = ringEdges.material;
  group.userData.fillMaterial = ring.material;
  group.userData.spinner = cage;
  return finish(group, 'shield-gen', MOLTEN.clone(), 1.6, 0.7);
}

// Power node: a trench coil with a molten core.
export function createPowerNodeMesh(): Group {
  const group = new Group();
  const stack = new Group();
  const plateGeos: CylinderGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const plateGeo = new CylinderGeometry(0.85 - i * 0.12, 0.85 - i * 0.12, 0.24, 6);
    plateGeos.push(plateGeo);
    const plate = new Mesh(
      plateGeo,
      new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) }),
    );
    plate.position.y = (i - 1) * 0.6;
    stack.add(plate);
  }
  stack.add(mergedEdges(
    plateGeos.map((geometry, i) => ({
      geometry,
      position: new Vector3(0, (i - 1) * 0.6, 0),
    })),
    hdr(MOLTEN, 1.1),
  ));
  const core = glowDot(MOLTEN, 0.34, 1.7);
  group.add(stack, core);
  return finish(group, 'power-node', MOLTEN.clone(), 1.5, 0.6);
}

// Flagship core: a dark sun ringed with crimson spikes.
export function createFlagCoreMesh(): Group {
  const group = new Group();
  const sun = new Mesh(
    new IcosahedronGeometry(1.5, 1),
    new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) }),
  );
  const sunEdges = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(1.5, 1)),
    new LineBasicMaterial({ color: hdr(MOLTEN, 1.2) }),
  );
  const heart = glowDot(CRIMSON, 0.8, 2.2);
  const spikes = new Group();
  const spikeGeo = new ConeGeometry(0.22, 1.2, 4);
  for (let i = 0; i < 8; i += 1) {
    const spike = new Mesh(
      spikeGeo,
      new MeshBasicMaterial({ color: hdr(CRIMSON, 0.9) }),
    );
    const angle = (i / 8) * Math.PI * 2;
    spike.position.set(Math.cos(angle) * 2.0, Math.sin(angle) * 2.0, 0);
    spike.rotation.z = angle - Math.PI / 2;
    spikes.add(spike);
  }
  group.add(sun, sunEdges, heart, spikes);
  group.userData.edgeMaterial = sunEdges.material;
  group.userData.fillMaterial = sun.material;
  group.userData.spinner = spikes;
  return finish(group, 'flag-core', CRIMSON.clone(), 2.2, 0.9);
}

const LOCK_TINT = new Color(1.0, 0.78, 0.35);

// Locked targets flare gold at the edges — the fleet's "weapons free" read.
export function setSwarmLocked(group: Group, locked: boolean) {
  group.userData.locked = locked;
  const edge = group.userData.edgeMaterial as LineBasicMaterial | undefined;
  // Per-part edges (gunship hulls, weaver blades) tint via traversal.
  group.traverse((child) => {
    if (child instanceof LineSegments) {
      const material = child.material as LineBasicMaterial;
      if (locked) {
        if (material.userData.baseColor === undefined) {
          material.userData.baseColor = material.color.clone();
        }
        material.color.copy(hdr(LOCK_TINT, 1.6));
      } else if (material.userData.baseColor !== undefined) {
        material.color.copy(material.userData.baseColor as Color);
      }
    }
  });
  if (edge && !locked && edge.userData.baseColor !== undefined) {
    edge.color.copy(edge.userData.baseColor as Color);
  }
  group.scale.setScalar(locked ? 1.12 : 1);
}
