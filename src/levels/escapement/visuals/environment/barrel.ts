import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rng } from '../../../../engine/rng';
import { createBrassMaterial, createLamp, createSteelMaterial, pinSnapshotView, withPreviewEnvironment } from '../materials';

// The Barrel: the mainspring coil seen edge-on. The band is a thin brass
// ribbon with open breaks between its plates; the rail runs in the gap between
// two turns with the void below and the farther turns visible through the
// breaks. The lamp hangs inside the coil above the rail, so its light crosses
// the corridor through the breaks. The rail leaves through a doorway in the
// toothed barrel drum.

export type BarrelLayout = {
  /** World position of the arbor, at corridor height. */
  center: Vector3;
  /** Corridor centreline radius at the start of the ride (angle 0). */
  corridorRadius: number;
  /** Radial distance between successive turns; also the corridor width. */
  pitch: number;
  /** Vertical extent of the coil band. */
  bandHeight: number;
  /** Radius of the toothed drum around the coil. */
  drumRadius: number;
};

const SEGMENT_LENGTH = 3;
const BAND_THICKNESS = 2.4;
/** Fraction of the band's length that is open break. */
const BREAK_FRACTION = 0.3;
const DRUM_THICKNESS = 3.2;
const DRUM_TOOTH_COUNT = 44;
/** Angle range of the ride along the corridor: a quarter turn ending on the +x axis, heading -z. */
const CORRIDOR_START = -Math.PI / 2;
const CORRIDOR_END = 0;
/** How far the coil band continues on either side of the ride, in turns. */
const COIL_TURNS_BEFORE = 2.6;
const COIL_TURNS_AFTER = 1;

/** Wall spiral radius at angle `theta`: the coil band the corridor runs between. */
function wallRadius(layout: BarrelLayout, theta: number) {
  return layout.corridorRadius - layout.pitch / 2 + (layout.pitch * theta) / (2 * Math.PI);
}

/** Point in the horizontal plane at polar (radius, theta): theta 0 is +x and theta grows toward -z. */
function polar(radius: number, theta: number, y = 0) {
  return new Vector3(Math.cos(theta) * radius, y, -Math.sin(theta) * radius);
}

/**
 * Corridor centreline for the rail: `t` in [0, 1] runs a quarter turn from
 * the -z side of the arbor round to the +x side, where the heading is -z.
 * Returns the world position and the unit tangent of travel.
 */
export function barrelCorridor(layout: BarrelLayout, t: number) {
  const theta = CORRIDOR_START + t * (CORRIDOR_END - CORRIDOR_START);
  const radius = layout.corridorRadius + (layout.pitch * theta) / (2 * Math.PI);
  const slope = layout.pitch / (2 * Math.PI);
  const position = polar(radius, theta).add(layout.center);
  const tangent = new Vector3(
    slope * Math.cos(theta) - radius * Math.sin(theta),
    0,
    -slope * Math.sin(theta) - radius * Math.cos(theta),
  ).normalize();
  return { position, tangent };
}

/** Where the corridor ends: the rail is heading -z here and continues straight to the drum doorway. */
export function barrelCorridorEnd(layout: BarrelLayout) {
  return barrelCorridor(layout, 1);
}

/** World point where the straight run out of the corridor crosses the drum wall. */
export function barrelExit(layout: BarrelLayout) {
  const x = layout.corridorRadius;
  const z = -Math.sqrt(layout.drumRadius * layout.drumRadius - x * x);
  return new Vector3(x, 0, z).add(layout.center);
}

type Sweep = {
  radiusAt: (theta: number) => number;
  thetaFrom: number;
  thetaTo: number;
  thickness: number;
  /** Vertical span of the plate at this angle, or null for a gap. */
  spanAt: (theta: number, index: number) => [number, number] | null;
};

