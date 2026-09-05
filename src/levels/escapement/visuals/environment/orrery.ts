import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGearFamily, createSpinningBrassMaterial, createSpinningSteelMaterial, mergeSpinParts, type GearSpec, type SpinPart } from '../gears';
import { createBrassMaterial, createLamp, createLampMaterial, pinSnapshotView, withPreviewEnvironment } from '../materials';
import { createDial, PREVIEW_DIAL_LAMP, PREVIEW_DIAL_LAYOUT } from './dial';
import { LAMP_WARM } from '../palette';

// The Orrery: open black outside the back plate. Planets on brass arms sweep
// around the sun lamp at kilometre scale; the arms spin in the shader about the
// sun's axis, so all of them share one draw call per material.

export type OrreryArm = {
  /** Sun-to-planet distance. */
  length: number;
  /** Height of the arm above the sun. */
  height: number;
  /** Seconds per orbit. */
  period: number;
  planetRadius: number;
  /** Starting angle about +y, radians. */
  phase: number;
  moons: number;
};

export type OrreryLayout = {
  sun: Vector3;
  sunRadius: number;
  arms: OrreryArm[];
};

const UP = new Vector3(0, 1, 0);
const DRIVE_WHEEL: GearSpec = { teeth: 24, module: 8, width: 12, rimWidth: 12, hubRadius: 16, spokes: 8, spokeWidth: 6 };
const DRIVE_PINION: GearSpec = { teeth: 9, module: 8, width: 12, rimWidth: 6, hubRadius: 8, spokes: 3, spokeWidth: 4 };

function nonIndexed(geometry: BufferGeometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  return result;
}

/** The sun: an emissive sphere inside a brass armillary cage. */
function createSun(layout: OrreryLayout) {
  const group = new Group();
  const sun = new Mesh(new SphereGeometry(layout.sunRadius, 48, 32), createLampMaterial(2.6));
  sun.position.copy(layout.sun);
  sun.name = 'orrery-sun-body';
  group.add(sun);

  const rings: BufferGeometry[] = [];
  const cage = layout.sunRadius * 1.9;
  for (const [tiltX, tiltZ, radius] of [
    [0, 0, cage],
    [Math.PI / 2, 0.4, cage * 1.18],
    [1.1, -0.9, cage * 1.36],
  ]) {
    const ring = new TorusGeometry(radius, 2.2, 8, 96);
    ring.rotateX(tiltX);
    ring.rotateZ(tiltZ);
    ring.translate(layout.sun.x, layout.sun.y, layout.sun.z);
    rings.push(nonIndexed(ring));
  }
  const column = new CylinderGeometry(9, 12, 520, 20);
  column.translate(layout.sun.x, layout.sun.y + 10, layout.sun.z);
  rings.push(nonIndexed(column));
  for (const arm of layout.arms) {
    const collar = new CylinderGeometry(18, 18, 14, 24);
    collar.translate(layout.sun.x, layout.sun.y + arm.height, layout.sun.z);
    rings.push(nonIndexed(collar));
  }
  const merged = mergeGeometries(rings, false);
  for (const ring of rings) ring.dispose();
  group.add(new Mesh(merged, createBrassMaterial({ tarnish: 0.3, brushAxis: new Vector3(0, 1, 0) })));
  return group;
}

