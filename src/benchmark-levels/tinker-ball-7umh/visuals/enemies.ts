import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BRASS_METAL,
  BUTTON_CYAN,
  BUTTON_LIME,
  BUTTON_MAGENTA,
  BUTTON_ORANGE,
  BUTTON_PURPLE,
  BUTTON_YELLOW,
  CARDBOARD_DARK,
  CARDBOARD_KRAFT,
  DENIED_COLOR,
  ERASER_PINK,
  GLUE_CORE_GLOW,
  GLUE_CORE_HOT,
  GLUE_DARK,
  GLUE_PURPLE,
  hdr,
  LOCK_COLOR,
  PENCIL_LEAD,
  PENCIL_WOOD,
  PENCIL_YELLOW,
  SPOOL_WOOD,
  STEEL_METAL,
} from './palette';

export type EnemyMeshUserData = {
  kind: string;
  coreMesh?: Mesh;
  coreMaterial?: MeshBasicMaterial;
  bodyParts?: Group;
  lockRing?: Mesh;
  accentColor?: Color;
};

// ---- Beetle ----
export function createBeetleMesh(): Group {
  const group = new Group();

  // 1. Dark Adhesive Core (Visible black/tar core with glowing ember)
  const coreGeom = new SphereGeometry(0.55, 10, 10);
  const coreMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 0.4, 0);

  const emberGeom = new SphereGeometry(0.3, 8, 8);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(GLUE_CORE_GLOW, 1.8) });
  const emberMesh = new Mesh(emberGeom, emberMat);
  coreMesh.add(emberMesh);
  group.add(coreMesh);

  // 2. Body: Stolen Button Shell (Domed 4-hole button)
  const buttonGroup = new Group();
  buttonGroup.userData.raildIgnoreOcclusion = true;
  const buttonGeom = new CylinderGeometry(1.2, 1.3, 0.35, 16);
  const buttonMat = new MeshBasicMaterial({ color: BUTTON_CYAN });
  const buttonMesh = new Mesh(buttonGeom, buttonMat);
  buttonMesh.position.set(0, 0.7, 0);
  buttonGroup.add(buttonMesh);

  // Button rim line
  const rimGeom = new TorusGeometry(1.25, 0.08, 6, 16);
  const rimMat = new MeshBasicMaterial({ color: hdr(BUTTON_CYAN, 1.4) });
  const rim = new Mesh(rimGeom, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0.85, 0);
  buttonGroup.add(rim);

  // 4 thread holes
  const holeGeom = new CylinderGeometry(0.12, 0.12, 0.4, 8);
  const holeMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const h1 = new Mesh(holeGeom, holeMat);
  h1.position.set(0.35, 0.72, 0.35);
  const h2 = new Mesh(holeGeom, holeMat);
  h2.position.set(-0.35, 0.72, 0.35);
  const h3 = new Mesh(holeGeom, holeMat);
  h3.position.set(0.35, 0.72, -0.35);
  const h4 = new Mesh(holeGeom, holeMat);
  h4.position.set(-0.35, 0.72, -0.35);
  buttonGroup.add(h1, h2, h3, h4);

  // 3. Legs: Thread spool rollers
  const spoolGeom = new CylinderGeometry(0.35, 0.35, 0.5, 8);
  const spoolMat = new MeshBasicMaterial({ color: SPOOL_WOOD });
  const leftSpool = new Mesh(spoolGeom, spoolMat);
  leftSpool.rotation.z = Math.PI / 2;
  leftSpool.position.set(-1.1, 0.25, 0);
  const rightSpool = new Mesh(spoolGeom, spoolMat);
  rightSpool.rotation.z = Math.PI / 2;
  rightSpool.position.set(1.1, 0.25, 0);
  buttonGroup.add(leftSpool, rightSpool);

  // 4. Antennae: Bent steel paperclips
  const antGeom = new CylinderGeometry(0.04, 0.04, 1.2, 6);
  const antMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const leftAnt = new Mesh(antGeom, antMat);
  leftAnt.position.set(-0.5, 0.9, -1.0);
  leftAnt.rotation.set(-0.6, -0.3, 0);
  const rightAnt = new Mesh(antGeom, antMat);
  rightAnt.position.set(0.5, 0.9, -1.0);
  rightAnt.rotation.set(-0.6, 0.3, 0);
  buttonGroup.add(leftAnt, rightAnt);

  group.add(buttonGroup);

  group.userData = {
    kind: 'beetle',
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: buttonGroup,
    accentColor: BUTTON_CYAN,
  } satisfies EnemyMeshUserData;

  return group;
}

