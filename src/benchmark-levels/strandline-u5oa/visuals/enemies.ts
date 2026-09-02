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
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  DENIED_RED,
  hdr,
  LOCK_CYAN,
  LOCK_GOLD,
  PARASITE_BRUISE,
  PARASITE_CORE,
  PARASITE_TOXIC,
  PARASITE_VIOLET,
  PEARL_WHITE,
} from './palette';

export type EnemyTintPart = {
  material: MeshBasicMaterial | LineBasicMaterial;
  baseColor: Color;
  kind: 'fill' | 'edge' | 'core';
};

export type EnemyMeshUserData = {
  kind: string;
  parts: EnemyTintPart[];
  coreMesh?: Mesh;
  spinSpeed?: number;
  latticeMesh?: Mesh;
  latticeShieldActive?: boolean;
};

// ---- Module-level Shared Geometries (ZERO runtime geometry growth) ----------
const coreOctaGeom = new OctahedronGeometry(1, 1);
const auraSphereGeom = new SphereGeometry(1, 8, 6);

// Clasper geometries
const clasperThoraxGeom = new IcosahedronGeometry(0.85, 0);
const clasperThoraxEdges = new EdgesGeometry(clasperThoraxGeom);
const clasperLegGeom = new ConeGeometry(0.12, 1.1, 4);
clasperLegGeom.rotateX(Math.PI * 0.7);
const clasperLegEdges = new EdgesGeometry(clasperLegGeom);

// Skimmer geometries
const skimmerHeadGeom = new ConeGeometry(0.55, 1.3, 5);
skimmerHeadGeom.rotateX(-Math.PI / 2);
const skimmerHeadEdges = new EdgesGeometry(skimmerHeadGeom);
const skimmerBodyGeom = new CylinderGeometry(0.48, 0.35, 1.6, 5);
skimmerBodyGeom.rotateX(Math.PI / 2);
const skimmerBodyEdges = new EdgesGeometry(skimmerBodyGeom);
const skimmerTailGeom = new ConeGeometry(0.3, 1.4, 4);
skimmerTailGeom.rotateX(Math.PI / 2);
const skimmerTailEdges = new EdgesGeometry(skimmerTailGeom);
const skimmerFinGeom = new BoxGeometry(1.8, 0.08, 0.6);
const skimmerFinEdges = new EdgesGeometry(skimmerFinGeom);

// Spore sac geometries
const sporeSacGeom = new IcosahedronGeometry(0.6, 1);
const sporeSacEdges = new EdgesGeometry(sporeSacGeom);
const thornRingGeom = new TorusGeometry(0.95, 0.05, 4, 16);

// Spore bolt geometries
const sporeNeedleGeom = new CylinderGeometry(0.04, 0.18, 1.4, 4);
sporeNeedleGeom.rotateX(Math.PI / 2);
const sporeNeedleEdges = new EdgesGeometry(sporeNeedleGeom);

// Parent boss geometries
const parentBodyGeom = new IcosahedronGeometry(2.4, 1);
const parentBodyEdges = new EdgesGeometry(parentBodyGeom);
const parentMandibleGeom = new ConeGeometry(0.4, 3.5, 5);
parentMandibleGeom.rotateX(Math.PI * 0.75);
const parentMandibleEdges = new EdgesGeometry(parentMandibleGeom);
const spokeGeom = new CylinderGeometry(0.05, 0.05, 6.0, 4);
const latticeRingGeoms = [
  new TorusGeometry(2.8, 0.08, 6, 24),
  new TorusGeometry(3.5, 0.08, 6, 24),
  new TorusGeometry(4.2, 0.08, 6, 24),
  new TorusGeometry(4.9, 0.08, 6, 24),
];

function trackPart(group: Group, part: EnemyTintPart) {
  const data = (group.userData ??= {}) as EnemyMeshUserData;
  data.parts ??= [];
  data.parts.push(part);
}

