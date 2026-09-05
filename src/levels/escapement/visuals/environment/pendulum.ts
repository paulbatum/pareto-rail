import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createEscapementBoss } from '../escapement-boss';
import { createBrassMaterial, createLamp, createSteelMaterial, pinSnapshotView, withPreviewEnvironment } from '../materials';

// The Pendulum: rod and bob hanging from the back cock, with the plate behind
// and the mount the escapement boss body attaches to. The swing is a rotation
// about +z through the pivot; positive angle carries the bob toward +x. The
// escapement itself (fork, escape wheel, crown wheel) is `escapement-boss.ts`,
// parented to `mount` by the integrator.

export type PendulumLayout = {
  pivot: Vector3;
  /** Pivot-to-bob-centre distance. */
  length: number;
  bobRadius: number;
  /** Where the escapement boss body attaches; its fork pivots here. */
  mount: Vector3;
  plate: { z: number; xMin: number; xMax: number; yMin: number; yMax: number };
};


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
  // Boss where the mount arbor passes through the plate, and a cock bracing it.
  const boss = new CylinderGeometry(22, 22, 10, 24);
  boss.rotateX(Math.PI / 2);
  boss.translate(layout.mount.x, layout.mount.y, plate.z + 9);
  parts.push(nonIndexed(boss));
  const cockArm = new BoxGeometry(90, 20, layout.mount.z - plate.z - 20);
  cockArm.translate(layout.mount.x - 60, layout.mount.y + 30, (layout.mount.z + plate.z) / 2);
  parts.push(nonIndexed(cockArm));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 60, tarnish: 0.4, roughness: 0.48, brushAxis: new Vector3(0, 1, 0) }));
}

/** The mount arbor from the plate to the fork pivot, and the pendulum's pivot pin. */
function createArbors(layout: PendulumLayout) {
  const parts: BufferGeometry[] = [];
  const arbor = new CylinderGeometry(7, 7, layout.mount.z - layout.plate.z + 30, 12);
  arbor.rotateX(Math.PI / 2);
  arbor.translate(layout.mount.x, layout.mount.y, (layout.mount.z + layout.plate.z) / 2 + 6);
  parts.push(nonIndexed(arbor));
  const pin = new CylinderGeometry(4, 4, layout.pivot.z - layout.plate.z + 16, 12);
  pin.rotateX(Math.PI / 2);
  pin.translate(layout.pivot.x, layout.pivot.y, (layout.pivot.z + layout.plate.z) / 2 + 4);
  parts.push(nonIndexed(pin));
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
  /** The escape wheel belongs to the boss body; this stays for callers and does nothing. */
  setEscapeWheelAngle(radians: number): void;
};

export function createPendulum(layout: PendulumLayout): Pendulum {
  const group = new Group();
  group.name = 'pendulum';
  const swing = createSwing(layout);
  group.add(swing);
  group.add(createPlate(layout));
  group.add(createArbors(layout));

  const mount = new Group();
  mount.name = 'escapement-mount';
  mount.position.copy(layout.mount);
  group.add(mount);

  return {
    group,
    mount,
    setAngle(radians) {
      swing.rotation.z = radians;
    },
    getAngle() {
      return swing.rotation.z;
    },
    setEscapeWheelAngle() {},
  };
}

export const PREVIEW_PENDULUM_LAYOUT: PendulumLayout = {
  pivot: new Vector3(140, 200, -1420),
  length: 130,
  bobRadius: 30,
  mount: new Vector3(140, 300, -1420),
  plate: { z: -1482, xMin: -84, xMax: 364, yMin: 40, yMax: 560 },
};

function previewPendulumLights(group: Group) {
  // The works lamp is about 270 units from the mount and the plate behind it.
  group.add(createLamp({ name: 'preview-lamp', position: new Vector3(140, 520, -1300), intensity: 25000 }));
}

/** Snapshot factory: the pendulum set from outside, mid-swing, with the boss body at the mount. */
export function previewPendulum() {
  return withPreviewEnvironment(() => {
    const pendulum = createPendulum(PREVIEW_PENDULUM_LAYOUT);
    pendulum.setAngle((14 * Math.PI) / 180);
    pendulum.mount.add(createEscapementBoss());
    previewPendulumLights(pendulum.group);
    return pendulum.group;
  });
}

/** Snapshot factory: the rail camera at the top of a swing, 110 units in front of the bob, aimed so the escapement fills the top third. */
export function previewPendulumRide() {
  return withPreviewEnvironment(() => {
    const pendulum = createPendulum(PREVIEW_PENDULUM_LAYOUT);
    const angle = (20 * Math.PI) / 180;
    pendulum.setAngle(angle);
    pendulum.mount.add(createEscapementBoss());
    previewPendulumLights(pendulum.group);
    const layout = PREVIEW_PENDULUM_LAYOUT;
    const bob = layout.pivot.clone().add(new Vector3(Math.sin(angle) * layout.length, -Math.cos(angle) * layout.length, 0));
    const camera = bob.clone().add(new Vector3(0, 24, 110));
    const target = layout.mount.clone().add(new Vector3(0, -70, 0));
    return pinSnapshotView(pendulum.group, camera, target.sub(camera).normalize());
  });
}