// ---- Skitterer ----
export function createSkittererMesh(): Group {
  const group = new Group();

  // Dark adhesive core
  const coreGeom = new SphereGeometry(0.42, 10, 10);
  const coreMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 0.3, 0);

  const emberGeom = new SphereGeometry(0.22, 8, 8);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(GLUE_CORE_GLOW, 1.9) });
  coreMesh.add(new Mesh(emberGeom, emberMat));
  group.add(coreMesh);

  // Paperclip & Needle Frame
  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;
  const clipGeom = new TorusGeometry(0.8, 0.08, 6, 16, Math.PI * 1.8);
  const clipMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const clip = new Mesh(clipGeom, clipMat);
  clip.rotation.x = Math.PI / 2;
  clip.position.set(0, 0.35, 0);
  bodyGroup.add(clip);

  // Brass Pin Spines
  const pinGeom = new CylinderGeometry(0.04, 0.04, 1.6, 6);
  const pinMat = new MeshBasicMaterial({ color: BRASS_METAL });
  for (let i = 0; i < 4; i += 1) {
    const pin = new Mesh(pinGeom, pinMat);
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    pin.position.set(Math.cos(angle) * 0.7, 0.3, Math.sin(angle) * 0.7);
    pin.rotation.set(0.4 * Math.sin(angle), angle, 0.4 * Math.cos(angle));
    bodyGroup.add(pin);
  }

  group.add(bodyGroup);

  group.userData = {
    kind: 'skitterer',
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: bodyGroup,
    accentColor: BRASS_METAL,
  } satisfies EnemyMeshUserData;

  return group;
}

// ---- Pencil-Leg Walker ----
export function createWalkerMesh(): Group {
  const group = new Group();

  // 1. Dark Tar Glue Core at center
  const coreGeom = new SphereGeometry(0.85, 12, 12);
  const coreMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 2.2, 0);

  const emberGeom = new SphereGeometry(0.48, 8, 8);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(GLUE_CORE_HOT, 2.2) });
  coreMesh.add(new Mesh(emberGeom, emberMat));
  group.add(coreMesh);

  // 2. 4 Pencil Legs (Yellow hex shaft, cedar wood cone, graphite tip, eraser cap)
  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;

  for (let i = 0; i < 4; i += 1) {
    const legGroup = new Group();
    legGroup.userData.raildIgnoreOcclusion = true;
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;

    // Yellow pencil body
    const pencilShaft = new CylinderGeometry(0.16, 0.16, 3.2, 6);
    const shaftMat = new MeshBasicMaterial({ color: PENCIL_YELLOW });
    const shaft = new Mesh(pencilShaft, shaftMat);
    shaft.position.set(0, 1.6, 0);
    legGroup.add(shaft);

    // Pink eraser top
    const eraserGeom = new CylinderGeometry(0.16, 0.16, 0.5, 6);
    const eraserMat = new MeshBasicMaterial({ color: ERASER_PINK });
    const eraser = new Mesh(eraserGeom, eraserMat);
    eraser.position.set(0, 3.4, 0);
    legGroup.add(eraser);

    // Wood cone & graphite tip at bottom
    const coneGeom = new CylinderGeometry(0.16, 0.02, 0.7, 6);
    const coneMat = new MeshBasicMaterial({ color: PENCIL_WOOD });
    const cone = new Mesh(coneGeom, coneMat);
    cone.position.set(0, -0.3, 0);
    legGroup.add(cone);

    const tipGeom = new CylinderGeometry(0.04, 0.01, 0.25, 6);
    const tipMat = new MeshBasicMaterial({ color: PENCIL_LEAD });
    const tip = new Mesh(tipGeom, tipMat);
    tip.position.set(0, -0.65, 0);
    legGroup.add(tip);

    // Orient leg outward from core
    legGroup.position.set(Math.cos(angle) * 0.9, 0.2, Math.sin(angle) * 0.9);
    legGroup.rotation.set(0.35 * Math.sin(angle), angle, 0.35 * Math.cos(angle));

    bodyGroup.add(legGroup);
  }

  group.add(bodyGroup);

  group.userData = {
    kind: 'walker',
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: bodyGroup,
    accentColor: PENCIL_YELLOW,
  } satisfies EnemyMeshUserData;

  return group;
}

