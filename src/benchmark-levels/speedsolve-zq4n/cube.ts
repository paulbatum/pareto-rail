import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../engine/visual-kit';
import { mulberry32 } from '../../engine/rng';
import { GRAPHITE, HOT_WHITE, MACHINE_GREY, MACHINE_WHITE, SOLVE_COLORS, hdr } from './visuals/palette';
import { burstCubies, spawnRing } from './visuals/effects';

// THE CUBE
//
// Twenty-six graphite cubies around a core, fifty-four colored sticker plates,
// and one rule: the face pointed at the rail is the face being solved.
//
// This file is a model with a view bolted on, in that order. The lattice, the
// quarter turns, the layer twists, and every anchor a target hangs off are
// plain math over integer slots and quaternions — `buildCube` only attaches
// meshes to a model that already works without them. Gameplay drives the model
// every frame, which is also why the headless simulator sees the same fight a
// player does.
//
// Presentation is a stack of exact quarter turns applied in the *camera's*
// frame, so the cube tips toward you rather than away: three turns about
// screen-vertical walk the equator (+Z, +X, -Z, -X), one about screen-
// horizontal brings the top up, and a half turn drops the bottom in. Which
// stickers are on the front, which slab a twist grabs, and which way is "up"
// on the face are all derived from that stack rather than tabulated, so the
// geometry and the bookkeeping cannot drift apart.
//
// Twists always take the current face normal as their axis and only ever grab
// the front layer, the back layer, or both caps at once. Every one of those
// fixes the two center pieces on that axis and never touches the other four,
// so a conquered face's empty socket stays exactly where it was put and every
// face still to come arrives with all nine of its squares. A slice move would
// walk the sockets around the machine; it is the one move this cube cannot do.
//
// Which squares are gone is tracked per *face*, not per plate, for the same
// reason. A twist shuffles plates between the four side faces, so marking
// individual plates dead would eventually deal a dead plate onto a face that
// has not been fought yet. Conquered faces are simply faces the machine no
// longer skins.

// ---- dimensions --------------------------------------------------------------

export const CELL = 8;
export const CUBIE_SIZE = 7.4;
/** Where a sticker plate sits on its cubie, measured from the cubie's center. */
const STICKER_LIFT = CUBIE_SIZE / 2 + 0.28;
/** How far a solve pip floats off its sticker. Keeps pips clear of the shell. */
export const PIP_STANDOFF = 2.4;
export const MOVES_PER_FACE = 5;

const SOCKET_FLOOR = CELL + CUBIE_SIZE / 2 - 3.0;
const WEAK_RISE = 5.8;
const WEAK_ORBIT = 3.5;

type Slab = 'front' | 'back' | 'shell';
const SLAB_FRONT: Slab = 'front';
const SLAB_BACK: Slab = 'back';
const SLAB_SHELL: Slab = 'shell';

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;

// The cube never squares up perfectly with the rail: it holds a permanent
// twenty-two-degree yaw and a thirteen-degree tip, which is the difference
// between a nine-square poster and an object with corners. The presented face
// stays square enough to read; the two faces beside it do the work of saying
// "cube", and they are also where the player watches previous faces stay gone.
const DISPLAY_TILT = new Quaternion().setFromEuler(new Euler(0.235, -0.375, 0.03));

// Presentation deltas, pre-multiplied in the camera frame. See the note above.
const PRESENT_TURNS: Array<{ axis: Vector3; angle: number; beats: number }> = [
  { axis: AXIS_Y, angle: -HALF_PI, beats: 1 },
  { axis: AXIS_Y, angle: -HALF_PI, beats: 1 },
  { axis: AXIS_Y, angle: -HALF_PI, beats: 1 },
  { axis: AXIS_X, angle: HALF_PI, beats: 1 },
  { axis: AXIS_X, angle: Math.PI, beats: 2 },
];

/**
 * One solve move: which layer the machine snaps, and which way. Layers are
 * measured along the current face normal — `front` wheels the visible grid and
 * the pips still stuck to it, `back` grinds the far layer inside the
 * silhouette, and `shell` turns both caps while the equator holds still.
 */
type Move = { slab: Slab; dir: 1 | -1 };