function addSharedFacet(
  group: Group,
  geom: BufferGeometry,
  edgesGeom: BufferGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity = 1.2,
): Mesh {
  const fillMat = new MeshBasicMaterial({
    color: fillColor.clone(),
    depthWrite: true,
  });
  const mesh = new Mesh(geom, fillMat);

  const edgeMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }),
  );
  const edges = new LineSegments(edgesGeom, edgeMat);
  mesh.add(edges);
  group.add(mesh);

  trackPart(group, { material: fillMat, baseColor: fillColor.clone(), kind: 'fill' });
  trackPart(group, { material: edgeMat, baseColor: hdr(edgeColor, edgeIntensity), kind: 'edge' });
  return mesh;
}

function addSharedCore(
  group: Group,
  radius: number,
  color: Color,
  intensity = 1.5,
): Mesh {
  const coreMat = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const mesh = new Mesh(coreOctaGeom, coreMat);
  mesh.scale.setScalar(radius);

  const auraMat = createAdditiveBasicMaterial({
    color: hdr(color, intensity * 0.5),
    opacity: 0.45,
  });
  const aura = new Mesh(auraSphereGeom, auraMat);
  aura.scale.setScalar(1.6);
  mesh.add(aura);
  group.add(mesh);

  trackPart(group, { material: coreMat, baseColor: hdr(color, intensity), kind: 'core' });
  trackPart(group, { material: auraMat, baseColor: hdr(color, intensity * 0.5), kind: 'core' });
  return mesh;
}

// 1. CLASPER: Sickly violet polyp parasite
export function createClasperMesh(): Group {
  const group = new Group();
  const data = (group.userData = { kind: 'clasper', parts: [] } as EnemyMeshUserData);

  addSharedFacet(group, clasperThoraxGeom, clasperThoraxEdges, PARASITE_BRUISE, PARASITE_VIOLET, 1.3);

  const core = addSharedCore(group, 0.38, PARASITE_CORE, 1.8);
  core.position.set(0, 0, 0.4);
  data.coreMesh = core;

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const leg = addSharedFacet(group, clasperLegGeom, clasperLegEdges, PARASITE_BRUISE.clone().multiplyScalar(0.7), PARASITE_TOXIC, 1.0);
    leg.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, -0.1);
    leg.rotation.z = angle;
    leg.rotation.y = 0.35;
  }

  return group;
}

// 2. SKIMMER: Serpentine leech parasite
export function createSkimmerMesh(): Group {
  const group = new Group();
  const data = (group.userData = { kind: 'skimmer', parts: [] } as EnemyMeshUserData);

  const head = addSharedFacet(group, skimmerHeadGeom, skimmerHeadEdges, PARASITE_BRUISE, PARASITE_TOXIC, 1.4);
  head.position.z = 0.5;

  const body = addSharedFacet(group, skimmerBodyGeom, skimmerBodyEdges, PARASITE_BRUISE.clone().multiplyScalar(0.8), PARASITE_VIOLET, 1.2);
  body.position.z = -0.7;

  const tail = addSharedFacet(group, skimmerTailGeom, skimmerTailEdges, PARASITE_BRUISE.clone().multiplyScalar(0.6), PARASITE_VIOLET, 1.0);
  tail.position.z = -2.0;

  const fin = addSharedFacet(group, skimmerFinGeom, skimmerFinEdges, PARASITE_BRUISE, PARASITE_TOXIC, 1.5);
  fin.position.z = -0.3;

  const eyeL = addSharedCore(group, 0.14, PARASITE_CORE, 2.0);
  eyeL.position.set(-0.25, 0.2, 0.9);
  const eyeR = addSharedCore(group, 0.14, PARASITE_CORE, 2.0);
  eyeR.position.set(0.25, 0.2, 0.9);

  data.spinSpeed = 1.5;
  return group;
}

// 3. SPORE SAC: Brood pod cluster
export function createSporeSacMesh(): Group {
  const group = new Group();
  const data = (group.userData = { kind: 'spore_sac', parts: [] } as EnemyMeshUserData);

  const core = addSharedCore(group, 0.45, PARASITE_CORE, 2.0);
  data.coreMesh = core;

  const offsets = [
    new Vector3(0.55, 0.4, 0),
    new Vector3(-0.55, 0.4, 0),
    new Vector3(0, -0.65, 0.2),
    new Vector3(0, 0.2, -0.5),
  ];

  for (let i = 0; i < offsets.length; i++) {
    const sac = addSharedFacet(group, sporeSacGeom, sporeSacEdges, PARASITE_BRUISE, PARASITE_TOXIC, 1.2);
    sac.position.copy(offsets[i]);
    sac.scale.set(0.9, 1.1, 0.9);
  }

  const ringMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(PARASITE_VIOLET, 1.3) }),
  );
  group.add(new Mesh(thornRingGeom, ringMat));
  trackPart(group, { material: ringMat, baseColor: hdr(PARASITE_VIOLET, 1.3), kind: 'edge' });

  return group;
}

