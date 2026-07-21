import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CHITIN,
  DANGER_RED,
  HAZARD_ORANGE,
  hdr,
  PALE_CORE,
  PANEL_SHADOW,
  PANEL_WHITE,
  STORM_GREY,
  WARN_AMBER,
} from './palette';
import type { ShardSpec } from './effects';

// Silhouette carries identity: kites are taut wings, vanes are rotor crosses,
// darts are needles, grapplers are hook-armed crabs, bulwarks are armored
// slabs, and the Tetherjack is a house-sized clamp-crawler. Storm kinds are
// grey chitin with pale cores; vacuum kinds darken; only hardware (and the
// beast that eats hardware) wears hazard orange.
//
// Geometries are cached at module scope and shared across every instance —
// only materials are per-mesh (they carry lock/deny/damage tinting).

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

const geometryCache = new Map<string, BufferGeometry>();

function cachedGeometry(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function edgesFor(key: string, geometry: BufferGeometry): BufferGeometry {
  return cachedGeometry(`edges:${key}`, () => new EdgesGeometry(geometry));
}

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacetMesh(
  group: Group,
  key: string,
  make: () => BufferGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const geometry = cachedGeometry(key, make);
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  fill.add(new LineSegments(edgesFor(key, geometry), edgeMaterial));
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.5, glowOpacity = 0.26) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(cachedGeometry(`core-${radius}`, () => new OctahedronGeometry(radius, 1)), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.4), opacity: glowOpacity });
  core.add(new Mesh(cachedGeometry(`core-${radius}-glow-${glowScale}`, () => new OctahedronGeometry(radius * glowScale, 1)), glowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- kite: a taut storm wing ------------------------------------------------

export function createKiteMesh() {
  const group = new Group();
  addFacetMesh(group, 'kite-wing', () => {
    const wing = new TetrahedronGeometry(0.9, 0);
    wing.scale(2.3, 0.22, 1.1);
    return wing;
  }, STORM_GREY.clone().multiplyScalar(0.4), PALE_CORE, 1.1);
  for (const side of [-1, 1]) {
    const mesh = addFacetMesh(group, 'kite-tip', () => {
      const tip = new TetrahedronGeometry(0.4, 0);
      tip.scale(0.9, 0.16, 1.6);
      return tip;
    }, CHITIN.clone().multiplyScalar(1.2), PALE_CORE, 0.9);
    mesh.position.set(side * 1.6, 0, -0.4);
    mesh.rotation.z = side * -0.35;
  }
  addCore(group, 0.2, PALE_CORE, 1.7);
  group.userData.accent = PALE_CORE.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.2, 0).normalize(), color: STORM_GREY.clone(), size: 0.6 },
    { direction: new Vector3(-1, 0.2, 0).normalize(), color: STORM_GREY.clone(), size: 0.6 },
    { direction: new Vector3(0, 0.4, -0.8).normalize(), color: PALE_CORE.clone(), size: 0.4 },
  ] satisfies ShardSpec[];
  group.userData.isVapor = true; // kills puff like a burst gust
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- vane: a rotor drone ----------------------------------------------------

export function createVaneMesh() {
  const group = new Group();
  addFacetMesh(group, 'vane-hub', () => {
    const hub = new OctahedronGeometry(0.5, 0);
    hub.scale(1, 1.4, 1);
    return hub;
  }, CHITIN.clone().multiplyScalar(1.1), STORM_GREY, 1.2);
  addCore(group, 0.18, PALE_CORE, 1.6);

  // Spinning four-blade cross — the tell that separates it from everything else.
  const rotor = new Group();
  const bladeMaterial = createAdditiveBasicMaterial({ color: hdr(STORM_GREY, 1.15), side: 2 });
  const bladeGeometry = cachedGeometry('vane-blade', () => new BoxGeometry(1.5, 0.14, 0.05));
  for (let i = 0; i < 4; i += 1) {
    const blade = new Mesh(bladeGeometry, bladeMaterial);
    blade.position.x = Math.cos((i / 4) * Math.PI * 2) * 0.85;
    blade.position.y = Math.sin((i / 4) * Math.PI * 2) * 0.85;
    blade.rotation.z = (i / 4) * Math.PI * 2;
    rotor.add(blade);
  }
  rotor.userData.spinSpeed = 5.2;
  group.add(rotor);
  group.userData.spinParts = [rotor];
  tintable(group).push({ material: bladeMaterial, base: hdr(STORM_GREY, 1.15), kind: 'edge' });

  group.userData.accent = STORM_GREY.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0, 0), color: STORM_GREY.clone(), size: 0.5 },
    { direction: new Vector3(-1, 0, 0), color: STORM_GREY.clone(), size: 0.5 },
    { direction: new Vector3(0, 1, 0), color: PALE_CORE.clone(), size: 0.4 },
    { direction: new Vector3(0, -1, 0), color: CHITIN.clone(), size: 0.4 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.1;
  return group;
}

