import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

// Dark adhesive core material shared across enemies
const GLUE_CORE_MATERIAL = new MeshStandardMaterial({
  color: 0x12081f,
  emissive: 0x6b21a8,
  emissiveIntensity: 0.8,
  roughness: 0.2,
  metalness: 0.8,
});

// Stolen supplies materials
const BUTTON_MAT_RED = new MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
const BUTTON_MAT_BLUE = new MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 });
const CARDBOARD_MAT = new MeshStandardMaterial({ color: 0xc29b62, roughness: 0.8, side: DoubleSide });
const RULER_MAT = new MeshStandardMaterial({ color: 0xeab308, roughness: 0.5 });
const PENCIL_MAT = new MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5 });

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  if (kind === 'beetle') return createBeetleMesh();
  if (kind === 'bird') return createBirdMesh();
  if (kind === 'walker') return createWalkerMesh();
  if (kind === 'spillcore') return createBossMesh();
  if (kind === 'glueblob') return createGlueBlobMesh();

  // Fallback
  return createBeetleMesh();
}

function createBeetleMesh(): Group {
  const group = new Group();
  // Core center
  const core = new Mesh(new SphereGeometry(0.5, 12, 10), GLUE_CORE_MATERIAL);
  group.add(core);

  // Button shell on back
  const button = new Mesh(new CylinderGeometry(0.85, 0.85, 0.25, 12), BUTTON_MAT_RED);
  button.position.set(0, 0.25, 0);
  group.add(button);

  // Spool head
  const spool = new Mesh(new CylinderGeometry(0.3, 0.3, 0.4, 8), BUTTON_MAT_BLUE);
  spool.rotation.x = Math.PI / 2;
  spool.position.set(0, 0, 0.65);
  group.add(spool);

  // 6 Peg legs (toothpicks/pins)
  const legGeo = new CylinderGeometry(0.04, 0.04, 0.7, 6);
  for (let i = 0; i < 6; i++) {
    const leg = new Mesh(legGeo, RULER_MAT);
    const side = i % 2 === 0 ? 1 : -1;
    const z = (Math.floor(i / 2) - 1) * 0.45;
    leg.position.set(side * 0.65, -0.25, z);
    leg.rotation.z = side * -0.5;
    group.add(leg);
  }

  return group;
}

function createBirdMesh(): Group {
  const group = new Group();
  // Dark Core
  const core = new Mesh(new SphereGeometry(0.55, 12, 10), GLUE_CORE_MATERIAL);
  group.add(core);

  // Cardboard folded wings
  const wingGeo = new BoxGeometry(1.6, 0.08, 0.8);
  const leftWing = new Mesh(wingGeo, CARDBOARD_MAT);
  leftWing.position.set(-0.85, 0.1, 0);
  leftWing.rotation.z = 0.25;
  group.add(leftWing);

  const rightWing = new Mesh(wingGeo, CARDBOARD_MAT);
  rightWing.position.set(0.85, 0.1, 0);
  rightWing.rotation.z = -0.25;
  group.add(rightWing);

  // Clothespin beak
  const beak = new Mesh(new ConeGeometry(0.2, 0.8, 4), CARDBOARD_MAT);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0, 0.7);
  group.add(beak);

  return group;
}

function createWalkerMesh(): Group {
  const group = new Group();
  // Core
  const core = new Mesh(new SphereGeometry(0.65, 14, 12), GLUE_CORE_MATERIAL);
  core.position.y = 0.8;
  group.add(core);

  // 4 Pencil / Ruler legs
  const legGeo = new CylinderGeometry(0.08, 0.06, 1.8, 8);
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (const a of angles) {
    const leg = new Mesh(legGeo, PENCIL_MAT);
    leg.position.set(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7);
    leg.rotation.x = Math.sin(a) * 0.35;
    leg.rotation.z = Math.cos(a) * -0.35;
    group.add(leg);
  }

  return group;
}

function createBossMesh(): Group {
  const group = new Group();
  // Large Dark Adhesive Core
  const core = new Mesh(new SphereGeometry(1.4, 20, 16), GLUE_CORE_MATERIAL);
  group.add(core);

  // Orbiting Ruler Armor Plates
  const plateMat = new MeshStandardMaterial({ color: 0xca8a04, roughness: 0.4 });
  const plateGeo = new BoxGeometry(0.4, 1.8, 0.15);

  for (let i = 0; i < 6; i++) {
    const plate = new Mesh(plateGeo, plateMat);
    const angle = (i / 6) * Math.PI * 2;
    plate.position.set(Math.cos(angle) * 2.2, Math.sin(angle) * 0.4, Math.sin(angle) * 2.2);
    plate.rotation.y = -angle;
    group.add(plate);
  }

  return group;
}

export function createGlueBlobMesh(): Mesh {
  const mat = new MeshStandardMaterial({
    color: 0x3b0764,
    emissive: 0x7e22ce,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });
  return new Mesh(new SphereGeometry(0.3, 10, 8), mat);
}

export function createProjectileMesh(): Mesh {
  // Glowing brass pin player projectile
  const mat = new MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xeab308,
    emissiveIntensity: 1.2,
    metalness: 0.9,
  });
  const pin = new Mesh(new CylinderGeometry(0.04, 0.04, 0.7, 8), mat);
  pin.rotation.x = Math.PI / 2;
  return pin;
}

export function createReticle(): Object3D {
  const group = new Group();
  // Reticle sized to match lockRadiusNdc 0.085 NDC (~1.2 units radius in world space at distance)
  const ringMat = new MeshBasicMaterial({ color: 0xfacc15, side: DoubleSide });
  const mainRing = new Mesh(new RingGeometry(1.05, 1.2, 32), ringMat);
  group.add(mainRing);

  // Compass ticks
  const tickMat = new MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 4; i++) {
    const tick = new Mesh(new BoxGeometry(0.08, 0.35, 0.02), tickMat);
    const a = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0);
    tick.rotation.z = a;
    group.add(tick);
  }

  return group;
}

function createLetterMesh(character: string): Group {
  const group = new Group();
  const cells = glyphOnCells(character);
  const blockGeo = new BoxGeometry(0.26, 0.26, 0.12);
  const buttonMat = new MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.4 });
  const pinMat = new MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3 });

  for (const cell of cells) {
    const isPin = (cell.x + cell.y) % 2 === 0;
    const block = new Mesh(blockGeo, isPin ? pinMat : buttonMat);
    block.position.set((cell.x - 2) * 0.32, (3 - cell.y) * 0.32, 0);
    group.add(block);
  }

  // Surrounding stationery ring
  const ringMat = new MeshBasicMaterial({ color: 0xfacc15, side: DoubleSide });
  group.add(new Mesh(new TorusGeometry(1.2, 0.03, 8, 32), ringMat));
  return group;
}