const MOVE_PROGRAM: Move[][] = [
  [{ slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_BACK, dir: -1 }, { slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_SHELL, dir: 1 }, { slab: SLAB_FRONT, dir: 1 }],
  [{ slab: SLAB_BACK, dir: 1 }, { slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_BACK, dir: -1 }, { slab: SLAB_SHELL, dir: -1 }],
  [{ slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_SHELL, dir: 1 }, { slab: SLAB_BACK, dir: 1 }, { slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_BACK, dir: -1 }],
  [{ slab: SLAB_SHELL, dir: -1 }, { slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_BACK, dir: -1 }, { slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_BACK, dir: 1 }],
  [{ slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_BACK, dir: 1 }, { slab: SLAB_SHELL, dir: -1 }, { slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_BACK, dir: -1 }],
  [{ slab: SLAB_BACK, dir: -1 }, { slab: SLAB_FRONT, dir: 1 }, { slab: SLAB_SHELL, dir: 1 }, { slab: SLAB_FRONT, dir: -1 }, { slab: SLAB_FRONT, dir: 1 }],
];

// Which of the nine slots start wrong on each face. Slot 4 is the fixed center
// piece and is never scrambled — the same courtesy a real cube extends.
const SCRAMBLE_SLOTS: number[][] = [
  [0, 2, 5, 6, 8],
  [1, 3, 2, 7, 5],
  [0, 1, 6, 7, 8],
  [2, 3, 5, 6, 0],
  [1, 2, 3, 7, 8],
  [0, 5, 6, 7, 2],
];

const FACE_NORMALS = [
  new Vector3(0, 0, 1),
  new Vector3(1, 0, 0),
  new Vector3(0, 0, -1),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
];

// ---- model -------------------------------------------------------------------

type Cubie = {
  /** Logical lattice slot in {-1,0,1}^3. Rewritten when a twist bakes. */
  p: Vector3;
  home: Vector3;
  base: Quaternion;
  /** Live pose in cube space, rewritten every frame. */
  position: Vector3;
  quaternion: Quaternion;
  removed: boolean;
  group: Group | null;
};

type Sticker = {
  cubie: Cubie;
  /** Logical outward normal in cube space. Rewritten when a twist bakes. */
  n: Vector3;
  home: Vector3;
  color: Color;
  snapAt: number;
  mesh: Mesh | null;
  material: MeshBasicMaterial | null;
};

type Twist = { axis: Vector3; slab: Slab; dir: 1 | -1; age: number; life: number };
type Present = { age: number; life: number; from: Quaternion; to: Quaternion };

export type CubeFrame = { right: Vector3; up: Vector3; forward: Vector3 };

const cubies: Cubie[] = [];
const stickers: Sticker[] = [];

let root: Group | null = null;
const bays: Group[] = [];
const bayLamps: MeshBasicMaterial[] = [];

const align = new Quaternion();
const turn = new Quaternion();
const orientation = new Quaternion();
let turnIndex = 0;
let present: Present | null = null;
let twist: Twist | null = null;
const twistQueue: Twist[] = [];

let faceIndex = 0;
let faceArmed = false;
let facesDropped = 0;
let moveCursor = 0;
let wrongStickers: Array<Sticker | null> = [];
let elapsed = 0;
let exploded = 0;
let explodeTarget = 0;
let corePulse = 0;
let coreDead = false;
/** Face-normal indices whose skin has come off. The machine stops painting them. */
const conquered = new Set<number>();
let shutdown = 0;
let idleSpin = 0;
let beatEnergy = 0;

const frontNormal = new Vector3(0, 0, 1);
const frontUAxis = new Vector3(1, 0, 0);
const frontVAxis = new Vector3(0, 1, 0);
const frame: CubeFrame = { right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), forward: new Vector3(0, 0, 1) };

const scratchQuat = new Quaternion();
const scratchQuatB = new Quaternion();
const scratchVec = new Vector3();
const scratchVecB = new Vector3();
const scratchMatrix = new Matrix4();

/** Solve color owned by the cube face whose outward normal is `n`. */
function colorForNormal(n: Vector3) {
  for (let i = 0; i < FACE_NORMALS.length; i += 1) {
    if (FACE_NORMALS[i].distanceToSquared(n) < 0.01) return SOLVE_COLORS[i];
  }
  return SOLVE_COLORS[0];
}

function buildModel() {
  cubies.length = 0;
  stickers.length = 0;
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        const cubie: Cubie = {
          p: new Vector3(x, y, z),
          home: new Vector3(x, y, z),
          base: new Quaternion(),
          position: new Vector3(x * CELL, y * CELL, z * CELL),
          quaternion: new Quaternion(),
          removed: false,
          group: null,
        };
        cubies.push(cubie);
        if (x !== 0) stickers.push(makeSticker(cubie, new Vector3(x, 0, 0)));
        if (y !== 0) stickers.push(makeSticker(cubie, new Vector3(0, y, 0)));
        if (z !== 0) stickers.push(makeSticker(cubie, new Vector3(0, 0, z)));
      }
    }
  }
}

