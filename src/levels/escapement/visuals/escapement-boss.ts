import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
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
import { previewLightRig, type EnemyRig } from './enemies';
import { RUBY } from './palette';

// The Escapement: an anchor fork pivoted above a 30-tooth escape wheel, under
// a crown wheel. The body is scenery-scale lit brass and steel. Its lockable
// parts (two pallet jewels, the arbor) are separate target rigs that gameplay
// seats at the body's anchors every frame with `seatPart`, so the runner sees
// one mesh per target while the body rocks as one piece.
//
// Coordinates: the fork pivot is the group origin. The wheel hangs below it in
// the XY plane and the front of the body faces +z.

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
const WHEEL_CENTER = new Vector3(0, -33, 0);
const WHEEL_TIP_RADIUS = 24.5;
const WHEEL_ROOT_RADIUS = 21.6;
const WHEEL_RIM_INNER = 16;
const WHEEL_DEPTH = 3.6;
const CROWN_CENTER = new Vector3(0, 27, -9);
const CROWN_OUTER = 29;
const CROWN_INNER = 24.8;
const CROWN_TEETH = 72;
const CROWN_DEPTH = 3.4;
const ARBOR_RADIUS = 2.2;
const ARBOR_LENGTH = 14;
const ARBOR_FRONT = ARBOR_LENGTH / 2;
const FORK_DEPTH = 4.2;
const ARM_THICKNESS = 5;
const PIVOT_RADIUS = 7;
const TIP_X = 19;
const TIP_Y = -15;
/** Jewel centre from the tip block's centre: proud of the block's front face, so the camera below and in front sees the whole slab. */
const JEWEL_OFFSET = new Vector3(2.0, -3.4, 4.6);
/** The claws straddle the jewel's depth in front of the block. */
const CLAW_GAP = 1.75;
const SNAP_RATE = 22;

// ---- geometry ----------------------------------------------------------------------