/** Boxes laid end to end along a polar curve; each box is one plate of the band. */
function sweepPlates(sweep: Sweep, center: Vector3): BufferGeometry {
  const plates: BufferGeometry[] = [];
  let theta = sweep.thetaFrom;
  let index = 0;
  while (theta < sweep.thetaTo) {
    const radius = sweep.radiusAt(theta);
    const step = SEGMENT_LENGTH / Math.max(radius, 1);
    const next = Math.min(theta + step, sweep.thetaTo);
    const span = sweep.spanAt(theta, index);
    index += 1;
    if (span) {
      const mid = (theta + next) / 2;
      const midRadius = sweep.radiusAt(mid);
      const arc = midRadius * (next - theta);
      const box = new BoxGeometry(sweep.thickness, span[1] - span[0], arc * 1.12);
      const position = polar(midRadius, mid, (span[0] + span[1]) / 2).add(center);
      box.applyMatrix4(new Matrix4().makeRotationY(mid).setPosition(position));
      plates.push(box);
    }
    theta = next;
  }
  const merged = mergeGeometries(plates, false);
  for (const plate of plates) plate.dispose();
  return merged;
}

/**
 * Break pattern for the coil: ribbon plates 40 to 90 units long separated by
 * open breaks 10 to 35 units wide, with a few plates torn to half height.
 */
function coilSpans(rng: Rng, height: number) {
  const half = height / 2;
  let remaining = 0;
  let mode: 'plate' | 'break' | 'crackTop' | 'crackBottom' = 'plate';
  return (): [number, number] | null => {
    if (remaining <= 0) {
      if (mode !== 'break' && rng() < BREAK_FRACTION + 0.25) {
        mode = 'break';
        remaining = Math.round((10 + rng() * 25) / SEGMENT_LENGTH);
      } else {
        const roll = rng();
        mode = roll < 0.12 ? 'crackTop' : roll < 0.24 ? 'crackBottom' : 'plate';
        remaining = Math.round((40 + rng() * 50) / SEGMENT_LENGTH);
      }
    }
    remaining -= 1;
    switch (mode) {
      case 'break':
        return null;
      case 'crackTop':
        return [-half, half * 0.1];
      case 'crackBottom':
        return [-half * 0.05, half];
      default:
        return [-half, half];
    }
  };
}

function createCoil(layout: BarrelLayout, rng: Rng) {
  const spans = coilSpans(rng, layout.bandHeight);
  const geometry = sweepPlates(
    {
      radiusAt: (theta) => wallRadius(layout, theta),
      thetaFrom: CORRIDOR_START - COIL_TURNS_BEFORE * 2 * Math.PI,
      thetaTo: CORRIDOR_END + COIL_TURNS_AFTER * 2 * Math.PI,
      thickness: BAND_THICKNESS,
      spanAt: () => spans(),
    },
    layout.center,
  );
  return new Mesh(geometry, createBrassMaterial({ seamScale: 1 / 260, seamAniso: 1, brushAxis: new Vector3(0, 1, 0), brushStrength: 0.34, tarnish: 0.35 }));
}

/** Steel binding strips along the top and bottom edges of the coil. */
function createCoilEdges(layout: BarrelLayout) {
  const half = layout.bandHeight / 2;
  const strips = [half, -half].map((y) => sweepPlates(
    {
      radiusAt: (theta) => wallRadius(layout, theta),
      thetaFrom: CORRIDOR_START - COIL_TURNS_BEFORE * 2 * Math.PI,
      thetaTo: CORRIDOR_END + COIL_TURNS_AFTER * 2 * Math.PI,
      thickness: BAND_THICKNESS + 1.2,
      spanAt: () => [y - 0.9, y + 0.9],
    },
    layout.center,
  ));
  const merged = mergeGeometries(strips, false);
  for (const strip of strips) strip.dispose();
  return new Mesh(merged, createSteelMaterial({ tarnish: 0.2, brushAxis: new Vector3(0, 1, 0) }));
}