function makeSticker(cubie: Cubie, normal: Vector3): Sticker {
  return {
    cubie,
    n: normal.clone(),
    home: normal.clone(),
    color: colorForNormal(normal).clone(),
    snapAt: -1,
    mesh: null,
    material: null,
  };
}

buildModel();

// ---- view --------------------------------------------------------------------

export function buildCube(scene: Scene) {
  disposeCube();
  const rng = mulberry32(0x0c0be5);

  root = new Group();
  const body = new Group();
  root.add(body);

  const shellMaterial = new MeshBasicMaterial({ color: GRAPHITE.clone() });
  // Two machinery tones, because a flat-shaded interior with one color reads as
  // a hole rather than a mechanism: grey plating with bright white hardware.
  const plateMaterial = new MeshBasicMaterial({ color: MACHINE_GREY.clone() });
  const hardwareMaterial = new MeshBasicMaterial({ color: MACHINE_WHITE.clone().multiplyScalar(0.9) });
  const plateGeometry = new BoxGeometry(6.85, 6.85, 0.5);
  const shellGeometry = cubieShellGeometry();

  for (const cubie of cubies) {
    const group = new Group();
    group.position.copy(cubie.position);
    group.add(new Mesh(shellGeometry, shellMaterial));

    // Machinery lives under every outward sticker: pale plating, a recessed
    // window, four studs. Nobody sees it until a face comes off.
    const panels: BufferGeometry[] = [];
    const hardware: BufferGeometry[] = [];
    for (const sticker of stickers) {
      if (sticker.cubie !== cubie) continue;
      const machinery = machineryPanelGeometry(sticker.home, rng);
      panels.push(...machinery.plating);
      hardware.push(...machinery.hardware);
      const material = new MeshBasicMaterial({ color: sticker.color.clone() });
      const mesh = new Mesh(plateGeometry, material);
      mesh.quaternion.setFromUnitVectors(AXIS_Z, sticker.home);
      mesh.position.copy(sticker.home).multiplyScalar(STICKER_LIFT);
      group.add(mesh);
      sticker.mesh = mesh;
      sticker.material = material;
    }
    const mergedPlating = mergeGeometries(panels);
    if (mergedPlating) group.add(new Mesh(mergedPlating, plateMaterial));
    const mergedHardware = mergeGeometries(hardware);
    if (mergedHardware) group.add(new Mesh(mergedHardware, hardwareMaterial));
    for (const geometry of [...panels, ...hardware]) geometry.dispose();

    cubie.group = group;
    body.add(group);
  }

  for (let i = 0; i < 6; i += 1) {
    const bay = buildBay(FACE_NORMALS[i], i);
    bay.visible = false;
    bays.push(bay);
    root.add(bay);
  }

  scene.add(root);
  resetCube();
  return root;
}

function cubieShellGeometry() {
  // Chamfered plastic: a slightly short box plus three thin bands, so the
  // graphite silhouette keeps its edges against a pale void.
  const parts: BufferGeometry[] = [new BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE)];
  const band = 0.42;
  for (const [w, h, d] of [
    [CUBIE_SIZE + 0.34, band, CUBIE_SIZE + 0.34],
    [band, CUBIE_SIZE + 0.34, CUBIE_SIZE + 0.34],
    [CUBIE_SIZE + 0.34, CUBIE_SIZE + 0.34, band],
  ] as const) {
    parts.push(new BoxGeometry(w, h, d));
  }
  const merged = mergeGeometries(parts);
  if (!merged) return parts[0];
  for (const part of parts) part.dispose();
  return merged;
}

function machineryPanelGeometry(normal: Vector3, rng: () => number) {
  const plating: BufferGeometry[] = [];
  const hardware: BufferGeometry[] = [];
  const quaternion = new Quaternion().setFromUnitVectors(AXIS_Z, normal);
  const push = (into: BufferGeometry[], geometry: BufferGeometry, offset: Vector3) => {
    const position = offset.clone().applyQuaternion(quaternion).addScaledVector(normal, CUBIE_SIZE / 2);
    into.push(geometry.applyMatrix4(new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1))));
  };
  push(plating, new BoxGeometry(6.2, 6.2, 0.5), new Vector3(0, 0, -0.1));
  push(plating, new BoxGeometry(4.0, 4.0, 0.6), new Vector3(0, 0, -0.55));
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    push(hardware, new BoxGeometry(0.9, 0.9, 1.0), new Vector3(sx * 2.3, sy * 2.3, 0));
  }
  // A little asymmetric hardware so the exposed guts do not read as tiling.
  push(hardware, new BoxGeometry(3.1, 0.6, 0.85), new Vector3((rng() - 0.5) * 1.6, (rng() - 0.5) * 3.0, 0.02));
  push(hardware, new BoxGeometry(0.55, 1.9, 0.7), new Vector3((rng() - 0.5) * 3.0, (rng() - 0.5) * 1.4, 0));
  return { plating, hardware };
}

