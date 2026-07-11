import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Euler,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { COLLAR_RADIUS } from '../gameplay';
import { ARC_BLUE, ARC_VIOLET, ARC_WHITE, GUNMETAL, hdr, HOSTILE_MAGENTA, WARNING_RED } from './palette';
import type { SparkSpec } from './effects';

// Defense drones are gun hardware: gunmetal mass, magenta signal light, and
// a hot core. Silhouette and motion carry identity — weavers are tri-blade
// spinners riding the coils, sliders are sleds grinding the conduit rails,
// sentinels are armored hex turrets, interlocks are the jammed clamps of the
// charge collar itself. Each drone's static faceting is merged into a single
// fill mesh plus a single edge mesh so a crowded barrel stays cheap to draw.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

const placeMatrix = new Matrix4();
const placeQuaternion = new Quaternion();
const placeEuler = new Euler();
const placeScale = new Vector3();
const placePosition = new Vector3();

/** Bake position/rotation/scale into a geometry for merging. */
function placed(
  geometry: BufferGeometry,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) {
  placeEuler.set(rotation[0], rotation[1], rotation[2]);
  placeQuaternion.setFromEuler(placeEuler);
  placePosition.set(position[0], position[1], position[2]);
  placeScale.set(scale[0], scale[1], scale[2]);
  placeMatrix.compose(placePosition, placeQuaternion, placeScale);
  geometry.applyMatrix4(placeMatrix);
  return geometry;
}