/** Arms, counterweights and planet rings: brass, spinning about the sun. */
function createArms(layout: OrreryLayout) {
  const brass: SpinPart[] = [];
  const steel: SpinPart[] = [];
  for (const arm of layout.arms) {
    const rate = (2 * Math.PI) / arm.period;
    const y = layout.sun.y + arm.height;
    // The arm is a lattice girder: two chords with diagonal members between them, so its length reads against the member spacing.
    const brassParts: BufferGeometry[] = [];
    const chordGap = Math.max(10, arm.length * 0.02);
    const chordSize = Math.max(3, arm.length * 0.006);
    for (const dy of [-chordGap / 2, chordGap / 2]) {
      const chord = new BoxGeometry(arm.length + 20, chordSize, chordSize);
      chord.translate(layout.sun.x + arm.length / 2 - 4, y + dy, layout.sun.z);
      brassParts.push(chord);
    }
    const bay = chordGap * 1.4;
    const bays = Math.max(3, Math.floor(arm.length / bay));
    for (let i = 0; i < bays; i += 1) {
      const x0 = layout.sun.x + 20 + i * bay;
      const diagonal = new BoxGeometry(Math.hypot(bay, chordGap), chordSize * 0.8, chordSize * 0.8);
      diagonal.rotateZ(Math.atan2(chordGap, bay) * (i % 2 === 0 ? 1 : -1));
      diagonal.translate(x0 + bay / 2, y, layout.sun.z);
      brassParts.push(diagonal);
      if (i % 4 === 0) {
        const post = new BoxGeometry(chordSize * 0.8, chordGap, chordSize * 0.8);
        post.translate(x0, y, layout.sun.z);
        brassParts.push(post);
      }
    }
    const counter = new BoxGeometry(arm.length * 0.22, chordGap, chordSize * 1.4);
    counter.translate(layout.sun.x - arm.length * 0.11 - 14, y, layout.sun.z);
    const weight = new CylinderGeometry(arm.planetRadius * 0.5, arm.planetRadius * 0.5, 16, 20);
    weight.translate(layout.sun.x - arm.length * 0.22 - 14, y, layout.sun.z);
    const sleeve = new CylinderGeometry(24, 24, chordGap + 12, 24);
    sleeve.translate(layout.sun.x, y, layout.sun.z);
    const equator = new TorusGeometry(arm.planetRadius * 1.25, 2.4, 8, 64);
    equator.rotateX(Math.PI / 2);
    equator.rotateZ(0.35);
    equator.translate(layout.sun.x + arm.length, y, layout.sun.z);
    brassParts.push(counter, weight, sleeve, equator);
    const planet = new SphereGeometry(arm.planetRadius, 40, 28);
    planet.translate(layout.sun.x + arm.length, y, layout.sun.z);
    const steelParts = [planet];
    for (let moon = 0; moon < arm.moons; moon += 1) {
      const angle = (moon / arm.moons) * Math.PI * 2 + 0.7;
      const distance = arm.planetRadius * (1.9 + moon * 0.5);
      const rod = new BoxGeometry(distance, 2.5, 2.5);
      rod.translate(distance / 2, 0, 0);
      rod.rotateY(angle);
      rod.translate(layout.sun.x + arm.length, y, layout.sun.z);
      brassParts.push(rod);
      const body = new SphereGeometry(arm.planetRadius * 0.22, 16, 12);
      body.translate(Math.cos(angle) * distance + layout.sun.x + arm.length, y, -Math.sin(angle) * distance + layout.sun.z);
      steelParts.push(body);
    }
    for (const geometry of brassParts) brass.push({ geometry: nonIndexed(geometry), center: layout.sun, axis: UP, rate, phase: arm.phase });
    for (const geometry of steelParts) steel.push({ geometry: nonIndexed(geometry), center: layout.sun, axis: UP, rate, phase: arm.phase });
  }
  const group = new Group();
  group.add(new Mesh(mergeSpinParts(brass), createSpinningBrassMaterial({ tarnish: 0.3, brushAxis: new Vector3(1, 0, 0) })));
  group.add(new Mesh(mergeSpinParts(steel), createSpinningSteelMaterial({ tarnish: 0.35, seamScale: 1 / 120, seamAniso: 1 })));
  return group;
}

/** Radius of the horizontal ecliptic ring below the orrery. */
const ECLIPTIC_RADIUS = 560;
/** Height of the ecliptic ring below the sun; it stays under the Train's floor plate. */
const ECLIPTIC_DROP = 500;
/** Radius of the vertical ring in the sun's z plane; the rail flies through it. */
const MERIDIAN_RADIUS = 600;