// ---- dart: a vacuum needle --------------------------------------------------

export function createDartMesh() {
  const group = new Group();
  addFacetMesh(group, 'dart-body', () => {
    const body = new OctahedronGeometry(0.4, 0);
    body.scale(0.5, 0.5, 3.2);
    return body;
  }, CHITIN.clone().multiplyScalar(0.9), WARN_AMBER, 1.15);
  for (const side of [-1, 1]) {
    const mesh = addFacetMesh(group, 'dart-fin', () => {
      const fin = new TetrahedronGeometry(0.34, 0);
      fin.scale(1.3, 0.16, 0.8);
      return fin;
    }, CHITIN.clone(), WARN_AMBER, 0.9);
    mesh.position.set(side * 0.42, 0, -0.8);
  }
  addCore(group, 0.16, WARN_AMBER, 1.8, 1.4, 0.3);
  group.userData.accent = WARN_AMBER.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: WARN_AMBER.clone(), size: 0.5 },
    { direction: new Vector3(0.6, 0.4, -0.6).normalize(), color: CHITIN.clone(), size: 0.4 },
    { direction: new Vector3(-0.6, -0.4, -0.6).normalize(), color: CHITIN.clone(), size: 0.4 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 0.95;
  return group;
}

// ---- grappler: the thing that goes for the car ------------------------------

export function createGrapplerMesh() {
  const group = new Group();
  addFacetMesh(group, 'grappler-body', () => {
    const body = new OctahedronGeometry(0.55, 0);
    body.scale(1.3, 0.8, 1);
    return body;
  }, CHITIN.clone().multiplyScalar(1.2), DANGER_RED, 0.9);

  // Hook arms — four curved claws splayed forward, hungry for deck plate.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const mesh = addFacetMesh(group, 'grappler-claw', () => new ConeGeometry(0.14, 1.1, 5), CHITIN.clone(), DANGER_RED, 1.1);
    mesh.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.6, 0.5);
    mesh.rotation.x = Math.PI / 2.6;
    mesh.rotation.z = -angle;
  }
  // The warning eye: pulses once latched, flares when armed.
  const eyeMaterial = new MeshBasicMaterial({ color: hdr(DANGER_RED, 1.8) });
  const eye = new Mesh(cachedGeometry('grappler-eye', () => new OctahedronGeometry(0.2, 1)), eyeMaterial);
  eye.position.z = 0.45;
  group.add(eye);
  group.userData.eyeMaterial = eyeMaterial;
  tintable(group).push({ material: eyeMaterial, base: hdr(DANGER_RED, 1.8), kind: 'core' });

  group.userData.accent = DANGER_RED.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0.7, 0.5, 0.4).normalize(), color: CHITIN.clone(), size: 0.6 },
    { direction: new Vector3(-0.7, 0.5, 0.4).normalize(), color: CHITIN.clone(), size: 0.6 },
    { direction: new Vector3(0.5, -0.6, 0.3).normalize(), color: DANGER_RED.clone(), size: 0.5 },
    { direction: new Vector3(-0.5, -0.6, 0.3).normalize(), color: CHITIN.clone(), size: 0.5 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.1;
  return group;
}

// ---- bulwark: an armored vacuum slab ----------------------------------------

