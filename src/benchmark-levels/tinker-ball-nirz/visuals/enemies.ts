import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { Color, Object3D } from 'three';
import { configureAdditiveMaterial } from '../../../engine/visual-kit';
import {
  BEAD,
  BUTTON,
  CARD,
  ERASER,
  LAMP,
  PAINT,
  PAPER,
  PENCIL,
  STEEL,
  WOOD,
} from './palette';
import {
  bead,
  box,
  createButton,
  createCard,
  createClip,
  createClothespin,
  createGlueCore,
  createGlueDrips,
  createJar,
  createPaintPot,
  createPencil,
  createPin,
  createRuler,
  createSpool,
  rod,
  tiltRandomly,
} from './props';

// Leaf module. Every glue monster is the same recipe: a black adhesive core,
// visible from every angle, wearing a temporary body made of stolen supplies.
// Shoot the core and the supplies are what fall out — so each builder also
// declares the pieces its body breaks into.

export type PieceShape = 'disc' | 'rod' | 'plate';
export type PieceSpec = { shape: PieceShape; color: Color; size: number };

const HALO_GEOMETRY = new SphereGeometry(0.5, 12, 8);

/** Per-enemy additive overlay for lock, damage, and denial. Materials are never shared, so tints stay local. */
function attachHalo(group: Group, radius: number) {
  const material = configureAdditiveMaterial(new MeshBasicMaterial({ color: LAMP.clone() }), { opacity: 0 });
  const mesh = new Mesh(HALO_GEOMETRY, material);
  mesh.scale.setScalar(radius * 2);
  group.add(mesh);
  group.userData.halo = mesh;
  group.userData.haloMaterial = material;
  return mesh;
}

/**
 * Seats the assembled body so the group's origin sits on the glue core. The
 * core is what the player aims at, so it — not the creature's feet — has to be
 * the point the engine locks and the lock ring centres on.
 */
function finish(group: Group, options: {
  radius: number;
  pieces: PieceSpec[];
  core: Object3D;
  limbs?: Object3D[];
  coreY?: number;
}) {
  const coreY = options.coreY ?? 0;
  if (coreY !== 0) {
    const body = new Group();
    for (const child of [...group.children]) body.add(child);
    body.position.y = -coreY;
    group.add(body);
  }
  attachHalo(group, options.radius);
  group.userData.core = options.core;
  group.userData.pieces = options.pieces;
  group.userData.limbs = options.limbs ?? [];
  group.userData.lockFit = options.radius;
  return group;
}

/** Button-and-bead beetle: a wide low shell that scuttles along the table. */
export function createBeetle() {
  const group = new Group();
  const core = createGlueCore(0.46);
  core.position.y = 0.42;
  group.add(core);

  const shell = createButton(1.05, BUTTON);
  shell.position.y = 0.72;
  shell.rotation.z = 0.12;
  group.add(shell);

  const limbs: Object3D[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const leg = new Group();
      const shin = rod(0.78, 0.045, STEEL);
      shin.position.y = -0.34;
      shin.rotation.z = side * 0.55;
      leg.add(shin);
      leg.position.set(side * 0.72, 0.42, (i - 1) * 0.52);
      group.add(leg);
      limbs.push(leg);
    }
  }

  for (const side of [-1, 1]) {
    const antenna = rod(0.62, 0.035, PENCIL);
    antenna.position.set(side * 0.28, 0.92, 0.72);
    antenna.rotation.set(0.9, 0, side * 0.4);
    group.add(antenna);
    const tip = bead(0.11, BEAD);
    tip.position.set(side * 0.4, 1.16, 1.02);
    group.add(tip);
  }

  return finish(group, {
    radius: 1.25,
    coreY: 0.42,
    core,
    limbs,
    pieces: [
      { shape: 'disc', color: BUTTON, size: 0.42 },
      { shape: 'disc', color: BUTTON, size: 0.3 },
      { shape: 'rod', color: STEEL, size: 0.34 },
      { shape: 'rod', color: STEEL, size: 0.3 },
      { shape: 'disc', color: BEAD, size: 0.2 },
      { shape: 'rod', color: PENCIL, size: 0.26 },
    ],
  });
}

