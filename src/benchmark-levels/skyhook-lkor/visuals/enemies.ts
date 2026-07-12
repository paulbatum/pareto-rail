import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  EdgesGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { GUNMETAL, GUNMETAL_DARK, hdr, SIGNAL_AMBER, SIGNAL_RED } from './palette';
import type { ShardSpec } from './effects';

// Every hostile is vacuum-built from the same stock: dark gunmetal mass with a
// small hot signal core. Down low the kites read ragged and aerodynamic; up top
// the darts, wasps and the lamprey read hard and faceted. Silhouette and motion
// carry identity — bloom is never load-bearing (gunmetal fill is real colour).

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

type FacetGeometry = OctahedronGeometry | TetrahedronGeometry | BoxGeometry | TorusGeometry | IcosahedronGeometry | ConeGeometry;

function addFacet(
  group: Group,
  geometry: FacetGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  fill.add(new LineSegments(new EdgesGeometry(geometry), edgeMaterial));
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.6, glowOpacity = 0.28) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 0), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.4), opacity: glowOpacity });
  core.add(new Mesh(new OctahedronGeometry(radius * glowScale, 0), glowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// Merge a set of same-material facets (fill + additive edge) into two draw
// calls: one merged fill mesh with a merged edge overlay. Every placement must
// share the fill/edge colour so the merged materials read identically to the
// per-part originals. Static structural clusters (leech legs/teeth, lamprey
// segments) collapse from dozens of nodes to two without changing the look.
type FacetPlacement = { geometry: FacetGeometry; matrix: Matrix4 };

function localMatrix(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz)).setPosition(x, y, z);
}

function mergeFacets(
  parent: Group,
  placements: FacetPlacement[],
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
): Mesh {
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  for (const { geometry, matrix } of placements) {
    fills.push(geometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(geometry).applyMatrix4(matrix));
    geometry.dispose();
  }
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  fill.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();
  parent.add(fill);
  tintable(parent).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

// ---- kite: a ragged wind-riding delta ---------------------------------------

export function createKiteMesh() {
  const group = new Group();
  const bank = new Group();
  group.add(bank);

  // Swept sail: a flattened diamond, wide across, thin front-to-back.
  const sailGeometry = new OctahedronGeometry(1.05, 0);
  sailGeometry.scale(1.5, 0.62, 0.26);
  addFacet(bank, sailGeometry, GUNMETAL.clone().multiplyScalar(0.9), SIGNAL_AMBER, 1.6);

  // Ragged swept wingtips trailing back, amber-lit leading edges.
  const shardSpecs: ShardSpec[] = [];
  for (const side of [-1, 1]) {
    const tip = new TetrahedronGeometry(0.66, 0);
    tip.scale(1.2, 0.32, 1.0);
    const mesh = addFacet(bank, tip, GUNMETAL.clone().multiplyScalar(0.7), SIGNAL_AMBER, 1.7);
    mesh.position.set(side * 1.45, -0.12, -0.55);
    mesh.rotation.set(0.1, side * 0.5, side * -0.35);
    shardSpecs.push({ direction: new Vector3(side, 0.1, -0.3).normalize(), color: SIGNAL_AMBER.clone(), size: 0.55 });
  }
  addCore(bank, 0.2, SIGNAL_AMBER, 1.5);

  shardSpecs.push({ direction: new Vector3(0, 0.4, 0.6).normalize(), color: SIGNAL_AMBER.clone(), size: 0.4 });
  group.userData.bankGroup = bank;
  group.userData.accent = SIGNAL_AMBER.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 1.15;
  group.userData.animSeed = Math.random() * 6.28;
  return group;
}

export function animateKite(mesh: Object3D, dt: number, elapsed: number) {
  const bank = mesh.userData.bankGroup as Group | undefined;
  if (!bank) return;
  const intent = clampSigned(mesh.userData.bank);
  const seed = (mesh.userData.animSeed as number) ?? 0;
  const flutter = Math.sin(elapsed * 6.5 + seed) * 0.08;
  bank.rotation.z += (intent * 0.9 + flutter - bank.rotation.z) * Math.min(1, dt * 6);
  bank.rotation.x = Math.sin(elapsed * 2.1 + seed) * 0.06;
}

// ---- dart: a needle strafer with cruciform fins -----------------------------

export function createDartMesh() {
  const group = new Group();

  const bodyGeometry = new OctahedronGeometry(0.5, 0);
  bodyGeometry.scale(0.44, 0.44, 3.2);
  addFacet(group, bodyGeometry, GUNMETAL.clone().multiplyScalar(0.85), SIGNAL_AMBER, 1.4);

  // Cruciform tail fins.
  for (let i = 0; i < 4; i += 1) {
    const fin = new BoxGeometry(0.06, 0.9, 0.5);
    const mesh = addFacet(group, fin, GUNMETAL.clone().multiplyScalar(0.7), SIGNAL_AMBER, 1.2);
    mesh.rotation.z = (i / 4) * Math.PI * 2;
    mesh.position.z = -1.35;
  }

  // Amber sighting eye at the nose.
  addCore(group, 0.16, SIGNAL_AMBER, 1.7).position.z = 1.35;

  // Tail thruster (drives on userData.thrust).
  const thrusterMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 1.4), opacity: 0.8 });
  const thruster = new Mesh(new ConeGeometry(0.24, 1.1, 8, 1, true), thrusterMaterial);
  thruster.rotation.x = Math.PI / 2;
  thruster.position.z = -1.9;
  group.add(thruster);

  group.userData.thruster = thruster;
  group.userData.thrusterMaterial = thrusterMaterial;
  group.userData.accent = SIGNAL_AMBER.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: SIGNAL_AMBER.clone(), size: 0.55 },
    { direction: new Vector3(0.5, 0.5, -0.5).normalize(), color: SIGNAL_RED.clone(), size: 0.4 },
    { direction: new Vector3(-0.5, -0.4, -0.5).normalize(), color: SIGNAL_RED.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 1.0;
  return group;
}