function buildBay(normal: Vector3, index: number) {
  const bay = new Group();
  const wallMaterial = new MeshBasicMaterial({ color: MACHINE_WHITE.clone().multiplyScalar(0.62) });
  const partMaterial = new MeshBasicMaterial({ color: MACHINE_GREY.clone() });
  const walls: BufferGeometry[] = [];
  const parts: BufferGeometry[] = [];

  // The socket a face's center piece used to sit in: four bright walls, a back
  // plate, and a ring of drive gear around the spindle mount.
  for (const [w, h, x, y] of [
    [8.6, 0.7, 0, 3.95],
    [8.6, 0.7, 0, -3.95],
    [0.7, 8.6, 3.95, 0],
    [0.7, 8.6, -3.95, 0],
  ] as const) {
    walls.push(new BoxGeometry(w, h, 8).applyMatrix4(new Matrix4().makeTranslation(x, y, -4.2)));
  }
  walls.push(new BoxGeometry(8.6, 8.6, 0.6).applyMatrix4(new Matrix4().makeTranslation(0, 0, -8.1)));
  parts.push(new TorusGeometry(2.9, 0.42, 6, 20).applyMatrix4(new Matrix4().makeTranslation(0, 0, -6.6)));
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    parts.push(new BoxGeometry(0.55, 1.5, 0.55).applyMatrix4(
      new Matrix4().makeTranslation(Math.cos(angle) * 2.9, Math.sin(angle) * 2.9, -6.6),
    ));
  }
  parts.push(new BoxGeometry(1.5, 1.5, 4.4).applyMatrix4(new Matrix4().makeTranslation(0, 0, -6.2)));

  const wallMesh = mergeGeometries(walls);
  if (wallMesh) bay.add(new Mesh(wallMesh, wallMaterial));
  const partMesh = mergeGeometries(parts);
  if (partMesh) bay.add(new Mesh(partMesh, partMaterial));
  for (const geometry of [...walls, ...parts]) geometry.dispose();

  const lampMaterial = createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 0.72), opacity: 0.65 });
  const lamp = new Mesh(new BoxGeometry(5.4, 5.4, 0.2), lampMaterial);
  lamp.position.set(0, 0, -7.6);
  bay.add(lamp);
  bayLamps[index] = lampMaterial;

  bay.quaternion.setFromUnitVectors(AXIS_Z, normal);
  bay.position.copy(normal).multiplyScalar(CELL + CUBIE_SIZE / 2);
  return bay;
}

// ---- lifecycle ---------------------------------------------------------------

export function disposeCube() {
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  root = null;
  bays.length = 0;
  bayLamps.length = 0;
  for (const cubie of cubies) cubie.group = null;
  for (const sticker of stickers) {
    sticker.mesh = null;
    sticker.material = null;
  }
  twistQueue.length = 0;
  twist = null;
  present = null;
}

export function resetCube() {
  align.identity();
  turn.identity();
  orientation.identity();
  turnIndex = 0;
  present = null;
  twist = null;
  twistQueue.length = 0;
  faceIndex = 0;
  faceArmed = false;
  facesDropped = 0;
  moveCursor = 0;
  wrongStickers = [];
  exploded = 0;
  explodeTarget = 0;
  corePulse = 0;
  coreDead = false;
  shutdown = 0;

  for (const cubie of cubies) {
    cubie.p.copy(cubie.home);
    cubie.base.identity();
    cubie.position.copy(cubie.home).multiplyScalar(CELL);
    cubie.quaternion.identity();
    cubie.removed = false;
    if (cubie.group) cubie.group.visible = true;
  }
  conquered.clear();
  for (const sticker of stickers) {
    sticker.n.copy(sticker.home);
    sticker.color.copy(colorForNormal(sticker.home));
    sticker.snapAt = -1;
    sticker.material?.color.copy(sticker.color);
    if (sticker.mesh) {
      sticker.mesh.visible = true;
      sticker.mesh.scale.setScalar(1);
    }
  }
  for (let i = 0; i < bays.length; i += 1) {
    bays[i].visible = false;
    bayLamps[i]?.color.copy(hdr(HOT_WHITE, 0.72));
  }
  if (root) {
    root.scale.setScalar(1);
    root.visible = true;
  }
  refreshFrontAxes();
  applyPose();
}

