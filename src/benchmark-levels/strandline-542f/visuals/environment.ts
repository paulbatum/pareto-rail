import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import { createStrandline542fRail } from '../gameplay';
import { STRANDLINE_542F_MARKERS } from '../timing';
import {
  JELLY_CREAM,
  JELLY_GOLD,
  JELLY_GREEN,
  JELLY_SHADOW,
  PARASITE_SOUR,
  PARASITE_VIOLET,
  SUN_WATER,
  WATER_CLEAR,
  WATER_DEEP,
  WATER_NEAR,
  fleshMat,
  strandMat,
} from './palette';

export const STRANDLINE_542F_JELLY_CENTER = new Vector3(10, 52, -385);

export type StrandlineEnvironmentContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type PulseNode = { mesh: Mesh; phase: number; baseScale: number };
type StrandMaterial = { material: MeshBasicMaterial; phase: number; baseOpacity: number };

let root: Group | null = null;
let cameraRig: Group | null = null;
let closeForest: Group | null = null;
let moonReveal: Group | null = null;
let codaTableau: Group | null = null;
let wholeAnimal: Group | null = null;
let motes: Points | null = null;
let liberated = false;
let liberationAt = -1;
let beatPulse = 0;
const pulseNodes: PulseNode[] = [];
const strandMaterials: StrandMaterial[] = [];
const cleanMaterials: MeshBasicMaterial[] = [];
const parasiteStains: Mesh[] = [];

export function createStrandlineEnvironment(scene: Scene) {
  disposeStrandlineEnvironment();
  scene.background = WATER_NEAR.clone();
  scene.fog = new FogExp2(WATER_DEEP.clone(), 0.0068);

  const nextRoot = new Group();
  nextRoot.name = 'strandline-world';
  nextRoot.userData.raildIgnoreOcclusion = true;
  nextRoot.add(new AmbientLight(0x6fd6c0, 1.35));
  const sun = new DirectionalLight(0xc6ffe0, 2.1);
  sun.position.set(-18, 42, 12);
  nextRoot.add(sun);

  closeForest = createRailForest();
  wholeAnimal = createWholeAnimal();
  nextRoot.add(closeForest, wholeAnimal);

  cameraRig = createCameraRig();
  moonReveal = cameraRig.getObjectByName('green-moon') as Group;
  motes = cameraRig.getObjectByName('water-motes') as Points;
  nextRoot.add(cameraRig);

  scene.add(nextRoot);
  root = nextRoot;
  return nextRoot;
}

export function setStrandlineLiberated(value: boolean, at = 0) {
  liberated = value;
  if (value) liberationAt = at;
}

export function pulseStrandlineEnvironment(strength: number) {
  beatPulse = Math.max(beatPulse, strength);
}

function createRailForest() {
  const forest = new Group();
  forest.name = 'living-strand-forest';
  const rail = createStrandline542fRail();

  // Twenty-four unique tubes surround the authored rail. Their unequal radii,
  // corkscrew rates, and phase offsets keep the grove organic from every bank.
  for (let strand = 0; strand < 20; strand += 1) {
    const points: Vector3[] = [];
    const angle = (strand / 20) * Math.PI * 2 + (strand % 5) * 0.11;
    const radius = 5.4 + (strand % 6) * 1.55;
    for (let sample = 0; sample <= 30; sample += 1) {
      const u = sample / 30;
      const point = rail.getPointAt(u);
      const widening = u > 0.22 && u < 0.42 ? 1.65 : u > 0.72 ? 1.28 : 1;
      const twist = angle + u * (2.2 + (strand % 4) * 0.42) + Math.sin(u * Math.PI * 5 + strand) * 0.16;
      point.x += Math.cos(twist) * radius * widening;
      point.y += Math.sin(twist) * radius * 0.7 * widening;
      point.z += Math.sin(twist * 1.4) * (1.2 + (strand % 3) * 0.6);
      points.push(point);
    }
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.42);
    const geometry = new TubeGeometry(curve, 108, 0.075 + (strand % 5) * 0.032, 5, false);
    const baseOpacity = 0.28 + (strand % 4) * 0.055;
    const material = strandMat(strand % 7 === 0 ? JELLY_GOLD : JELLY_GREEN, baseOpacity);
    material.depthWrite = false;
    const tube = new Mesh(geometry, material);
    tube.name = `living-strand-${strand}`;
    forest.add(tube);
    strandMaterials.push({ material, phase: strand * 0.47, baseOpacity });

    // Sparse ganglia make the restoring pulse travel visibly up the animal.
    if (strand % 3 === 0) {
      for (let knot = 3; knot < 29; knot += 5) {
        const node = new Mesh(new SphereGeometry(0.19 + (strand % 2) * 0.08, 8, 5), strandMat(JELLY_GOLD, 0.7));
        node.position.copy(curve.getPointAt(knot / 30));
        forest.add(node);
        pulseNodes.push({ mesh: node, phase: strand * 0.3 + knot * 0.42, baseScale: 0.8 + (strand % 4) * 0.12 });
      }
    }
  }

  // A few non-target violet clamps establish the infestation before the first
  // moving parasite arrives. They bleach away across the liberated coda.
  for (let index = 0; index < 34; index += 1) {
    const u = 0.04 + ((index * 37) % 88) / 100;
    const point = rail.getPointAt(Math.min(0.92, u));
    const angle = index * 2.399963;
    point.x += Math.cos(angle) * (6 + index % 7);
    point.y += Math.sin(angle) * (4 + index % 5);
    const stain = new Mesh(new TorusGeometry(0.32 + (index % 3) * 0.11, 0.08, 4, 9), strandMat(PARASITE_VIOLET, 0.68));
    stain.position.copy(point);
    stain.rotation.set(angle * 0.17, angle * 0.11, angle);
    forest.add(stain);
    parasiteStains.push(stain);
  }
  return forest;
}

