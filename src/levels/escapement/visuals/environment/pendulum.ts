import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGearFamily, meshedPhase, pitchRadius, type GearFamily, type GearSpec } from '../gears';
import { createBrassMaterial, createPreviewLights, createSteelMaterial, pinSnapshotView } from '../materials';

// The Pendulum: rod and bob hanging from the back cock, the escape wheel and
// the crown wheel on the plate above. The swing is a rotation about +z through
// the pivot; positive angle carries the bob toward +x. The escapement boss body
// (the anchor fork) belongs to another module and attaches at `mount`.

export type PendulumLayout = {
  pivot: Vector3;
  /** Pivot-to-bob-centre distance. */
  length: number;
  bobRadius: number;
  /** Escape wheel centre; its axis is +z. */
  escapeWheel: Vector3;
  crownWheel: Vector3;
  /** Where the anchor fork pivots. */
  mount: Vector3;
  plate: { z: number; xMin: number; xMax: number; yMin: number; yMax: number };
};

export const ESCAPE_WHEEL: GearSpec = { teeth: 30, module: 4, width: 6, rimWidth: 7, hubRadius: 7, spokes: 5, spokeWidth: 3 };
export const CROWN_WHEEL: GearSpec = { teeth: 48, module: 4, width: 8, rimWidth: 10, hubRadius: 10, spokes: 8, spokeWidth: 4 };
const CROWN_PINION: GearSpec = { teeth: 12, module: 4, width: 8, rimWidth: 4, hubRadius: 5, spokes: 3, spokeWidth: 3 };
const Z_AXIS = new Vector3(0, 0, 1);

function nonIndexed(geometry: BufferGeometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  return result;
}

/** Lens-shaped bob profile, axis along y. */
function bobProfile(radius: number, thickness: number) {
  const points: Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = (t - 0.5) * Math.PI;
    points.push(new Vector2(Math.cos(angle) * radius, Math.sin(angle) * thickness * 0.5));
  }
  return points;
}

/** The swinging part: suspension block, rod, rating nut, bob. Built with the pivot at the origin. */
function createSwing(layout: PendulumLayout) {
  const swing = new Group();
  swing.position.copy(layout.pivot);

  const steel: BufferGeometry[] = [];
  const block = new BoxGeometry(14, 22, 10);
  block.translate(0, -11, 0);
  steel.push(nonIndexed(block));
  const rod = new CylinderGeometry(4.2, 4.2, layout.length, 16);
  rod.translate(0, -layout.length / 2 - 8, 0);
  steel.push(nonIndexed(rod));
  const steelMesh = new Mesh(mergeGeometries(steel, false), createSteelMaterial({ tarnish: 0.2, brushAxis: new Vector3(0, 1, 0) }));
  for (const part of steel) part.dispose();
  swing.add(steelMesh);

  const brass: BufferGeometry[] = [];
  const bob = new LatheGeometry(bobProfile(layout.bobRadius, layout.bobRadius * 0.34), 64);
  bob.rotateX(Math.PI / 2);
  bob.translate(0, -layout.length, 0);
  brass.push(nonIndexed(bob));
  const nut = new CylinderGeometry(9, 9, 8, 12);
  nut.translate(0, -layout.length - layout.bobRadius * 0.34 - 6, 0);
  brass.push(nonIndexed(nut));
  const collar = new CylinderGeometry(7, 7, 10, 12);
  collar.translate(0, -layout.length * 0.5, 0);
  brass.push(nonIndexed(collar));
  const brassMesh = new Mesh(mergeGeometries(brass, false), createBrassMaterial({ tarnish: 0.2, roughness: 0.34, brushAxis: new Vector3(0, 0, 1), seamScale: 1 / 22 }));
  for (const part of brass) part.dispose();
  swing.add(brassMesh);
  return swing;
}

function createPlate(layout: PendulumLayout) {
  const { plate } = layout;
  const parts: BufferGeometry[] = [];
  const body = new BoxGeometry(plate.xMax - plate.xMin, plate.yMax - plate.yMin, 10);
  body.translate((plate.xMin + plate.xMax) / 2, (plate.yMin + plate.yMax) / 2, plate.z);
  parts.push(nonIndexed(body));
  // Back cock: the bracket that carries the suspension.
  const cock = new BoxGeometry(60, 26, layout.pivot.z - plate.z + 4);
  cock.translate(layout.pivot.x, layout.pivot.y + 14, (layout.pivot.z + plate.z) / 2 + 2);
  parts.push(nonIndexed(cock));
  // Bosses where the arbors pass through the plate.
  for (const center of [layout.escapeWheel, layout.crownWheel, layout.mount]) {
    const boss = new CylinderGeometry(16, 16, 8, 24);
    boss.rotateX(Math.PI / 2);
    boss.translate(center.x, center.y, plate.z + 8);
    parts.push(nonIndexed(boss));
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 60, tarnish: 0.4, roughness: 0.48, brushAxis: new Vector3(0, 1, 0) }));
}

