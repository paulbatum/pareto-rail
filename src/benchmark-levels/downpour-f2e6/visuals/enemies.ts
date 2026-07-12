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
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { ACID_GREEN, AMBER, CYAN, hdr, HAZARD_WHITE, MAGENTA, SLATE, SLATE_LIGHT } from './palette';

// Every hostile reads by silhouette and motion, not just color: interceptors
// are thin swept-wing darts, sentries are blocky bolted turrets, trawlers are
// flat wide skimmers, and the gunship is a slab of armored engine pods.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacet(
  group: Group,
  geometry: OctahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry | ConeGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
  fill.add(edges);
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.5, glowOpacity = 0.28) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.4), opacity: glowOpacity });
  const glow = new Mesh(new OctahedronGeometry(radius * glowScale, 1), glowMaterial);
  core.add(glow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- interceptor: a thin swept-wing hunter dart -------------------------------

export function createInterceptorMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.34, 0);
  body.scale(0.7, 0.7, 2.4);
  addFacet(group, body, SLATE.clone().multiplyScalar(0.9), MAGENTA, 1.15);

  for (const side of [-1, 1]) {
    const wing = new TetrahedronGeometry(0.62, 0);
    wing.scale(1.8, 0.12, 0.62);
    const mesh = addFacet(group, wing, SLATE.clone().multiplyScalar(0.7), CYAN, 1.2);
    mesh.position.set(side * 0.55, 0, -0.1);
    mesh.rotation.z = side * -0.12;
  }

  addCore(group, 0.15, CYAN, 1.9, 1.5, 0.32);

  const shardSpecs: ShardSpec[] = [
    { direction: new Vector3(1, 0.1, 0.2).normalize(), color: MAGENTA.clone(), size: 0.5 },
    { direction: new Vector3(-1, 0.1, 0.2).normalize(), color: MAGENTA.clone(), size: 0.5 },
    { direction: new Vector3(0, 0.3, 1).normalize(), color: CYAN.clone(), size: 0.4 },
    { direction: new Vector3(0, -0.3, -1).normalize(), color: CYAN.clone(), size: 0.4 },
  ];
  group.userData.accent = MAGENTA.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- sentry: a bolted armored turret ------------------------------------------

export function createSentryMesh() {
  const group = new Group();

  const mount = new BoxGeometry(0.5, 0.5, 0.7);
  const mountMesh = addFacet(group, mount, SLATE_LIGHT.clone(), HAZARD_WHITE, 0.7);
  mountMesh.position.y = -0.35;

  const turret = new BoxGeometry(0.78, 0.62, 0.9);
  addFacet(group, turret, SLATE.clone().multiplyScalar(1.1), HAZARD_WHITE, 1.1);

  const barrel = new CylinderGeometry(0.09, 0.11, 0.85, 8);
  const barrelMesh = addFacet(group, barrel, SLATE.clone().multiplyScalar(0.8), HAZARD_WHITE, 1.0);
  barrelMesh.rotation.x = Math.PI / 2;
  barrelMesh.position.z = 0.75;

  addCore(group, 0.14, HAZARD_WHITE, 1.7, 1.6, 0.3);

  // Spotlight ring: reads as a targeting eye, distinct from every other kind.
  const eyeMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_WHITE, 1.5), side: 2 });
  const eye = new Mesh(new RingGeometry(0.16, 0.22, 24), eyeMaterial);
  eye.position.z = 0.55;
  group.add(eye);
  tintable(group).push({ material: eyeMaterial, base: hdr(HAZARD_WHITE, 1.5), kind: 'core' });

  const shardSpecs: ShardSpec[] = [
    { direction: new Vector3(0.6, 0.3, 0.7).normalize(), color: HAZARD_WHITE.clone(), size: 0.6 },
    { direction: new Vector3(-0.6, 0.3, 0.7).normalize(), color: HAZARD_WHITE.clone(), size: 0.6 },
    { direction: new Vector3(0, -0.7, -0.4).normalize(), color: SLATE_LIGHT.clone().multiplyScalar(3), size: 0.5 },
  ];
  group.userData.accent = HAZARD_WHITE.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 1.15;
  return group;
}

// ---- trawler: a flat skimmer wedge, low over the canal ------------------------