export function createBulwarkMesh() {
  const group = new Group();
  // Molten-amber core column, hidden behind armor until the stage break.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(WARN_AMBER, 1.0) });
  const core = new Mesh(cachedGeometry('bulwark-core', () => new CylinderGeometry(0.6, 0.6, 2.3, 6)), coreMaterial);
  const coreGlow = createAdditiveBasicMaterial({ color: hdr(WARN_AMBER, 0.4), opacity: 0.24 });
  core.add(new Mesh(cachedGeometry('bulwark-core-glow', () => new CylinderGeometry(0.9, 0.9, 2.5, 6)), coreGlow));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(WARN_AMBER, 1.0), kind: 'core' },
    { material: coreGlow, base: hdr(WARN_AMBER, 0.4), kind: 'core' },
  );

  // Scavenged panel armor: white service plates bolted into a cage, merged
  // into a single mesh so the cage costs two draw calls.
  const armorFill = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.32) });
  const armorEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(PANEL_WHITE, 0.85) }));
  const armorGeometry = cachedGeometry('bulwark-armor', () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      const plate = new BoxGeometry(1.05, 2.7, 0.24);
      plate.applyMatrix4(new Matrix4()
        .makeRotationY(-angle + Math.PI / 2)
        .setPosition(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15));
      parts.push(plate);
    }
    return mergeGeometries(parts);
  });
  const armorEdges = edgesFor('bulwark-armor', armorGeometry);
  const armor = new Group();
  const armorMesh = new Mesh(armorGeometry, armorFill);
  armorMesh.add(new LineSegments(armorEdges, armorEdge));
  armor.add(armorMesh);
  group.add(armor);
  group.userData.armor = armor;
  tintable(group).push(
    { material: armorFill, base: PANEL_WHITE.clone().multiplyScalar(0.32), kind: 'fill' },
    { material: armorEdge, base: hdr(PANEL_WHITE, 0.85), kind: 'edge' },
  );
  const shardSpecs: ShardSpec[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    shardSpecs.push({
      direction: new Vector3(Math.cos(angle), 0.3, Math.sin(angle)).normalize(),
      color: PANEL_WHITE.clone(),
      size: 0.9,
    });
  }

  for (const y of [1.6, -1.6]) {
    const cap = addFacetMesh(group, 'bulwark-cap', () => new CylinderGeometry(1.3, 1.0, 0.45, 6), PANEL_SHADOW.clone(), HAZARD_ORANGE, 0.95);
    cap.position.y = y;
    if (y < 0) cap.rotation.z = Math.PI;
  }

  group.userData.accent = WARN_AMBER.clone();
  group.userData.shardSpecs = [
    ...shardSpecs,
    { direction: new Vector3(0, 1, 0), color: WARN_AMBER.clone(), size: 1.1 },
    { direction: new Vector3(0, -1, 0), color: WARN_AMBER.clone(), size: 1.1 },
  ];
  group.userData.lockRingScale = 1.8;
  return group;
}

/** Stage break: the panel cage shears off and the core burns naked. */
export function breakBulwarkArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(2.1);
  }
}

// ---- rivet: wrenched tether hardware, thrown --------------------------------

export function createRivetMesh() {
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_ORANGE, 2.3) });
  group.add(new Mesh(cachedGeometry('rivet-spike', () => {
    const spike = new OctahedronGeometry(0.34, 0);
    spike.scale(0.55, 0.55, 2.2);
    return spike;
  }), coreMaterial));
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.9), opacity: 0.5 });
  group.add(new Mesh(cachedGeometry('rivet-shell', () => {
    const shell = new OctahedronGeometry(0.52, 0);
    shell.scale(0.6, 0.6, 1.9);
    return shell;
  }), shellMaterial));
  tintable(group).push(
    { material: coreMaterial, base: hdr(HAZARD_ORANGE, 2.3), kind: 'core' },
    { material: shellMaterial, base: hdr(HAZARD_ORANGE, 0.9), kind: 'core' },
  );
  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = HAZARD_ORANGE.clone().multiplyScalar(0.75);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: HAZARD_ORANGE.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: HAZARD_ORANGE.clone(), size: 0.4 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 0.75;
  return group;
}

// ---- the Tetherjack ---------------------------------------------------------

