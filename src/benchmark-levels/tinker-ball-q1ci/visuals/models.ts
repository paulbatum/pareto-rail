import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Material, Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import {
  BLUE,
  CARDBOARD,
  CORAL,
  CREAM,
  CYAN,
  GLUE_BLACK,
  GLUE_RIM,
  GRAPHITE,
  MINT,
  ORANGE,
  PAPER,
  SUPPLY_COLORS,
  VIOLET,
  WOOD_DARK,
  WOOD_LIGHT,
  YELLOW,
} from './palette';

const coreGeometry = new DodecahedronGeometry(0.72, 1);
const coreHighlightGeometry = new SphereGeometry(0.12, 8, 6);
const buttonGeometry = new CylinderGeometry(0.72, 0.72, 0.18, 20);
const buttonHoleGeometry = new CylinderGeometry(0.07, 0.07, 0.24, 8);
const spoolGeometry = new CylinderGeometry(0.6, 0.6, 0.82, 18);
const spoolRimGeometry = new TorusGeometry(0.62, 0.12, 8, 24);
const beadGeometry = new SphereGeometry(0.23, 10, 7);
const blockGeometry = new BoxGeometry(0.95, 0.78, 0.72);
const rulerGeometry = new BoxGeometry(0.5, 4.8, 0.16);
const glueLobeGeometry = new SphereGeometry(1, 20, 12);
const supplyPencilGeometry = new BoxGeometry(0.2, 1.45, 0.16);
const supplyTipGeometry = new ConeGeometry(0.15, 0.34, 6);
const supplyCardGeometry = new BoxGeometry(0.74, 0.5, 0.1);
const supplyClipGeometry = new TorusGeometry(0.4, 0.045, 6, 16);

function standard(color: number | import('three').Color, options: {
  roughness?: number;
  metalness?: number;
  emissive?: number | import('three').Color;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: typeof DoubleSide;
} = {}) {
  return new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.64,
    metalness: options.metalness ?? 0.02,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent,
    opacity: options.opacity,
    side: options.side,
  });
}

function remember(material: MeshStandardMaterial) {
  material.userData.baseColor = material.color.clone();
  material.userData.baseEmissive = material.emissive.clone();
  material.userData.baseEmissiveIntensity = material.emissiveIntensity;
  return material;
}

function createGlueCore(radius = 1) {
  const group = new Group();
  const coreMaterial = remember(standard(GLUE_BLACK, {
    roughness: 0.14,
    metalness: 0.16,
    emissive: GLUE_RIM,
    emissiveIntensity: 0.12,
  }));
  const core = new Mesh(coreGeometry, coreMaterial);
  core.scale.setScalar(radius);

  const wetRimMaterial = remember(standard(GLUE_RIM, {
    roughness: 0.22,
    metalness: 0.1,
    emissive: GLUE_RIM,
    emissiveIntensity: 0.26,
  }));
  const wetRim = new Mesh(new TorusGeometry(0.76 * radius, 0.075 * radius, 8, 28), wetRimMaterial);
  wetRim.position.z = 0.17 * radius;

  const highlight = new Mesh(coreHighlightGeometry, new MeshBasicMaterial({ color: 0xffffff }));
  highlight.position.set(-0.27 * radius, 0.29 * radius, 0.57 * radius);
  highlight.scale.set(0.7, 0.28, 0.25);
  group.add(core, wetRim, highlight);
  group.userData.coreMaterials = [coreMaterial, wetRimMaterial];
  group.userData.core = core;
  return group;
}

function createButton(colorIndex: number, radius = 0.72) {
  const group = new Group();
  const material = standard(SUPPLY_COLORS[colorIndex % SUPPLY_COLORS.length], { roughness: 0.42 });
  const disc = new Mesh(buttonGeometry, material);
  disc.rotation.x = Math.PI / 2;
  disc.scale.setScalar(radius / 0.72);
  group.add(disc);
  const holeMaterial = standard(GRAPHITE, { roughness: 0.9 });
  for (const x of [-0.2, 0.2]) {
    for (const y of [-0.2, 0.2]) {
      const hole = new Mesh(buttonHoleGeometry, holeMaterial);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(x * (radius / 0.72), y * (radius / 0.72), 0.02);
      hole.scale.setScalar(radius / 0.72);
      group.add(hole);
    }
  }
  return group;
}