export function animateDart(mesh: Object3D, _dt: number, elapsed: number) {
  const thrust = clamp01(mesh.userData.thrust);
  const thruster = mesh.userData.thruster as Mesh | undefined;
  const material = mesh.userData.thrusterMaterial as MeshBasicMaterial | undefined;
  if (!thruster || !material) return;
  const flare = 0.35 + thrust * 1.0 + Math.sin(elapsed * 40) * 0.06 * thrust;
  thruster.scale.set(0.6 + thrust * 0.7, flare, 0.6 + thrust * 0.7);
  material.color.copy(hdr(SIGNAL_RED, 0.5 + thrust * 1.8));
}

// ---- leech: a six-legged tether-grinder -------------------------------------

// The leech latches only ~6 units from the camera, so the whole mesh is kept
// parasite-small — about half the car's width — via an inner body scale (the
// runner owns the top group's scale for the spawn ease).
const LEECH_SCALE = 0.45;

export function createLeechMesh() {
  const group = new Group();
  const body = new Group();
  body.scale.setScalar(LEECH_SCALE);
  group.add(body);

  const shellGeometry = new IcosahedronGeometry(0.95, 0);
  shellGeometry.scale(1.1, 0.7, 1.25);
  body.add(addFacet(group, shellGeometry, GUNMETAL.clone().multiplyScalar(0.8), SIGNAL_RED, 1.1));

  // Six legs splayed low around the shell — static structure, merged into two
  // draw calls under a group that clenches as a whole on the bite.
  const legs = new Group();
  const legPlacements: FacetPlacement[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((i + 0.5) / 6) * Math.PI * 2;
    const legMatrix = localMatrix(Math.cos(angle) * 0.85, -0.35, Math.sin(angle) * 0.7, 0, -angle, 0);
    legPlacements.push({ geometry: scaledBox(0.12, 0.12, 0.9), matrix: legMatrix.clone().multiply(localMatrix(0, 0, 0.45, 0.8, 0, 0)) });
    legPlacements.push({ geometry: scaledBox(0.1, 0.1, 0.8), matrix: legMatrix.clone().multiply(localMatrix(0, -0.5, 0.85, -0.6, 0, 0)) });
  }
  mergeFacets(legs, legPlacements, GUNMETAL_DARK.clone(), SIGNAL_RED, 0.8);
  body.add(legs);

  // Grinder mouth: a ring of teeth around a dark maw at the front (+Z). The
  // teeth are static relative to the spinning grinder group, so they merge.
  const mouth = new Group();
  const teeth = new Group();
  const toothPlacements: FacetPlacement[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const tooth = new TetrahedronGeometry(0.16, 0);
    tooth.scale(0.7, 0.7, 1.4);
    toothPlacements.push({ geometry: tooth, matrix: localMatrix(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0) });
  }
  mergeFacets(teeth, toothPlacements, GUNMETAL.clone(), SIGNAL_AMBER, 1.5);
  mouth.add(teeth);
  mouth.position.z = 1.05;
  body.add(mouth);

  // Amber belly light — blinks faster as the chew winds up.
  const bellyMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_AMBER, 1.2), opacity: 0.9 });
  const belly = new Mesh(new OctahedronGeometry(0.3, 0), bellyMaterial);
  belly.scale.set(1.4, 0.5, 1.4);
  belly.position.set(0, -0.62, 0.1);
  body.add(belly);

  group.userData.legs = legs;
  group.userData.grinder = teeth;
  group.userData.bellyMaterial = bellyMaterial;
  group.userData.accent = SIGNAL_AMBER.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, -0.3, 1).normalize(), color: SIGNAL_AMBER.clone(), size: 0.6 },
    { direction: new Vector3(0.8, 0.2, 0).normalize(), color: SIGNAL_RED.clone(), size: 0.5 },
    { direction: new Vector3(-0.8, 0.2, 0).normalize(), color: SIGNAL_RED.clone(), size: 0.5 },
    { direction: new Vector3(0, 0.6, -0.6).normalize(), color: SIGNAL_RED.clone(), size: 0.45 },
  ];
  group.userData.lockRingScale = 0.7;
  group.userData.animSeed = Math.random() * 6.28;
  return group;
}