export function createTrawlerMesh() {
  const group = new Group();
  const hull = new TetrahedronGeometry(0.7, 0);
  hull.scale(1.6, 0.28, 1.1);
  addFacet(group, hull, SLATE.clone().multiplyScalar(0.85), AMBER, 1.1);

  for (const side of [-1, 1]) {
    const fin = new BoxGeometry(0.5, 0.06, 0.9);
    const mesh = addFacet(group, fin, SLATE.clone().multiplyScalar(0.6), AMBER, 0.9);
    mesh.position.set(side * 0.68, -0.08, -0.25);
    mesh.rotation.y = side * 0.18;
  }

  addCore(group, 0.14, AMBER, 1.8, 1.5, 0.3);

  // Wake plane trailing behind, catching the amber undercity light.
  const wakeMaterial = createAdditiveBasicMaterial({ color: hdr(AMBER, 0.7), opacity: 0.4, side: 2 });
  const wake = new Mesh(new ConeGeometry(0.55, 2.4, 4, 1, true), wakeMaterial);
  wake.rotation.x = Math.PI / 2;
  wake.rotation.y = Math.PI / 4;
  wake.position.z = -1.3;
  group.add(wake);
  tintable(group).push({ material: wakeMaterial, base: hdr(AMBER, 0.7), kind: 'core' });

  const shardSpecs: ShardSpec[] = [
    { direction: new Vector3(0.8, 0.15, 0.3).normalize(), color: AMBER.clone(), size: 0.55 },
    { direction: new Vector3(-0.8, 0.15, 0.3).normalize(), color: AMBER.clone(), size: 0.55 },
    { direction: new Vector3(0, -0.5, -0.7).normalize(), color: AMBER.clone(), size: 0.45 },
  ];
  group.userData.accent = AMBER.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- bolt: the city's own hostile fire ----------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.28, 0);
  dart.scale(0.5, 0.5, 2.2);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_WHITE, 2.4) });
  const core = new Mesh(dart, coreMaterial);
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(AMBER, 1.0), opacity: 0.5 });
  const shellGeometry = new OctahedronGeometry(0.44, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  const shell = new Mesh(shellGeometry, shellMaterial);
  group.add(core, shell);
  tintable(group).push(
    { material: coreMaterial, base: hdr(HAZARD_WHITE, 2.4), kind: 'core' },
    { material: shellMaterial, base: hdr(AMBER, 1.0), kind: 'core' },
  );
  group.userData.accent = AMBER.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = AMBER.clone().multiplyScalar(0.85);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: AMBER.clone(), size: 0.35 },
    { direction: new Vector3(0, 0, -1), color: AMBER.clone(), size: 0.35 },
  ];
  group.userData.lockRingScale = 0.7;
  return group;
}

// ---- gunship: the hunter-gunship boss ------------------------------------------

export function createGunshipMesh() {
  const group = new Group();

  const hull = new BoxGeometry(2.6, 0.75, 3.6);
  addFacet(group, hull, SLATE.clone().multiplyScalar(1.05), HAZARD_WHITE, 0.85);

  for (const side of [-1, 1]) {
    const pod = new CylinderGeometry(0.42, 0.5, 2.0, 8);
    const mesh = addFacet(group, pod, SLATE_LIGHT.clone(), ACID_GREEN, 1.3);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(side * 1.55, -0.1, -0.2);
  }

  const prow = new TetrahedronGeometry(0.9, 0);
  prow.scale(1, 0.6, 1.7);
  const prowMesh = addFacet(group, prow, SLATE.clone().multiplyScalar(0.9), ACID_GREEN, 1.2);
  prowMesh.position.z = 1.9;

  const core = addCore(group, 0.4, ACID_GREEN, 1.9, 1.6, 0.4);
  core.position.z = 0.4;

  const canopyMaterial = createAdditiveBasicMaterial({ color: hdr(ACID_GREEN, 1.1), opacity: 0.45, side: 2 });
  const canopy = new Mesh(new RingGeometry(0.35, 0.55, 5), canopyMaterial);
  canopy.position.set(0, 0.42, 0.6);
  canopy.rotation.x = -Math.PI / 2.4;
  group.add(canopy);
  tintable(group).push({ material: canopyMaterial, base: hdr(ACID_GREEN, 1.1), kind: 'core' });

  group.scale.setScalar(1.35);

  const shardSpecs: ShardSpec[] = [
    { direction: new Vector3(1, 0.1, 0.3).normalize(), color: ACID_GREEN.clone(), size: 1.1 },
    { direction: new Vector3(-1, 0.1, 0.3).normalize(), color: ACID_GREEN.clone(), size: 1.1 },
    { direction: new Vector3(0, 0.6, -0.7).normalize(), color: HAZARD_WHITE.clone(), size: 0.9 },
    { direction: new Vector3(0, -0.6, 0.6).normalize(), color: HAZARD_WHITE.clone(), size: 0.9 },
  ];
  group.userData.accent = ACID_GREEN.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 2.4;
  group.userData.isGunship = true;
  return group;
}