function createDrum(layout: BarrelLayout, rng: Rng) {
  const exit = barrelExit(layout).sub(layout.center);
  const doorTheta = Math.atan2(-exit.z, exit.x);
  const doorHalfWidth = 16 / layout.drumRadius;
  const half = layout.bandHeight / 2 + 2;
  const wall = sweepPlates(
    {
      radiusAt: () => layout.drumRadius,
      thetaFrom: doorTheta + doorHalfWidth,
      thetaTo: doorTheta + 2 * Math.PI - doorHalfWidth,
      thickness: DRUM_THICKNESS,
      spanAt: () => (rng() < 0.04 ? [-half, half * 0.3] : [-half, half]),
    },
    layout.center,
  );

  const teeth: BufferGeometry[] = [wall];
  const toothDepth = 5;
  const toothWidth = (2 * Math.PI * layout.drumRadius) / DRUM_TOOTH_COUNT / 2;
  for (let i = 0; i < DRUM_TOOTH_COUNT; i += 1) {
    const theta = (i / DRUM_TOOTH_COUNT) * 2 * Math.PI;
    const wrapped = (((theta - doorTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const angleFromDoor = Math.abs(wrapped - Math.PI);
    if (angleFromDoor < doorHalfWidth * 1.4) continue;
    const tooth = new BoxGeometry(toothDepth, layout.bandHeight + 4, toothWidth);
    const position = polar(layout.drumRadius + DRUM_THICKNESS / 2 + toothDepth / 2 - 0.4, theta).add(layout.center);
    tooth.applyMatrix4(new Matrix4().makeRotationY(theta).setPosition(position));
    teeth.push(tooth);
  }
  const merged = mergeGeometries(teeth, false);
  for (const part of teeth) part.dispose();
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 320, tarnish: 0.45, roughness: 0.45 }));
}

function createArbor(layout: BarrelLayout) {
  const parts: BufferGeometry[] = [];
  const shaft = new CylinderGeometry(8, 8, layout.bandHeight * 4, 24);
  parts.push(shaft.toNonIndexed());
  const hook = new BoxGeometry(14, layout.bandHeight, 6);
  hook.translate(7, 0, 0);
  parts.push(hook.toNonIndexed());
  for (const y of [-1, 1]) {
    const collar = new CylinderGeometry(10, 10, 4, 24);
    collar.translate(0, y * (layout.bandHeight / 2 + 6), 0);
    parts.push(collar.toNonIndexed());
  }
  const merged = mergeGeometries(parts, false);
  merged.translate(layout.center.x, layout.center.y, layout.center.z);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createSteelMaterial({ brushAxis: new Vector3(0, 1, 0), tarnish: 0.2 }));
}

export function createBarrel(layout: BarrelLayout) {
  const group = new Group();
  group.name = 'barrel';
  const rng = mulberry32(0x5ca1e);
  group.add(createCoil(layout, rng));
  group.add(createCoilEdges(layout));
  group.add(createDrum(layout, rng));
  group.add(createArbor(layout));
  return group;
}

export const PREVIEW_BARREL_LAYOUT: BarrelLayout = {
  center: new Vector3(0, 0, 0),
  corridorRadius: 140,
  pitch: 40,
  bandHeight: 44,
  drumRadius: 236,
};

/** Lamp position inside the coil for the previews: above the corridor near its exit. */
export const PREVIEW_BARREL_LAMP = new Vector3(96, 78, 34);
/** Coil plates sit 60–110 units from the lamp, so they receive 0.25–0.8 of lamp light. */
const PREVIEW_LAMP_INTENSITY = 2800;

/** Snapshot factory: the barrel from outside, under the level sky. */
export function previewBarrel() {
  return withPreviewEnvironment(() => {
    const group = createBarrel(PREVIEW_BARREL_LAYOUT);
    group.add(createLamp({ name: 'preview-lamp', position: PREVIEW_BARREL_LAMP, intensity: PREVIEW_LAMP_INTENSITY }));
    return group;
  });
}

/** Snapshot factory: the corridor from the rail camera a third of the way round. */
export function previewBarrelInside() {
  return withPreviewEnvironment(() => {
    const group = createBarrel(PREVIEW_BARREL_LAYOUT);
    group.add(createLamp({ name: 'preview-lamp', position: PREVIEW_BARREL_LAMP, intensity: PREVIEW_LAMP_INTENSITY }));
    const { position, tangent } = barrelCorridor(PREVIEW_BARREL_LAYOUT, 0.35);
    return pinSnapshotView(group, position, tangent);
  });
}