// Built big (≈14 units across) because it is seen from 250 units away and
// then from 12. A wide clamp carapace over a grinding maw, two gripper arms
// above it wrapped around the cable, feral hazard-orange chevrons, one furnace
// eye. The merged carapace plates hide the maw until the first stage breaks.
export function createRipperMesh() {
  const group = new Group();

  // Gripper arms reaching up the tether.
  for (const side of [-1, 1]) {
    const mesh = addFacetMesh(group, 'ripper-arm', () => new BoxGeometry(1.6, 7.5, 1.6), CHITIN.clone().multiplyScalar(1.15), HAZARD_ORANGE, 0.8);
    mesh.position.set(side * 2.2, 6.2, -1);
    mesh.rotation.z = side * -0.28;
    const clawMesh = addFacetMesh(group, 'ripper-claw', () => new ConeGeometry(0.9, 2.6, 4), CHITIN.clone(), HAZARD_ORANGE, 1.1);
    clawMesh.position.set(side * 3.6, 9.6, -1);
    clawMesh.rotation.z = side * 2.6;
  }

  // Body mass.
  addFacetMesh(group, 'ripper-body', () => {
    const body = new OctahedronGeometry(4.4, 1);
    body.scale(1.5, 1.05, 0.9);
    return body;
  }, CHITIN.clone().multiplyScalar(1.3), STORM_GREY, 0.7);

  // Feral chevrons: the hazard paint of whatever it ate.
  for (const side of [-1, 1]) {
    const mesh = addFacetMesh(group, 'ripper-chevron', () => new BoxGeometry(2.6, 0.5, 0.2), HAZARD_ORANGE.clone().multiplyScalar(0.55), HAZARD_ORANGE, 1.15);
    mesh.position.set(side * 3.4, 1.6, 3.1);
    mesh.rotation.z = side * 0.6;
  }

  // Carapace: six plates shielding the maw, merged to one mesh; they shear off
  // as a set at the stage break.
  const carapaceGeometry = cachedGeometry('ripper-carapace', () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const plate = new BoxGeometry(3.4, 2.4, 0.5);
      plate.applyMatrix4(new Matrix4()
        .makeRotationZ(angle + Math.PI / 2)
        .setPosition(Math.cos(angle) * 3.1, Math.sin(angle) * 2.5, 3.4));
      parts.push(plate);
    }
    return mergeGeometries(parts);
  });
  const carapaceFill = new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(1.4) });
  const carapaceEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD_ORANGE, 0.85) }));
  const carapace = new Group();
  const carapaceMesh = new Mesh(carapaceGeometry, carapaceFill);
  carapaceMesh.add(new LineSegments(edgesFor('ripper-carapace', carapaceGeometry), carapaceEdge));
  carapace.add(carapaceMesh);
  group.add(carapace);
  group.userData.carapace = carapace;
  tintable(group).push(
    { material: carapaceFill, base: PANEL_SHADOW.clone().multiplyScalar(1.4), kind: 'fill' },
    { material: carapaceEdge, base: hdr(HAZARD_ORANGE, 0.85), kind: 'edge' },
  );
  const carapaceSpecs: ShardSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    carapaceSpecs.push({
      direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.5).normalize(),
      color: HAZARD_ORANGE.clone(),
      size: 1.4,
    });
  }
  group.userData.carapaceSpecs = carapaceSpecs;

  // The furnace eye / maw core — the thing you are actually killing.
  const eyeMaterial = new MeshBasicMaterial({ color: hdr(DANGER_RED, 1.9) });
  const eye = new Mesh(cachedGeometry('ripper-eye', () => new OctahedronGeometry(1.5, 1)), eyeMaterial);
  eye.position.z = 3.2;
  const eyeGlow = createAdditiveBasicMaterial({ color: hdr(DANGER_RED, 0.7), opacity: 0.4 });
  eye.add(new Mesh(cachedGeometry('ripper-eye-glow', () => new OctahedronGeometry(2.3, 1)), eyeGlow));
  group.add(eye);
  group.userData.eyeMaterial = eyeMaterial;
  tintable(group).push(
    { material: eyeMaterial, base: hdr(DANGER_RED, 1.9), kind: 'core' },
    { material: eyeGlow, base: hdr(DANGER_RED, 0.7), kind: 'core' },
  );

  // Maw ring behind the plates.
  const mawMaterial = createAdditiveBasicMaterial({ color: hdr(WARN_AMBER, 1.0), side: 2 });
  const maw = new Mesh(cachedGeometry('ripper-maw', () => new RingGeometry(1.9, 2.6, 8)), mawMaterial);
  maw.position.z = 2.9;
  group.add(maw);
  tintable(group).push({ material: mawMaterial, base: hdr(WARN_AMBER, 1.0), kind: 'core' });

  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.isBoss = true;
  group.userData.shardSpecs = [
    ...carapaceSpecs,
    { direction: new Vector3(0, 1, 0.3).normalize(), color: HAZARD_ORANGE.clone(), size: 2.2 },
    { direction: new Vector3(0.8, -0.4, 0.3).normalize(), color: CHITIN.clone(), size: 2 },
    { direction: new Vector3(-0.8, -0.4, 0.3).normalize(), color: CHITIN.clone(), size: 2 },
    { direction: new Vector3(0, -1, 0.4).normalize(), color: DANGER_RED.clone(), size: 1.6 },
  ];
  group.userData.lockRingScale = 3.2;
  return group;
}

/** First stage break: shed the carapace, expose the maw, the eye burns hotter. */
export function shedRipperCarapace(group: Group) {
  const carapace = group.userData.carapace as Group | undefined;
  if (!carapace || carapace.visible === false) return;
  carapace.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(1.7);
  }
}