// ---- queries -------------------------------------------------------------------

/** Camera-relative basis anchored to the cube's lagged facing. */
export function cubeFrame(): CubeFrame {
  return frame;
}

export function activeFaceIndex() {
  return faceIndex;
}

export function facesConquered() {
  return facesDropped;
}

export function isCoreDead() {
  return coreDead;
}

export function setCubeBeat(energy: number) {
  beatEnergy = energy;
}

// ---- presentation --------------------------------------------------------------

/** Kicks the quarter turn that brings face `index` into the frame. */
export function presentFace(index: number, beatSeconds: number) {
  if (index <= 0 || index >= 6 || index !== turnIndex + 1) return;
  const step = PRESENT_TURNS[index - 1];
  const from = turn.clone();
  const to = new Quaternion().setFromAxisAngle(step.axis, step.angle).multiply(turn);
  present = { age: 0, life: beatSeconds * step.beats, from, to };
  turnIndex = index;
  faceIndex = index;
  faceArmed = false;
  twistQueue.length = 0;
}

/** Scrambles the presented face and hands back how many pips will solve it. */
export function armFace(index: number) {
  faceIndex = index;
  moveCursor = 0;
  faceArmed = true;
  refreshFrontAxes();
  const slots = frontSlots();
  const normalIndex = faceNormalIndex();
  const target = SOLVE_COLORS[normalIndex];
  const scramble = SCRAMBLE_SLOTS[index % SCRAMBLE_SLOTS.length];

  for (const sticker of slots) {
    if (!sticker) continue;
    sticker.color.copy(target);
    sticker.snapAt = elapsed;
  }
  wrongStickers = [];
  for (let i = 0; i < scramble.length; i += 1) {
    const sticker = slots[scramble[i]] ?? null;
    if (sticker) {
      // Decoys are always another face's color, so a wrong square reads as
      // "this belongs somewhere else", never as a shade of the target.
      sticker.color.copy(SOLVE_COLORS[(normalIndex + 1 + (i % 5)) % 6]);
      sticker.snapAt = elapsed + i * 0.05;
    }
    wrongStickers.push(sticker);
  }
  return wrongStickers.length;
}

/** World position of the pip hanging off wrong-sticker `index`, if it is live. */
export function pipAnchor(index: number, out: Vector3): Vector3 | null {
  const sticker = wrongStickers[index];
  if (!sticker || !faceArmed || skinnedOff(sticker)) return null;
  const normal = scratchVecB.copy(sticker.home).applyQuaternion(sticker.cubie.quaternion);
  out.copy(sticker.home)
    .multiplyScalar(STICKER_LIFT)
    .applyQuaternion(sticker.cubie.quaternion)
    .add(sticker.cubie.position)
    .addScaledVector(normal, PIP_STANDOFF);
  return out.applyQuaternion(orientation);
}

/**
 * The solve step: the square snaps to the face color and the machine answers
 * with a queued layer rotation. Rotations always fire on a beat, so the queue
 * drains one move per beat rather than firing at the moment of the shot.
 */
export function solvePip(index: number, beatSeconds: number) {
  const sticker = wrongStickers[index];
  if (!sticker) return;
  sticker.color.copy(SOLVE_COLORS[faceNormalIndex()]);
  sticker.snapAt = elapsed;
  wrongStickers[index] = null;
  const move = MOVE_PROGRAM[faceIndex % MOVE_PROGRAM.length][moveCursor % MOVES_PER_FACE];
  moveCursor += 1;
  queueTwist({ axis: frontNormal.clone(), slab: move.slab, dir: move.dir, age: 0, life: beatSeconds });
}

/** Both caps at once on the view axis: the machine signing off on a face. */
export function queueFullTwist(dir: 1 | -1, beatSeconds: number) {
  queueTwist({ axis: frontNormal.clone(), slab: SLAB_SHELL, dir, age: 0, life: beatSeconds });
}

/**
 * The queue drains one move per beat. It is bounded because a beat is the only
 * thing that empties it, and a silenced transport would otherwise let a fast
 * volley bank more snaps than the rest of the run can spend.
 */
function queueTwist(next: Twist) {
  twistQueue.push(next);
  while (twistQueue.length > 4) twistQueue.shift();
}

/** Runs a queued rotation. Called from the beat handler — never from a kill. */
export function releaseQueuedTwist() {
  if (twist || present || twistQueue.length === 0) return false;
  twist = twistQueue.shift() ?? null;
  return twist !== null;
}

