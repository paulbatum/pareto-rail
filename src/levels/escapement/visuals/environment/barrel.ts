import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, Shape, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rng } from '../../../../engine/rng';
import { createBrassMaterial, createFill, createLamp, createPreviewLights, createSteelMaterial, pinSnapshotView } from '../materials';

// The Barrel: the mainspring coil seen edge-on. The rail runs along the
// corridor between two turns of the coil, from the arbor outward, and leaves
// through a doorway in the barrel drum. The lamp hangs above the broken lid, so
// its light comes down through the missing lid plates and sideways through the
// gaps in the coil.

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
const DRUM_THICKNESS = 3.2;
const DRUM_TOOTH_COUNT = 44;
const LID_SECTORS = 36;
const LID_RINGS = 6;
const LID_MISSING_FRACTION = 0.34;
/** Angle range of the ride along the corridor: a quarter turn ending on the +x axis, heading -z. */
const CORRIDOR_START = -Math.PI / 2;
const CORRIDOR_END = 0;
/** How far the coil band continues on either side of the ride, in turns. */
const COIL_TURNS_BEFORE = 1.6;
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

/** Gap pattern for the coil: full breaks every few metres, half-height cracks between them. */
function coilSpans(rng: Rng, height: number) {
  const half = height / 2;
  let remaining = 0;
  let mode: 'plate' | 'break' | 'crackTop' | 'crackBottom' = 'plate';
  return (): [number, number] | null => {
    if (remaining <= 0) {
      const roll = rng();
      if (roll < 0.1) {
        mode = 'break';
        remaining = 2 + Math.floor(rng() * 3);
      } else if (roll < 0.22) {
        mode = rng() < 0.5 ? 'crackTop' : 'crackBottom';
        remaining = 3 + Math.floor(rng() * 6);
      } else {
        mode = 'plate';
        remaining = 6 + Math.floor(rng() * 12);
      }
    }
    remaining -= 1;
    switch (mode) {
      case 'break':
        return null;
      case 'crackTop':
        return [-half, half * 0.15];
      case 'crackBottom':
        return [-half * 0.1, half];
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
  return new Mesh(geometry, createBrassMaterial({ seamScale: 1 / 5.5, seamAniso: 2.2, brushAxis: new Vector3(0, 1, 0), brushStrength: 0.34, tarnish: 0.4 }));
}

/** Steel binding strips along the top and bottom edges of the coil. */
function createCoilEdges(layout: BarrelLayout) {
  const half = layout.bandHeight / 2;
  const strips = [half, -half].map((y) => sweepPlates(
    {
      radiusAt: (theta) => wallRadius(layout, theta),
      thetaFrom: CORRIDOR_START - COIL_TURNS_BEFORE * 2 * Math.PI,
      thetaTo: CORRIDOR_END + COIL_TURNS_AFTER * 2 * Math.PI,
      thickness: BAND_THICKNESS + 1.6,
      spanAt: () => [y - 1.4, y + 1.4],
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
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 8, tarnish: 0.5, roughness: 0.5 }));
}

function annularSector(inner: number, outer: number, from: number, to: number) {
  const shape = new Shape();
  shape.absarc(0, 0, outer, from, to, false);
  shape.absarc(0, 0, inner, to, from, true);
  shape.closePath();
  return shape;
}

/** The barrel lid: sector plates with a third of them missing, so the lamp above throws shafts. */
function createLid(layout: BarrelLayout, rng: Rng) {
  const plates: BufferGeometry[] = [];
  const outer = layout.drumRadius - DRUM_THICKNESS;
  const inner = 9;
  const ringStep = (outer - inner) / LID_RINGS;
  for (let ring = 0; ring < LID_RINGS; ring += 1) {
    for (let sector = 0; sector < LID_SECTORS; sector += 1) {
      if (rng() < LID_MISSING_FRACTION) continue;
      const from = (sector / LID_SECTORS) * Math.PI * 2 + ring * 0.11;
      const to = from + (Math.PI * 2) / LID_SECTORS - 0.012;
      const shape = annularSector(inner + ring * ringStep + 0.4, inner + (ring + 1) * ringStep - 0.4, from, to);
      const plate = new ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false, curveSegments: 6 });
      plate.rotateX(Math.PI / 2);
      plate.translate(layout.center.x, layout.center.y + layout.bandHeight / 2 + 1.5, layout.center.z);
      plates.push(plate);
    }
  }
  const merged = mergeGeometries(plates, false);
  for (const plate of plates) plate.dispose();
  return new Mesh(merged, createBrassMaterial({ seamScale: 1 / 12, tarnish: 0.45, brushAxis: new Vector3(1, 0, 0) }));
}

function createFloor(layout: BarrelLayout) {
  const geometry = new CylinderGeometry(layout.drumRadius + 6, layout.drumRadius + 6, 2.5, 72);
  geometry.translate(layout.center.x, layout.center.y - layout.bandHeight / 2 - 1.6, layout.center.z);
  return new Mesh(geometry, createBrassMaterial({ seamScale: 1 / 15, tarnish: 0.5, roughness: 0.55, brushAxis: new Vector3(1, 0, 0) }));
}

function createArbor(layout: BarrelLayout) {
  const parts: BufferGeometry[] = [];
  const shaft = new CylinderGeometry(6, 6, layout.bandHeight + 70, 24);
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

export function createBarrel(layout: BarrelLayout, options: { lid?: boolean } = {}) {
  const group = new Group();
  group.name = 'barrel';
  const rng = mulberry32(0x5ca1e);
  group.add(createCoil(layout, rng));
  group.add(createCoilEdges(layout));
  group.add(createDrum(layout, rng));
  if (options.lid !== false) group.add(createLid(layout, rng));
  group.add(createFloor(layout));
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

/** Snapshot factory: the barrel under a lamp above its lid. */
export function previewBarrel() {
  const group = createBarrel(PREVIEW_BARREL_LAYOUT);
  group.add(createPreviewLights(new Vector3(0, 0, 0), 260));
  return group;
}

/** Snapshot factory: the barrel with the lid removed, so the corridor is visible from above. */
export function previewBarrelOpen() {
  const group = createBarrel(PREVIEW_BARREL_LAYOUT, { lid: false });
  group.add(createPreviewLights(new Vector3(0, 0, 0), 260));
  return group;
}

/** Snapshot factory: the corridor from the rail camera a third of the way round. */
export function previewBarrelInside() {
  const group = createBarrel(PREVIEW_BARREL_LAYOUT);
  group.add(createLamp({ name: 'preview-lamp', position: new Vector3(60, 130, -30), intensity: 220 }));
  group.add(createFill());
  const { position, tangent } = barrelCorridor(PREVIEW_BARREL_LAYOUT, 0.35);
  return pinSnapshotView(group, position, tangent);
}