function createWholeAnimal() {
  const jelly = new Group();
  jelly.name = 'whole-jellyfish';
  jelly.position.copy(STRANDLINE_542F_JELLY_CENTER);

  const shellMaterial = fleshMat(JELLY_GREEN, 0.13);
  shellMaterial.depthWrite = false;
  const shell = new Mesh(new SphereGeometry(44, 44, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), shellMaterial);
  shell.position.z = -1;
  shell.rotation.x = -Math.PI * 0.5;
  shell.scale.set(1, 0.76, 1);
  jelly.add(shell);

  const innerMaterial = strandMat(JELLY_CREAM, 0.09);
  innerMaterial.depthWrite = false;
  const inner = new Mesh(new SphereGeometry(35, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.48), innerMaterial);
  inner.position.z = -2;
  inner.rotation.x = -Math.PI * 0.5;
  inner.scale.set(1, 0.72, 1);
  jelly.add(inner);

  const rimMaterial = strandMat(JELLY_GOLD, 0.72);
  rimMaterial.depthWrite = false;
  const rim = new Mesh(new TorusGeometry(41.8, 0.52, 7, 56), rimMaterial);
  rim.scale.y = 0.76;
  jelly.add(rim);
  cleanMaterials.push(rimMaterial);

  for (let nerve = 0; nerve < 12; nerve += 1) {
    const angle = (nerve / 12) * Math.PI * 2;
    const spoke = new Mesh(new BoxGeometry(39, 0.17, 0.14), strandMat(nerve % 3 ? JELLY_GREEN : JELLY_GOLD, 0.5));
    spoke.position.set(Math.cos(angle) * 19.3, Math.sin(angle) * 19.3 * 0.76, 0.3);
    spoke.rotation.z = angle;
    jelly.add(spoke);
  }

  // These long silhouette strands are what make the coda read as the entire
  // animal instead of a detached dome. The gameplay forest is nested among them.
  for (let index = 0; index < 22; index += 1) {
    const angle = (index / 22) * Math.PI * 2;
    const startRadius = 9 + (index % 6) * 4.7;
    const start = new Vector3(Math.cos(angle) * startRadius, Math.sin(angle) * startRadius * 0.72, 0);
    const points = [
      start,
      new Vector3(start.x * 0.9 + Math.sin(index) * 3, start.y * 0.9, 34 + (index % 3) * 7),
      new Vector3(start.x * 0.7 + Math.cos(index * 1.7) * 7, start.y * 0.72 + Math.sin(index) * 4, 80 + (index % 5) * 8),
      new Vector3(start.x * 0.52 + Math.sin(index * 0.8) * 10, start.y * 0.48, 136 + (index % 4) * 13),
      new Vector3(start.x * 0.3 + Math.cos(index) * 12, start.y * 0.25 + Math.sin(index * 1.4) * 7, 205 + (index % 6) * 11),
    ];
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.48);
    const material = strandMat(index % 5 === 0 ? JELLY_GOLD : JELLY_GREEN, 0.38 + (index % 4) * 0.055);
    material.depthWrite = false;
    const tentacle = new Mesh(new TubeGeometry(curve, 54, 0.13 + (index % 5) * 0.045, 5, false), material);
    jelly.add(tentacle);
    cleanMaterials.push(material);
  }
  return jelly;
}