/** Finishes the face without ceremony when the timeline runs out of patience. */
export function forceSolveFace() {
  const target = SOLVE_COLORS[faceNormalIndex()];
  for (const sticker of frontSlots()) {
    if (!sticker) continue;
    if (!sticker.color.equals(target)) sticker.snapAt = elapsed;
    sticker.color.copy(target);
  }
  wrongStickers = [];
}

// ---- face teardown -------------------------------------------------------------

/** Cube-space point to world. The cube sits at the origin, so this is a rotation. */
function toWorld(local: Vector3) {
  return local.applyQuaternion(orientation);
}

/** The conquered face lets go: nine plates and the center piece come off. */
export function dropFace() {
  if (!faceArmed) return;
  faceArmed = false;
  facesDropped += 1;
  const normalIndex = faceNormalIndex();
  const worldNormal = scratchVec.copy(frontNormal).applyQuaternion(orientation).normalize().clone();

  for (const sticker of frontSlots()) {
    if (!sticker) continue;
    const position = toWorld(
      new Vector3().copy(sticker.home).multiplyScalar(STICKER_LIFT)
        .applyQuaternion(sticker.cubie.quaternion)
        .add(sticker.cubie.position),
    );
    burstCubies(position, worldNormal, sticker.color, 1.5, 3);
  }
  conquered.add(normalIndex);
  // The center piece is the socket cover; blowing it out is what exposes the
  // machinery and the weakpoint underneath.
  const center = cubieAt(frontNormal);
  if (center) {
    center.removed = true;
    if (center.group) center.group.visible = false;
    const position = toWorld(center.position.clone());
    burstCubies(position, worldNormal, SOLVE_COLORS[normalIndex], 2.6, 6);
    spawnRing(position, hdr(MACHINE_WHITE, 0.9), 13, 0.5);
  }
  if (bays[normalIndex]) bays[normalIndex].visible = true;
  wrongStickers = [];
}

/**
 * Where the exposed weakpoint hangs. It rises straight up the socket axis
 * before it starts orbiting, so it is never behind a socket wall.
 */
export function weakAnchor(age: number, out: Vector3): Vector3 {
  const eased = 1 - (1 - Math.min(1, age / 0.5)) ** 3;
  const angle = age * 1.35 + faceIndex * 1.9;
  out.copy(frontNormal).multiplyScalar(SOCKET_FLOOR + WEAK_RISE * eased);
  out.addScaledVector(frontUAxis, Math.cos(angle) * WEAK_ORBIT * eased);
  out.addScaledVector(frontVAxis, Math.sin(angle) * WEAK_ORBIT * 0.9 * eased);
  return toWorld(out);
}

export function closeSocket() {
  bayLamps[faceNormalIndex()]?.color.copy(hdr(MACHINE_GREY, 0.3));
}

export function breakSocket() {
  bayLamps[faceNormalIndex()]?.color.copy(hdr(SOLVE_COLORS[faceNormalIndex()], 0.9));
}

// ---- core --------------------------------------------------------------------

/** Bar 31: the shell unfolds and the core is left hanging in the open. */
export function exposeCore() {
  explodeTarget = 1;
  // The sockets unfold with the shell. They also sit squarely between the rail
  // and the core, so leaving them up would hide the thing the finale is about.
  for (const bay of bays) bay.visible = false;
}

export function coreAnchor(out: Vector3): Vector3 {
  return out.set(0, 0, 0);
}

export function coreHit(intensity: number) {
  corePulse = Math.max(corePulse, 0.6 + intensity * 0.7);
}

/** The finish: the shell shreds into a confetti storm of tiny cubes. */
export function killCore() {
  if (coreDead) return;
  coreDead = true;
  corePulse = 1.8;
  const center = new Vector3();
  for (let i = 0; i < 6; i += 1) spawnRing(center, hdr(SOLVE_COLORS[i], 0.95), 24 + i * 9, 0.75 + i * 0.1);
  for (let i = 0; i < cubies.length; i += 1) {
    const cubie = cubies[i];
    if (cubie.removed) continue;
    cubie.removed = true;
    if (cubie.group) cubie.group.visible = false;
    const position = toWorld(cubie.position.clone());
    burstCubies(position, position.clone().normalize(), SOLVE_COLORS[i % 6], 3.4, 6);
  }
  for (let i = 0; i < FACE_NORMALS.length; i += 1) conquered.add(i);
  for (const bay of bays) bay.visible = false;
}

/** Run over: whatever is left of the machine powers down and recedes. */
export function shutdownCube() {
  shutdown = Math.max(shutdown, 0.0001);
}

// ---- per-frame ---------------------------------------------------------------