function createArbors(layout: PendulumLayout) {
  const parts: BufferGeometry[] = [];
  for (const [center, radius] of [
    [layout.escapeWheel, 4],
    [layout.crownWheel, 6],
    [layout.mount, 7],
  ] as const) {
    const arbor = new CylinderGeometry(radius, radius, layout.pivot.z - layout.plate.z + 30, 12);
    arbor.rotateX(Math.PI / 2);
    arbor.translate(center.x, center.y, (center.z + layout.plate.z) / 2 + 6);
    parts.push(nonIndexed(arbor));
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createSteelMaterial({ tarnish: 0.2 }));
}

export type Pendulum = {
  group: Group;
  /** Attach the escapement boss body here; +y is up, +z faces the camera side. */
  mount: Group;
  setAngle(radians: number): void;
  getAngle(): number;
  /** Rotates the escape wheel to an absolute angle; the boss loop steps it a tooth per tick. */
  setEscapeWheelAngle(radians: number): void;
  escapeWheel: GearFamily;
};

export function createPendulum(layout: PendulumLayout): Pendulum {
  const group = new Group();
  group.name = 'pendulum';
  const swing = createSwing(layout);
  group.add(swing);
  group.add(createPlate(layout));
  group.add(createArbors(layout));

  const escapeWheel = createGearFamily(ESCAPE_WHEEL, [{ position: layout.escapeWheel, axis: Z_AXIS, rate: 0 }]);
  group.add(escapeWheel.mesh);
  const crownRate = 0.06;
  const crownPhase = 0;
  const toPinion = new Vector3(1, 0, 0);
  const pinionCenter = layout.crownWheel.clone().addScaledVector(toPinion, pitchRadius(CROWN_WHEEL) + pitchRadius(CROWN_PINION));
  const crown = createGearFamily(CROWN_WHEEL, [{ position: layout.crownWheel, axis: Z_AXIS, rate: crownRate, phase: crownPhase }]);
  const pinion = createGearFamily(CROWN_PINION, [{
    position: pinionCenter,
    axis: Z_AXIS,
    rate: -crownRate * (CROWN_WHEEL.teeth / CROWN_PINION.teeth),
    phase: meshedPhase({ spec: CROWN_WHEEL, axis: Z_AXIS, phase: crownPhase }, toPinion, CROWN_PINION),
  }]);
  group.add(crown.mesh, pinion.mesh);

  const mount = new Group();
  mount.name = 'escapement-mount';
  mount.position.copy(layout.mount);
  group.add(mount);

  return {
    group,
    mount,
    escapeWheel,
    setAngle(radians) {
      swing.rotation.z = radians;
    },
    getAngle() {
      return swing.rotation.z;
    },
    setEscapeWheelAngle(radians) {
      escapeWheel.setPhase(0, radians);
    },
  };
}

export const PREVIEW_PENDULUM_LAYOUT: PendulumLayout = {
  pivot: new Vector3(54, 320, -1200),
  length: 300,
  bobRadius: 46,
  escapeWheel: new Vector3(54, 420, -1215),
  crownWheel: new Vector3(54, 590, -1215),
  mount: new Vector3(54, 500, -1200),
  plate: { z: -1262, xMin: -170, xMax: 280, yMin: 150, yMax: 720 },
};

/** Snapshot factory: the pendulum set from outside, mid-swing. */
export function previewPendulum() {
  const pendulum = createPendulum(PREVIEW_PENDULUM_LAYOUT);
  pendulum.setAngle((14 * Math.PI) / 180);
  pendulum.group.add(createPreviewLights(new Vector3(54, 400, -1200), 320));
  return pendulum.group;
}

/** Snapshot factory: looking up from the bob at the top of a swing toward the escapement. */
export function previewPendulumRide() {
  const pendulum = createPendulum(PREVIEW_PENDULUM_LAYOUT);
  const angle = (20 * Math.PI) / 180;
  pendulum.setAngle(angle);
  pendulum.group.add(createPreviewLights(new Vector3(54, 520, -1140), 260));
  const layout = PREVIEW_PENDULUM_LAYOUT;
  const camera = layout.pivot.clone().add(new Vector3(Math.sin(angle) * (layout.length - 30), -Math.cos(angle) * (layout.length - 30), 40));
  return pinSnapshotView(pendulum.group, camera, new Vector3(0, 0.55, -1));
}