export function animateLeech(mesh: Object3D, dt: number, elapsed: number) {
  const latched = mesh.userData.leechPhase === 'latched';
  const chew = clamp01(mesh.userData.chew);
  const bite = clamp01(mesh.userData.bite);
  const grinder = mesh.userData.grinder as Group | undefined;
  const belly = mesh.userData.bellyMaterial as MeshBasicMaterial | undefined;
  const legs = mesh.userData.legs as Group | undefined;
  const seed = (mesh.userData.animSeed as number) ?? 0;

  // Grinder teeth spin, fastest during the wind-up and on the bite.
  if (grinder) grinder.rotation.z += dt * ((latched ? 3 : 0.6) + chew * 8 + bite * 20);

  // Belly light blinks faster as the chew charges; it flares white on a bite.
  if (belly) {
    const rate = 2.5 + chew * 22;
    const blink = 0.5 + 0.5 * Math.sin(elapsed * rate + seed);
    const intensity = 0.6 + blink * (0.6 + chew * 1.6) + bite * 3;
    belly.color.copy(hdr(SIGNAL_AMBER, intensity));
  }

  // Legs clench on the bite instant.
  if (legs) {
    const clench = bite * 0.4 + (latched ? Math.sin(elapsed * 4 + seed) * 0.04 : 0);
    legs.scale.setScalar(1 - clench * 0.25);
  }
}

// ---- wasp: a faceted twin-lobe hopper ---------------------------------------