/** One merged fill mesh + one merged edge mesh, registered for tinting. */
function mergedFacet(group: Group, pieces: BufferGeometry[], fillColor: Color, edgeColor: Color, edgeIntensity: number) {
  const edgePieces = pieces.map((piece) => new EdgesGeometry(piece));
  // Box/torus geometries are indexed while polyhedra are not; merging
  // requires one or the other across the board.
  const fillPieces = pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece));
  const fillGeometry = mergeGeometries(fillPieces);
  const edgeGeometry = mergeGeometries(edgePieces);
  for (const piece of new Set([...pieces, ...fillPieces, ...edgePieces])) piece.dispose();

  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  const shell = new Group();
  shell.add(new Mesh(fillGeometry, fillMaterial));
  shell.add(new LineSegments(edgeGeometry, edgeMaterial));
  group.add(shell);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return shell;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.55, glowOpacity = 0.26) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({
    color: hdr(color, intensity * 0.4),
    opacity: glowOpacity,
  });
  const glow = new Mesh(new OctahedronGeometry(radius * glowScale, 1), glowMaterial);
  core.add(glow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- weaver: a tri-blade spinner threading the coils ---------------------------

export function createWeaverMesh() {
  const group = new Group();
  const sparkSpecs: SparkSpec[] = [];

  // The blade disc spins as one merged unit; each blade swept like a vane.
  const blades: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    blades.push(placed(
      new BoxGeometry(0.24, 1.5, 0.09),
      [Math.cos(angle + Math.PI / 2) * 0.72, Math.sin(angle + Math.PI / 2) * 0.72, 0],
      [0, 0.5, angle],
    ));
    sparkSpecs.push({
      direction: new Vector3(Math.cos(angle + Math.PI / 2), Math.sin(angle + Math.PI / 2), 0),
      color: HOSTILE_MAGENTA.clone(),
      size: 0.55,
    });
  }
  const disc = new Group();
  const shell = mergedFacet(group, blades, GUNMETAL.clone().multiplyScalar(0.7), HOSTILE_MAGENTA, 1.15);
  shell.removeFromParent();
  disc.add(shell);
  disc.userData.spinSpeed = 7.5;
  group.add(disc);
  group.userData.spinParts = [disc];

  addCore(group, 0.24, HOSTILE_MAGENTA, 1.8, 1.6, 0.3);
  sparkSpecs.push({ direction: new Vector3(0, 0, 1), color: ARC_VIOLET.clone(), size: 0.4 });

  group.userData.accent = HOSTILE_MAGENTA.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- slider: a sled grinding a conduit rail -------------------------------------

export function createSliderMesh() {
  const group = new Group();

  // Low hull, long in z (travel direction); belly at -y rides the wall.
  mergedFacet(group, [
    placed(new BoxGeometry(0.8, 0.34, 2.6)),
    placed(new TetrahedronGeometry(0.5, 0), [0, 0.08, 1.55], [0.35, Math.PI / 4, 0], [0.9, 0.5, 1.5]),
    placed(new BoxGeometry(0.12, 0.85, 0.12), [0, -0.55, -0.4]),
    placed(new BoxGeometry(0.14, 0.12, 2.2), [-0.42, -0.24, 0]),
    placed(new BoxGeometry(0.14, 0.12, 2.2), [0.42, -0.24, 0]),
  ], GUNMETAL.clone().multiplyScalar(0.62), ARC_VIOLET, 1.05);

  // Canopy signal light and the grinding rail contact.
  const canopy = addCore(group, 0.17, HOSTILE_MAGENTA, 1.9, 1.5, 0.3);
  canopy.position.set(0, 0.3, 0.55);
  const contact = addCore(group, 0.14, ARC_WHITE, 2.2, 1.9, 0.42);
  contact.position.set(0, -1.0, -0.4);

  group.userData.accent = ARC_VIOLET.clone();
  group.userData.sparkSpecs = [
    { direction: new Vector3(0, 0, 1), color: HOSTILE_MAGENTA.clone(), size: 0.6 },
    { direction: new Vector3(0, 0, -1), color: ARC_VIOLET.clone(), size: 0.6 },
    { direction: new Vector3(0.7, 0.7, 0).normalize(), color: ARC_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(-0.7, 0.7, 0).normalize(), color: ARC_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(0, -1, 0), color: ARC_WHITE.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 1.15;
  return group;
}

// ---- sentinel: an armored hex turret parked in a ring aperture -------------------

export function createSentinelMesh() {
  const group = new Group();

  const pieces: BufferGeometry[] = [
    // Hex pod facing the player.
    placed(new CylinderGeometry(0.95, 0.95, 0.5, 6), [0, 0, 0], [Math.PI / 2, 0, 0]),
  ];
  // Emitter prongs converging ahead of the core — the barrel of its arc gun.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    pieces.push(placed(
      new TetrahedronGeometry(0.34, 0),
      [Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0.55],
      [0, 0, angle],
      [0.6, 0.6, 2.1],
    ));
  }
  mergedFacet(group, pieces, GUNMETAL.clone().multiplyScalar(0.58), ARC_VIOLET, 1.05);

  const core = addCore(group, 0.26, HOSTILE_MAGENTA, 1.6, 1.5, 0.3);
  core.position.z = 0.35;

  // The tell: a hex halo frame that spins while it hunts.
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(HOSTILE_MAGENTA, 1.3), side: 2 });
  const halo = new Mesh(new RingGeometry(1.42, 1.52, 6), haloMaterial);
  halo.userData.spinSpeed = 1.7;
  group.add(halo);
  group.userData.spinParts = [halo];
  tintable(group).push({ material: haloMaterial, base: hdr(HOSTILE_MAGENTA, 1.3), kind: 'edge' });

  group.userData.accent = HOSTILE_MAGENTA.clone();
  group.userData.sparkSpecs = [0, 1, 2, 3, 4, 5].map((i) => ({
    direction: new Vector3(Math.cos((i / 6) * Math.PI * 2), Math.sin((i / 6) * Math.PI * 2), 0.2).normalize(),
    color: (i % 2 === 0 ? HOSTILE_MAGENTA : ARC_VIOLET).clone(),
    size: 0.6,
  }));
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- bolt: a crackling arc spark ------------------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(HOSTILE_MAGENTA, 2.4) });
  const crossed = mergeGeometries([
    placed(new TetrahedronGeometry(0.34, 0), [0, 0, 0], [0, 0, 0], [0.6, 0.6, 1.6]),
    placed(new TetrahedronGeometry(0.34, 0), [0, 0, 0], [0, 0, Math.PI / 3], [0.6, 0.6, 1.6]),
  ]);
  group.add(new Mesh(crossed, coreMaterial));
  tintable(group).push({ material: coreMaterial, base: hdr(HOSTILE_MAGENTA, 2.4), kind: 'core' });
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_VIOLET, 1.1), opacity: 0.5 });
  const shell = new Mesh(placed(new OctahedronGeometry(0.52, 0), [0, 0, 0], [0, 0, 0], [0.7, 0.7, 1.8]), shellMaterial);
  group.add(shell);
  tintable(group).push({ material: shellMaterial, base: hdr(ARC_VIOLET, 1.1), kind: 'core' });

  group.userData.accent = HOSTILE_MAGENTA.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = HOSTILE_MAGENTA.clone().multiplyScalar(0.8);
  group.userData.sparkSpecs = [
    { direction: new Vector3(0, 0, 1), color: HOSTILE_MAGENTA.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: ARC_VIOLET.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 0.75;
  return group;
}

// ---- interlock: a jammed clamp on the charge collar ------------------------------

// Each interlock carries its own 52° slice of the collar ring, so the six of
// them assemble into the full collar and the ring visibly disintegrates as
// they die. Local +y points at the tunnel center (gameplay orients the mesh).
export function createInterlockMesh() {
  const group = new Group();

  const arcSpan = Math.PI * 52 / 180;
  const collarArc = new TorusGeometry(COLLAR_RADIUS, 0.34, 8, 10, arcSpan);
  collarArc.rotateZ(-Math.PI / 2 - arcSpan / 2);
  collarArc.translate(0, COLLAR_RADIUS, 0);

  // Collar slice + clamp jaws biting inward: the permanent body.
  mergedFacet(group, [
    collarArc,
    placed(new BoxGeometry(0.34, 0.9, 0.6), [-0.42, 0.75, 0], [0, 0, 0.18]),
    placed(new BoxGeometry(0.34, 0.9, 0.6), [0.42, 0.75, 0], [0, 0, -0.18]),
  ], GUNMETAL.clone().multiplyScalar(0.55), WARNING_RED, 1.1);

  // Armor casing: shears off at the stage break, exposing the live coupling.
  const armor = new Group();
  const casing = mergedFacet(group, [
    placed(new BoxGeometry(1.7, 1.0, 1.05)),
    placed(new BoxGeometry(0.5, 0.7, 1.2), [-1.05, -0.1, 0], [0, 0, 0.28]),
    placed(new BoxGeometry(0.5, 0.7, 1.2), [1.05, -0.1, 0], [0, 0, -0.28]),
  ], GUNMETAL.clone().multiplyScalar(0.7), ARC_VIOLET, 0.9);
  casing.removeFromParent();
  armor.add(casing);
  group.add(armor);
  group.userData.armor = armor;

  // The jam light between the jaws.
  const jamCore = addCore(group, 0.26, WARNING_RED, 1.9, 1.7, 0.36);
  jamCore.position.set(0, 0.62, 0);
  group.userData.jamCore = jamCore;

  group.userData.accent = WARNING_RED.clone();
  group.userData.sparkSpecs = [
    { direction: new Vector3(0, 1, 0), color: ARC_WHITE.clone(), size: 0.8 },
    { direction: new Vector3(0.8, 0.4, 0).normalize(), color: WARNING_RED.clone(), size: 0.7 },
    { direction: new Vector3(-0.8, 0.4, 0).normalize(), color: WARNING_RED.clone(), size: 0.7 },
    { direction: new Vector3(0.5, -0.6, 0.4).normalize(), color: ARC_VIOLET.clone(), size: 0.9 },
    { direction: new Vector3(-0.5, -0.6, -0.4).normalize(), color: ARC_VIOLET.clone(), size: 0.9 },
    { direction: new Vector3(0, 0, 1), color: ARC_WHITE.clone(), size: 0.6 },
  ];
  group.userData.lockRingScale = 1.5;
  return group;
}

// Casing shear: the armor blows off; the live coupling burns naked underneath.
export function breakInterlockCasing(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.base.multiplyScalar(2.0);
  }
}

