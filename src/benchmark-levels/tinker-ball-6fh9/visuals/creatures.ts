import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { bakeShaded, mergeShadedMesh } from './bake';
import {
  BUTTON_RED,
  CARDBOARD,
  CLIP_SILVER,
  COBALT,
  CORE_HOT,
  CORE_VIOLET,
  CRAFT_CYCLE,
  CREAM,
  ERASER_PINK,
  GLUE_BLACK,
  GLUE_SHEEN,
  hdr,
  MUSTARD,
  PENCIL_YELLOW,
  SPOOL_PLUM,
  TEAL,
  WOOD_DARK,
} from './palette';

// Glue-monster bodies: every creature is a visible black adhesive core
// wearing stolen stationery. The core (with its hot violet glint) is the
// "shoot me" read; the bright craft-colored supplies are what the ball
// rescues when the body breaks apart.

export type PieceShape = 'disc' | 'box' | 'stick' | 'ball';

export type PieceSpec = {
  shape: PieceShape;
  color: Color;
  size: number;
  direction: Vector3;
};

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomDirection(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

/** The adhesive core: matte black blob, one glossy sheen highlight, and a hot violet glint. */
function addGlueCore(group: Group, radius: number) {
  const coreMaterial = new MeshBasicMaterial({ color: GLUE_BLACK });
  const core = new Mesh(new SphereGeometry(radius, 14, 11), coreMaterial);
  core.scale.y = 0.92;
  group.add(core);

  const sheenMaterial = createAdditiveBasicMaterial({ color: GLUE_SHEEN.clone().multiplyScalar(0.5), opacity: 0.85 });
  const sheen = new Mesh(new SphereGeometry(radius * 0.34, 8, 6), sheenMaterial);
  sheen.position.set(-radius * 0.38, radius * 0.42, radius * 0.5);
  sheen.scale.set(1, 0.6, 0.6);
  group.add(sheen);

  const dotMaterial = new MeshBasicMaterial({ color: hdr(CORE_VIOLET, 1.9) });
  const dot = new Mesh(new SphereGeometry(radius * 0.22, 8, 6), dotMaterial);
  dot.position.set(0, 0, radius * 0.82);
  group.add(dot);

  group.userData.coreMaterial = coreMaterial;
  group.userData.sheenMaterial = sheenMaterial;
  group.userData.dotMaterial = dotMaterial;
  group.userData.coreRadius = radius;
  return { coreMaterial, sheenMaterial, dotMaterial };
}

function shadedPart(build: (parts: BufferGeometry[]) => void): Mesh {
  const parts: BufferGeometry[] = [];
  build(parts);
  return mergeShadedMesh(parts);
}

const IDENTITY = new Quaternion();

function place(x: number, y: number, z: number, rotation = IDENTITY, scale = 1): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), rotation, new Vector3(scale, scale, scale));
}

function tiltZ(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
}

function tiltX(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
}

// ---- button beetle ---------------------------------------------------------