function createPencil(colorIndex: number, length = 2.4) {
  const group = new Group();
  const shaft = new Mesh(
    new BoxGeometry(0.28, length, 0.28),
    standard(SUPPLY_COLORS[colorIndex % SUPPLY_COLORS.length], { roughness: 0.7 }),
  );
  const wood = new Mesh(
    new ConeGeometry(0.2, 0.48, 6),
    standard(PAPER, { roughness: 0.85 }),
  );
  wood.position.y = length / 2 + 0.22;
  const graphite = new Mesh(
    new ConeGeometry(0.075, 0.2, 6),
    standard(GRAPHITE, { roughness: 0.7 }),
  );
  graphite.position.y = length / 2 + 0.52;
  const ferrule = new Mesh(
    new CylinderGeometry(0.18, 0.18, 0.26, 8),
    standard(0xb8a78d, { roughness: 0.3, metalness: 0.6 }),
  );
  ferrule.position.y = -length / 2 - 0.12;
  const eraser = new Mesh(
    new CylinderGeometry(0.17, 0.17, 0.24, 8),
    standard(CORAL, { roughness: 0.9 }),
  );
  eraser.position.y = -length / 2 - 0.36;
  group.add(shaft, wood, graphite, ferrule, eraser);
  return group;
}

function createBentWire(points: Vector3[], color = 0xbac5c3, radius = 0.055) {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.3);
  return new Mesh(
    new TubeGeometry(curve, 24, radius, 6, false),
    standard(color, { roughness: 0.26, metalness: 0.72 }),
  );
}

function createClothespin(colorIndex: number, scale = 1) {
  const group = new Group();
  const material = standard(SUPPLY_COLORS[colorIndex % SUPPLY_COLORS.length], { roughness: 0.82 });
  for (const side of [-1, 1]) {
    const jaw = new Mesh(new BoxGeometry(0.3, 1.8, 0.28), material);
    jaw.position.x = side * 0.22;
    jaw.rotation.z = side * -0.09;
    group.add(jaw);
  }
  const spring = new Mesh(
    new TorusGeometry(0.27, 0.045, 7, 16),
    standard(0xa8b3b2, { roughness: 0.28, metalness: 0.7 }),
  );
  spring.position.z = 0.2;
  group.add(spring);
  group.scale.setScalar(scale);
  return group;
}

function createPaperclip(scale = 1) {
  const wire = createBentWire([
    new Vector3(-0.38, -0.75, 0),
    new Vector3(-0.56, 0.32, 0),
    new Vector3(-0.15, 0.78, 0),
    new Vector3(0.38, 0.55, 0),
    new Vector3(0.3, -0.55, 0),
    new Vector3(-0.05, -0.58, 0),
    new Vector3(-0.12, 0.3, 0),
  ]);
  wire.scale.setScalar(scale);
  return wire;
}

function createWing(color: number | import('three').Color, mirror: boolean) {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(mirror ? -2.15 : 2.15, 0.75);
  shape.lineTo(mirror ? -1.7 : 1.7, -0.72);
  shape.lineTo(mirror ? -0.45 : 0.45, -0.36);
  shape.closePath();
  const mesh = new Mesh(
    new ShapeGeometry(shape),
    standard(color, { roughness: 0.86, side: DoubleSide }),
  );
  mesh.position.z = -0.06;
  return mesh;
}

