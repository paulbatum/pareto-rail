import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  type Side,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import {
  CLOUD_GREY,
  GRAPHITE,
  HAZARD_ORANGE,
  PANEL_SHADE,
  PANEL_WHITE,
  RAIN_GREY,
  STEEL,
  WINDOW_BLUE,
  hdr,
} from './palette';

export type SkyhookTintPart = {
  material: MeshBasicMaterial;
  base: Color;
  role: 'panel' | 'edge' | 'hot' | 'dark';
};

const box = new BoxGeometry(1, 1, 1);
const hubCylinder = new CylinderGeometry(0.72, 0.72, 1.15, 10);
const smallCylinder = new CylinderGeometry(0.22, 0.22, 1, 8);
const cone = new ConeGeometry(0.55, 1.6, 7);
const octa = new OctahedronGeometry(0.72, 0);
const sphere = new SphereGeometry(0.7, 10, 7);
const thinRing = new TorusGeometry(1, 0.08, 5, 28);
const letterCell = new BoxGeometry(0.23, 0.23, 0.09);

const kiteWing = new BufferGeometry();
kiteWing.setAttribute('position', new Float32BufferAttribute([
  0, 0, 0,
  3.8, 0.35, -0.15,
  1.15, 1.85, 0.08,
  0, 0, 0,
  1.15, -1.85, 0.08,
  3.8, -0.35, -0.15,
], 3));
kiteWing.computeVertexNormals();

function basic(color: Color, options: { opacity?: number; side?: Side; depthWrite?: boolean } = {}) {
  return new MeshBasicMaterial({
    color: color.clone(),
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? DoubleSide,
    depthWrite: options.depthWrite ?? true,
  });
}

function addPart(
  root: Group,
  geometry: BufferGeometry,
  base: Color,
  role: SkyhookTintPart['role'],
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const material = basic(base);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  root.add(mesh);
  (root.userData.tintParts as SkyhookTintPart[]).push({ material, base: base.clone(), role });
  return mesh;
}

function enemyRoot(kind: string) {
  const root = new Group();
  root.userData.kind = kind;
  root.userData.tintParts = [] as SkyhookTintPart[];
  root.userData.lockScale = 1;
  return root;
}

export function createGustwingMesh() {
  const root = enemyRoot('gustwing');
  const left = addPart(root, kiteWing, RAIN_GREY, 'panel', [0, 0, 0], [1, 1, 1]);
  const right = addPart(root, kiteWing, CLOUD_GREY, 'panel', [0, 0, 0], [-1, 1, 1]);
  const spine = addPart(root, hubCylinder, GRAPHITE, 'dark', [0, 0, 0.25], [0.55, 1.2, 0.55], [Math.PI / 2, 0, 0]);
  const rotor = new Group();
  for (let index = 0; index < 4; index += 1) {
    const blade = addPart(root, box, PANEL_WHITE, 'edge', [0, 0, 0], [0.09, 1.25, 0.08]);
    root.remove(blade);
    blade.rotation.z = index * Math.PI / 2;
    rotor.add(blade);
  }
  rotor.position.z = -0.52;
  root.add(rotor);
  addPart(root, sphere, HAZARD_ORANGE, 'hot', [0, 0, -0.62], [0.28, 0.28, 0.28]);
  root.userData.rotors = [rotor];
  root.userData.flexParts = [left, right];
  root.userData.spine = spine;
  root.userData.lockScale = 2.6;
  return root;
}

export function createSkimmerMesh() {
  const root = enemyRoot('skimmer');
  addPart(root, octa, PANEL_WHITE, 'panel', [0, 0, 0], [0.75, 0.58, 1.15]);
  addPart(root, box, GRAPHITE, 'dark', [-2.4, 0, 0], [3.25, 0.12, 1.05]);
  addPart(root, box, GRAPHITE, 'dark', [2.4, 0, 0], [3.25, 0.12, 1.05]);
  for (const side of [-1, 1]) {
    for (let cell = 0; cell < 3; cell += 1) {
      addPart(root, box, WINDOW_BLUE, 'panel', [side * (1.35 + cell * 0.92), 0, -0.03], [0.76, 0.16, 0.78]);
    }
    addPart(root, box, PANEL_WHITE, 'edge', [side * 2.3, 0, 0.83], [3.05, 0.08, 0.08]);
    addPart(root, box, PANEL_WHITE, 'edge', [side * 2.3, 0, -0.83], [3.05, 0.08, 0.08]);
  }
  const antenna = addPart(root, smallCylinder, STEEL, 'edge', [0, 1.0, 0], [1, 1.3, 1]);
  antenna.rotation.z = 0.25;
  addPart(root, sphere, HAZARD_ORANGE, 'hot', [0.3, 1.58, 0], [0.18, 0.18, 0.18]);
  root.userData.lockScale = 2.6;
  return root;
}