export function createWaspMesh() {
  const group = new Group();

  const shardSpecs: ShardSpec[] = [];
  for (const side of [-1, 1]) {
    const lobe = new OctahedronGeometry(0.7, 0);
    lobe.scale(0.9, 0.85, 1.15);
    const mesh = addFacet(group, lobe, GUNMETAL.clone().multiplyScalar(0.85), SIGNAL_AMBER, 1.2);
    mesh.position.set(side * 0.62, 0, 0);
    shardSpecs.push({ direction: new Vector3(side, 0.2, 0).normalize(), color: SIGNAL_AMBER.clone(), size: 0.6 });
  }
  // Faceted crown chips bridging the lobes.
  for (const [y, z] of [[0.55, 0.1], [-0.5, -0.15]] as const) {
    const chip = new TetrahedronGeometry(0.4, 0);
    chip.scale(1.4, 0.6, 0.9);
    const mesh = addFacet(group, chip, GUNMETAL_DARK.clone(), SIGNAL_AMBER, 1.0);
    mesh.position.set(0, y, z);
  }

  addCore(group, 0.28, SIGNAL_RED, 1.9, 1.7, 0.34);

  // Twin impulse thrusters at the rear (drive on userData.burn).
  const thrusterMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 1.2), opacity: 0.8 });
  const thrusters: Mesh[] = [];
  for (const side of [-1, 1]) {
    const jet = new Mesh(new ConeGeometry(0.16, 0.8, 7, 1, true), thrusterMaterial);
    jet.rotation.x = Math.PI / 2;
    jet.position.set(side * 0.5, 0, -0.7);
    group.add(jet);
    thrusters.push(jet);
  }

  group.userData.thrusters = thrusters;
  group.userData.thrusterMaterial = thrusterMaterial;
  group.userData.accent = SIGNAL_RED.clone();
  group.userData.shardSpecs = [
    ...shardSpecs,
    { direction: new Vector3(0, 0.7, 0.5).normalize(), color: SIGNAL_RED.clone(), size: 0.5 },
    { direction: new Vector3(0, -0.7, -0.5).normalize(), color: SIGNAL_RED.clone(), size: 0.5 },
  ];
  group.userData.lockRingScale = 1.25;
  group.userData.animSeed = Math.random() * 6.28;
  return group;
}

export function animateWasp(mesh: Object3D, _dt: number, elapsed: number) {
  const burn = clamp01(mesh.userData.burn);
  const material = mesh.userData.thrusterMaterial as MeshBasicMaterial | undefined;
  const thrusters = mesh.userData.thrusters as Mesh[] | undefined;
  const seed = (mesh.userData.animSeed as number) ?? 0;
  if (material) material.color.copy(hdr(SIGNAL_RED, 0.3 + burn * 2.2 + Math.sin(elapsed * 50 + seed) * 0.1 * burn));
  if (thrusters) for (const jet of thrusters) jet.scale.set(0.5 + burn * 0.6, 0.4 + burn * 1.3, 0.5 + burn * 0.6);
}

// ---- bolt: a wasp's homing tracer shard -------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.32, 0);
  dart.scale(0.5, 0.5, 2.3);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(SIGNAL_RED, 2.4) });
  const core = new Mesh(dart, coreMaterial);
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 1.0), opacity: 0.5 });
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  group.add(core, new Mesh(shellGeometry, shellMaterial));
  tintable(group).push(
    { material: coreMaterial, base: hdr(SIGNAL_RED, 2.4), kind: 'core' },
    { material: shellMaterial, base: hdr(SIGNAL_RED, 1.0), kind: 'core' },
  );
  group.userData.accent = SIGNAL_RED.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = SIGNAL_RED.clone().multiplyScalar(0.8);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: SIGNAL_RED.clone(), size: 0.35 },
    { direction: new Vector3(0, 0, -1), color: SIGNAL_RED.clone(), size: 0.35 },
  ];
  group.userData.lockRingScale = 0.7;
  return group;
}

// ---- the lamprey: a tether-grinder boss -------------------------------------

const LAMPREY_ARMS = 3;