export function createBeetle(): Group {
  const group = new Group();
  const accent = pick([BUTTON_RED, COBALT, TEAL, MUSTARD]).clone();
  const secondary = pick(CRAFT_CYCLE).clone();
  addGlueCore(group, 0.44);

  // Elytra: two big buttons worn as wing covers.
  const buttonDisc = new CylinderGeometry(0.56, 0.52, 0.14, 16);
  const elytra = shadedPart((parts) => {
    bakeShaded(parts, buttonDisc, place(-0.4, 0.34, -0.12, tiltZ(0.55)), accent);
    bakeShaded(parts, buttonDisc, place(0.4, 0.34, -0.12, tiltZ(-0.55)), secondary);
    // Button holes read at close range.
    const hole = new CylinderGeometry(0.06, 0.06, 0.18, 6);
    for (const side of [-1, 1]) {
      for (const [hx, hz] of [[-0.14, -0.14], [0.14, 0.14], [-0.14, 0.14], [0.14, -0.14]] as const) {
        bakeShaded(parts, hole, place(side * 0.4 + hx, 0.36, -0.12 + hz, tiltZ(side * -0.55)), WOOD_DARK, { topBoost: 0.5, sideDim: 0.4 });
      }
    }
  });
  group.add(elytra);
  buttonDisc.dispose();

  // Six pin legs, merged into two gait sets that swing in anti-phase.
  const legGeometry = new CylinderGeometry(0.028, 0.014, 0.85, 5);
  const legSets: Mesh[] = [];
  for (const phase of [0, 1]) {
    const legs = shadedPart((parts) => {
      for (let i = 0; i < 3; i += 1) {
        const side = i % 2 === phase ? 1 : -1;
        const along = (i - 1) * 0.34;
        bakeShaded(parts, legGeometry, place(side * 0.5, -0.28, along, tiltZ(side * 0.9)), CLIP_SILVER);
        const head = new SphereGeometry(0.06, 6, 5);
        bakeShaded(parts, head, place(side * 0.88, -0.55, along), pick(CRAFT_CYCLE));
        head.dispose();
      }
    });
    group.add(legs);
    legSets.push(legs);
  }
  legGeometry.dispose();

  // Bead eyes on pin stalks.
  const eyes = shadedPart((parts) => {
    const stalk = new CylinderGeometry(0.02, 0.02, 0.3, 5);
    const bead = new SphereGeometry(0.09, 8, 6);
    for (const side of [-1, 1]) {
      bakeShaded(parts, stalk, place(side * 0.2, 0.5, 0.3, tiltX(0.5)), CLIP_SILVER);
      bakeShaded(parts, bead, place(side * 0.22, 0.66, 0.42), CREAM, { topBoost: 1.5 });
    }
    stalk.dispose();
    bead.dispose();
  });
  group.add(eyes);

  group.userData.legSets = legSets;
  group.userData.accent = accent;
  group.userData.lockRingScale = 1.05;
  group.userData.pieces = beetlePieces(accent, secondary);
  return group;
}

function beetlePieces(accent: Color, secondary: Color): PieceSpec[] {
  return [
    { shape: 'disc', color: accent.clone(), size: 0.5, direction: randomDirection() },
    { shape: 'disc', color: secondary.clone(), size: 0.46, direction: randomDirection() },
    { shape: 'stick', color: CLIP_SILVER.clone(), size: 0.45, direction: randomDirection() },
    { shape: 'ball', color: CREAM.clone(), size: 0.22, direction: randomDirection() },
    { shape: 'ball', color: pick(CRAFT_CYCLE).clone(), size: 0.2, direction: randomDirection() },
  ];
}

// ---- pencil strider --------------------------------------------------------