function registerModel(root: Group, kind: string, coreGroup: Group, bodyMaterials: MeshStandardMaterial[] = []) {
  root.userData.kind = kind;
  root.userData.coreMaterials = coreGroup.userData.coreMaterials as MeshStandardMaterial[];
  root.userData.core = coreGroup.userData.core;
  root.userData.bodyMaterials = bodyMaterials;
  root.userData.targetScale = 1;
  root.userData.locked = false;
  root.userData.damageFlash = 0;
  root.userData.denied = 0;
  return root;
}

function createButtonBeetle() {
  const root = new Group();
  const core = createGlueCore(0.84);
  const left = createButton(0, 0.76);
  const right = createButton(2, 0.76);
  left.position.set(-0.7, 0.08, -0.12);
  right.position.set(0.7, 0.08, -0.12);
  left.rotation.z = 0.16;
  right.rotation.z = -0.16;
  const legs = new Group();
  for (const side of [-1, 1]) {
    for (let index = -1; index <= 1; index += 1) {
      const leg = createPaperclip(0.6);
      leg.position.set(side * 0.72, index * 0.43, -0.18);
      leg.rotation.z = side * (Math.PI / 2 + index * 0.18);
      legs.add(leg);
    }
  }
  root.add(left, right, legs, core);
  root.userData.animatedLegs = legs;
  return registerModel(root, 'button-beetle', core);
}

function createPencilWalker() {
  const root = new Group();
  const core = createGlueCore(0.9);
  core.position.y = 0.3;
  const legs = new Group();
  const colors = [1, 0, 4, 2];
  const poses = [
    [-0.85, -1.05, 0.42],
    [-0.35, -1.2, 0.16],
    [0.35, -1.2, -0.16],
    [0.85, -1.05, -0.42],
  ] as const;
  poses.forEach(([x, y, rotation], index) => {
    const pencil = createPencil(colors[index], 2.8);
    pencil.position.set(x, y, -0.12);
    pencil.rotation.z = rotation;
    legs.add(pencil);
  });
  const ruler = new Mesh(
    new BoxGeometry(2.7, 0.34, 0.18),
    standard(YELLOW, { roughness: 0.76 }),
  );
  ruler.position.set(0, 1.02, -0.2);
  root.add(legs, ruler, core);
  root.userData.animatedLegs = legs;
  return registerModel(root, 'pencil-walker', core);
}