function createCameraRig() {
  const rig = new Group();
  rig.name = 'water-camera-rig';
  rig.userData.raildIgnoreOcclusion = true;

  const shafts = new Group();
  shafts.name = 'sun-shafts';
  for (let index = 0; index < 9; index += 1) {
    const material = strandMat(index % 3 === 0 ? SUN_WATER : JELLY_CREAM, 0.025 + (index % 4) * 0.012);
    material.depthWrite = false;
    const shaft = new Mesh(new ConeGeometry(2.2 + (index % 3), 72, 8, 1, true), material);
    shaft.position.set(-32 + index * 8.2, 25 + (index % 2) * 7, -48 - (index % 4) * 20);
    shaft.rotation.z = 0.16 + (index % 3) * 0.04;
    shaft.rotation.x = 0.38;
    shafts.add(shaft);
  }
  rig.add(shafts);

  const moon = createGreenMoon();
  moon.name = 'green-moon';
  moon.position.set(18, 6, -76);
  moon.visible = false;
  rig.add(moon);

  const tableau = createCodaTableau();
  tableau.name = 'liberated-tableau';
  tableau.position.set(0, 3, -72);
  tableau.visible = false;
  rig.add(tableau);
  codaTableau = tableau;

  const count = 520;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963;
    const radius = 4 + ((index * 43) % 54);
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.62;
    positions[index * 3 + 2] = -5 - ((index * 31) % 118);
  }
  const moteGeometry = new BufferGeometry();
  moteGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(moteGeometry, new PointsMaterial({
    color: JELLY_CREAM,
    size: 0.12,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  points.name = 'water-motes';
  rig.add(points);
  return rig;
}

function createGreenMoon() {
  const moon = new Group();
  const faceMaterial = strandMat(JELLY_SHADOW, 0.68);
  faceMaterial.depthWrite = false;
  const face = new Mesh(new CircleGeometry(31.5, 48), faceMaterial);
  face.scale.set(1.2, 0.82, 1);
  face.position.z = 0.08;
  moon.add(face);
  const material = fleshMat(JELLY_GREEN, 0.18);
  material.depthWrite = false;
  const bell = new Mesh(new SphereGeometry(34, 38, 16, 0, Math.PI * 2, 0, Math.PI * 0.54), material);
  bell.rotation.x = -Math.PI * 0.5;
  bell.scale.set(1.2, 0.82, 1);
  moon.add(bell);
  const rim = new Mesh(new TorusGeometry(32, 0.44, 7, 48), strandMat(JELLY_GOLD, 0.72));
  rim.scale.set(1.2, 0.82, 1);
  moon.add(rim);
  for (let nerve = 0; nerve < 10; nerve += 1) {
    const angle = (nerve / 10) * Math.PI * 2;
    const line = new Mesh(new BoxGeometry(29, 0.15, 0.1), strandMat(nerve % 2 ? JELLY_GREEN : JELLY_GOLD, 0.48));
    line.position.set(Math.cos(angle) * 14.5, Math.sin(angle) * 11.9, 0.3);
    line.rotation.z = angle;
    moon.add(line);
  }
  const crown = new Mesh(new RingGeometry(4.5, 6.2, 24), strandMat(JELLY_CREAM, 0.55));
  crown.position.z = 0.8;
  moon.add(crown);
  return moon;
}

function createCodaTableau() {
  const jelly = new Group();
  jelly.userData.raildIgnoreOcclusion = true;

  const faceMaterial = strandMat(JELLY_SHADOW, 0.72);
  faceMaterial.depthWrite = false;
  const face = new Mesh(new CircleGeometry(20, 48), faceMaterial);
  face.position.y = 10;
  face.scale.set(1.12, 0.72, 1);
  jelly.add(face);

  const shellMaterial = fleshMat(JELLY_GREEN, 0.34);
  shellMaterial.depthWrite = false;
  const shell = new Mesh(new SphereGeometry(20.5, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.53), shellMaterial);
  shell.position.y = 10;
  shell.rotation.x = -Math.PI * 0.5;
  shell.scale.set(1.12, 0.72, 0.78);
  jelly.add(shell);

  const rim = new Mesh(new TorusGeometry(20, 0.38, 7, 52), strandMat(JELLY_GOLD, 0.9));
  rim.position.y = 10;
  rim.scale.set(1.12, 0.72, 1);
  jelly.add(rim);

  const heart = new Mesh(new RingGeometry(3.2, 4.5, 24), strandMat(JELLY_CREAM, 0.88));
  heart.position.set(0, 8, 0.7);
  jelly.add(heart);

  const infection = new Group();
  infection.name = 'tableau-infection';
  infection.position.set(0, 8, 1.0);
  infection.add(new Mesh(new TorusGeometry(5.4, 0.34, 6, 24), strandMat(PARASITE_SOUR, 0.9)));
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const line = new Mesh(new BoxGeometry(9.4, 0.16, 0.08), strandMat(PARASITE_VIOLET, 0.78));
    line.rotation.z = (spoke / 8) * Math.PI * 2;
    infection.add(line);
  }
  jelly.add(infection);

  for (let nerve = 0; nerve < 12; nerve += 1) {
    const angle = (nerve / 12) * Math.PI * 2;
    const line = new Mesh(new BoxGeometry(18.2, 0.12, 0.08), strandMat(nerve % 3 ? JELLY_GREEN : JELLY_GOLD, 0.66));
    line.position.set(Math.cos(angle) * 9.1, 10 + Math.sin(angle) * 6.55, 0.45);
    line.rotation.z = angle;
    jelly.add(line);
  }

  for (let strand = 0; strand < 18; strand += 1) {
    const across = (strand / 17 - 0.5) * 31;
    const phase = strand * 1.37;
    const curve = new CatmullRomCurve3([
      new Vector3(across, -3 + Math.cos(phase) * 2.2, 0),
      new Vector3(across * 0.82 + Math.sin(phase) * 3, -14, Math.cos(phase) * 1.4),
      new Vector3(across * 0.62 + Math.cos(phase * 1.4) * 5, -28, Math.sin(phase) * 2),
      new Vector3(across * 0.42 + Math.sin(phase * 0.7) * 7, -45 - (strand % 4) * 3, Math.cos(phase) * 3),
    ], false, 'catmullrom', 0.44);
    const material = strandMat(strand % 5 === 0 ? JELLY_GOLD : JELLY_GREEN, 0.66);
    material.depthWrite = false;
    jelly.add(new Mesh(new TubeGeometry(curve, 32, 0.11 + (strand % 4) * 0.035, 5, false), material));
  }
  return jelly;
}

export function updateStrandlineEnvironment(dt: number, context: StrandlineEnvironmentContext) {
  beatPulse = Math.max(0, beatPulse - dt * 1.8);
  const time = context.runTime;
  const progress = Math.min(1, time / STRANDLINE_542F_MARKERS.release);
  const releaseT = time < STRANDLINE_542F_MARKERS.release
    ? 0
    : Math.min(1, (time - STRANDLINE_542F_MARKERS.release) / Math.max(0.01, STRANDLINE_542F_MARKERS.end - STRANDLINE_542F_MARKERS.release));
  const liberationT = liberated && liberationAt >= 0 ? Math.min(1, Math.max(0, context.elapsed - liberationAt) / 3.5) : 0;

  const baseWater = time < STRANDLINE_542F_MARKERS.moonReveal
    ? new Color().lerpColors(WATER_NEAR, WATER_CLEAR, progress * 0.72)
    : time < STRANDLINE_542F_MARKERS.parent
      ? new Color().lerpColors(WATER_CLEAR, WATER_DEEP, Math.min(0.72, (time - STRANDLINE_542F_MARKERS.moonReveal) / 28))
      : new Color().lerpColors(WATER_DEEP, WATER_CLEAR, releaseT * 0.78);
  context.scene.background = baseWater;
  if (context.scene.fog instanceof FogExp2) {
    context.scene.fog.color.copy(baseWater).lerp(WATER_DEEP, 0.28);
    context.scene.fog.density = 0.0068 - releaseT * 0.0034;
  }

  if (cameraRig) {
    cameraRig.position.copy(context.camera.position);
    cameraRig.quaternion.copy(context.camera.quaternion);
  }
  if (moonReveal) {
    const begin = STRANDLINE_542F_MARKERS.moonReveal - 1.0;
    const end = STRANDLINE_542F_MARKERS.forestReturn + 1.2;
    moonReveal.visible = context.running && time >= begin && time <= end;
    if (moonReveal.visible) {
      const reveal = Math.min(1, Math.max(0, (time - begin) / 2));
      const retreat = Math.min(1, Math.max(0, (end - time) / 2));
      moonReveal.scale.setScalar(0.75 + Math.min(reveal, retreat) * 0.22 + beatPulse * 0.01);
      moonReveal.rotation.z = Math.sin(time * 0.13) * 0.035;
    }
  }
  if (motes) {
    motes.rotation.z += dt * 0.008;
    motes.position.y = Math.sin(context.elapsed * 0.12) * 0.5;
    (motes.material as PointsMaterial).opacity = 0.35 + beatPulse * 0.15 + releaseT * 0.16;
  }
  if (codaTableau) {
    const tableauT = Math.max(liberationT, releaseT);
    codaTableau.visible = tableauT > 0.03;
    if (codaTableau.visible) {
      const pull = tableauT * tableauT * (3 - 2 * tableauT);
      codaTableau.position.set(0, 3 + pull * 3, -72 - pull * 48);
      codaTableau.scale.setScalar(1.34 - pull * 0.54);
      codaTableau.rotation.z = Math.sin(context.elapsed * 0.19) * 0.035;
      const infection = codaTableau.getObjectByName('tableau-infection');
      if (infection) infection.visible = !liberated;
    }
  }

  const forestFade = Math.max(releaseT ** 1.5, liberationT * 0.82);
  for (const item of strandMaterials) {
    const traveling = 0.5 + 0.5 * Math.sin(context.elapsed * 1.45 - item.phase + progress * 15);
    item.material.opacity = item.baseOpacity * (1 - forestFade * 0.72) + (beatPulse * 0.12 + liberationT * 0.16) * traveling;
    item.material.color.copy(JELLY_GREEN).lerp(JELLY_GOLD, Math.min(0.72, liberationT * 0.55 + traveling * (0.08 + progress * 0.08)));
  }
  for (const node of pulseNodes) {
    const wave = 0.5 + 0.5 * Math.sin(context.elapsed * 2.0 - node.phase + progress * 18);
    node.mesh.scale.setScalar(node.baseScale * (0.82 + wave * 0.28 + beatPulse * 0.18));
    const material = node.mesh.material as MeshBasicMaterial;
    material.opacity = 0.44 + wave * 0.34 + liberationT * 0.18;
  }
  for (const stain of parasiteStains) {
    const material = stain.material as MeshBasicMaterial;
    material.opacity = Math.max(0, 0.68 * (1 - Math.max(releaseT, liberationT)));
    stain.scale.setScalar(1 - Math.max(releaseT, liberationT) * 0.82);
  }
  for (const material of cleanMaterials) {
    material.opacity = Math.min(0.9, material.opacity + dt * (releaseT > 0 ? 0.1 : 0));
    material.color.copy(JELLY_GREEN).lerp(JELLY_GOLD, 0.3 + releaseT * 0.45);
  }
  if (wholeAnimal) {
    wholeAnimal.rotation.z = Math.sin(context.elapsed * 0.08) * 0.025;
    wholeAnimal.position.y = STRANDLINE_542F_JELLY_CENTER.y + Math.sin(context.elapsed * 0.11) * 1.2;
  }
  if (closeForest) closeForest.visible = releaseT < 0.98;
}

export function disposeStrandlineEnvironment() {
  pulseNodes.length = 0;
  strandMaterials.length = 0;
  cleanMaterials.length = 0;
  parasiteStains.length = 0;
  liberated = false;
  liberationAt = -1;
  beatPulse = 0;
  closeForest = null;
  cameraRig = null;
  moonReveal = null;
  codaTableau = null;
  wholeAnimal = null;
  motes = null;
  if (!root) return;
  root.removeFromParent();
  disposeTree(root);
  root = null;
}

function disposeTree(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