export function createBoarderMesh() {
  const root = enemyRoot('boarder');
  addPart(root, hubCylinder, GRAPHITE, 'dark', [0, 0, 0], [0.9, 1.7, 0.9], [Math.PI / 2, 0, 0]);
  addPart(root, cone, PANEL_WHITE, 'panel', [0, 0, 1.0], [0.85, 0.85, 0.85], [Math.PI / 2, 0, 0]);
  const claws: Group[] = [];
  for (let index = 0; index < 4; index += 1) {
    const pivot = new Group();
    pivot.rotation.z = index * Math.PI / 2;
    const arm = addPart(root, box, PANEL_SHADE, 'panel', [0, 0, 0], [0.24, 1.6, 0.22]);
    root.remove(arm);
    arm.position.y = 1.2;
    arm.rotation.x = -0.42;
    const tip = addPart(root, cone, HAZARD_ORANGE, 'hot', [0, 0, 0], [0.38, 0.7, 0.38]);
    root.remove(tip);
    tip.position.set(0, 2.2, -0.48);
    tip.rotation.x = Math.PI;
    pivot.add(arm, tip);
    root.add(pivot);
    claws.push(pivot);
  }
  addPart(root, new RingGeometry(0.55, 0.78, 12), HAZARD_ORANGE, 'hot', [0, 0, -0.92], [1, 1, 1]);
  root.userData.claws = claws;
  root.userData.lockScale = 2.2;
  return root;
}

export function createCrawlerMesh() {
  const root = enemyRoot('crawler');
  const cage = addPart(root, thinRing, STEEL, 'edge', [0, 0, 0], [1.25, 1.25, 1.25]);
  addPart(root, sphere, GRAPHITE, 'dark', [0, 0, 0], [0.75, 0.75, 0.55]);
  const legs: Group[] = [];
  for (let index = 0; index < 6; index += 1) {
    const pivot = new Group();
    pivot.rotation.z = index * Math.PI / 3;
    const leg = addPart(root, box, PANEL_SHADE, 'panel', [0, 0, 0], [0.18, 1.45, 0.16]);
    root.remove(leg);
    leg.position.y = 1.25;
    leg.rotation.x = index % 2 === 0 ? 0.34 : -0.34;
    const foot = addPart(root, box, HAZARD_ORANGE, 'hot', [0, 0, 0], [0.38, 0.45, 0.24]);
    root.remove(foot);
    foot.position.y = 2.02;
    pivot.add(leg, foot);
    root.add(pivot);
    legs.push(pivot);
  }
  addPart(root, sphere, HAZARD_ORANGE, 'hot', [0, 0, -0.7], [0.24, 0.24, 0.16]);
  root.userData.crawlerCage = cage;
  root.userData.legs = legs;
  root.userData.lockScale = 2.2;
  return root;
}

export function createBoltMesh() {
  const root = enemyRoot('bolt');
  addPart(root, cone, HAZARD_ORANGE, 'hot', [0, 0, 0], [0.34, 1.5, 0.34], [Math.PI / 2, 0, 0]);
  addPart(root, box, PANEL_WHITE, 'edge', [0, 0, 0.95], [0.06, 0.06, 2.0]);
  addPart(root, thinRing, PANEL_WHITE, 'edge', [0, 0, -0.25], [0.42, 0.42, 0.42]);
  root.userData.isHostileShot = true;
  root.userData.lockScale = 1.45;
  return root;
}

export function createReaverShellMesh() {
  const root = enemyRoot('reaver-shell');
  root.userData.isReaver = true;
  root.userData.lockScale = 5.3;
  const gears: Mesh[] = [];

  const outer = addPart(root, new TorusGeometry(4.1, 0.48, 7, 24), STEEL, 'edge', [0, 0, 0], [1, 1, 1]);
  const inner = addPart(root, new TorusGeometry(2.55, 0.22, 6, 18), PANEL_WHITE, 'edge', [0, 0, 0.15], [1, 1, 1]);
  gears.push(outer, inner);
  addPart(root, hubCylinder, GRAPHITE, 'dark', [0, 0, 0.35], [2.0, 1.8, 2.0], [Math.PI / 2, 0, 0]);
  addPart(root, sphere, HAZARD_ORANGE, 'hot', [0, 0, -0.9], [1.22, 1.22, 0.48]);

  const jaws: Group[] = [];
  for (const side of [-1, 1]) {
    const jaw = new Group();
    jaw.position.x = side * 4.6;
    const shoulder = addPart(root, box, PANEL_SHADE, 'panel', [0, 0, 0], [2.4, 0.72, 0.8]);
    root.remove(shoulder);
    shoulder.position.x = side * 0.45;
    const tooth = addPart(root, cone, HAZARD_ORANGE, 'hot', [0, 0, 0], [0.85, 1.25, 0.85]);
    root.remove(tooth);
    tooth.position.set(side * 1.7, -1.15, 0);
    tooth.rotation.z = side > 0 ? Math.PI * 0.72 : -Math.PI * 0.72;
    jaw.add(shoulder, tooth);
    root.add(jaw);
    jaws.push(jaw);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    addPart(
      root,
      box,
      index % 2 === 0 ? HAZARD_ORANGE : GRAPHITE,
      index % 2 === 0 ? 'hot' : 'dark',
      [Math.cos(angle) * 4.1, Math.sin(angle) * 4.1, -0.08],
      [0.58, 0.22, 0.2],
      [0, 0, angle],
    );
  }
  root.userData.gears = gears;
  root.userData.jaws = jaws;
  return root;
}