export function createStrider(): Group {
  const group = new Group();
  const threadColor = pick([SPOOL_PLUM, TEAL, BUTTON_RED, COBALT]).clone();
  addGlueCore(group, 0.5);
  group.userData.sheenOffset = 0.6;

  // Thread spool torso hanging under the core.
  const torso = shadedPart((parts) => {
    const waist = new CylinderGeometry(0.34, 0.34, 0.62, 12);
    const flange = new CylinderGeometry(0.48, 0.48, 0.12, 14);
    bakeShaded(parts, waist, place(0, -0.72, 0), threadColor);
    bakeShaded(parts, flange, place(0, -0.38, 0), CREAM);
    bakeShaded(parts, flange, place(0, -1.06, 0), CREAM);
    waist.dispose();
    flange.dispose();
    // Glue drips seeping from the core over the spool.
    const drip = new ConeGeometry(0.09, 0.42, 6);
    for (const [dx, dz] of [[-0.3, 0.2], [0.24, -0.16], [0.05, 0.32]] as const) {
      bakeShaded(parts, drip, place(dx, -0.52, dz, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)), GLUE_BLACK, { topBoost: 0.5, sideDim: 0.45 });
    }
    drip.dispose();
  });
  group.add(torso);

  // Four pencil legs in two anti-phase pairs.
  const legSets: Mesh[] = [];
  for (const phase of [0, 1]) {
    const legs = shadedPart((parts) => {
      const shaft = new CylinderGeometry(0.055, 0.055, 2.1, 6);
      const tip = new ConeGeometry(0.055, 0.22, 6);
      for (let i = 0; i < 2; i += 1) {
        const side = i === 0 ? -1 : 1;
        const forward = phase === 0 ? side * 0.3 : side * -0.3;
        const lean = side * 0.38;
        bakeShaded(parts, shaft, place(side * 0.62, -1.35, forward, tiltZ(lean)), PENCIL_YELLOW);
        bakeShaded(parts, tip, place(side * 1.0, -2.35, forward * 1.4, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI + lean)), WOOD_DARK, { topBoost: 0.6 });
      }
      shaft.dispose();
      tip.dispose();
    });
    group.add(legs);
    legSets.push(legs);
  }

  // An eraser worn like a hat.
  const hat = shadedPart((parts) => {
    const eraser = new BoxGeometry(0.62, 0.22, 0.34);
    bakeShaded(parts, eraser, place(0.06, 0.52, 0, tiltZ(-0.14)), ERASER_PINK);
    eraser.dispose();
  });
  group.add(hat);

  group.userData.legSets = legSets;
  group.userData.accent = threadColor;
  group.userData.lockRingScale = 1.35;
  group.userData.pieces = [
    { shape: 'stick', color: PENCIL_YELLOW.clone(), size: 0.72, direction: randomDirection() },
    { shape: 'stick', color: PENCIL_YELLOW.clone(), size: 0.66, direction: randomDirection() },
    { shape: 'disc', color: CREAM.clone(), size: 0.42, direction: randomDirection() },
    { shape: 'box', color: threadColor.clone(), size: 0.4, direction: randomDirection() },
    { shape: 'box', color: ERASER_PINK.clone(), size: 0.34, direction: randomDirection() },
  ] satisfies PieceSpec[];
  return group;
}

// ---- clothespin snapper ----------------------------------------------------

export function createSnapper(): Group {
  const group = new Group();
  const wingColor = CARDBOARD.clone();
  const beakColor = pick([BUTTON_RED, MUSTARD, TEAL]).clone();
  addGlueCore(group, 0.52);

  // Folded cardboard wings, pivoted at the shoulders so they flap.
  const wings: Mesh[] = [];
  for (const side of [-1, 1]) {
    const wing = shadedPart((parts) => {
      const panel = new BoxGeometry(1.5, 0.05, 0.8);
      bakeShaded(parts, panel, place(side * 0.75, 0, 0, tiltZ(side * 0.1)), wingColor);
      const fold = new BoxGeometry(0.8, 0.045, 0.55);
      bakeShaded(parts, fold, place(side * 1.42, 0.12, -0.06, tiltZ(side * 0.55)), wingColor.clone().multiplyScalar(1.15));
      panel.dispose();
      fold.dispose();
    });
    wing.position.set(side * 0.18, 0.18, 0);
    group.add(wing);
    wings.push(wing);
  }

  // Clothespin beak: two jaws that snap.
  const jaws: Mesh[] = [];
  for (const vertical of [1, -1]) {
    const jaw = shadedPart((parts) => {
      const wood = new BoxGeometry(0.85, 0.12, 0.2);
      bakeShaded(parts, wood, place(0.42, vertical * 0.07, 0), beakColor);
      wood.dispose();
    });
    jaw.position.set(0.32, 0, 0.42);
    jaw.rotation.y = -Math.PI / 2;
    group.add(jaw);
    jaws.push(jaw);
  }
  const spring = new Mesh(
    new TorusGeometry(0.08, 0.02, 6, 10),
    new MeshBasicMaterial({ color: CLIP_SILVER }),
  );
  spring.position.set(0, 0, 0.4);
  group.add(spring);

  // A curled paper tail.
  const tail = shadedPart((parts) => {
    const strip = new BoxGeometry(0.4, 0.04, 0.5);
    bakeShaded(parts, strip, place(0, 0.05, -0.62, tiltX(0.4)), CREAM);
    bakeShaded(parts, strip, place(0, 0.22, -0.95, tiltX(1.0)), CREAM.clone().multiplyScalar(0.92));
    strip.dispose();
  });
  group.add(tail);

  group.userData.wings = wings;
  group.userData.jaws = jaws;
  group.userData.accent = beakColor;
  group.userData.lockRingScale = 1.2;
  group.userData.pieces = [
    { shape: 'box', color: wingColor.clone(), size: 0.5, direction: randomDirection() },
    { shape: 'box', color: wingColor.clone().multiplyScalar(1.1), size: 0.44, direction: randomDirection() },
    { shape: 'stick', color: beakColor.clone(), size: 0.5, direction: randomDirection() },
    { shape: 'box', color: CREAM.clone(), size: 0.3, direction: randomDirection() },
  ] satisfies PieceSpec[];
  return group;
}