function createClothespinBird() {
  const root = new Group();
  const core = createGlueCore(0.8);
  const wings = new Group();
  const left = createWing(CARDBOARD, true);
  const right = createWing(PAPER, false);
  left.position.x = -0.35;
  right.position.x = 0.35;
  wings.add(left, right);
  const body = createClothespin(1, 0.75);
  body.rotation.z = Math.PI / 2;
  body.position.y = -0.35;
  const beak = new Mesh(new ConeGeometry(0.28, 0.85, 4), standard(ORANGE, { roughness: 0.75 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(1.16, 0.05, 0.05);
  root.add(wings, body, core, beak);
  root.userData.wings = wings;
  return registerModel(root, 'clothespin-bird', core);
}

function createSpoolCrab() {
  const root = new Group();
  const core = createGlueCore(0.78);
  const spoolMaterial = standard(VIOLET, { roughness: 0.62 });
  const spool = new Mesh(spoolGeometry, spoolMaterial);
  spool.rotation.x = Math.PI / 2;
  spool.scale.set(1.22, 1.22, 1.22);
  const thread = new Mesh(new TorusGeometry(0.48, 0.2, 10, 24), standard(CYAN, { roughness: 0.92 }));
  thread.position.z = 0.32;
  const claws = new Group();
  for (const side of [-1, 1]) {
    const eraser = new Mesh(new BoxGeometry(0.7, 0.5, 0.38), standard(CORAL, { roughness: 0.9 }));
    eraser.position.set(side * 1.16, 0.1, 0);
    eraser.rotation.z = side * -0.35;
    claws.add(eraser);
    const wire = createPaperclip(0.55);
    wire.position.set(side * 0.96, -0.7, -0.15);
    wire.rotation.z = side * 0.72;
    claws.add(wire);
  }
  root.add(spool, thread, claws, core);
  root.userData.spool = spool;
  root.userData.claws = claws;
  return registerModel(root, 'spool-crab', core, [spoolMaterial]);
}

function createBlockGolem() {
  const root = new Group();
  const core = createGlueCore(1.0);
  const blocks = new Group();
  const colors = [WOOD_LIGHT, BLUE, YELLOW, MINT, CORAL];
  const poses = [
    [-1.05, -0.4, 0.15],
    [1.05, -0.35, -0.18],
    [-0.62, 0.8, -0.2],
    [0.62, 0.92, 0.22],
    [0, -1.18, 0.05],
  ] as const;
  poses.forEach(([x, y, rotation], index) => {
    const material = standard(colors[index], { roughness: 0.78 });
    const block = new Mesh(blockGeometry, material);
    block.position.set(x, y, -0.18);
    block.rotation.z = rotation;
    const edges = new LineSegments(
      new EdgesGeometry(blockGeometry),
      new LineBasicMaterial({ color: WOOD_DARK }),
    );
    block.add(edges);
    blocks.add(block);
  });
  const cap = new Mesh(
    new CylinderGeometry(0.72, 0.72, 0.38, 18),
    standard(0x7aa3a7, { roughness: 0.32, metalness: 0.5 }),
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 1.7, -0.1);
  root.add(blocks, cap, core);
  root.userData.blocks = blocks;
  return registerModel(root, 'block-golem', core);
}

function createSpillBase(radius: number) {
  const group = new Group();
  const lobes = [
    [-0.6, 0.1, 1.05, 0.7],
    [0.55, 0.25, 0.9, 1.1],
    [0, -0.45, 1.25, 0.74],
  ] as const;
  for (const [x, y, sx, sy] of lobes) {
    const material = remember(standard(GLUE_BLACK, {
      roughness: 0.18,
      metalness: 0.12,
      emissive: GLUE_RIM,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.94,
    }));
    const lobe = new Mesh(glueLobeGeometry, material);
    lobe.position.set(x * radius, y * radius, -0.4);
    lobe.scale.set(radius * sx, radius * sy, radius * 0.28);
    group.add(lobe);
  }
  return group;
}

function createRulerCore() {
  const root = new Group();
  const spill = createSpillBase(1.42);
  const core = createGlueCore(1.1);
  const rulers = new Group();
  for (let index = 0; index < 4; index += 1) {
    const ruler = new Mesh(rulerGeometry, standard(index % 2 ? YELLOW : WOOD_LIGHT, { roughness: 0.7 }));
    ruler.rotation.z = index * Math.PI / 2 + 0.34;
    ruler.position.z = -0.18;
    rulers.add(ruler);
    for (let tick = -4; tick <= 4; tick += 1) {
      const mark = new Mesh(new BoxGeometry(tick % 2 === 0 ? 0.25 : 0.16, 0.025, 0.035), new MeshBasicMaterial({ color: GRAPHITE }));
      mark.position.set(0.12, tick * 0.45, 0.1);
      ruler.add(mark);
    }
  }
  root.add(spill, rulers, core);
  root.userData.shellParts = rulers;
  return registerModel(root, 'spill-ruler-core', core);
}

function createJarCore() {
  const root = new Group();
  const spill = createSpillBase(1.45);
  const core = createGlueCore(1.12);
  const jars = new Group();
  for (const side of [-1, 1]) {
    const glassMaterial = standard(side < 0 ? CYAN : MINT, {
      roughness: 0.16,
      metalness: 0.05,
      transparent: true,
      opacity: 0.42,
    });
    const jar = new Mesh(new CylinderGeometry(0.7, 0.82, 1.65, 16), glassMaterial);
    jar.rotation.x = Math.PI / 2;
    jar.rotation.z = side * 0.5;
    jar.position.set(side * 1.28, 0.2, -0.08);
    const lid = new Mesh(new CylinderGeometry(0.72, 0.72, 0.22, 16), standard(0x93a3a2, { roughness: 0.3, metalness: 0.55 }));
    lid.rotation.x = Math.PI / 2;
    lid.position.set(side * 1.72, side * 0.5, 0.05);
    jars.add(jar, lid);
  }
  root.add(spill, jars, core);
  root.userData.shellParts = jars;
  return registerModel(root, 'spill-jar-core', core);
}

function createCardCore() {
  const root = new Group();
  const spill = createSpillBase(1.55);
  const core = createGlueCore(1.15);
  const cards = new Group();
  const colors = [CARDBOARD, PAPER, BLUE, CORAL];
  for (let index = 0; index < 6; index += 1) {
    const card = new Mesh(new BoxGeometry(1.5, 2.5, 0.13), standard(colors[index % colors.length], { roughness: 0.86 }));
    const angle = index / 6 * Math.PI * 2;
    card.position.set(Math.cos(angle) * 1.5, Math.sin(angle) * 1.35, -0.18);
    card.rotation.z = angle + 0.35;
    cards.add(card);
  }
  const clips = new Group();
  for (const side of [-1, 1]) {
    const clip = createClothespin(side < 0 ? 1 : 5, 0.6);
    clip.position.set(side * 1.75, 0.7, 0.18);
    clip.rotation.z = side * 0.7;
    clips.add(clip);
  }
  root.add(spill, cards, clips, core);
  root.userData.shellParts = cards;
  return registerModel(root, 'spill-card-core', core);
}

function createSpillHeart() {
  const root = new Group();
  const spill = createSpillBase(1.9);
  const core = createGlueCore(1.38);
  const cage = new Group();
  for (let index = 0; index < 8; index += 1) {
    const pencil = createPencil(index, 3.7);
    const angle = index / 8 * Math.PI * 2;
    pencil.position.set(Math.cos(angle) * 1.75, Math.sin(angle) * 1.75, -0.3);
    pencil.rotation.z = angle - Math.PI / 2;
    cage.add(pencil);
  }
  const rings = new Group();
  for (let index = 0; index < 3; index += 1) {
    const ring = new Mesh(
      new TorusGeometry(1.45 + index * 0.32, 0.07, 8, 36),
      standard(SUPPLY_COLORS[(index + 2) % SUPPLY_COLORS.length], {
        roughness: 0.4,
        emissive: SUPPLY_COLORS[(index + 2) % SUPPLY_COLORS.length],
        emissiveIntensity: 0.15,
      }),
    );
    ring.rotation.z = index * 0.3;
    rings.add(ring);
  }
  root.add(spill, cage, rings, core);
  root.userData.shellParts = cage;
  root.userData.rings = rings;
  return registerModel(root, 'spill-heart', core);
}

function createLetterMesh(character: string) {
  const root = new Group();
  const cardMaterial = standard(PAPER, { roughness: 0.92 });
  const card = new Mesh(new BoxGeometry(2.75, 3.55, 0.14), cardMaterial);
  card.position.z = -0.13;
  const edge = new LineSegments(
    new EdgesGeometry(card.geometry),
    new LineBasicMaterial({ color: WOOD_DARK }),
  );
  card.add(edge);
  const cells = glyphOnCells(character);
  const cellMaterials: MeshStandardMaterial[] = [];
  for (const [index, cell] of cells.entries()) {
    const material = remember(standard(SUPPLY_COLORS[index % SUPPLY_COLORS.length], {
      roughness: 0.38,
      emissive: SUPPLY_COLORS[index % SUPPLY_COLORS.length],
      emissiveIntensity: 0.06,
    }));
    cellMaterials.push(material);
    const bead = new Mesh(beadGeometry, material);
    bead.position.set((cell.x - 2) * 0.45, (3 - cell.y) * 0.45, 0.14);
    bead.scale.set(1, 1, 0.5);
    root.add(bead);
  }
  const thread = new Mesh(
    new TorusGeometry(1.82, 0.045, 6, 36),
    standard(CORAL, { roughness: 0.85 }),
  );
  thread.scale.set(0.74, 1, 1);
  thread.position.z = 0.02;
  root.add(card, thread);
  root.userData.kind = 'letter';
  root.userData.isLetter = true;
  root.userData.letterMaterials = cellMaterials;
  root.userData.targetScale = 1;
  root.userData.locked = false;
  return root;
}

export function createTinkerEnemyModel(kind: string, letter?: string) {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'spill-controller': {
      const controller = new Group();
      controller.userData.kind = kind;
      controller.userData.targetScale = 0.001;
      return controller;
    }
    case 'button-beetle':
      return createButtonBeetle();
    case 'pencil-walker':
      return createPencilWalker();
    case 'clothespin-bird':
      return createClothespinBird();
    case 'spool-crab':
      return createSpoolCrab();
    case 'block-golem':
      return createBlockGolem();
    case 'spill-ruler-core':
      return createRulerCore();
    case 'spill-jar-core':
      return createJarCore();
    case 'spill-card-core':
      return createCardCore();
    case 'spill-heart':
      return createSpillHeart();
    default:
      return createButtonBeetle();
  }
}

export function setTinkerModelLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.locked = locked;
  const coreMaterials = mesh.userData.coreMaterials as MeshStandardMaterial[] | undefined;
  if (coreMaterials) {
    for (const material of coreMaterials) {
      const baseColor = material.userData.baseColor as import('three').Color;
      const baseEmissive = material.userData.baseEmissive as import('three').Color;
      material.color.copy(locked ? CREAM : baseColor);
      material.emissive.copy(locked ? SUPPLY_COLORS[lockCount % SUPPLY_COLORS.length] : baseEmissive);
      material.emissiveIntensity = locked ? 0.85 : material.userData.baseEmissiveIntensity as number;
    }
  }
  const letterMaterials = mesh.userData.letterMaterials as MeshStandardMaterial[] | undefined;
  if (letterMaterials) {
    for (const material of letterMaterials) {
      const baseColor = material.userData.baseColor as import('three').Color;
      material.color.copy(locked ? CREAM : baseColor);
      material.emissive.copy(locked ? CYAN : baseColor);
      material.emissiveIntensity = locked ? 0.65 : 0.06;
    }
  }
}

export function animateTinkerEnemyModel(mesh: Group, elapsed: number, dt: number) {
  const phase = (mesh.userData.motionPhase as number | undefined) ?? elapsed;
  const wings = mesh.userData.wings as Group | undefined;
  if (wings) {
    const children = wings.children;
    if (children[0]) children[0].rotation.z = Math.sin(phase * 6.2) * 0.46;
    if (children[1]) children[1].rotation.z = -Math.sin(phase * 6.2) * 0.46;
  }
  const legs = mesh.userData.animatedLegs as Group | undefined;
  if (legs) {
    legs.children.forEach((leg, index) => {
      leg.rotation.z += Math.sin(phase * 5 + index * Math.PI / 2) * dt * 1.8;
    });
  }
  const spool = mesh.userData.spool as Mesh | undefined;
  if (spool) spool.rotation.z += dt * 2.8;
  const claws = mesh.userData.claws as Group | undefined;
  if (claws) claws.rotation.z = Math.sin(phase * 4.1) * 0.11;
  const blocks = mesh.userData.blocks as Group | undefined;
  if (blocks) blocks.rotation.z = Math.sin(phase * 2.2) * 0.06;
  const shell = mesh.userData.shellParts as Group | undefined;
  if (shell) shell.rotation.z += dt * (mesh.userData.activeCore === false ? 0.12 : 0.42);
  const rings = mesh.userData.rings as Group | undefined;
  if (rings) {
    rings.children.forEach((ring, index) => {
      ring.rotation.z += dt * (index % 2 ? -0.7 : 0.9);
    });
  }
}

export function createTinkerProjectileModel() {
  const root = new Group();
  const bead = new Mesh(
    new OctahedronGeometry(0.28, 0),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  const halo = new Mesh(
    new RingGeometry(0.3, 0.39, 12),
    new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }),
  );
  const pin = new Mesh(
    new CylinderGeometry(0.045, 0.045, 1.25, 7),
    new MeshBasicMaterial({ color: YELLOW }),
  );
  pin.rotation.x = Math.PI / 2;
  pin.position.z = 0.45;
  root.add(bead, halo, pin);
  return root;
}