// 4. SPORE BOLT: Lockable hostile projectile
export function createSporeBoltMesh(): Group {
  const group = new Group();
  const data = (group.userData = { kind: 'spore_bolt', parts: [] } as EnemyMeshUserData);

  addSharedFacet(group, sporeNeedleGeom, sporeNeedleEdges, PARASITE_BRUISE, PARASITE_TOXIC, 1.8);

  const core = addSharedCore(group, 0.22, PARASITE_CORE, 2.2);
  data.coreMesh = core;

  return group;
}

// 5. PARENT ORGANISM: Queen at the crown
export function createParentOrganismMesh(): Group {
  const group = new Group();
  const data = (group.userData = {
    kind: 'parent',
    parts: [],
    latticeShieldActive: true,
  } as EnemyMeshUserData);

  const mainBody = addSharedFacet(group, parentBodyGeom, parentBodyEdges, PARASITE_BRUISE, PARASITE_VIOLET, 1.5);
  mainBody.scale.set(1.2, 1.0, 1.4);

  const queenCore = addSharedCore(group, 1.1, PARASITE_CORE, 2.4);
  queenCore.position.set(0, 0, 0.5);
  data.coreMesh = queenCore;

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const m = addSharedFacet(group, parentMandibleGeom, parentMandibleEdges, PARASITE_BRUISE.clone().multiplyScalar(0.7), PARASITE_TOXIC, 1.3);
    m.position.set(Math.cos(angle) * 2.0, Math.sin(angle) * 2.0, -1.0);
    m.rotation.z = angle;
  }

  const latticeGroup = new Group();
  for (let i = 0; i < latticeRingGeoms.length; i++) {
    const ringMat = new MeshBasicMaterial(
      additiveMaterialParameters({ color: hdr(PARASITE_TOXIC, 1.6), transparent: true, opacity: 0.8 }),
    );
    const rMesh = new Mesh(latticeRingGeoms[i], ringMat);
    rMesh.position.z = (i - 1.5) * 0.8;
    latticeGroup.add(rMesh);
  }

  for (let i = 0; i < 6; i++) {
    const sMat = new MeshBasicMaterial(
      additiveMaterialParameters({ color: hdr(PARASITE_VIOLET, 1.4), transparent: true, opacity: 0.7 }),
    );
    const spoke = new Mesh(spokeGeom, sMat);
    spoke.rotation.z = (i / 6) * Math.PI;
    latticeGroup.add(spoke);
  }

  group.add(latticeGroup);
  data.latticeMesh = latticeGroup as unknown as Mesh;

  return group;
}

export function setEnemyMeshLocked(mesh: Group, locked: boolean) {
  const data = mesh.userData as EnemyMeshUserData;
  if (!data || !data.parts) return;

  for (const part of data.parts) {
    if (locked) {
      if (part.kind === 'fill') {
        part.material.color.copy(hdr(LOCK_CYAN, 1.1));
      } else if (part.kind === 'edge') {
        part.material.color.copy(hdr(LOCK_GOLD, 2.2));
      } else if (part.kind === 'core') {
        part.material.color.copy(hdr(PEARL_WHITE, 2.5));
      }
    } else {
      part.material.color.copy(part.baseColor);
    }
  }

  mesh.scale.setScalar(locked ? 1.25 : 1.0);
}

export function setEnemyMeshDenied(mesh: Group) {
  const data = mesh.userData as EnemyMeshUserData;
  if (!data || !data.parts) return;

  for (const part of data.parts) {
    part.material.color.copy(DENIED_RED);
  }
  mesh.scale.setScalar(0.82);
}