/** Two great rings around the sun: the ecliptic far below and a vertical meridian the rail passes through. */
function createRings(layout: OrreryLayout) {
  const parts: BufferGeometry[] = [];
  const ecliptic = new TorusGeometry(ECLIPTIC_RADIUS, 6, 10, 200);
  ecliptic.rotateX(Math.PI / 2);
  ecliptic.translate(layout.sun.x, layout.sun.y - ECLIPTIC_DROP, layout.sun.z);
  parts.push(nonIndexed(ecliptic));
  const meridian = new TorusGeometry(MERIDIAN_RADIUS, 7, 10, 240);
  meridian.translate(layout.sun.x, layout.sun.y, layout.sun.z);
  parts.push(nonIndexed(meridian));
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const post = new BoxGeometry(12, 40, 12);
    post.translate(layout.sun.x + Math.cos(angle) * ECLIPTIC_RADIUS, layout.sun.y - ECLIPTIC_DROP + 20, layout.sun.z + Math.sin(angle) * ECLIPTIC_RADIUS);
    parts.push(nonIndexed(post));
  }
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const knob = new CylinderGeometry(14, 14, 16, 16);
    knob.rotateX(Math.PI / 2);
    knob.translate(layout.sun.x + Math.cos(angle) * MERIDIAN_RADIUS, layout.sun.y + Math.sin(angle) * MERIDIAN_RADIUS, layout.sun.z);
    parts.push(nonIndexed(knob));
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ tarnish: 0.35, seamScale: 1 / 30, brushAxis: new Vector3(0, 1, 0) }));
}

/** The drive under the sun: a wheel and its pinion, spinning about +y. */
function createDrive(layout: OrreryLayout) {
  const center = layout.sun.clone().setY(layout.sun.y - 210);
  const wheel = createGearFamily(DRIVE_WHEEL, [{ position: center, axis: UP, rate: 0.12 }]);
  const pinionOffset = new Vector3(1, 0, 0);
  const pinionCenter = center.clone().addScaledVector(pinionOffset, (DRIVE_WHEEL.teeth + DRIVE_PINION.teeth) * DRIVE_WHEEL.module / 2);
  const pinion = createGearFamily(DRIVE_PINION, [{ position: pinionCenter, axis: UP, rate: -0.12 * (DRIVE_WHEEL.teeth / DRIVE_PINION.teeth), phase: Math.PI / DRIVE_PINION.teeth }]);
  const group = new Group();
  group.add(wheel.mesh, pinion.mesh);
  return group;
}

export type Orrery = {
  group: Group;
  sunLight: ReturnType<typeof createLamp>;
};

export function createOrrery(layout: OrreryLayout): Orrery {
  const group = new Group();
  group.name = 'orrery';
  group.add(createSun(layout));
  group.add(createArms(layout));
  group.add(createRings(layout));
  group.add(createDrive(layout));
  // The rail passes about 120 units from the sun, where it receives 0.5 of sun light.
  const sunLight = createLamp({ name: 'escapement-sun', position: layout.sun, intensity: 7200 });
  sunLight.color.copy(LAMP_WARM);
  group.add(sunLight);
  return { group, sunLight };
}

export const PREVIEW_ORRERY_LAYOUT: OrreryLayout = {
  sun: new Vector3(260, 30, -1020),
  sunRadius: 34,
  arms: [
    { length: 190, height: -75, period: 44, planetRadius: 14, phase: 0.4, moons: 0 },
    { length: 300, height: 85, period: 62, planetRadius: 22, phase: 2.1, moons: 1 },
    { length: 430, height: -130, period: 84, planetRadius: 30, phase: 3.9, moons: 0 },
    { length: 580, height: 150, period: 110, planetRadius: 42, phase: 1.3, moons: 2 },
    { length: 760, height: -200, period: 150, planetRadius: 55, phase: 5.2, moons: 1 },
    { length: 960, height: 230, period: 200, planetRadius: 70, phase: 2.9, moons: 3 },
    { length: 1180, height: -280, period: 260, planetRadius: 84, phase: 4.4, moons: 2 },
    { length: 1400, height: 320, period: 330, planetRadius: 96, phase: 0.9, moons: 4 },
  ],
};

/** Snapshot factory: the whole orrery from outside, under the level sky. */
export function previewOrrery() {
  return withPreviewEnvironment(() => {
    const { group } = createOrrery(PREVIEW_ORRERY_LAYOUT);
    return group;
  });
}

/** Snapshot factory: the rail camera crossing the orrery, sun to the right, with the dial behind as the sky. */
export function previewOrreryCrossing() {
  return withPreviewEnvironment(() => {
    const { group } = createOrrery(PREVIEW_ORRERY_LAYOUT);
    group.add(createDial(PREVIEW_DIAL_LAYOUT));
    group.add(createLamp({ name: 'preview-dial-lamp', position: PREVIEW_DIAL_LAMP, intensity: 60000 }));
    return pinSnapshotView(group, new Vector3(140, 0, -720), new Vector3(0.12, 0.05, -1));
  });
}
