import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
  Color,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  AMBER,
  BEAD_BLUE,
  BRASS,
  BUTTON_RED,
  BUTTON_TEAL,
  BUTTON_YELLOW,
  CARDBOARD,
  CORE_WHITE,
  CREAM,
  ERASER_PINK,
  GLUE_DARK,
  GLUE_VIOLET,
  hdr,
  PENCIL,
  SUPPLY_COLORS,
  WOOD,
  WOOD_DARK,
} from './palette';

// Glue-monster construction kit. Every monster wears the same visible black
// adhesive core (a near-black sphere with a violet additive shell and one
// hot amber glint); the stolen supplies around it give each kind its
// silhouette: button bodies with pencil legs (beetles), cardboard wings
// with a clothespin beak (birds), ruler bodies marching on pencils
// (stilters), and bare glue blobs with supplies trapped inside.

export type ShardSpec = { direction: Vector3; color: Color; size: number };

const mat = (color: Color) => new MeshBasicMaterial({ color: color.clone() });
const glowMat = (color: Color, opacity: number) =>
  createAdditiveBasicMaterial({ color, opacity });

const sphereGeo = new SphereGeometry(1, 14, 10);
const boxGeo = new BoxGeometry(1, 1, 1);
const cylGeo = new CylinderGeometry(1, 1, 1, 12);

function mesh(geo: BufferGeometry, material: MeshBasicMaterial, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const m = new Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

/** The visible black adhesive core every monster is built around. */
export function makeGlueCore(radius: number): Group {
  const group = new Group();
  const dark = mesh(sphereGeo, mat(GLUE_DARK), radius, radius, radius);
  const shell = mesh(
    sphereGeo,
    glowMat(hdr(GLUE_VIOLET, 1.1), 0.4),
    radius * 1.18,
    radius * 1.18,
    radius * 1.18,
  );
  const glint = mesh(sphereGeo, new MeshBasicMaterial({ color: hdr(AMBER, 1.4) }), radius * 0.16, radius * 0.16, radius * 0.16, radius * 0.35, radius * 0.4, radius * 0.75);
  group.add(dark, shell, glint);
  group.userData.coreShell = shell;
  group.userData.coreGlint = glint;
  return group;
}

function shardSpecsFor(parts: Array<{ color: Color; size: number }>): ShardSpec[] {
  return parts.map((part, index) => {
    const angle = (index / Math.max(1, parts.length)) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle) * 0.7, 0.6).normalize(),
      color: part.color.clone(),
      size: part.size,
    };
  });
}

function tag(group: Group, kind: string, accent: Color, lockRingScale: number, shards: ShardSpec[]) {
  group.userData.kind = kind;
  group.userData.accent = accent.clone();
  group.userData.lockRingScale = lockRingScale;
  group.userData.shardSpecs = shards;
  return group;
}

let supplyCursor = 0;
function nextSupplyColor(): Color {
  supplyCursor += 1;
  return SUPPLY_COLORS[supplyCursor % SUPPLY_COLORS.length].clone();
}