export function createReaverMesh() {
  const root = enemyRoot('reaver');
  root.userData.isReaverCore = true;
  root.userData.lockScale = 2.5;
  const outer = addPart(root, new TorusGeometry(1.62, 0.24, 6, 18), PANEL_WHITE, 'edge', [0, 0, 0], [1, 1, 1]);
  const inner = addPart(root, new TorusGeometry(1.04, 0.15, 5, 14), STEEL, 'edge', [0, 0, -0.08], [1, 1, 1]);
  addPart(root, hubCylinder, GRAPHITE, 'dark', [0, 0, 0.18], [0.92, 1.15, 0.92], [Math.PI / 2, 0, 0]);
  addPart(root, sphere, HAZARD_ORANGE, 'hot', [0, 0, -0.72], [0.72, 0.72, 0.34]);
  for (let index = 0; index < 3; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 3;
    addPart(
      root,
      box,
      index === 0 ? HAZARD_ORANGE : PANEL_SHADE,
      index === 0 ? 'hot' : 'panel',
      [Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0.1],
      [0.72, 0.22, 0.32],
      [0, 0, angle],
    );
  }
  root.userData.gears = [outer, inner];
  return root;
}

export function createClampMesh() {
  const root = enemyRoot('clamp');
  root.userData.lockScale = 2.15;
  addPart(root, box, PANEL_WHITE, 'panel', [0, 0, 0], [1.7, 0.8, 0.72]);
  addPart(root, hubCylinder, GRAPHITE, 'dark', [0, 0, 0], [0.7, 1.3, 0.7], [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) {
    addPart(root, cone, HAZARD_ORANGE, 'hot', [side * 1.45, -0.62, 0], [0.58, 1.0, 0.58], [0, 0, side * 0.78]);
  }
  addPart(root, new RingGeometry(0.44, 0.65, 10), HAZARD_ORANGE, 'hot', [0, 0, -0.73], [1, 1, 1]);
  return root;
}

export function createLetterMesh(character: string) {
  const root = enemyRoot('letter');
  root.userData.isLetter = true;
  root.userData.lockScale = 1.25;
  const cells = glyphOnCells(character);
  for (const cell of cells) {
    const block = addPart(
      root,
      letterCell,
      PANEL_WHITE,
      'panel',
      [(cell.x - 2) * 0.285, (3 - cell.y) * 0.285, 0],
      [1, 1, 1],
    );
    const inset = new Mesh(new PlaneGeometry(0.13, 0.13), basic(GRAPHITE));
    inset.position.z = -0.051;
    block.add(inset);
  }
  const top = addPart(root, box, GRAPHITE, 'dark', [0, 1.2, 0.08], [1.65, 0.07, 0.1]);
  const bottom = addPart(root, box, GRAPHITE, 'dark', [0, -1.2, 0.08], [1.65, 0.07, 0.1]);
  addPart(root, box, HAZARD_ORANGE, 'hot', [-0.72, 1.2, 0.09], [0.22, 0.13, 0.12]);
  addPart(root, box, HAZARD_ORANGE, 'hot', [0.72, -1.2, 0.09], [0.22, 0.13, 0.12]);
  root.userData.letterRails = [top, bottom];
  return root;
}

export function createPlayerProjectileMesh() {
  const root = new Group();
  const core = new Mesh(octa, basic(hdr(PANEL_WHITE, 1.25)));
  core.scale.set(0.22, 0.22, 1.15);
  const collar = new Mesh(new TorusGeometry(0.28, 0.045, 5, 12), basic(hdr(HAZARD_ORANGE, 1.35)));
  collar.position.z = 0.25;
  root.add(core, collar);
  return root;
}

export function createLockMarker(color: Color) {
  const root = new Group();
  const outer = new Mesh(new RingGeometry(0.88, 0.94, 8), basic(hdr(color, 1.25), { depthWrite: false }));
  const ticks = new Group();
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(box, basic(hdr(PANEL_WHITE, 1.1), { depthWrite: false }));
    tick.scale.set(0.3, 0.055, 0.04);
    const angle = index * Math.PI / 2;
    tick.position.set(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }
  root.add(outer, ticks);
  root.userData.outerMaterial = outer.material;
  root.userData.ticks = ticks;
  return root;
}