export function createLampreyMesh() {
  const group = new Group();

  // Annular body segments stacked along the bore (local +Z toward the car).
  const segments: Array<[number, number]> = [
    [-6.5, 2.0],
    [-4.6, 2.2],
    [-2.7, 2.45],
    [-0.8, 2.7],
    [1.1, 2.9],
  ];
  // All segments share the same gunmetal/amber materials and never move
  // relative to the body, so they merge into one fill + edge pair. The thin
  // hazard-amber intake strips (additive) merge into a single overlay mesh.
  const segmentPlacements: FacetPlacement[] = [];
  const stripGeometries: BufferGeometry[] = [];
  for (const [z, radius] of segments) {
    segmentPlacements.push({ geometry: new TorusGeometry(radius, 0.62, 8, 28), matrix: localMatrix(0, 0, z) });
    stripGeometries.push(new TorusGeometry(radius - 0.5, 0.06, 6, 28).applyMatrix4(localMatrix(0, 0, z + 0.15)));
  }
  mergeFacets(group, segmentPlacements, GUNMETAL.clone().multiplyScalar(0.75), SIGNAL_AMBER, 1.0);
  const stripMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_AMBER, 1.3), opacity: 0.7 });
  group.add(new Mesh(mergeGeometries(stripGeometries), stripMaterial));
  for (const geometry of stripGeometries) geometry.dispose();
  tintable(group).push({ material: stripMaterial, base: hdr(SIGNAL_AMBER, 1.3), kind: 'edge' });

  // Three grapple arms hauling hand-over-hand along the tether; each blows off
  // on a stage-1 hit.
  const arms: Group[] = [];
  for (let i = 0; i < LAMPREY_ARMS; i += 1) {
    const angle = (i / LAMPREY_ARMS) * Math.PI * 2;
    const arm = new Group();
    const upper = addFacet(arm, scaledBox(0.55, 0.55, 2.6), GUNMETAL.clone().multiplyScalar(0.7), SIGNAL_AMBER, 0.9);
    upper.position.set(0, 2.7, -1.2);
    upper.rotation.x = 0.5;
    const claw = addFacet(arm, scaledBox(0.7, 0.3, 1.1), GUNMETAL_DARK.clone(), SIGNAL_AMBER, 1.1);
    claw.position.set(0, 3.6, 0.9);
    claw.rotation.x = -0.7;
    // Amber pod that glows during the arm stage.
    const podMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_AMBER, 1.4), opacity: 0.85 });
    const pod = new Mesh(new OctahedronGeometry(0.42, 0), podMaterial);
    pod.position.set(0, 2.5, 0);
    arm.add(pod);
    arm.rotation.z = angle;
    arm.userData.podMaterial = podMaterial;
    arm.userData.armPhase = (i / LAMPREY_ARMS) * Math.PI * 2;
    group.add(arm);
    arms.push(arm);
  }

  // Tri-petal grinder mouth at the front around a hot core. Each petal rides an
  // `arrange` group (fixing its 120° slot) and a `hinge` group (tilts to open).
  const mouth = new Group();
  mouth.position.z = 2.6;
  const petals: Group[] = [];
  for (let i = 0; i < 3; i += 1) {
    const arrange = new Group();
    arrange.rotation.z = (i / 3) * Math.PI * 2;
    const hinge = new Group();
    const petal = addFacet(group, scaledBox(1.9, 0.4, 2.2), GUNMETAL.clone().multiplyScalar(0.8), SIGNAL_AMBER, 1.2);
    petal.removeFromParent();
    petal.position.set(0, 1.15, 0.9);
    hinge.add(petal);
    // Grinder ridges along the inner face.
    const ridgeMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_AMBER, 1.4), opacity: 0.7 });
    const ridge = new Mesh(scaledBox(1.5, 0.08, 1.8), ridgeMaterial);
    ridge.position.set(0, 0.95, 0.9);
    hinge.add(ridge);
    arrange.add(hinge);
    mouth.add(arrange);
    petals.push(hinge);
    tintable(group).push({ material: ridgeMaterial, base: hdr(SIGNAL_AMBER, 1.4), kind: 'edge' });
  }
  group.add(mouth);

  // The core: dark and hooded when the mouth is shut, screaming when exposed.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(SIGNAL_RED, 0.7) });
  const core = new Mesh(new OctahedronGeometry(1.1, 1), coreMaterial);
  core.position.z = 3.0;
  group.add(core);
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 0.4), opacity: 0.4 });
  const coreGlow = new Mesh(new OctahedronGeometry(1.7, 1), coreGlowMaterial);
  core.add(coreGlow);

  group.userData.lampreyArms = arms;
  group.userData.lampreyPetals = petals;
  group.userData.lampreyMouth = mouth;
  group.userData.coreMaterial = coreMaterial;
  group.userData.coreGlowMaterial = coreGlowMaterial;
  group.userData.armsBlown = 0;
  group.userData.petalOpen = 0;
  group.userData.accent = SIGNAL_AMBER.clone();
  group.userData.shardSpecs = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle) * 0.8, 0.2).normalize(),
      color: (i % 3 === 0 ? SIGNAL_RED : SIGNAL_AMBER).clone(),
      size: 1.4,
    } as ShardSpec;
  });
  group.userData.lockRingScale = 3.0;
  return group;
}