export function createSupplyPiece(kind: string, index: number): Object3D {
  const choice = index % 4;
  if (kind.includes('ruler') || (kind === 'pencil-walker' && choice < 2)) {
    const pencil = new Group();
    const shaft = new Mesh(
      supplyPencilGeometry,
      standard(SUPPLY_COLORS[index % SUPPLY_COLORS.length], { roughness: 0.72 }),
    );
    const tip = new Mesh(supplyTipGeometry, standard(PAPER, { roughness: 0.86 }));
    tip.position.y = 0.88;
    pencil.add(shaft, tip);
    pencil.scale.setScalar(kind.includes('ruler') ? 0.58 : 0.42);
    return pencil;
  }
  if (kind.includes('jar') || kind === 'spool-crab') {
    const spool = new Group();
    const body = new Mesh(spoolGeometry, standard(SUPPLY_COLORS[index % SUPPLY_COLORS.length], { roughness: 0.65 }));
    body.rotation.x = Math.PI / 2;
    const rim = new Mesh(spoolRimGeometry, standard(CREAM, { roughness: 0.72 }));
    rim.position.z = 0.4;
    spool.add(body, rim);
    spool.scale.setScalar(kind.includes('jar') ? 0.42 : 0.28);
    return spool;
  }
  if (kind.includes('card') || kind === 'clothespin-bird') {
    const card = new Mesh(
      supplyCardGeometry,
      standard(choice % 2 === 0 ? CARDBOARD : PAPER, { roughness: 0.9 }),
    );
    card.rotation.z = (index % 3 - 1) * 0.22;
    return card;
  }
  if (kind === 'block-golem' || kind === 'spill-heart') {
    const block = new Mesh(blockGeometry, standard(SUPPLY_COLORS[index % SUPPLY_COLORS.length], { roughness: 0.8 }));
    block.scale.setScalar(kind === 'spill-heart' ? 0.48 : 0.34);
    return block;
  }
  if (choice === 3) {
    const clip = new Mesh(
      supplyClipGeometry,
      standard(0xbac5c3, { roughness: 0.26, metalness: 0.72 }),
    );
    clip.scale.set(1, 1.65, 1);
    return clip;
  }
  const button = createButton(index, 0.34);
  button.scale.setScalar(0.65);
  return button;
}

export function tintModelForDamage(mesh: Object3D, amount: number) {
  const coreMaterials = mesh.userData.coreMaterials as MeshStandardMaterial[] | undefined;
  if (!coreMaterials) return;
  for (const material of coreMaterials) {
    const baseColor = material.userData.baseColor as import('three').Color;
    material.color.copy(baseColor).lerp(CREAM, amount);
    material.emissive.copy(CORAL);
    material.emissiveIntensity = 0.2 + amount * 1.2;
  }
}

export function restoreModelMaterials(mesh: Object3D) {
  if (mesh.userData.locked === true) return;
  const coreMaterials = mesh.userData.coreMaterials as MeshStandardMaterial[] | undefined;
  if (coreMaterials) {
    for (const material of coreMaterials) {
      material.color.copy(material.userData.baseColor);
      material.emissive.copy(material.userData.baseEmissive);
      material.emissiveIntensity = material.userData.baseEmissiveIntensity as number;
    }
  }
}

export function collectModelMaterials(root: Object3D) {
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) materials.add(material);
  });
  return materials;
}