/** Pin-legged strider: tall, thin, walks with a scissoring gait. */
export function createStrider() {
  const group = new Group();
  const core = createGlueCore(0.5);
  core.position.y = 1.5;
  group.add(core);
  const drips = createGlueDrips(3, 0.5, 1.7);
  drips.position.y = 1.28;
  group.add(drips);

  const cap = createButton(0.5, PAPER);
  cap.position.y = 1.98;
  group.add(cap);

  const limbs: Object3D[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new Group();
    // Flipped so the pin hangs head-down from the body: the bead head is the foot.
    const pin = createPin(1.62, STEEL, i % 2 === 0 ? BUTTON : BEAD);
    pin.rotation.z = Math.PI;
    leg.add(pin);
    leg.position.set(Math.cos(angle) * 0.42, 1.42, Math.sin(angle) * 0.42);
    leg.rotation.z = -Math.cos(angle) * 0.34;
    leg.rotation.x = Math.sin(angle) * 0.34;
    group.add(leg);
    limbs.push(leg);
  }

  const stolen = createPencil(1.15, PENCIL, WOOD);
  stolen.position.set(0.46, 1.42, -0.3);
  stolen.rotation.z = -1.1;
  group.add(stolen);

  return finish(group, {
    radius: 1.35,
    coreY: 1.5,
    core,
    limbs,
    pieces: [
      { shape: 'rod', color: STEEL, size: 0.46 },
      { shape: 'rod', color: STEEL, size: 0.4 },
      { shape: 'rod', color: PENCIL, size: 0.36 },
      { shape: 'disc', color: PAPER, size: 0.3 },
      { shape: 'disc', color: BUTTON, size: 0.18 },
      { shape: 'disc', color: BEAD, size: 0.18 },
    ],
  });
}

/** Cardboard-and-clothespin bird: broad wings, a snapping beak, always above the table. */
export function createBird() {
  const group = new Group();
  const core = createGlueCore(0.44);
  group.add(core);

  const limbs: Object3D[] = [];
  for (const side of [-1, 1]) {
    const wing = new Group();
    const panel = createCard(1.35, 0.86, CARD);
    panel.position.set(side * 0.78, 0, 0);
    panel.rotation.set(Math.PI / 2, 0, side * 0.2);
    wing.add(panel);
    const strut = rod(1.2, 0.04, STEEL);
    strut.position.set(side * 0.62, 0.06, 0);
    strut.rotation.z = Math.PI / 2;
    wing.add(strut);
    group.add(wing);
    limbs.push(wing);
  }

  const beak = createClothespin(0.86, WOOD, STEEL);
  beak.position.set(0, -0.06, 0.82);
  beak.rotation.x = Math.PI / 2;
  group.add(beak);
  group.userData.beak = beak;

  const tail = createCard(0.5, 0.72, PAPER);
  tail.position.set(0, 0.1, -0.8);
  tail.rotation.set(Math.PI / 2.4, 0, 0);
  group.add(tail);

  for (const side of [-1, 1]) {
    const eye = bead(0.1, BEAD);
    eye.position.set(side * 0.22, 0.28, 0.42);
    group.add(eye);
  }

  return finish(group, {
    radius: 1.3,
    core,
    limbs,
    pieces: [
      { shape: 'plate', color: CARD, size: 0.5 },
      { shape: 'plate', color: CARD, size: 0.44 },
      { shape: 'plate', color: PAPER, size: 0.34 },
      { shape: 'rod', color: WOOD, size: 0.36 },
      { shape: 'rod', color: STEEL, size: 0.3 },
      { shape: 'disc', color: BEAD, size: 0.16 },
    ],
  });
}

/** Thread-spool roller: spins on a horizontal axle and unwinds as it comes. */
export function createSpoolRoller() {
  const group = new Group();
  const wheel = new Group();
  const spool = createSpool(0.92, 1.15, WOOD, BEAD);
  spool.rotation.z = Math.PI / 2;
  wheel.add(spool);
  for (let i = 0; i < 3; i += 1) {
    const spoke = box(0.12, 1.24, 0.12, PENCIL);
    spoke.rotation.x = (i / 3) * Math.PI;
    wheel.add(spoke);
  }
  group.add(wheel);
  group.userData.wheel = wheel;

  const core = createGlueCore(0.5);
  group.add(core);

  const thread = rod(1.5, 0.05, BEAD);
  thread.position.set(0, -0.2, -0.9);
  thread.rotation.x = Math.PI / 2.2;
  group.add(thread);

  return finish(group, {
    radius: 1.2,
    core,
    limbs: [wheel],
    pieces: [
      { shape: 'disc', color: WOOD, size: 0.46 },
      { shape: 'disc', color: WOOD, size: 0.38 },
      { shape: 'rod', color: BEAD, size: 0.34 },
      { shape: 'rod', color: PENCIL, size: 0.3 },
      { shape: 'disc', color: BEAD, size: 0.24 },
      { shape: 'plate', color: ERASER, size: 0.28 },
    ],
  });
}