// ---- glue glob (hostile shot) ----------------------------------------------

export function createGlob(): Group {
  const group = new Group();
  const { dotMaterial } = addGlueCore(group, 0.42);
  dotMaterial.color.copy(hdr(CORE_VIOLET, 1.2));
  // Drippy tail.
  const tailMaterial = new MeshBasicMaterial({ color: GLUE_BLACK });
  const tail = new Mesh(new ConeGeometry(0.14, 0.6, 7), tailMaterial);
  tail.position.set(0, 0.36, -0.1);
  group.add(tail);
  // Hot rim that the danger tint drives as it closes in.
  const rimMaterial = createAdditiveBasicMaterial({ color: GLUE_SHEEN.clone().multiplyScalar(0.32), opacity: 0.6 });
  const rim = new Mesh(new SphereGeometry(0.48, 10, 8), rimMaterial);
  group.add(rim);
  group.userData.isGlob = true;
  group.userData.rimMaterial = rimMaterial;
  group.userData.accent = CORE_VIOLET.clone();
  group.userData.lockRingScale = 0.85;
  group.userData.pieces = [] satisfies PieceSpec[];
  return group;
}

// ---- the spill's targets ---------------------------------------------------

/** A shelled core: a heavy glue orb caked in stolen supplies that pop off per hit. */
export function createSpillCore(): Group {
  const group = new Group();
  addGlueCore(group, 1.2);
  group.userData.sheenOffset = 1.1;

  const shellPieces: Mesh[] = [];
  const shellSpecs: Array<{ shape: PieceShape; color: Color; size: number }> = [
    { shape: 'disc', color: BUTTON_RED.clone(), size: 0.5 },
    { shape: 'box', color: COBALT.clone(), size: 0.44 },
    { shape: 'stick', color: PENCIL_YELLOW.clone(), size: 0.6 },
    { shape: 'disc', color: MUSTARD.clone(), size: 0.42 },
    { shape: 'box', color: CARDBOARD.clone(), size: 0.48 },
    { shape: 'ball', color: TEAL.clone(), size: 0.3 },
  ];
  shellSpecs.forEach((spec, index) => {
    const angle = (index / shellSpecs.length) * Math.PI * 2;
    const direction = new Vector3(Math.cos(angle), Math.sin(angle * 1.7) * 0.6, Math.sin(angle)).normalize();
    const piece = shadedPart((parts) => {
      const geometry = spec.shape === 'disc'
        ? new CylinderGeometry(spec.size, spec.size * 0.94, spec.size * 0.34, 12)
        : spec.shape === 'stick'
          ? new CylinderGeometry(spec.size * 0.12, spec.size * 0.12, spec.size * 2, 6)
          : spec.shape === 'ball'
            ? new SphereGeometry(spec.size, 10, 8)
            : new BoxGeometry(spec.size, spec.size * 0.7, spec.size * 0.8);
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
      bakeShaded(parts, geometry, new Matrix4().compose(
        direction.clone().multiplyScalar(1.22),
        rotation,
        new Vector3(1, 1, 1),
      ), spec.color);
      geometry.dispose();
    });
    group.add(piece);
    shellPieces.push(piece);
  });

  group.userData.shellPieces = shellPieces;
  group.userData.accent = CORE_VIOLET.clone();
  group.userData.lockRingScale = 1.6;
  group.userData.pieces = shellSpecs.map((spec) => ({
    shape: spec.shape,
    color: spec.color.clone(),
    size: spec.size,
    direction: randomDirection(),
  })) satisfies PieceSpec[];
  return group;
}