export function updateCube(dt: number, camera: PerspectiveCamera, running: boolean) {
  elapsed += dt;
  corePulse = Math.max(0, corePulse - dt * 2.4);

  // Facing: the cube turns to keep the presented face square to the rail, but
  // it lags, so orbiting visibly makes it swivel to keep up with you.
  scratchMatrix.lookAt(camera.position, ORIGIN, UP);
  scratchQuat.setFromRotationMatrix(scratchMatrix);
  align.slerp(scratchQuat, Math.min(1, dt * (running ? 2.2 : 1.3)));
  frame.forward.copy(AXIS_Z).applyQuaternion(align).normalize();
  frame.right.copy(AXIS_X).applyQuaternion(align).normalize();
  frame.up.copy(AXIS_Y).applyQuaternion(align).normalize();

  // Attract idles with a slow display spin; the run unwinds it in about a
  // second so the first face squares up before its pips arrive.
  if (running) idleSpin *= Math.max(0, 1 - dt * 2.6);
  else idleSpin += dt * 0.24;

  if (present) {
    present.age += dt;
    const t = Math.min(1, present.age / present.life);
    if (t >= 1) {
      turn.copy(present.to);
      present = null;
      refreshFrontAxes();
      composeOrientation(turn);
    } else {
      composeOrientation(scratchQuatB.copy(present.from).slerp(present.to, snapEase(t)));
    }
  } else {
    composeOrientation(turn);
  }
  if (idleSpin > 0.0005) orientation.multiply(scratchQuatB.setFromAxisAngle(AXIS_Y, idleSpin));

  if (twist) {
    twist.age += dt;
    const t = Math.min(1, twist.age / twist.life);
    applyPose(twist.dir * HALF_PI * snapEase(t));
    if (t >= 1) {
      bakeTwist();
      twist = null;
      refreshFrontAxes();
      applyPose();
    }
  } else {
    applyPose();
  }

  // The shell snaps open rather than easing: it is a mechanism, and the core
  // must be in clear air before it becomes a target half a bar later.
  exploded += (explodeTarget - exploded) * Math.min(1, dt * 6.5);
  if (shutdown > 0) shutdown = Math.min(1, shutdown + dt * 0.8);

  syncView(dt);
}

const ORIGIN = new Vector3();

function composeOrientation(turnQuat: Quaternion) {
  orientation.copy(align).multiply(DISPLAY_TILT).multiply(turnQuat);
}

/** Mechanical snap: fast off the mark, one small settle, then dead still. */
function snapEase(t: number) {
  const c = t - 1;
  return 1 + 2.05 * c * c * c + 1.05 * c * c;
}

/** Writes every cubie's live pose in cube space. Pure model work. */
function applyPose(angle = 0) {
  const active = twist;
  if (active) scratchQuat.setFromAxisAngle(active.axis, angle);
  for (const cubie of cubies) {
    if (cubie.removed) continue;
    scratchVec.copy(cubie.p).multiplyScalar(CELL);
    if (exploded > 0.001) {
      // Exploded view: the shell opens outward in the plane of the frame and
      // barely toward the camera, so nothing crowds the flight space.
      scratchVecB.copy(cubie.p).multiplyScalar(CELL * 0.7 * exploded);
      scratchVecB.addScaledVector(frontNormal, -scratchVecB.dot(frontNormal) * 0.72);
      scratchVec.add(scratchVecB);
    }
    if (active && inTwist(cubie.p, active)) {
      cubie.position.copy(scratchVec).applyQuaternion(scratchQuat);
      cubie.quaternion.copy(scratchQuat).multiply(cubie.base);
    } else {
      cubie.position.copy(scratchVec);
      cubie.quaternion.copy(cubie.base);
    }
  }
}

/** Is this lattice slot inside the layer the twist grabbed? */
function inTwist(p: Vector3, active: Twist) {
  const along = Math.round(p.dot(active.axis));
  if (active.slab === 'front') return along === 1;
  if (active.slab === 'back') return along === -1;
  return along !== 0;
}

function bakeTwist() {
  const active = twist;
  if (!active) return;
  scratchQuat.setFromAxisAngle(active.axis, active.dir * HALF_PI);
  for (const sticker of stickers) {
    if (!inTwist(sticker.cubie.p, active)) continue;
    rotateLattice(sticker.n, active.axis, active.dir);
  }
  for (const cubie of cubies) {
    if (!inTwist(cubie.p, active)) continue;
    rotateLattice(cubie.p, active.axis, active.dir);
    cubie.base.premultiply(scratchQuat);
  }
}

