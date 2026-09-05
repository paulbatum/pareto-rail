import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGearFamily, meshedPhase, pitchRadius, toothPhase, type GearFamily, type GearInstance, type GearSpec } from '../gears';
import { createBrassMaterial, createPreviewLights, createSteelMaterial, pinSnapshotView } from '../materials';

// The Train: the great wheels the rail rides. Every wheel spins about +y, so
// the rail on a rim sees the far plates yaw around it while the wheel face
// stays level with the camera and out of frame. Detail sits on the plates the
// camera looks at and on the next wheel in the chain.

export const GREAT_30: GearSpec = { teeth: 30, module: 10, width: 22, rimWidth: 16, hubRadius: 18, spokes: 8, spokeWidth: 8, spokeDepth: 10 };
export const GREAT_20: GearSpec = { teeth: 20, module: 10, width: 22, rimWidth: 14, hubRadius: 16, spokes: 6, spokeWidth: 8, spokeDepth: 10 };
export const MID_16: GearSpec = { teeth: 16, module: 6, width: 8, rimWidth: 7, hubRadius: 8, spokes: 5, spokeWidth: 4 };
export const SMALL_10: GearSpec = { teeth: 10, module: 6, width: 8, rimWidth: 5, hubRadius: 6, spokes: 3, spokeWidth: 3.5 };

const UP = new Vector3(0, 1, 0);
/** Rail height above a wheel's top face. */
export const RIDE_HEIGHT = 10;

/**
 * Radius of the circle the rail rides: the pitch circle, so at a hand-off the
 * exit point of one wheel is the entry point of the next and the meshing teeth
 * pass under the camera.
 */
export function rideRadius(spec: GearSpec) {
  return pitchRadius(spec);
}

export type ChainArc = {
  spec: GearSpec;
  /** Signed arc the rail rides, radians. Positive turns the heading toward +x when travelling -z. */
  arc: number;
  /** Seconds the rail spends on this wheel. */
  seconds: number;
};

export type TrainWheel = {
  spec: GearSpec;
  center: Vector3;
  /** Signed spin rate about +y in radians per second. */
  rate: number;
  phase: number;
  /** Polar angle (about +y, from +x toward +z) where the rail joins the rim. */
  entryAngle: number;
  exitAngle: number;
  /** World point on the ride circle where the rail leaves this wheel, and its heading there. */
  exit: Vector3;
  exitHeading: Vector3;
  /** World point on the ride circle where the rail joins this wheel. */
  entry: Vector3;
};

function polarXZ(center: Vector3, radius: number, angle: number, y: number) {
  return new Vector3(center.x + Math.cos(angle) * radius, y, center.z + Math.sin(angle) * radius);
}

/**
 * Lays meshing wheels along the rail. The rail arrives at `firstEntry`
 * travelling along `heading` on the first wheel's ride circle, rides each wheel
 * through its arc, and hands off where the pitch circles touch. Rim speeds
 * match across a hand-off, so the wheels stay meshed as they spin.
 */
export function chainWheels(firstEntry: Vector3, heading: Vector3, arcs: ChainArc[], wheelCenterY: number): TrainWheel[] {
  const wheels: TrainWheel[] = [];
  const railY = firstEntry.y;
  let direction = heading.clone().setY(0).normalize();
  let previous: TrainWheel | null = null;
  for (const { spec, arc, seconds } of arcs) {
    const ride = rideRadius(spec);
    let center: Vector3;
    if (!previous) {
      // The centre lies to the side of the heading: to the right of travel for a positive arc.
      const side = new Vector3(direction.z, 0, -direction.x).multiplyScalar(arc > 0 ? -1 : 1);
      center = firstEntry.clone().addScaledVector(side, ride);
    } else {
      // Pitch circles touch: the new centre continues along the previous wheel's exit radius.
      const outward = previous.exit.clone().sub(previous.center).setY(0).normalize();
      center = previous.center.clone().addScaledVector(outward, pitchRadius(previous.spec) + pitchRadius(spec));
    }
    center.y = wheelCenterY;
    const entryAngle = previous
      ? Math.atan2(previous.center.z - center.z, previous.center.x - center.x)
      : Math.atan2(firstEntry.z - center.z, firstEntry.x - center.x);
    const exitAngle = entryAngle + arc;
    const entry = polarXZ(center, ride, entryAngle, railY);
    const exit = polarXZ(center, ride, exitAngle, railY);
    const exitHeading = new Vector3(-Math.sin(exitAngle), 0, Math.cos(exitAngle)).multiplyScalar(arc > 0 ? 1 : -1);
    const rate = -arc / seconds;
    let phase = 0;
    if (previous) {
      const toNext = center.clone().sub(previous.center).setY(0).normalize();
      phase = meshedPhase({ spec: previous.spec, axis: UP, phase: previous.phase }, toNext, spec);
    }
    const wheel: TrainWheel = { spec, center, rate, phase, entryAngle, exitAngle, entry, exit, exitHeading };
    wheels.push(wheel);
    previous = wheel;
    direction = exitHeading;
  }
  return wheels;
}

