import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Path,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeObject3D } from '../../../engine/visual-kit';
import { brassMaterial, createTargetPaint, steelMaterial } from './enemy-materials';
import type { EnemyRig } from './enemies';
import { createLamp, pinSnapshotView, withPreviewEnvironment } from './materials';
import { RUBY, WHITE_HOT } from './palette';

// The Escapement: an anchor fork pivoted above a 30-tooth escape wheel, under
// a crown wheel. The body is scenery-scale lit brass and steel. Its lockable
// parts (two pallet jewels, the arbor core) are separate target rigs that
// gameplay seats at the body's anchors every frame with `seatPart`, so the
// runner sees one mesh per target while the body rocks as one piece.
//
// Coordinates: the fork pivot is the group origin. The wheel hangs below it in
// the XY plane and the front of the body faces +z. The rail camera holds in
// front of and above the body, so every part that must read sits forward of
// the parts behind it: crown wheel at the back, then wheel and fork, then the
// jewels and the arbor core in front of everything.
//
// Sizes: the escape wheel is 56 m across and the anchor spans 50 m, so the
// body reads from the ride camera about 150 m in front. The jewels are 18 m
// crystals, far larger than a real pallet stone, because they are the lock
// targets.

export type JewelSide = 'left' | 'right';
export type BossStage = 'jewels' | 'arbor' | 'broken';
export type BossPart = 'jewelLeft' | 'jewelRight' | 'arbor';

export interface PalletJewelRig extends EnemyRig {
  /** Lifted off the wheel: white-hot and lockable. Engaged: dull ruby. */
  setLifted(lifted: boolean): void;
}

export interface EscapementBoss extends Group {
  update(dt: number, beatPhase: number): void;
  /** Rocks the fork about its pivot. Positive lifts the right pallet, negative the left. */
  setForkAngle(radians: number): void;
  forkAngle(): number;
  /** Advances the escape wheel one tooth with a snap. `update` also calls this on each beat wrap. */
  tick(): void;
  setJewelLifted(side: JewelSide, lifted: boolean): void;
  /** The fork tip shears off and a crown-wheel plate falls into the void. */
  breakJewel(side: JewelSide): void;
  exposeArbor(open: boolean): void;
  setStage(stage: BossStage): void;
  /** Free-run wheel speed in radians per second; only used in the `broken` stage. */
  setWheelSpin(rate: number): void;
  attachJewel(side: JewelSide, rig: PalletJewelRig): void;
  /** Copies a part anchor's world transform onto `object`. */
  seatPart(part: BossPart, object: Object3D): void;
  anchors: Record<BossPart, Object3D>;
  dispose(): void;
}

/** Which pallet is lifted off the wheel at a given fork angle. */
export function liftedSide(forkAngle: number): JewelSide {
  return forkAngle >= 0 ? 'right' : 'left';
}

export const ESCAPE_WHEEL_TEETH = 30;
const TOOTH_ANGLE = (Math.PI * 2) / ESCAPE_WHEEL_TEETH;
/** The wheel sits behind the fork plane so the anchor band crosses its top rim without touching it. */
const WHEEL_CENTER = new Vector3(0, -46, -6);
const WHEEL_TIP_RADIUS = 28;
const WHEEL_ROOT_RADIUS = 24.5;
const WHEEL_RIM_INNER = 19;
const WHEEL_DEPTH = 7.5;
const WHEEL_HUB_RADIUS = 7.5;
const CROWN_CENTER = new Vector3(0, 40, -30);
const CROWN_OUTER = 40;
const CROWN_INNER = 33;
const CROWN_TEETH = 60;
const CROWN_DEPTH = 6.5;
const ARBOR_RADIUS = 3.8;
const ARBOR_LENGTH = 28;
const ARBOR_FRONT = ARBOR_LENGTH / 2;
const FORK_DEPTH = 7.5;
const PIVOT_RADIUS = 10;
/** Fork tip centres, in the fork's frame. The pallets sit on the wheel 45 degrees either side of its top. */
const TIP_X = 22;
const TIP_Y = -20.5;
/** Jewel centre in the tip's frame: below the tip block and 2 m in front of its face, so no part of the fork or wheel is ever between the jewel and a camera in front of the body. */
const JEWEL_OFFSET = new Vector3(2, -6.5, 10);
const JEWEL_TILT = -0.7;
/** Radius of the shutter discs and of the socket they cover. */
const SOCKET_RADIUS = 8;
const SHUTTER_Z = ARBOR_FRONT + 0.5;
const SHUTTER_TRAVEL = 10;
const SNAP_RATE = 22;
/** Falling pieces: gravity and how long they stay in the scene. */
const FALL_GRAVITY = 24;
const FALL_SECONDS = 5;