// --- Button/spool beetle ----------------------------------------------------
export function createBeetleMesh(): Group {
  const group = new Group();
  const bodyColor = nextSupplyColor();

  // Button body: squat cylinder with pin-holes.
  const body = mesh(cylGeo, mat(bodyColor), 1.05, 0.42, 1.05, 0, 0, 0);
  const rim = mesh(new TorusGeometry(1.02, 0.09, 8, 24), mat(WOOD_DARK), 1, 1, 1, 0, 0, 0);
  rim.rotation.x = Math.PI / 2;
  group.add(body, rim);
  for (const [hx, hz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.25], [0.3, 0.25]] as const) {
    group.add(mesh(cylGeo, mat(WOOD_DARK), 0.07, 0.46, 0.07, hx, 0, hz));
  }

  // Spool thorax + thread windings.
  const spool = mesh(cylGeo, mat(WOOD), 0.42, 0.5, 0.42, 0, 0.1, 0.95);
  const thread = mesh(cylGeo, mat(BUTTON_TEAL), 0.46, 0.3, 0.46, 0, 0.1, 0.95);
  const beadHead = mesh(sphereGeo, mat(BUTTON_RED), 0.3, 0.3, 0.3, 0, 0.15, 1.5);
  group.add(spool, thread, beadHead);

  // Six pencil legs.
  for (let side = -1; side <= 1; side += 2) {
    for (let leg = 0; leg < 3; leg += 1) {
      const t = (leg - 1) * 0.55;
      const limb = mesh(boxGeo, mat(PENCIL), 0.12, 0.12, 1.15, side * 1.15, -0.32, t);
      limb.rotation.y = side * (0.5 + leg * 0.12);
      limb.rotation.z = side * -0.35;
      group.add(limb);
    }
  }

  // The stolen-look core riding its back.
  const core = makeGlueCore(0.48);
  core.position.set(0, 0.62, -0.25);
  group.add(core);

  // Pin antennae with bead tips.
  for (const side of [-1, 1] as const) {
    const pin = mesh(cylGeo, mat(CREAM), 0.035, 0.035, 0.8, side * 0.25, 0.5, 1.7);
    pin.rotation.x = 1.1;
    pin.rotation.z = side * -0.3;
    const tip = mesh(sphereGeo, mat(BEAD_BLUE), 0.09, 0.09, 0.09, side * 0.38, 0.72, 2.0);
    group.add(pin, tip);
  }

  return tag(group, 'beetle', bodyColor, 1.15, shardSpecsFor([
    { color: bodyColor, size: 0.4 },
    { color: PENCIL, size: 0.3 },
    { color: BUTTON_TEAL, size: 0.3 },
    { color: GLUE_DARK, size: 0.34 },
  ]));
}

// --- Cardboard/clothespin bird -----------------------------------------------
export function createBirdMesh(): Group {
  const group = new Group();
  const wingColor = nextSupplyColor();

  // Folded-cardboard body.
  const body = mesh(boxGeo, mat(CARDBOARD), 0.7, 0.7, 1.7, 0, 0, 0);
  body.rotation.x = 0.15;
  const keel = mesh(boxGeo, mat(WOOD_DARK), 0.16, 0.5, 1.4, 0, -0.5, 0);
  group.add(body, keel);

  // Flapping wings on pivot groups (gameplay drives userData.wings).
  const wings: Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new Group();
    pivot.position.set(side * 0.35, 0.25, 0.1);
    const wing = mesh(boxGeo, mat(wingColor), 1.7, 0.08, 1.0, side * 0.95, 0, 0);
    const tip = mesh(boxGeo, mat(CARDBOARD), 0.7, 0.09, 0.7, side * 1.9, 0, 0);
    pivot.add(wing, tip);
    group.add(pivot);
    wings.push(pivot);
  }
  group.userData.wings = wings;

  // Clothespin beak: two snapping jaws.
  const jawTop = mesh(boxGeo, mat(AMBER), 0.3, 0.14, 0.8, 0, 0.22, 1.15);
  const jawBottom = mesh(boxGeo, mat(WOOD), 0.3, 0.14, 0.8, 0, -0.12, 1.15);
  const spring = mesh(new TorusGeometry(0.16, 0.05, 6, 12), mat(BRASS), 1, 1, 1, 0, 0.05, 0.85);
  group.add(jawTop, jawBottom, spring);

  // Paper tail fan.
  for (let i = -1; i <= 1; i += 1) {
    const feather = mesh(boxGeo, mat(CREAM), 0.28, 0.06, 0.9, i * 0.3, 0.1, -1.2);
    feather.rotation.y = i * 0.35;
    group.add(feather);
  }

  // Belly core + button eyes.
  const core = makeGlueCore(0.42);
  core.position.set(0, -0.35, 0.45);
  group.add(core);
  for (const side of [-1, 1] as const) {
    group.add(mesh(sphereGeo, mat(BEAD_BLUE), 0.13, 0.13, 0.13, side * 0.3, 0.35, 0.75));
  }

  return tag(group, 'bird', wingColor, 1.25, shardSpecsFor([
    { color: CARDBOARD, size: 0.4 },
    { color: wingColor, size: 0.36 },
    { color: AMBER, size: 0.28 },
    { color: GLUE_DARK, size: 0.32 },
  ]));
}