// ---- Clothespin Snapping Bird ----
export function createSnapperMesh(): Group {
  const group = new Group();

  // Dark glue chest core
  const coreGeom = new SphereGeometry(0.65, 10, 10);
  const coreMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 0, 0);

  const emberGeom = new SphereGeometry(0.35, 8, 8);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(GLUE_CORE_GLOW, 2.0) });
  coreMesh.add(new Mesh(emberGeom, emberMat));
  group.add(coreMesh);

  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;

  // Folded Corrugated Cardboard Wings
  const wingGeom = new BoxGeometry(2.4, 0.08, 1.2);
  const wingMat = new MeshBasicMaterial({ color: CARDBOARD_KRAFT });

  const leftWing = new Mesh(wingGeom, wingMat);
  leftWing.position.set(-1.4, 0.2, 0);
  leftWing.rotation.set(0.1, 0, 0.25);
  const rightWing = new Mesh(wingGeom, wingMat);
  rightWing.position.set(1.4, 0.2, 0);
  rightWing.rotation.set(0.1, 0, -0.25);
  bodyGroup.add(leftWing, rightWing);

  // Clothespin Snapping Beak (Wooden peg halves)
  const pegGeom = new BoxGeometry(0.3, 0.25, 1.6);
  const pegMat = new MeshBasicMaterial({ color: PENCIL_WOOD });
  const topPeg = new Mesh(pegGeom, pegMat);
  topPeg.position.set(0, 0.2, -1.0);
  topPeg.rotation.x = -0.15;
  const botPeg = new Mesh(pegGeom, pegMat);
  botPeg.position.set(0, -0.15, -1.0);
  botPeg.rotation.x = 0.15;
  bodyGroup.add(topPeg, botPeg);

  // Push-pin eyes
  const eyeGeom = new SphereGeometry(0.15, 6, 6);
  const eyeMat = new MeshBasicMaterial({ color: BUTTON_MAGENTA });
  const leftEye = new Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.35, 0.35, -0.6);
  const rightEye = new Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.35, 0.35, -0.6);
  bodyGroup.add(leftEye, rightEye);

  group.add(bodyGroup);

  group.userData = {
    kind: 'snapper',
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: bodyGroup,
    accentColor: BUTTON_MAGENTA,
  } satisfies EnemyMeshUserData;

  return group;
}

// ---- Paint-Pot Mortar Turret ----
export function createMortarMesh(): Group {
  const group = new Group();

  // Dark bubbling glue spring inside
  const coreGeom = new SphereGeometry(0.9, 12, 12);
  const coreMat = new MeshBasicMaterial({ color: GLUE_PURPLE });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 1.2, 0);

  const emberGeom = new SphereGeometry(0.5, 8, 8);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_ORANGE, 2.2) });
  coreMesh.add(new Mesh(emberGeom, emberMat));
  group.add(coreMesh);

  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;

  // Ceramic / Tin Paint Pot Canister
  const potGeom = new CylinderGeometry(1.6, 1.4, 2.2, 16, 1, true);
  const potMat = new MeshBasicMaterial({ color: BUTTON_ORANGE });
  const pot = new Mesh(potGeom, potMat);
  pot.position.set(0, 1.1, 0);
  bodyGroup.add(pot);

  // Spool wooden base
  const baseGeom = new CylinderGeometry(1.9, 1.9, 0.5, 12);
  const baseMat = new MeshBasicMaterial({ color: SPOOL_WOOD });
  const base = new Mesh(baseGeom, baseMat);
  base.position.set(0, 0.25, 0);
  bodyGroup.add(base);

  // Wire clips holding pot
  const wireGeom = new TorusGeometry(1.65, 0.08, 6, 16);
  const wireMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const wire = new Mesh(wireGeom, wireMat);
  wire.rotation.x = Math.PI / 2;
  wire.position.set(0, 2.1, 0);
  bodyGroup.add(wire);

  group.add(bodyGroup);

  group.userData = {
    kind: 'mortar',
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: bodyGroup,
    accentColor: BUTTON_ORANGE,
  } satisfies EnemyMeshUserData;

  return group;
}