/** Point on a wheel's ride circle at height `y`, for the rail's parent frame. */
export function rimPoint(wheel: TrainWheel, angle: number, y: number) {
  return polarXZ(wheel.center, rideRadius(wheel.spec), angle, y);
}

export type TrainLayout = {
  wheels: TrainWheel[];
  /** Height of the wheels' top faces. */
  wheelTop: number;
  backPlate: { z: number; xMin: number; xMax: number; yMin: number; yMax: number; doorway: { x: number; y: number; width: number; height: number } };
  leftPlate: { x: number; zMin: number; zMax: number; yMin: number; yMax: number };
  rightPlate: { x: number; zMin: number; zMax: number; yMin: number; yMax: number };
  /** Height of the plate far below the wheels. */
  floorY: number;
};

type PlateGear = { spec: GearSpec; position: Vector3; axis: Vector3; rate: number; phase?: number };

/** Meshing pair mounted on a plate: `first` drives `second`, placed `angle` radians around it in the plate plane. */
function plateGearPair(first: PlateGear, second: GearSpec, angle: number, planeU: Vector3, planeV: Vector3): PlateGear[] {
  const direction = planeU.clone().multiplyScalar(Math.cos(angle)).addScaledVector(planeV, Math.sin(angle)).normalize();
  const distance = pitchRadius(first.spec) + pitchRadius(second);
  const position = first.position.clone().addScaledVector(direction, distance);
  const ratio = first.spec.teeth / second.teeth;
  const driver = { ...first, phase: first.phase ?? toothPhase(first.spec, first.axis, direction) };
  return [
    driver,
    { spec: second, position, axis: first.axis, rate: -first.rate * ratio, phase: meshedPhase({ spec: driver.spec, axis: driver.axis, phase: driver.phase }, direction, second) },
  ];
}

function createPlates(layout: TrainLayout) {
  const parts: BufferGeometry[] = [];
  const thickness = 10;
  const { backPlate: back, leftPlate: left, rightPlate: right } = layout;
  const door = back.doorway;
  const push = (geometry: BoxGeometry, x: number, y: number, z: number) => {
    geometry.translate(x, y, z);
    parts.push(geometry.toNonIndexed());
    geometry.dispose();
  };
  // Back plate: four boxes framing the doorway the rail leaves through.
  const doorLeft = door.x - door.width / 2;
  const doorRight = door.x + door.width / 2;
  const doorBottom = door.y - door.height / 2;
  const doorTop = door.y + door.height / 2;
  push(new BoxGeometry(doorLeft - back.xMin, back.yMax - back.yMin, thickness), (back.xMin + doorLeft) / 2, (back.yMin + back.yMax) / 2, back.z);
  push(new BoxGeometry(back.xMax - doorRight, back.yMax - back.yMin, thickness), (doorRight + back.xMax) / 2, (back.yMin + back.yMax) / 2, back.z);
  push(new BoxGeometry(door.width, doorBottom - back.yMin, thickness), door.x, (back.yMin + doorBottom) / 2, back.z);
  push(new BoxGeometry(door.width, back.yMax - doorTop, thickness), door.x, (doorTop + back.yMax) / 2, back.z);
  // Side plates.
  push(new BoxGeometry(thickness, left.yMax - left.yMin, left.zMax - left.zMin), left.x, (left.yMin + left.yMax) / 2, (left.zMin + left.zMax) / 2);
  push(new BoxGeometry(thickness, right.yMax - right.yMin, right.zMax - right.zMin), right.x, (right.yMin + right.yMax) / 2, (right.zMin + right.zMax) / 2);
  // Floor plate far below the wheels.
  push(new BoxGeometry(right.x - left.x + 80, 8, back.z * -1 + 260), (left.x + right.x) / 2, layout.floorY, back.z / 2 + 40);
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 42, seamAniso: 1.6, tarnish: 0.45, roughness: 0.5, brushAxis: new Vector3(0, 1, 0) }));
}