// --- Ruler/pencil stilter ----------------------------------------------------
export function createStilterMesh(): Group {
  const group = new Group();

  // Long ruler body with tick marks.
  const ruler = mesh(boxGeo, mat(WOOD), 2.9, 0.5, 0.16, 0, 0.9, 0);
  group.add(ruler);
  for (let i = 0; i < 7; i += 1) {
    group.add(mesh(boxGeo, mat(WOOD_DARK), 0.06, 0.2, 0.18, -1.2 + i * 0.4, 1.05, 0));
  }

  // Eraser head + pencil legs.
  group.add(mesh(boxGeo, mat(ERASER_PINK), 0.55, 0.55, 0.4, 1.65, 0.9, 0));
  group.add(mesh(boxGeo, mat(CREAM), 0.18, 0.5, 0.3, 1.32, 0.9, 0));
  for (const side of [-1, 1] as const) {
    for (const lx of [-0.9, 0.9]) {
      const leg = mesh(cylGeo, mat(PENCIL), 0.09, 1.9, 0.09, lx + side * 0.12, -0.15, side * 0.25);
      leg.rotation.z = side * 0.14;
      const foot = mesh(boxGeo, mat(BUTTON_RED), 0.3, 0.14, 0.4, lx + side * 0.26, -1.1, side * 0.25);
      group.add(leg, foot);
    }
  }

  // Core slung under the ruler like a stolen engine.
  const core = makeGlueCore(0.55);
  core.position.set(0, 0.15, 0);
  group.add(core);

  // Paperclip arms.
  for (const side of [-1, 1] as const) {
    const arm = mesh(new TorusGeometry(0.3, 0.05, 6, 14), mat(CREAM), 1, 1, 1, side * 1.55, 0.4, 0);
    group.add(arm);
  }

  return tag(group, 'stilter', WOOD.clone(), 1.35, shardSpecsFor([
    { color: WOOD, size: 0.42 },
    { color: PENCIL, size: 0.3 },
    { color: ERASER_PINK, size: 0.3 },
    { color: GLUE_DARK, size: 0.34 },
  ]));
}

// --- Bare glue blob with trapped supplies ------------------------------------
export function createBlobMesh(): Group {
  const group = new Group();
  const trapped = nextSupplyColor();

  const body = mesh(sphereGeo, mat(GLUE_DARK), 0.85, 0.76, 0.85);
  const shell = mesh(sphereGeo, glowMat(hdr(GLUE_VIOLET, 1.2), 0.45), 1.0, 0.9, 1.0);
  group.add(body, shell);
  group.userData.jiggle = body;

  // Supplies half-swallowed: a button, a bead, a paperclip.
  group.add(mesh(cylGeo, mat(trapped), 0.4, 0.16, 0.4, 0.55, 0.45, 0.35));
  group.add(mesh(sphereGeo, mat(BUTTON_YELLOW), 0.2, 0.2, 0.2, -0.5, 0.3, 0.5));
  const clip = mesh(new TorusGeometry(0.28, 0.05, 6, 14), mat(CREAM), 1, 1, 1, 0.1, -0.5, 0.6);
  group.add(clip);

  const glint = mesh(sphereGeo, new MeshBasicMaterial({ color: hdr(AMBER, 1.4) }), 0.12, 0.12, 0.12, 0.3, 0.5, 0.75);
  group.add(glint);

  return tag(group, 'blob', GLUE_VIOLET.clone(), 0.95, shardSpecsFor([
    { color: GLUE_DARK, size: 0.4 },
    { color: trapped, size: 0.3 },
    { color: BUTTON_YELLOW, size: 0.26 },
  ]));
}