function toothedRing(outer: number, root: number, inner: number, teeth: number, club: boolean) {
  const shape = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    // A club tooth leans forward: a long ramp up the back, a short flat at the
    // tip, a steep face at the front. A blunt tooth is symmetric.
    const points: Array<[number, number]> = club
      ? [[a, root], [a + step * 0.5, outer], [a + step * 0.64, outer], [a + step * 0.66, root + (outer - root) * 0.35], [a + step * 0.7, root]]
      : [[a, root], [a + step * 0.2, outer], [a + step * 0.5, outer], [a + step * 0.7, root]];
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

function extrude(shape: Shape, depth: number, bevel = 0.12) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
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

function escapeWheelGeometry() {
  const rim = extrude(toothedRing(WHEEL_TIP_RADIUS, WHEEL_ROOT_RADIUS, WHEEL_RIM_INNER, ESCAPE_WHEEL_TEETH, true), WHEEL_DEPTH);
  const pieces = [nonIndexed(rim)];
  addSpokes(pieces, 5, WHEEL_RIM_INNER, WHEEL_DEPTH, 2.0, 3.4);
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

/** Spokes from a hub to the rim, merged into `pieces`. */
function addSpokes(pieces: BufferGeometry[], count: number, rimInner: number, depth: number, width: number, hubRadius: number) {
  for (let i = 0; i < count; i += 1) {
    const spoke = new BoxGeometry(width, rimInner + 0.6, depth * 0.7);
    spoke.translate(0, (rimInner + 0.6) / 2, 0);
    spoke.rotateZ((i / count) * Math.PI * 2);
    pieces.push(nonIndexed(spoke));
  }
  const hub = new CylinderGeometry(hubRadius, hubRadius, depth * 1.4, 16);
  hub.rotateX(Math.PI / 2);
  pieces.push(nonIndexed(hub));
}

/** The crown wheel: blunt teeth, a rim, six spokes and a hub. */
function crownWheelGeometry() {
  const rim = extrude(toothedRing(CROWN_OUTER, CROWN_OUTER - 1.8, CROWN_INNER, CROWN_TEETH, false), CROWN_DEPTH, 0.2);
  const pieces = [nonIndexed(rim)];
  addSpokes(pieces, 6, CROWN_INNER, CROWN_DEPTH, 2.4, 4.5);
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

// The anchor: a pivot disc with two forged bars that reach down and out to the
// tips. The bars stop short of the pallets; the tips are separate meshes so
// they can shear.
function forkGeometry() {
  const pieces: BufferGeometry[] = [];
  const disc = new CylinderGeometry(PIVOT_RADIUS, PIVOT_RADIUS, FORK_DEPTH, 24);
  disc.rotateX(Math.PI / 2);
  pieces.push(nonIndexed(disc));
  const tipReach = Math.hypot(TIP_X, TIP_Y) - 1.5;
  for (const sign of [1, -1]) {
    const arm = new BoxGeometry(tipReach, ARM_THICKNESS, FORK_DEPTH);
    arm.translate(tipReach / 2, 0, 0);
    arm.rotateZ(Math.atan2(TIP_Y, sign * TIP_X));
    pieces.push(nonIndexed(arm));
    // A brace from the disc rim to mid-arm gives the anchor its shoulder.
    const brace = new BoxGeometry(12, 2, FORK_DEPTH * 0.7);
    brace.translate(6, 0, 0);
    brace.rotateZ(Math.atan2(-3.2, sign * 12));
    brace.translate(sign * 2.5, -5, 0);
    pieces.push(nonIndexed(brace));
  }
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

/** A pallet tip: a brass block with two claws that hold the jewel in front of its face. Built for the right side; the left is mirrored by rotation. */
function tipGeometry() {
  const block = new BoxGeometry(7, 5.6, FORK_DEPTH + 1.2);
  block.rotateZ(-0.7);
  const pieces = [nonIndexed(block)];
  for (const side of [1, -1]) {
    const claw = new BoxGeometry(1.1, 4.6, 1.1);
    claw.translate(0, 1.3, JEWEL_OFFSET.z + side * CLAW_GAP);
    claw.rotateZ(-0.7);
    claw.translate(JEWEL_OFFSET.x * 0.8, JEWEL_OFFSET.y * 0.8, 0);
    pieces.push(nonIndexed(claw));
  }
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

function shutterGeometry() {
  const geometry = new CylinderGeometry(3.4, 3.4, 0.7, 24, 1, false, 0, Math.PI);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// ---- target rigs ----------------------------------------------------------------------

// A faceted slab about a quarter of the arm length, its long axis along the
// pallet face where the wheel's teeth land. Sized to read from the boss
// station 95 units away.
const JEWEL_LENGTH = 7;
const JEWEL_HEIGHT = 3.4;
const JEWEL_DEPTH = 2.2;

const jewelGeometry = (() => {
  let cached: BufferGeometry | null = null;
  return () => {
    if (!cached) {
      const half = JEWEL_LENGTH / 2;
      const rise = JEWEL_HEIGHT / 2;
      const outline = new Shape([
        new Vector2(-half, -rise * 0.55),
        new Vector2(-half * 0.8, -rise),
        new Vector2(half * 0.8, -rise),
        new Vector2(half, -rise * 0.55),
        new Vector2(half, rise * 0.55),
        new Vector2(half * 0.8, rise),
        new Vector2(-half * 0.8, rise),
        new Vector2(-half, rise * 0.55),
      ]);
      cached = new ExtrudeGeometry(outline, { depth: JEWEL_DEPTH, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 1 });
      cached.translate(0, 0, -JEWEL_DEPTH / 2);
    }
    return cached;
  };
})();

/** A pallet jewel target. Lifted: the whole slab white-hot, lockable. Engaged: dull ruby. */
export function createPalletJewel(side: JewelSide): PalletJewelRig {
  const group = new Group();
  const paint = createTargetPaint();
  const stone = new Mesh(jewelGeometry(), paint.accent('ruby-dull', 0, true));
  group.add(stone);
  // The spark's tips reach through the slab's front and back faces.
  const spark = new Mesh(new OctahedronGeometry(1.0, 1), paint.spark(3));
  spark.scale.set(1, 1, JEWEL_DEPTH / 2 + 0.9);
  group.add(spark);
  group.userData.kind = 'pallet-jewel';
  group.userData.side = side;
  group.userData.accent = RUBY.clone();
  group.userData.lockRingScale = 2.4;

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

/** The arbor target: a ruby collet around the steel arbor's end with a white-hot centre. */
export function createArborTarget(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  group.add(new Mesh(new TorusGeometry(2.0, 0.55, 8, 28), paint.accent('ruby')));
  const spark = new Mesh(new OctahedronGeometry(1.2, 1), paint.spark(3));
  group.add(spark);
  group.userData.kind = 'arbor';
  group.userData.accent = RUBY.clone();
  group.userData.lockRingScale = 2.2;

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
      heat: 0,
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
    const angle = side === 'right' ? -Math.PI / 2 + 0.7 : -Math.PI / 2 - 0.7;
    const plate = new Mesh(new BoxGeometry(9, 2.4, 2.6), brass);
    plate.position.set(
      CROWN_CENTER.x + Math.cos(angle) * (CROWN_INNER - 1.0),
      CROWN_CENTER.y + Math.sin(angle) * (CROWN_INNER - 1.0),
      CROWN_CENTER.z + 3.0,
    );
    plate.rotation.z = angle + Math.PI / 2;
    group.add(plate);
    plates[side] = plate;
  }

  // Escape wheel below the pivot.
  const wheel = new Mesh(escapeWheelGeometry(), brass);
  wheel.position.copy(WHEEL_CENTER);
  group.add(wheel);

  // The fork: arms, tips, and the pivot hub.
  const fork = new Group();
  fork.add(new Mesh(forkGeometry(), steel));
  const hub = new Mesh(new CylinderGeometry(4.8, 4.8, FORK_DEPTH + 1.2, 24), brass);
  hub.rotation.x = Math.PI / 2;
  fork.add(hub);
  const tipShape = tipGeometry();
  const tips: Record<JewelSide, Group> = { left: new Group(), right: new Group() };
  const anchors: Record<BossPart, Object3D> = { jewelLeft: new Object3D(), jewelRight: new Object3D(), arbor: new Object3D() };
  for (const side of ['left', 'right'] as const) {
    const tip = tips[side];
    const sign = side === 'right' ? 1 : -1;
    tip.position.set(sign * TIP_X, TIP_Y, 0);
    tip.rotation.y = side === 'right' ? 0 : Math.PI;
    tip.add(new Mesh(tipShape, brass));
    const anchor = side === 'right' ? anchors.jewelRight : anchors.jewelLeft;
    anchor.position.copy(JEWEL_OFFSET);
    // The slab's long axis follows the tip block's face. The left tip is the
    // right one turned about y, so its anchor turns back to face +z.
    anchor.rotation.set(0, side === 'right' ? 0 : Math.PI, -0.7);
    tip.add(anchor);
    fork.add(tip);
  }
  group.add(fork);

  // The arbor runs through the pivot and out both faces, with a brass collet
  // in front of the hub. Two brass shutters cover its front end until stage two.
  const arbor = new Mesh(new CylinderGeometry(ARBOR_RADIUS, ARBOR_RADIUS, ARBOR_LENGTH, 16), steel);
  arbor.rotation.x = Math.PI / 2;
  group.add(arbor);
  const collet = new Mesh(new TorusGeometry(ARBOR_RADIUS + 0.7, 0.7, 8, 24), brass);
  collet.position.z = FORK_DEPTH / 2 + 1.6;
  group.add(collet);
  anchors.arbor.position.set(0, 0, ARBOR_FRONT + 0.4);
  group.add(anchors.arbor);
  const shutterShape = shutterGeometry();
  const shutters = [1, -1].map((sign) => {
    const shutter = new Mesh(shutterShape, brass);
    shutter.rotation.z = sign === 1 ? -Math.PI / 2 : Math.PI / 2;
    shutter.position.z = ARBOR_FRONT - 0.2;
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
    for (const shutter of shutters) shutter.mesh.position.x = shutter.sign * arborOpen * 5.0;

    for (const piece of falling) {
      piece.age += dt;
      piece.velocity.y -= 24 * dt;
      piece.object.position.addScaledVector(piece.velocity, dt);
      piece.object.rotation.x += piece.spin.x * dt;
      piece.object.rotation.y += piece.spin.y * dt;
      piece.object.rotation.z += piece.spin.z * dt;
      if (piece.age > 4) piece.object.removeFromParent();
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
  boss.breakJewel = (side) => {
    if (broken[side]) return;
    broken[side] = true;
    const sign = side === 'right' ? 1 : -1;
    falling.push({
      object: tips[side],
      velocity: new Vector3(sign * 6, -3, 4),
      spin: new Vector3(2.5, 1.5, sign * 3),
      age: 0,
    });
    falling.push({
      object: plates[side],
      velocity: new Vector3(sign * 3, -1, 6),
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
    disposeObject3D(group);
  };
  boss.update(0, 0);
  return boss;
}

// ---- preview harness --------------------------------------------------------------------

export type BossPreviewStage = 'jewels-right' | 'jewels-left' | 'broken-left' | 'arbor' | 'free';

/**
 * Snapshot entry point: the body with jewel and arbor targets seated, posed
 * in one loop stage, and lit. For
 * `npm run snapshot -- --module src/levels/escapement/visuals/escapement-boss.ts --export previewBoss --args '["arbor"]'`.
 */
export function previewBoss(stageName: BossPreviewStage = 'jewels-right') {
  const stage = new Group();
  const boss = createEscapementBoss();
  const jewels = { left: createPalletJewel('left'), right: createPalletJewel('right') };
  const arbor = createArborTarget();
  boss.attachJewel('left', jewels.left);
  boss.attachJewel('right', jewels.right);
  stage.add(boss, jewels.left, jewels.right, arbor);

  const angle = stageName === 'jewels-left' ? -0.16 : 0.16;
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

  stage.add(previewLightRig(new Vector3(0, -8, 0), 12));
  return stage;
}