/** Paint-pot lobber: squats, hops, and throws glue. The lid is the core. */
export function createPotter() {
  const group = new Group();
  const pot = createPaintPot(0.86, 1.15, PAINT, PAPER);
  pot.position.y = 0.72;
  group.add(pot);

  const core = createGlueCore(0.54);
  core.position.y = 1.5;
  group.add(core);

  const limbs: Object3D[] = [];
  for (const side of [-1, 1]) {
    const leg = new Group();
    const clip = createClip(0.92, STEEL);
    clip.rotation.set(Math.PI / 2, 0, side * 0.35);
    clip.position.y = -0.3;
    leg.add(clip);
    leg.position.set(side * 0.6, 0.5, 0);
    group.add(leg);
    limbs.push(leg);
  }

  const brush = createPencil(1.05, ERASER, WOOD);
  brush.position.set(-0.6, 0.9, 0.35);
  brush.rotation.z = 0.85;
  group.add(brush);

  return finish(group, {
    radius: 1.3,
    coreY: 1.5,
    core,
    limbs,
    pieces: [
      { shape: 'disc', color: PAINT, size: 0.5 },
      { shape: 'disc', color: PAINT, size: 0.4 },
      { shape: 'plate', color: PAPER, size: 0.3 },
      { shape: 'rod', color: STEEL, size: 0.34 },
      { shape: 'rod', color: ERASER, size: 0.3 },
      { shape: 'disc', color: WOOD, size: 0.22 },
    ],
  });
}

/** Ruler walker: the late-run silhouette — very wide, very slow, two blocks for feet. */
export function createRulerWalker() {
  const group = new Group();
  const beam = createRuler(4.4, PENCIL, WOOD);
  beam.position.y = 1.5;
  group.add(beam);

  const core = createGlueCore(0.56);
  core.position.y = 1.9;
  group.add(core);

  const limbs: Object3D[] = [];
  for (const side of [-1, 1]) {
    const leg = new Group();
    const shin = box(0.22, 1.3, 0.22, WOOD);
    shin.position.y = -0.65;
    leg.add(shin);
    const foot = box(0.62, 0.36, 0.62, ERASER);
    foot.position.y = -1.35;
    leg.add(foot);
    leg.position.set(side * 1.3, 1.42, 0);
    group.add(leg);
    limbs.push(leg);
  }

  return finish(group, {
    radius: 1.6,
    coreY: 1.9,
    core,
    limbs,
    pieces: [
      { shape: 'plate', color: PENCIL, size: 0.56 },
      { shape: 'plate', color: PENCIL, size: 0.46 },
      { shape: 'plate', color: ERASER, size: 0.34 },
      { shape: 'rod', color: WOOD, size: 0.4 },
      { shape: 'rod', color: STEEL, size: 0.3 },
      { shape: 'disc', color: WOOD, size: 0.24 },
    ],
  });
}

/** A thrown drop of glue with one stolen bead trapped inside. */
export function createBlob() {
  const group = new Group();
  const core = createGlueCore(0.3);
  group.add(core);
  const drips = createGlueDrips(2, 0.3, 0.4);
  group.add(drips);
  const trapped = bead(0.16, BUTTON);
  trapped.position.set(0.12, 0.1, 0.16);
  group.add(trapped);
  return finish(group, {
    radius: 0.62,
    core,
    pieces: [
      { shape: 'disc', color: BUTTON, size: 0.2 },
      { shape: 'disc', color: BEAD, size: 0.16 },
    ],
  });
}

/** Boss armour: a slab of supplies the spill has recycled into a shell. */
export function createSpillCrust(index: number) {
  const group = new Group();
  const slab = box(2.9, 0.55, 1.6, CARD);
  group.add(slab);

  const parts: Array<() => Object3D> = [
    () => createButton(0.5, BUTTON),
    () => box(0.7, 0.7, 0.7, PAINT),
    () => createSpool(0.42, 0.6, WOOD, BEAD),
    () => createCard(0.9, 0.62, PAPER),
    () => createClip(0.7, STEEL),
    () => box(0.9, 0.32, 0.45, ERASER),
  ];
  for (let i = 0; i < 3; i += 1) {
    const piece = tiltRandomly(parts[(i + index) % parts.length](), i * 0.37 + index);
    piece.position.set((i - 1) * 0.92, 0.42 + (i % 2) * 0.26, i % 2 === 0 ? -0.32 : 0.32);
    group.add(piece);
  }

  const drips = createGlueDrips(3, 1.3, index);
  drips.position.y = -0.24;
  group.add(drips);

  return finish(group, {
    radius: 1.75,
    core: slab,
    pieces: [
      { shape: 'plate', color: CARD, size: 0.6 },
      { shape: 'disc', color: BUTTON, size: 0.42 },
      { shape: 'plate', color: PAINT, size: 0.4 },
      { shape: 'disc', color: WOOD, size: 0.36 },
      { shape: 'plate', color: PAPER, size: 0.34 },
      { shape: 'rod', color: STEEL, size: 0.3 },
      { shape: 'plate', color: ERASER, size: 0.3 },
      { shape: 'disc', color: BEAD, size: 0.22 },
    ],
  });
}