// --- Spill core: the boss -----------------------------------------------------
export function createBossCoreMesh(): Group {
  const group = new Group();

  // A heavy glue mound.
  const mound = mesh(sphereGeo, mat(GLUE_DARK), 1.35, 1.05, 1.35, 0, -0.25, 0);
  const sheen = mesh(sphereGeo, glowMat(hdr(GLUE_VIOLET, 1.4), 0.5), 1.48, 1.15, 1.48, 0, -0.25, 0);
  const heart = makeGlueCore(0.68);
  heart.position.set(0, 0.5, 0.72);
  group.add(mound, sheen, heart);

  // Recycled-material shell: jars, rulers, cardboard. Non-lethal hits knock
  // these off one by one (see userData.shellPieces).
  const shell = new Group();
  const jarGlass = mat(BEAD_BLUE);
  const jar = mesh(cylGeo, jarGlass, 0.65, 0.9, 0.65, -1.35, 0.4, 0.15);
  const jarLid = mesh(cylGeo, mat(BUTTON_RED), 0.7, 0.18, 0.7, -1.35, 0.9, 0.15);
  const rulerBar = mesh(boxGeo, mat(WOOD), 2.1, 0.25, 0.12, 1.2, -0.15, 0.7);
  rulerBar.rotation.z = 0.5;
  rulerBar.rotation.y = 0.4;
  const cardA = mesh(boxGeo, mat(CARDBOARD), 1.3, 1.0, 0.09, 0.3, 1.2, -0.95);
  cardA.rotation.x = -0.4;
  const cardB = mesh(boxGeo, mat(CARDBOARD), 1.05, 0.85, 0.09, 1.1, 0.8, -0.5);
  cardB.rotation.y = 0.7;
  const spoolCap = mesh(cylGeo, mat(BUTTON_YELLOW), 0.4, 0.32, 0.4, -0.4, 1.05, 0.5);
  shell.add(jar, jarLid, rulerBar, cardA, cardB, spoolCap);
  group.add(shell);
  group.userData.shellPieces = [jar, jarLid, rulerBar, cardA, cardB, spoolCap];
  group.userData.jiggle = mound;

  // Hot crack veins that brighten as the core takes damage.
  const veinMaterial = new MeshBasicMaterial({ color: hdr(AMBER, 0.7) });
  const vein = mesh(new TorusGeometry(0.95, 0.04, 6, 20), veinMaterial, 1, 1, 1, 0, 0.1, 0.32);
  vein.rotation.x = 1.1;
  group.add(vein);
  group.userData.veinMaterial = veinMaterial;

  return tag(group, 'boss-core', GLUE_VIOLET.clone(), 1.6, shardSpecsFor([
    { color: GLUE_DARK, size: 0.6 },
    { color: CARDBOARD, size: 0.45 },
    { color: WOOD, size: 0.4 },
    { color: BEAD_BLUE, size: 0.36 },
    { color: BUTTON_RED, size: 0.34 },
  ]));
}

// --- Shared small geometries for debris ---------------------------------------
export const debrisGeometries = {
  box: new BoxGeometry(0.3, 0.22, 0.26),
  tetra: new TetrahedronGeometry(0.24),
  octa: new OctahedronGeometry(0.2),
  button: new CylinderGeometry(0.2, 0.22, 0.09, 10),
};

export function debrisGeometryFor(kind: string) {
  if (kind === 'beetle') return debrisGeometries.button;
  if (kind === 'bird') return debrisGeometries.box;
  if (kind === 'stilter') return debrisGeometries.box;
  if (kind === 'boss-core') return debrisGeometries.octa;
  return debrisGeometries.tetra;
}