// ---- charge: the firing charge building at the collar's center -------------------

export function createChargeMesh() {
  const group = new Group();

  const coreMaterial = new MeshBasicMaterial({ color: hdr(ARC_WHITE, 2.0) });
  const core = new Mesh(new OctahedronGeometry(0.55, 2), coreMaterial);
  group.add(core);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_VIOLET, 1.0), opacity: 0.4 });
  const glow = new Mesh(new OctahedronGeometry(1.05, 1), glowMaterial);
  group.add(glow);
  tintable(group).push(
    { material: coreMaterial, base: hdr(ARC_WHITE, 2.0), kind: 'core' },
    { material: glowMaterial, base: hdr(ARC_VIOLET, 1.0), kind: 'core' },
  );

  // Discharge vanes: a slow-spinning star of prongs around the plasma.
  const vanes = new Group();
  const vaneMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.2), opacity: 0.7 });
  const vanePieces: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    vanePieces.push(placed(
      new TetrahedronGeometry(0.3, 0),
      [Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0],
      [0, 0, angle],
      [0.4, 0.4, 1],
    ));
  }
  vanes.add(new Mesh(mergeGeometries(vanePieces), vaneMaterial));
  for (const piece of vanePieces) piece.dispose();
  vanes.userData.spinSpeed = 0.9;
  group.add(vanes);
  group.userData.spinParts = [vanes];
  tintable(group).push({ material: vaneMaterial, base: hdr(ARC_BLUE, 1.2), kind: 'core' });

  group.userData.accent = ARC_WHITE.clone();
  group.userData.isCharge = true;
  group.userData.sparkSpecs = [
    { direction: new Vector3(0, 1, 0), color: ARC_WHITE.clone(), size: 0.8 },
    { direction: new Vector3(0, -1, 0), color: ARC_VIOLET.clone(), size: 0.8 },
  ];
  group.userData.lockRingScale = 1.0;
  return group;
}