// Blow the next intact grapple arm; returns its local mount point for a burst,
// or null when no arms remain.
export function blowLampreyArm(mesh: Object3D): Vector3 | null {
  const arms = mesh.userData.lampreyArms as Group[] | undefined;
  if (!arms) return null;
  const blown = (mesh.userData.armsBlown as number) ?? 0;
  if (blown >= arms.length) return null;
  const arm = arms[blown];
  arm.visible = false;
  mesh.userData.armsBlown = blown + 1;
  return arm.getWorldPosition(new Vector3());
}

export function animateLamprey(mesh: Object3D, dt: number, elapsed: number) {
  const state = mesh.userData.lamprey as
    | { descent: number; stageIndex: number; exposed: boolean; lurch: number }
    | undefined;
  const stageIndex = state?.stageIndex ?? 0;
  const exposed = state?.exposed === true;
  const lurch = clamp01(state?.lurch ?? 0);
  const descent = clamp01(state?.descent ?? 0);

  // Arms haul hand-over-hand; cadence rises as it closes on the car.
  const arms = mesh.userData.lampreyArms as Group[] | undefined;
  if (arms) {
    const haulRate = 1.6 + descent * 2.2;
    for (const arm of arms) {
      if (!arm.visible) continue;
      const phase = (arm.userData.armPhase as number) ?? 0;
      arm.position.z = Math.sin(elapsed * haulRate + phase) * 0.6;
      arm.rotation.x = Math.sin(elapsed * haulRate + phase) * 0.12;
      const pod = arm.userData.podMaterial as MeshBasicMaterial | undefined;
      if (pod) pod.color.copy(hdr(SIGNAL_AMBER, stageIndex === 0 ? 1.4 + Math.sin(elapsed * 6 + phase) * 0.5 : 0.4));
    }
  }

  // Mouth petals: shut in stage 1, cracked in stage 2, flung wide in stage 3.
  const target = exposed ? 1 : stageIndex >= 1 ? 0.4 : 0.02;
  let open = (mesh.userData.petalOpen as number) ?? 0;
  open += (target - open) * Math.min(1, dt * 5);
  mesh.userData.petalOpen = open;
  const petals = mesh.userData.lampreyPetals as Group[] | undefined;
  if (petals) for (const hinge of petals) hinge.rotation.x = -open * 1.15;

  // Core: hooded and slow when shut, white-hot and racing when exposed.
  const coreMaterial = mesh.userData.coreMaterial as MeshBasicMaterial | undefined;
  const coreGlowMaterial = mesh.userData.coreGlowMaterial as MeshBasicMaterial | undefined;
  if (coreMaterial && coreGlowMaterial) {
    const pulse = exposed ? 2.2 + Math.sin(elapsed * 8) * 0.8 : 0.6 + Math.sin(elapsed * 2) * 0.12;
    coreMaterial.color.copy(hdr(exposed ? SIGNAL_AMBER : SIGNAL_RED, pulse * (1 + lurch * 0.6)));
    coreGlowMaterial.color.copy(hdr(SIGNAL_RED, pulse * 0.35 + lurch * 0.5));
  }

  // A hit or stage break makes the whole machine shudder.
  const shudder = lurch * 0.08;
  mesh.rotation.z = Math.sin(elapsed * 30) * shudder;
}

// Scripted death: unclamp, tumble away DOWN toward the planet, burning.
export function updateLampreyDeath(mesh: Object3D, dt: number, elapsed: number, since: number) {
  const fall = mesh.userData.deathVelocity as Vector3 | undefined ?? new Vector3(2.5, -6, 4);
  mesh.userData.deathVelocity = fall;
  fall.y -= dt * 6;
  mesh.position.addScaledVector(fall, dt);
  mesh.rotation.x += dt * 1.4;
  mesh.rotation.y += dt * 0.8;
  const coreMaterial = mesh.userData.coreMaterial as MeshBasicMaterial | undefined;
  if (coreMaterial) coreMaterial.color.copy(hdr(SIGNAL_AMBER, Math.max(0, 2.4 - since * 0.9) + Math.sin(elapsed * 20) * 0.3));
}

function scaledBox(x: number, y: number, z: number) {
  return new BoxGeometry(x, y, z);
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.min(1, Math.max(0, n));
}

function clampSigned(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.min(1, Math.max(-1, n));
}