// --- Player ball ---------------------------------------------------------------
export function createPlayerBall(): Group {
  const group = new Group();
  const skin = new MeshBasicMaterial({ color: new Color(0.55, 0.47, 0.35) });
  const ball = new Mesh(sphereGeo, skin);
  // Dark back-side outline so the ball reads against the bright table.
  const outline = new Mesh(sphereGeo, new MeshBasicMaterial({ color: new Color(0.12, 0.07, 0.04), side: BackSide }));
  outline.scale.setScalar(1.12);
  // Painted equator stripe: shows the roll.
  const stripe = new Mesh(new TorusGeometry(0.97, 0.07, 8, 32), mat(BUTTON_RED));
  stripe.rotation.x = Math.PI / 2;
  const stripe2 = new Mesh(new TorusGeometry(0.97, 0.05, 8, 32), mat(BUTTON_TEAL));
  stripe2.rotation.y = Math.PI / 2;
  const fuzz = new Mesh(sphereGeo, glowMat(hdr(AMBER, 0.5), 0.1));
  fuzz.scale.setScalar(1.12);
  group.add(ball, outline, stripe, stripe2, fuzz);
  group.userData.ballSkin = skin;
  group.userData.ballCore = ball;
  group.userData.stuckBits = [] as Group[];
  return group;
}

export function ballStuckBit(): Mesh {
  const colors = [BUTTON_RED, BUTTON_TEAL, BUTTON_YELLOW, BEAD_BLUE, PENCIL, CREAM];
  const pick = colors[(Math.random() * colors.length) | 0];
  const geos = [debrisGeometries.box, debrisGeometries.tetra, debrisGeometries.button];
  return new Mesh(geos[(Math.random() * geos.length) | 0], mat(pick));
}

export function createProjectileMeshInternal(): Group {
  const group = new Group();
  // A glue-busting pin: bead head, needle shaft, thread fletching.
  const head = mesh(sphereGeo, new MeshBasicMaterial({ color: hdr(BUTTON_RED, 1.6) }), 0.22, 0.22, 0.22);
  const shaft = mesh(cylGeo, new MeshBasicMaterial({ color: hdr(CORE_WHITE, 1.4) }), 0.05, 0.05, 0.9, 0, 0, -0.5);
  shaft.rotation.x = Math.PI / 2;
  const fluff = mesh(sphereGeo, glowMat(hdr(AMBER, 1.2), 0.5), 0.3, 0.3, 0.3, 0, 0, -0.3);
  group.add(head, shaft, fluff);
  return group;
}

export function createReticleMesh(): Group {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const add = (m: Mesh, base: Color, active: Color) => {
    const material = m.material as MeshBasicMaterial;
    material.color.copy(base);
    material.transparent = true;
    material.opacity = 0.95;
    parts.push({ material, base: base.clone(), active: active.clone() });
  };

  // Brass sight ring + pencil ticks + pin-head dot.
  const outer = new Mesh(new TorusGeometry(0.62, 0.035, 8, 48), new MeshBasicMaterial());
  add(outer, hdr(BRASS, 1.2), hdr(BUTTON_RED, 1.9));

  const spinner = new Group();
  const triangle = new Mesh(new TorusGeometry(0.34, 0.025, 6, 3), new MeshBasicMaterial());
  add(triangle, hdr(CREAM, 1.0), hdr(CORE_WHITE, 1.8));
  spinner.add(triangle);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(boxGeo, new MeshBasicMaterial());
    tick.scale.set(0.2, 0.045, 0.01);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle + Math.PI / 2;
    add(tick, hdr(BRASS, 1.4), hdr(BUTTON_RED, 2.2));
    brackets.add(tick);
  }

  const dot = new Mesh(sphereGeo, new MeshBasicMaterial());
  dot.scale.setScalar(0.055);
  add(dot, hdr(BUTTON_RED, 1.8), hdr(CORE_WHITE, 2.6));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}