/** Exact 90° lattice rotation about a signed cardinal axis. */
function rotateLattice(v: Vector3, axis: Vector3, dir: number) {
  if (Math.abs(axis.x) > 0.5) {
    const sign = Math.sign(axis.x) * dir;
    const y = v.y;
    v.y = -sign * v.z;
    v.z = sign * y;
  } else if (Math.abs(axis.y) > 0.5) {
    const sign = Math.sign(axis.y) * dir;
    const z = v.z;
    v.z = -sign * v.x;
    v.x = sign * z;
  } else {
    const sign = Math.sign(axis.z) * dir;
    const x = v.x;
    v.x = -sign * v.y;
    v.y = sign * x;
  }
  v.round();
}

/** The presented face's normal and screen axes, derived from the turn stack. */
function refreshFrontAxes() {
  scratchQuatB.copy(turn).invert();
  frontNormal.copy(AXIS_Z).applyQuaternion(scratchQuatB).round();
  frontUAxis.copy(AXIS_X).applyQuaternion(scratchQuatB).round();
  frontVAxis.copy(AXIS_Y).applyQuaternion(scratchQuatB).round();
}

function faceNormalIndex() {
  for (let i = 0; i < FACE_NORMALS.length; i += 1) {
    if (FACE_NORMALS[i].distanceToSquared(frontNormal) < 0.01) return i;
  }
  return 0;
}

/** The nine stickers currently on the presented face, in reading order. */
function frontSlots(): Array<Sticker | null> {
  const slots: Array<Sticker | null> = [null, null, null, null, null, null, null, null, null];
  for (const sticker of stickers) {
    if (skinnedOff(sticker) || sticker.cubie.removed) continue;
    if (sticker.n.distanceToSquared(frontNormal) > 0.01) continue;
    const col = Math.round(sticker.cubie.p.dot(frontUAxis)) + 1;
    const row = 1 - Math.round(sticker.cubie.p.dot(frontVAxis));
    const index = row * 3 + col;
    if (index >= 0 && index < 9) slots[index] = sticker;
  }
  return slots;
}

/** True once the face this plate is currently showing on has been conquered. */
function skinnedOff(sticker: Sticker) {
  return conquered.has(normalIndexOf(sticker.n));
}

function normalIndexOf(n: Vector3) {
  for (let i = 0; i < FACE_NORMALS.length; i += 1) {
    if (FACE_NORMALS[i].distanceToSquared(n) < 0.01) return i;
  }
  return -1;
}

function cubieAt(p: Vector3) {
  for (const cubie of cubies) if (!cubie.removed && cubie.p.distanceToSquared(p) < 0.01) return cubie;
  return null;
}

// ---- view sync ------------------------------------------------------------------

function syncView(_dt: number) {
  if (!root) return;
  root.quaternion.copy(orientation);
  if (shutdown > 0) {
    const fade = 1 - shutdown;
    root.scale.setScalar(Math.max(0.001, fade * fade));
    root.visible = shutdown < 0.99;
  }
  for (const cubie of cubies) {
    if (!cubie.group || cubie.removed) continue;
    cubie.group.position.copy(cubie.position);
    cubie.group.quaternion.copy(cubie.quaternion);
  }

  updateStickerLook();
}

/**
 * Sticker finish. Plates hold their flat solve color so the face stays legible
 * with bloom off; the only animation is the snap flare when a square is solved
 * and a slow breath on the squares still carrying a pip.
 */
function updateStickerLook() {
  for (const sticker of stickers) {
    if (!sticker.material || !sticker.mesh) continue;
    // Skinning is re-derived every frame from the conquered set, so a plate
    // twisted onto a stripped face vanishes and one twisted off it comes back.
    sticker.mesh.visible = !skinnedOff(sticker);
    if (!sticker.mesh.visible) continue;
    const since = elapsed - sticker.snapAt;
    if (sticker.snapAt >= 0 && since >= 0 && since < 0.34) {
      const k = 1 - since / 0.34;
      sticker.material.color.copy(sticker.color).multiplyScalar(1 + k * 1.15);
      sticker.mesh.scale.setScalar(1 + k * 0.1);
      continue;
    }
    sticker.mesh.scale.setScalar(1);
    sticker.material.color.copy(sticker.color);
  }
  for (const sticker of wrongStickers) {
    if (!sticker || !sticker.material || skinnedOff(sticker) || elapsed - sticker.snapAt < 0.34) continue;
    // A wrong square keeps a live edge: it is the thing you are here to fix.
    sticker.material.color.copy(sticker.color).multiplyScalar(0.84 + Math.sin(elapsed * 7.6 + sticker.home.x * 2.1) * 0.18);
  }
}