/** One of the spill's three cores: bare adhesive once its crust is gone. */
export function createSpillCore() {
  const group = new Group();
  const core = createGlueCore(1.0);
  group.add(core);
  group.add(createGlueDrips(3, 1.0, 3.1));
  for (let i = 0; i < 2; i += 1) {
    const angle = (i / 2) * Math.PI * 2;
    const trapped = i % 2 === 0 ? createButton(0.34, BEAD) : box(0.42, 0.42, 0.42, PENCIL);
    trapped.position.set(Math.cos(angle) * 1.05, Math.sin(angle) * 0.72, 0.2);
    group.add(trapped);
  }
  return finish(group, {
    radius: 1.5,
    core,
    pieces: [
      { shape: 'disc', color: BEAD, size: 0.46 },
      { shape: 'plate', color: PENCIL, size: 0.44 },
      { shape: 'disc', color: BUTTON, size: 0.36 },
      { shape: 'rod', color: STEEL, size: 0.32 },
      { shape: 'plate', color: PAPER, size: 0.3 },
      { shape: 'disc', color: PAINT, size: 0.28 },
    ],
  });
}

/** The heart of the spill: the last glue, wearing everything it ever swallowed. */
export function createSpillHeart() {
  const group = new Group();
  const core = createGlueCore(1.9);
  group.add(core);
  group.add(createGlueDrips(4, 1.9, 5.5));

  const ring = new Group();
  const parts: Array<() => Object3D> = [
    () => createJar(0.55, 1.2, PAPER, PAINT),
    () => createRuler(2.4, PENCIL, WOOD),
    () => createCard(1.1, 0.8, CARD),
    () => box(0.8, 0.8, 0.8, WOOD),
  ];
  for (let i = 0; i < parts.length; i += 1) {
    const angle = (i / parts.length) * Math.PI * 2;
    const piece = tiltRandomly(parts[i](), i * 0.61);
    piece.position.set(Math.cos(angle) * 2.55, Math.sin(angle) * 1.95, Math.sin(i) * 0.5);
    ring.add(piece);
  }
  group.add(ring);
  group.userData.ring = ring;

  return finish(group, {
    radius: 2.9,
    core,
    pieces: [
      { shape: 'plate', color: PENCIL, size: 0.66 },
      { shape: 'disc', color: PAPER, size: 0.58 },
      { shape: 'plate', color: CARD, size: 0.54 },
      { shape: 'disc', color: BUTTON, size: 0.5 },
      { shape: 'disc', color: WOOD, size: 0.46 },
      { shape: 'plate', color: PAINT, size: 0.44 },
      { shape: 'rod', color: STEEL, size: 0.4 },
      { shape: 'plate', color: ERASER, size: 0.38 },
      { shape: 'disc', color: BEAD, size: 0.34 },
      { shape: 'rod', color: PENCIL, size: 0.3 },
    ],
  });
}

// The spill grows three crusts and they must not be identical slabs; the
// counter walks the recycled-part rotation so each one packs differently.
let crustIndex = 0;

export function createEnemyGroup(kind: string): Group {
  switch (kind) {
    case 'strider':
      return createStrider();
    case 'bird':
      return createBird();
    case 'spool':
      return createSpoolRoller();
    case 'potter':
      return createPotter();
    case 'ruler':
      return createRulerWalker();
    case 'blob':
      return createBlob();
    case 'crust':
      crustIndex += 1;
      return createSpillCrust(crustIndex);
    case 'core':
      return createSpillCore();
    case 'heart':
      return createSpillHeart();
    default:
      return createBeetle();
  }
}

export function piecesForMesh(mesh: Object3D): PieceSpec[] {
  return (mesh.userData.pieces as PieceSpec[] | undefined) ?? [];
}