// ---- geometry ----------------------------------------------------------------------

function toothedRing(outer: number, root: number, inner: number, teeth: number) {
  const shape = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    // A club tooth leans forward: a long ramp up the back, a short flat at the
    // tip, a steep face at the front.
    const points: Array<[number, number]> = [
      [a, root],
      [a + step * 0.5, outer],
      [a + step * 0.64, outer],
      [a + step * 0.66, root + (outer - root) * 0.35],
      [a + step * 0.7, root],
    ];
    for (const [angle, radius] of points) {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0 && angle === a) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  const hole = new Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function ring(outer: number, inner: number) {
  const shape = new Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function extrude(shape: Shape, depth: number, bevel = 0.3) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function nonIndexed(geometry: BufferGeometry) {
  if (!geometry.index) return geometry;
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

function mergeAll(pieces: BufferGeometry[]) {
  const merged = mergeGeometries(pieces.map(nonIndexed));
  for (const piece of pieces) piece.dispose();
  return merged;
}

/** A ring of bolt heads on a hub face, merged into `pieces`. */
function addBolts(pieces: BufferGeometry[], count: number, radius: number, z: number, size: number) {
  for (let i = 0; i < count; i += 1) {
    const bolt = new CylinderGeometry(size, size, size * 0.8, 6);
    bolt.rotateX(Math.PI / 2);
    const angle = (i / count) * Math.PI * 2;
    bolt.translate(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    pieces.push(bolt);
  }
}

/** Spokes from the hub to the rim and the hub itself, merged into `pieces`. The hub is a stepped boss with bolt heads on both faces. */
function addSpokesAndHub(pieces: BufferGeometry[], count: number, rimInner: number, depth: number, width: number, hubRadius: number) {
  for (let i = 0; i < count; i += 1) {
    const length = rimInner - hubRadius + 2;
    const spoke = new BoxGeometry(width, length, depth * 0.75);
    spoke.translate(0, hubRadius - 1 + length / 2, 0);
    spoke.rotateZ((i / count) * Math.PI * 2);
    pieces.push(spoke);
  }
  const hub = new CylinderGeometry(hubRadius, hubRadius, depth * 1.5, 24);
  hub.rotateX(Math.PI / 2);
  pieces.push(hub);
  const step = new CylinderGeometry(hubRadius * 0.6, hubRadius * 0.6, depth * 2.1, 20);
  step.rotateX(Math.PI / 2);
  pieces.push(step);
  for (const sign of [1, -1]) addBolts(pieces, 8, hubRadius * 0.8, sign * depth * 0.75, hubRadius * 0.09);
}

/** The escape wheel: 30 club teeth on a thick rim, an inner stiffening ring, five spokes and a bolted hub. */
function escapeWheelGeometry() {
  const pieces: BufferGeometry[] = [extrude(toothedRing(WHEEL_TIP_RADIUS, WHEEL_ROOT_RADIUS, WHEEL_RIM_INNER, ESCAPE_WHEEL_TEETH), WHEEL_DEPTH)];
  const stiffener = new TorusGeometry(WHEEL_RIM_INNER + 0.5, 1.4, 8, 48);
  pieces.push(stiffener);
  addSpokesAndHub(pieces, 5, WHEEL_RIM_INNER, WHEEL_DEPTH, 3.5, WHEEL_HUB_RADIUS);
  return mergeAll(pieces);
}

/** The crown wheel: a thick rim with 60 teeth standing forward off its face, eight spokes and a bolted hub. */
function crownWheelGeometry() {
  const pieces: BufferGeometry[] = [extrude(ring(CROWN_OUTER, CROWN_INNER), CROWN_DEPTH, 0.4)];
  const toothRadius = (CROWN_OUTER + CROWN_INNER) / 2;
  for (let i = 0; i < CROWN_TEETH; i += 1) {
    const tooth = new BoxGeometry(2, CROWN_OUTER - CROWN_INNER - 1.2, 4);
    tooth.translate(0, toothRadius, CROWN_DEPTH / 2 + 1.8);
    tooth.rotateZ((i / CROWN_TEETH) * Math.PI * 2);
    pieces.push(tooth);
  }
  addSpokesAndHub(pieces, 8, CROWN_INNER, CROWN_DEPTH, 3.2, 9);
  return mergeAll(pieces);
}

/**
 * The anchor: a crescent band that straddles the top of the escape wheel,
 * a shank up to the pivot boss, and the boss itself, all one silhouette in
 * the fork plane and extruded. The band ends short of the pallets; the tips
 * are separate meshes so they can shear.
 */
function forkGeometry() {
  const tipAngle = Math.atan2(TIP_Y, TIP_X);
  const tipRadius = Math.hypot(TIP_X, TIP_Y);
  const outer = tipRadius + 3.5;
  const inner = tipRadius - 5;
  const shape = new Shape();
  // From the right tip under the pivot to the left tip and back along the inner edge.
  shape.absarc(0, 0, outer, tipAngle, Math.PI - tipAngle, true);
  shape.absarc(0, 0, inner, Math.PI - tipAngle, tipAngle, false);
  shape.closePath();
  const pieces: BufferGeometry[] = [extrude(shape, FORK_DEPTH, 0.4)];
  const shank = new BoxGeometry(9, inner + 2, FORK_DEPTH);
  shank.translate(0, -(inner + 2) / 2, 0);
  pieces.push(shank);
  const boss = new CylinderGeometry(PIVOT_RADIUS, PIVOT_RADIUS, FORK_DEPTH + 1, 32);
  boss.rotateX(Math.PI / 2);
  pieces.push(boss);
  // A raised rib along the band and a bolted collar on the boss give the anchor its forged read.
  const rib = new TorusGeometry((outer + inner) / 2, 1.6, 8, 48, Math.PI + 2 * tipAngle);
  rib.rotateZ(-(Math.PI + tipAngle));
  pieces.push(rib);
  const collar = new TorusGeometry(PIVOT_RADIUS - 0.5, 1.5, 8, 32);
  pieces.push(collar);
  addBolts(pieces, 6, PIVOT_RADIUS - 3.2, FORK_DEPTH / 2 + 0.5, 0.9);
  return mergeAll(pieces);
}

/** A pallet tip: a brass block at the arm's end, a pad on its face, and two claws that hold the jewel from behind. `sign` is +1 for the right tip and -1 for the left, which mirrors it in x. */
function tipGeometry(sign: 1 | -1) {
  const tilt = sign * JEWEL_TILT;
  const ox = sign * JEWEL_OFFSET.x;
  const oy = JEWEL_OFFSET.y;
  const block = new BoxGeometry(10, 9, FORK_DEPTH + 1);
  block.rotateZ(tilt);
  const pieces: BufferGeometry[] = [block];
  for (const side of [1, -1]) {
    const claw = new BoxGeometry(2, 9, 2);
    claw.translate(0, -1.2, 0);
    claw.rotateZ(tilt);
    claw.translate(ox + side * 6 * Math.cos(tilt), oy + 2 + side * 6 * Math.sin(tilt), JEWEL_OFFSET.z - 3.5);
    pieces.push(claw);
  }
  // The pad the claws grow from, bridging the block's face and the jewel's back.
  const pad = new BoxGeometry(13, 4, JEWEL_OFFSET.z - 2);
  pad.rotateZ(tilt);
  pad.translate(ox, oy + 2, (JEWEL_OFFSET.z - 2) / 2);
  pieces.push(pad);
  return mergeAll(pieces);
}

function shutterGeometry() {
  const geometry = new CylinderGeometry(SOCKET_RADIUS, SOCKET_RADIUS, 1.2, 28, 1, false, 0, Math.PI);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** The static brass around the arbor: the collet behind the fork, the socket ring the shutters slide in, and the shutter rails. */
function arborBrassGeometry() {
  const pieces: BufferGeometry[] = [];
  const collet = new TorusGeometry(ARBOR_RADIUS + 1.2, 1.2, 8, 28);
  collet.translate(0, 0, FORK_DEPTH / 2 + 2);
  pieces.push(collet);
  const socketRing = new TorusGeometry(SOCKET_RADIUS + 1.2, 1.4, 8, 40);
  socketRing.translate(0, 0, SHUTTER_Z);
  pieces.push(socketRing);
  const socketWall = new CylinderGeometry(SOCKET_RADIUS + 1.2, SOCKET_RADIUS + 1.2, ARBOR_FRONT - FORK_DEPTH / 2 - 1, 40, 1, true);
  socketWall.rotateX(Math.PI / 2);
  socketWall.translate(0, 0, (SHUTTER_Z + FORK_DEPTH / 2) / 2);
  pieces.push(socketWall);
  for (const sign of [1, -1]) {
    const rail = new BoxGeometry(SOCKET_RADIUS * 2 + SHUTTER_TRAVEL, 0.9, 1.6);
    rail.translate(0, sign * (SOCKET_RADIUS + 1.6), SHUTTER_Z - 0.6);
    pieces.push(rail);
  }
  return mergeAll(pieces);
}

// ---- target rigs ----------------------------------------------------------------------

/** A hexagonal bipyramid crystal, 18 m along its axis and 10 m across. The axis lies along x. */
const JEWEL_LENGTH = 18;
const JEWEL_RADIUS = 5;

const jewelGeometry = (() => {
  let cached: BufferGeometry | null = null;
  return () => {
    if (!cached) {
      const half = JEWEL_LENGTH / 2;
      const profile = [
        new Vector2(0.001, -half),
        new Vector2(JEWEL_RADIUS * 0.75, -half * 0.68),
        new Vector2(JEWEL_RADIUS, -half * 0.28),
        new Vector2(JEWEL_RADIUS, half * 0.28),
        new Vector2(JEWEL_RADIUS * 0.75, half * 0.68),
        new Vector2(0.001, half),
      ];
      cached = new LatheGeometry(profile, 6).toNonIndexed();
      cached.rotateZ(Math.PI / 2);
      cached.computeVertexNormals();
    }
    return cached;
  };
})();

/** A pallet jewel target. Lifted: the whole crystal white-hot, lockable. Engaged: dull ruby. */
export function createPalletJewel(side: JewelSide): PalletJewelRig {
  const group = new Group();
  const paint = createTargetPaint();
  const stone = new Mesh(jewelGeometry(), paint.accent('ruby-dull', 0, true));
  group.add(stone);
  // The spark's tips reach out of the crystal's front, back, top and bottom faces.
  const spark = new Mesh(new OctahedronGeometry(1, 1), paint.spark(3));
  spark.scale.set(2.8, JEWEL_RADIUS + 1.5, JEWEL_RADIUS + 1.5);
  group.add(spark);
  group.userData.kind = 'pallet-jewel';
  group.userData.side = side;
  group.userData.accent = RUBY.clone();
  group.userData.lockRingScale = 7.5;

  let lifted = true;
  let heat = 1;
  let locked = false;
  let deniedUntil = -1;
  let damagedUntil = -1;
  let time = 0;
  const rig = group as PalletJewelRig;
  rig.update = (dt, beatPhase) => {
    time += dt;
    heat = MathUtils.damp(heat, lifted ? 1 : 0, 6, dt);
    paint.apply({
      locked,
      whiteHot: heat > 0.5,
      denied: MathUtils.clamp((deniedUntil - time) / 0.5, 0, 1),
      damaged: MathUtils.clamp((damagedUntil - time) / 0.32, 0, 1),
      pulse: (1 - beatPhase) ** 3 * heat,
      heat,
      dim: 1 - heat,
    });
  };
  rig.setLifted = (next) => {
    lifted = next;
  };
  rig.setLocked = (next) => {
    locked = next;
  };
  rig.setDenied = () => {
    deniedUntil = time + 0.5;
  };
  rig.setDamaged = () => {
    damagedUntil = time + 0.32;
  };
  rig.dispose = () => {
    paint.dispose();
    disposeObject3D(group);
  };
  rig.update(0, 0);
  return rig;
}

/** The arbor target: a ruby ring around a faceted ruby boss with a white-hot core, filling the socket the shutters uncover. */
export function createArborTarget(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  group.add(new Mesh(new TorusGeometry(SOCKET_RADIUS - 2.2, 1.6, 10, 36), paint.accent('ruby')));
  const boss = new Mesh(new CylinderGeometry(SOCKET_RADIUS - 4.2, SOCKET_RADIUS - 3.2, 2.4, 8), paint.accent('ruby', 0, true));
  boss.rotation.x = Math.PI / 2;
  boss.position.z = -0.6;
  group.add(boss);
  const spark = new Mesh(new OctahedronGeometry(1, 1), paint.spark(3));
  spark.scale.set(4, 4, 3);
  group.add(spark);
  group.userData.kind = 'arbor';
  group.userData.accent = RUBY.clone();
  group.userData.lockRingScale = 6;

  let locked = false;
  let deniedUntil = -1;
  let damagedUntil = -1;
  let time = 0;
  const rig = group as EnemyRig;
  rig.update = (dt, beatPhase) => {
    time += dt;
    spark.rotation.z += dt * 1.5;
    paint.apply({
      locked,
      denied: MathUtils.clamp((deniedUntil - time) / 0.5, 0, 1),
      damaged: MathUtils.clamp((damagedUntil - time) / 0.32, 0, 1),
      pulse: (1 - beatPhase) ** 3,
      heat: 0.6,
      dim: 0,
    });
  };
  rig.setLocked = (next) => {
    locked = next;
  };
  rig.setDenied = () => {
    deniedUntil = time + 0.5;
  };
  rig.setDamaged = () => {
    damagedUntil = time + 0.32;
  };
  rig.dispose = () => {
    paint.dispose();
    disposeObject3D(group);
  };
  rig.update(0, 0);
  return rig;
}

// ---- the body ---------------------------------------------------------------------------

type Falling = { object: Object3D; velocity: Vector3; spin: Vector3; age: number };

export function createEscapementBoss(): EscapementBoss {
  const group = new Group();
  const brass = brassMaterial();
  const steel = steelMaterial();

  // Crown wheel above and behind the fork. A brass plate is bolted to its
  // lower rim on each side; the plate falls when the jewel on that side breaks.
  const crown = new Mesh(crownWheelGeometry(), brass);
  crown.position.copy(CROWN_CENTER);
  group.add(crown);
  const plates: Record<JewelSide, Mesh> = { left: new Mesh(), right: new Mesh() };
  for (const side of ['left', 'right'] as const) {
    const angle = side === 'right' ? -Math.PI / 2 + 0.75 : -Math.PI / 2 - 0.75;
    const plate = new Mesh(new BoxGeometry(15, 4, 3.5), brass);
    plate.position.set(
      CROWN_CENTER.x + Math.cos(angle) * (CROWN_INNER - 1.2),
      CROWN_CENTER.y + Math.sin(angle) * (CROWN_INNER - 1.2),
      CROWN_CENTER.z + CROWN_DEPTH / 2 + 1.5,
    );
    plate.rotation.z = angle + Math.PI / 2;
    group.add(plate);
    plates[side] = plate;
  }

  // Escape wheel below the pivot.
  const wheel = new Mesh(escapeWheelGeometry(), brass);
  wheel.position.copy(WHEEL_CENTER);
  group.add(wheel);

  // The fork: the anchor silhouette, the two tips, and the jewel anchors on the tips.
  const fork = new Group();
  fork.add(new Mesh(forkGeometry(), steel));
  const tips: Record<JewelSide, Group> = { left: new Group(), right: new Group() };
  const anchors: Record<BossPart, Object3D> = { jewelLeft: new Object3D(), jewelRight: new Object3D(), arbor: new Object3D() };
  for (const side of ['left', 'right'] as const) {
    const tip = tips[side];
    const sign = side === 'right' ? 1 : -1;
    tip.position.set(sign * TIP_X, TIP_Y, 0);
    tip.add(new Mesh(tipGeometry(sign), brass));
    const anchor = side === 'right' ? anchors.jewelRight : anchors.jewelLeft;
    // The crystal's axis follows the pallet face; both jewels sit the same distance in front of the fork.
    anchor.position.set(sign * JEWEL_OFFSET.x, JEWEL_OFFSET.y, JEWEL_OFFSET.z);
    anchor.rotation.z = sign * JEWEL_TILT;
    tip.add(anchor);
    fork.add(tip);
  }
  group.add(fork);

  // The arbor runs through the pivot and out both faces. Its front end sits in
  // a brass socket that two shutters cover until stage two; behind them the
  // socket floor glows ruby so the opening reads from the station.
  const arbor = new Mesh(new CylinderGeometry(ARBOR_RADIUS, ARBOR_RADIUS, ARBOR_LENGTH, 20), steel);
  arbor.rotation.x = Math.PI / 2;
  group.add(arbor);
  group.add(new Mesh(arborBrassGeometry(), brass));
  const socketGlow = new MeshStandardMaterial({ color: RUBY, emissive: RUBY.clone().multiplyScalar(1.2), roughness: 0.4, metalness: 0.1 });
  const socketFloor = new Mesh(new CylinderGeometry(SOCKET_RADIUS, SOCKET_RADIUS, 1, 40), socketGlow);
  socketFloor.rotation.x = Math.PI / 2;
  socketFloor.position.z = ARBOR_FRONT - 3;
  group.add(socketFloor);
  anchors.arbor.position.set(0, 0, ARBOR_FRONT - 1.5);
  group.add(anchors.arbor);
  const shutterShape = shutterGeometry();
  const shutters = [1, -1].map((sign) => {
    const shutter = new Mesh(shutterShape, brass);
    shutter.rotation.z = sign === 1 ? -Math.PI / 2 : Math.PI / 2;
    shutter.position.z = SHUTTER_Z;
    group.add(shutter);
    return { mesh: shutter, sign };
  });

  const jewels: Partial<Record<JewelSide, PalletJewelRig>> = {};
  const broken: Record<JewelSide, boolean> = { left: false, right: false };
  const falling: Falling[] = [];
  let forkAngle = 0;
  let forkSkip = 0;
  let wheelAngle = 0;
  let wheelTarget = 0;
  let wheelSpin = 0;
  let arborOpen = 0;
  let arborOpenTarget = 0;
  let stage: BossStage = 'jewels';
  let lastBeatPhase = 0;
  let hang = 0;

  function tick() {
    wheelTarget += TOOTH_ANGLE;
    if (stage === 'arbor') forkSkip = (Math.random() < 0.5 ? -1 : 1) * 0.07;
  }

  const boss = group as EscapementBoss;
  boss.anchors = anchors;
  boss.update = (dt, beatPhase) => {
    if (beatPhase < lastBeatPhase) tick();
    lastBeatPhase = beatPhase;

    if (stage === 'broken') {
      // Free run: the wheel spins past readable speed and the fork hangs loose.
      wheelAngle += wheelSpin * dt;
      wheelTarget = wheelAngle;
      hang = MathUtils.damp(hang, 1, 2, dt);
    } else {
      wheelAngle = MathUtils.damp(wheelAngle, wheelTarget, SNAP_RATE, dt);
    }
    wheel.rotation.z = -wheelAngle;
    // The crown wheel meshes with the escape wheel's pinion, so it turns the other way at the tooth ratio.
    crown.rotation.z = wheelAngle * (ESCAPE_WHEEL_TEETH / CROWN_TEETH);
    forkSkip = MathUtils.damp(forkSkip, 0, 9, dt);
    fork.rotation.z = MathUtils.lerp(forkAngle + forkSkip, -0.55 + Math.sin(wheelAngle * 0.2) * 0.03, hang);

    arborOpen = MathUtils.damp(arborOpen, arborOpenTarget, 5, dt);
    for (const shutter of shutters) shutter.mesh.position.x = shutter.sign * arborOpen * SHUTTER_TRAVEL;
    socketGlow.emissiveIntensity = 0.35 + arborOpen * 1.0;

    for (const piece of falling) {
      piece.age += dt;
      piece.velocity.y -= FALL_GRAVITY * dt;
      piece.object.position.addScaledVector(piece.velocity, dt);
      piece.object.rotation.x += piece.spin.x * dt;
      piece.object.rotation.y += piece.spin.y * dt;
      piece.object.rotation.z += piece.spin.z * dt;
      if (piece.age > FALL_SECONDS) piece.object.removeFromParent();
    }
    for (let index = falling.length - 1; index >= 0; index -= 1) {
      if (!falling[index].object.parent) falling.splice(index, 1);
    }
    for (const side of ['left', 'right'] as const) jewels[side]?.update(dt, beatPhase);
  };
  boss.setForkAngle = (radians) => {
    forkAngle = radians;
  };
  boss.forkAngle = () => forkAngle;
  boss.tick = tick;
  boss.setJewelLifted = (side, lifted) => {
    jewels[side]?.setLifted(lifted);
  };
  // Sheared pieces are lit brass with no emissive. They fall outward, down and
  // away from the rail (the camera is at +z), so none can cross the bob path.
  boss.breakJewel = (side) => {
    if (broken[side]) return;
    broken[side] = true;
    const sign = side === 'right' ? 1 : -1;
    falling.push({
      object: tips[side],
      velocity: new Vector3(sign * 9, -5, -9),
      spin: new Vector3(2.5, 1.5, sign * 3),
      age: 0,
    });
    falling.push({
      object: plates[side],
      velocity: new Vector3(sign * 5, -2, -11),
      spin: new Vector3(1.8, 0.6, sign * 2.2),
      age: 0,
    });
  };
  boss.exposeArbor = (open) => {
    arborOpenTarget = open ? 1 : 0;
  };
  boss.setStage = (next) => {
    stage = next;
    if (next === 'broken') arborOpenTarget = 1;
  };
  boss.setWheelSpin = (rate) => {
    wheelSpin = rate;
  };
  boss.attachJewel = (side, rig) => {
    jewels[side] = rig;
  };
  boss.seatPart = (part, object) => {
    const anchor = anchors[part];
    anchor.getWorldPosition(object.position);
    anchor.getWorldQuaternion(object.quaternion);
  };
  boss.dispose = () => {
    socketGlow.dispose();
    disposeObject3D(group);
  };
  boss.update(0, 0);
  return boss;
}

// ---- preview harness --------------------------------------------------------------------

export type BossPreviewStage = 'jewels-right' | 'jewels-left' | 'broken-left' | 'arbor' | 'free';
export type BossPreviewView = 'orbit' | 'station' | 'front';

/** The pendulum pivot relative to the mount; the ride camera swings about it with the bob. */
const PENDULUM_PIVOT_OFFSET = new Vector3(0, -60, -14);
/** The ride camera relative to the mount at rest: the bob plus PENDULUM_RIDE_OFFSET, aimed PENDULUM_RIDE_AIM_DROP below the mount (gameplay.ts RIDE_STATION and BOSS_AIM). */
const STATION_OFFSET = new Vector3(0, -160, 106);
const STATION_AIM = new Vector3(0, -66, 0);
/** The agreed boss pose for the camera designer: on the pendulum frame 35 m below the pivot and 120 m in front of it, aimed at the fork pivot. */
const FRONT_OFFSET = PENDULUM_PIVOT_OFFSET.clone().add(new Vector3(0, -35, 120));

/** The works lamp relative to the mount, as the pendulum set previews it. */
const PREVIEW_LAMP_OFFSET = new Vector3(0, 260, 106);
const PREVIEW_LAMP_INTENSITY = 25000;

/**
 * Snapshot entry point: the body with jewel and arbor targets seated, posed
 * in one loop stage, and lit under the level's sky bake and works lamp.
 * `view` 'orbit' lets the tool frame the body;
 * 'station' pins the camera where gameplay rides it, swung with the bob by
 * the stage's fork angle; 'front' pins it at the agreed boss pose, 35 m
 * below the pendulum pivot and 120 m in front of it, swung the same way. For
 * `npm run snapshot -- --module src/levels/escapement/visuals/escapement-boss.ts --export previewBoss --args '["arbor","station"]'`.
 */
export function previewBoss(stageName: BossPreviewStage = 'jewels-right', view: BossPreviewView = 'orbit') {
  return withPreviewEnvironment(() => buildBossPreview(stageName, view));
}

function buildBossPreview(stageName: BossPreviewStage, view: BossPreviewView) {
  const stage = new Group();
  const boss = createEscapementBoss();
  const jewels = { left: createPalletJewel('left'), right: createPalletJewel('right') };
  const arbor = createArborTarget();
  boss.attachJewel('left', jewels.left);
  boss.attachJewel('right', jewels.right);
  stage.add(boss, jewels.left, jewels.right, arbor);

  // The jewel stages pose the fork at the 20-degree amplitude; the arbor stage at 40 degrees, near the bottom of the swing.
  const angle = stageName === 'jewels-left' ? -0.35 : stageName === 'jewels-right' ? 0.35 : stageName === 'broken-left' ? 0.35 : 0.12;
  boss.setForkAngle(angle);
  const lifted = liftedSide(angle);
  boss.setJewelLifted('left', lifted === 'left');
  boss.setJewelLifted('right', lifted === 'right');
  jewels[lifted].setLocked(stageName === 'jewels-right');

  const step = 1 / 60;
  let seconds = 1.2;
  // A broken jewel is a dead target: it leaves the scene rather than hiding.
  if (stageName === 'broken-left') {
    boss.breakJewel('left');
    stage.remove(jewels.left);
    seconds = 0.45;
  }
  if (stageName === 'arbor' || stageName === 'free') {
    boss.breakJewel('left');
    boss.breakJewel('right');
    stage.remove(jewels.left, jewels.right);
    boss.setStage(stageName === 'arbor' ? 'arbor' : 'broken');
    boss.exposeArbor(true);
    boss.setWheelSpin(9);
    seconds = 5;
  }
  arbor.visible = stageName === 'arbor' || stageName === 'free';
  for (let t = 0; t < seconds; t += step) {
    boss.update(step, (t / 0.5) % 1);
    arbor.update(step, (t / 0.5) % 1);
  }
  boss.updateMatrixWorld(true);
  if (jewels.left.parent) boss.seatPart('jewelLeft', jewels.left);
  if (jewels.right.parent) boss.seatPart('jewelRight', jewels.right);
  boss.seatPart('arbor', arbor);

  stage.add(createLamp({ name: 'preview-lamp', position: PREVIEW_LAMP_OFFSET.clone(), intensity: PREVIEW_LAMP_INTENSITY }));
  if (view === 'orbit') return stage;

  const rest = view === 'station' ? STATION_OFFSET : FRONT_OFFSET;
  const cameraPosition = rest.clone().sub(PENDULUM_PIVOT_OFFSET).applyAxisAngle(new Vector3(0, 0, 1), angle).add(PENDULUM_PIVOT_OFFSET);
  const aim = view === 'station' ? STATION_AIM : new Vector3(0, 0, 0);
  const direction = aim.clone().sub(cameraPosition).normalize();
  return pinSnapshotView(stage, cameraPosition, direction);
}