function createSteelwork(layout: TrainLayout, plateGears: PlateGear[]) {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry) => {
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  // Pylon under each wheel, arbor above.
  for (const wheel of layout.wheels) {
    const pylon = new CylinderGeometry(15, 22, wheel.center.y - layout.floorY, 20);
    pylon.translate(wheel.center.x, (wheel.center.y + layout.floorY) / 2, wheel.center.z);
    add(pylon);
    const arbor = new CylinderGeometry(9, 9, 120, 16);
    arbor.translate(wheel.center.x, wheel.center.y + 50, wheel.center.z);
    add(arbor);
  }
  // Pillars at the plate corners.
  const { backPlate: back, leftPlate: left, rightPlate: right } = layout;
  for (const [x, z] of [
    [left.x + 14, back.z + 14],
    [right.x - 14, back.z + 14],
    [left.x + 14, left.zMax - 14],
    [right.x - 14, right.zMax - 14],
  ]) {
    const pillar = new CylinderGeometry(10, 10, back.yMax - back.yMin, 14);
    pillar.translate(x, (back.yMin + back.yMax) / 2, z);
    add(pillar);
  }
  // Arbors through the plate-mounted gears.
  for (const gear of plateGears) {
    const arbor = new CylinderGeometry(gear.spec.hubRadius * 0.55, gear.spec.hubRadius * 0.55, gear.spec.width * 3, 12);
    const axis = gear.axis;
    if (Math.abs(axis.x) > 0.9) arbor.rotateZ(Math.PI / 2);
    else if (Math.abs(axis.z) > 0.9) arbor.rotateX(Math.PI / 2);
    arbor.translate(gear.position.x, gear.position.y, gear.position.z);
    add(arbor);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createSteelMaterial({ brushAxis: new Vector3(0, 1, 0), tarnish: 0.25 }));
}

export type Train = {
  group: Group;
  families: GearFamily[];
};

/** Gears mounted on the three plates, facing the camera on the rims. */
function createPlateGears(layout: TrainLayout): PlateGear[] {
  const { backPlate: back, leftPlate: left, rightPlate: right } = layout;
  const zAxis = new Vector3(0, 0, 1);
  const xAxis = new Vector3(1, 0, 0);
  const gears: PlateGear[] = [];
  const backFace = back.z + 5 + 9;
  gears.push(...plateGearPair(
    { spec: GREAT_30, position: new Vector3(back.xMin + 190, 150, backFace), axis: zAxis, rate: 0.08 },
    GREAT_20,
    Math.PI / 6,
    xAxis,
    UP,
  ));
  gears.push(...plateGearPair(
    { spec: MID_16, position: new Vector3(back.xMax - 160, -140, backFace), axis: zAxis, rate: -0.5 },
    SMALL_10,
    -Math.PI / 4,
    xAxis,
    UP,
  ));
  gears.push(...plateGearPair(
    { spec: MID_16, position: new Vector3(back.xMax - 60, 90, backFace), axis: zAxis, rate: 0.35 },
    SMALL_10,
    Math.PI * 0.75,
    xAxis,
    UP,
  ));
  const leftFace = left.x + 5 + 6;
  gears.push(...plateGearPair(
    { spec: MID_16, position: new Vector3(leftFace, 40, left.zMin + 120), axis: xAxis, rate: 0.4 },
    SMALL_10,
    Math.PI / 5,
    zAxis,
    UP,
  ));
  gears.push(...plateGearPair(
    { spec: GREAT_20, position: new Vector3(leftFace + 4, -150, left.zMax - 160), axis: xAxis, rate: -0.12 },
    MID_16,
    Math.PI * 0.6,
    zAxis,
    UP,
  ));
  const rightFace = right.x - 5 - 6;
  gears.push(...plateGearPair(
    { spec: GREAT_20, position: new Vector3(rightFace - 4, 120, right.zMin + 200), axis: xAxis, rate: 0.1 },
    MID_16,
    -Math.PI * 0.7,
    zAxis,
    UP,
  ));
  gears.push(...plateGearPair(
    { spec: MID_16, position: new Vector3(rightFace, -120, right.zMax - 120), axis: xAxis, rate: -0.45 },
    SMALL_10,
    Math.PI * 0.2,
    zAxis,
    UP,
  ));
  return gears;
}