/** The heart: the biggest core, wearing a junk dome until the last shell cracks. */
export function createSpillHeart(): Group {
  const group = new Group();
  const { dotMaterial } = addGlueCore(group, 1.7);
  dotMaterial.color.copy(hdr(CORE_HOT, 2.2));
  group.userData.sheenOffset = 1.6;

  const dome = shadedPart((parts) => {
    const specs: Array<[PieceShape, Color, number]> = [
      ['disc', BUTTON_RED.clone(), 0.6],
      ['box', CARDBOARD.clone(), 0.66],
      ['stick', PENCIL_YELLOW.clone(), 0.8],
      ['disc', COBALT.clone(), 0.52],
      ['box', SPOOL_PLUM.clone(), 0.5],
      ['ball', MUSTARD.clone(), 0.36],
      ['stick', CLIP_SILVER.clone(), 0.6],
      ['disc', TEAL.clone(), 0.5],
    ];
    specs.forEach(([shape, color, size], index) => {
      const angle = (index / specs.length) * Math.PI * 2 + 0.4;
      const direction = new Vector3(Math.cos(angle), 0.35 + Math.sin(index * 2.3) * 0.45, Math.sin(angle)).normalize();
      const geometry = shape === 'disc'
        ? new CylinderGeometry(size, size * 0.94, size * 0.3, 12)
        : shape === 'stick'
          ? new CylinderGeometry(size * 0.1, size * 0.1, size * 2.2, 6)
          : shape === 'ball'
            ? new SphereGeometry(size, 10, 8)
            : new BoxGeometry(size, size * 0.66, size * 0.8);
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
      bakeShaded(parts, geometry, new Matrix4().compose(
        direction.clone().multiplyScalar(1.62),
        rotation,
        new Vector3(1, 1, 1),
      ), color);
      geometry.dispose();
    });
  });
  group.add(dome);

  group.userData.dome = dome;
  group.userData.isHeart = true;
  group.userData.accent = CORE_HOT.clone();
  group.userData.lockRingScale = 2.1;
  group.userData.pieces = [
    { shape: 'disc', color: BUTTON_RED.clone(), size: 0.55, direction: randomDirection() },
    { shape: 'box', color: COBALT.clone(), size: 0.5, direction: randomDirection() },
    { shape: 'stick', color: PENCIL_YELLOW.clone(), size: 0.7, direction: randomDirection() },
    { shape: 'disc', color: TEAL.clone(), size: 0.48, direction: randomDirection() },
    { shape: 'box', color: CARDBOARD.clone(), size: 0.52, direction: randomDirection() },
    { shape: 'ball', color: MUSTARD.clone(), size: 0.32, direction: randomDirection() },
    { shape: 'stick', color: CLIP_SILVER.clone(), size: 0.5, direction: randomDirection() },
    { shape: 'disc', color: SPOOL_PLUM.clone(), size: 0.44, direction: randomDirection() },
  ] satisfies PieceSpec[];
  return group;
}