// ---- Lockable Hazard Bead Projectile ----
export function createHazardBeadMesh(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const coreGeom = new SphereGeometry(0.4, 8, 8);
  const coreMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_MAGENTA, 2.2) });
  const core = new Mesh(coreGeom, coreMat);
  core.userData.raildIgnoreOcclusion = true;
  group.add(core);

  const glueBlobGeom = new SphereGeometry(0.55, 8, 8);
  const glueBlobMat = new MeshBasicMaterial({ color: GLUE_DARK, transparent: true, opacity: 0.7 });
  const glueBlob = new Mesh(glueBlobGeom, glueBlobMat);
  glueBlob.userData.raildIgnoreOcclusion = true;
  group.add(glueBlob);

  group.userData = {
    kind: 'hazard',
    accentColor: BUTTON_MAGENTA,
    raildIgnoreOcclusion: true,
  } satisfies EnemyMeshUserData & { raildIgnoreOcclusion: boolean };

  return group;
}

// ---- Boss: The Great Glue Spill (Cores, Orbiting Armor Rings, Grand Core) ----
export function createSpillCoreMesh(idSuffix = '1'): Group {
  const group = new Group();

  // Dark Adhesive Core with crackling amber core
  const coreGeom = new SphereGeometry(1.6, 14, 14);
  const coreMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const coreMesh = new Mesh(coreGeom, coreMat);
  coreMesh.position.set(0, 1.8, 0);

  const emberGeom = new SphereGeometry(0.9, 10, 10);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(GLUE_CORE_HOT, 2.5) });
  coreMesh.add(new Mesh(emberGeom, emberMat));
  group.add(coreMesh);

  // Stolen Armor Supply Plates: Rulers, Cardboard, Scissor Blades
  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;

  // 1. Orbiting Ruler Shields
  const rulerGeom = new BoxGeometry(0.6, 0.1, 4.5);
  const rulerMat = new MeshBasicMaterial({ color: PENCIL_WOOD });
  for (let r = 0; r < 3; r += 1) {
    const angle = (r / 3) * Math.PI * 2;
    const ruler = new Mesh(rulerGeom, rulerMat);
    ruler.position.set(Math.cos(angle) * 2.5, 1.8, Math.sin(angle) * 2.5);
    ruler.rotation.set(0.2, angle + Math.PI / 2, 0);
    bodyGroup.add(ruler);
  }

  // 2. Cardboard Deflectors
  const cardGeom = new BoxGeometry(1.8, 1.4, 0.12);
  const cardMat = new MeshBasicMaterial({ color: CARDBOARD_KRAFT });
  for (let c = 0; c < 2; c += 1) {
    const angle = c * Math.PI + Math.PI / 4;
    const card = new Mesh(cardGeom, cardMat);
    card.position.set(Math.cos(angle) * 2.4, 1.8, Math.sin(angle) * 2.4);
    card.rotation.y = angle + Math.PI / 2;
    bodyGroup.add(card);
  }

  group.add(bodyGroup);

  group.userData = {
    kind: `spill-core-${idSuffix}`,
    coreMesh,
    coreMaterial: coreMat,
    bodyParts: bodyGroup,
    accentColor: GLUE_CORE_HOT,
  } satisfies EnemyMeshUserData;

  return group;
}

export function createGrandSpillHeartMesh(): Group {
  const group = new Group();

  // Massive dark tar lake heart
  const heartGeom = new SphereGeometry(3.2, 18, 18);
  const heartMat = new MeshBasicMaterial({ color: GLUE_DARK });
  const heartMesh = new Mesh(heartGeom, heartMat);
  heartMesh.position.set(0, 3.5, 0);

  const innerEmber = new SphereGeometry(1.9, 14, 14);
  const emberMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_YELLOW, 3.0) });
  heartMesh.add(new Mesh(innerEmber, emberMat));
  group.add(heartMesh);

  // Swirling Armor Rings
  const bodyGroup = new Group();
  bodyGroup.userData.raildIgnoreOcclusion = true;
  const ringGeom = new TorusGeometry(5.2, 0.4, 8, 24);
  const ringMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const ring1 = new Mesh(ringGeom, ringMat);
  ring1.rotation.x = 0.4;
  ring1.position.set(0, 3.5, 0);

  const ring2 = new Mesh(ringGeom, ringMat);
  ring2.rotation.y = 0.6;
  ring2.position.set(0, 3.5, 0);
  bodyGroup.add(ring1, ring2);

  group.add(bodyGroup);

  group.userData = {
    kind: 'spill-heart',
    coreMesh: heartMesh,
    coreMaterial: heartMat,
    bodyParts: bodyGroup,
    accentColor: BUTTON_YELLOW,
  } satisfies EnemyMeshUserData;

  return group;
}