export function createTrain(layout: TrainLayout): Train {
  const group = new Group();
  group.name = 'train';
  const plateGears = createPlateGears(layout);

  const bySpec = new Map<GearSpec, GearInstance[]>();
  const instance = (spec: GearSpec, entry: GearInstance) => {
    const list = bySpec.get(spec) ?? [];
    list.push(entry);
    bySpec.set(spec, list);
  };
  for (const wheel of layout.wheels) {
    instance(wheel.spec, { position: wheel.center, axis: UP, rate: wheel.rate, phase: wheel.phase });
  }
  for (const gear of plateGears) {
    instance(gear.spec, { position: gear.position, axis: gear.axis, rate: gear.rate, phase: gear.phase });
  }
  const families: GearFamily[] = [];
  for (const [spec, instances] of bySpec) {
    const family = createGearFamily(spec, instances);
    families.push(family);
    group.add(family.mesh);
  }

  group.add(createPlates(layout));
  group.add(createSteelwork(layout, plateGears));
  return { group, families };
}

export const PREVIEW_TRAIN_ARCS: ChainArc[] = [
  { spec: GREAT_30, arc: (40 * Math.PI) / 180, seconds: 6 },
  { spec: GREAT_20, arc: (-80 * Math.PI) / 180, seconds: 8 },
  { spec: GREAT_30, arc: (40 * Math.PI) / 180, seconds: 6 },
  { spec: GREAT_20, arc: (-60 * Math.PI) / 180, seconds: 6 },
];

export function previewTrainLayout(): TrainLayout {
  const wheelTop = -8;
  const wheels = chainWheels(new Vector3(54, wheelTop + RIDE_HEIGHT, -110), new Vector3(0, 0, -1), PREVIEW_TRAIN_ARCS, wheelTop - GREAT_30.width / 2);
  return {
    wheels,
    wheelTop,
    backPlate: { z: -490, xMin: -380, xMax: 520, yMin: -330, yMax: 330, doorway: { x: 54, y: 0, width: 44, height: 56 } },
    leftPlate: { x: -380, zMin: -490, zMax: 60, yMin: -330, yMax: 330 },
    rightPlate: { x: 520, zMin: -490, zMax: 60, yMin: -330, yMax: 330 },
    floorY: -400,
  };
}

/** Snapshot factory: the whole train under a lamp above the middle wheel. */
export function previewTrain() {
  const layout = previewTrainLayout();
  const { group } = createTrain(layout);
  group.add(createPreviewLights(new Vector3(70, 0, -250), 320));
  return group;
}

/** Snapshot factory: the four ride wheels alone. */
export function previewTrainWheels() {
  const layout = previewTrainLayout();
  const group = new Group();
  const bySpec = new Map<GearSpec, GearInstance[]>();
  for (const wheel of layout.wheels) {
    const list = bySpec.get(wheel.spec) ?? [];
    list.push({ position: wheel.center, axis: UP, rate: wheel.rate, phase: wheel.phase });
    bySpec.set(wheel.spec, list);
  }
  for (const [spec, instances] of bySpec) group.add(createGearFamily(spec, instances).mesh);
  group.add(createPreviewLights(new Vector3(100, -15, -280), 260));
  return group;
}

/** Snapshot factory: the view from the rail camera riding the first wheel's rim, a third of the way round its arc. */
export function previewTrainRide() {
  const layout = previewTrainLayout();
  const { group } = createTrain(layout);
  group.add(createPreviewLights(new Vector3(60, 40, -200), 220));
  const wheel = layout.wheels[0];
  const angle = wheel.entryAngle + (wheel.exitAngle - wheel.entryAngle) * 0.35;
  const position = rimPoint(wheel, angle, layout.wheelTop + RIDE_HEIGHT);
  const heading = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
  return pinSnapshotView(group, position, heading);
}

/** Snapshot factory: the view from the second wheel, looking at the left plate. */
export function previewTrainRideSecond() {
  const layout = previewTrainLayout();
  const { group } = createTrain(layout);
  group.add(createPreviewLights(new Vector3(60, 40, -200), 220));
  const wheel = layout.wheels[1];
  const angle = wheel.entryAngle + (wheel.exitAngle - wheel.entryAngle) * 0.5;
  const position = rimPoint(wheel, angle, layout.wheelTop + RIDE_HEIGHT);
  const heading = new Vector3(Math.sin(angle), 0, -Math.cos(angle));
  return pinSnapshotView(group, position, heading);
}
