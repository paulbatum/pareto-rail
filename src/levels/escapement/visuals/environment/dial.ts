import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, Path, Shape, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBrassMaterial, createOxideMaterial, createPreviewLights, pinSnapshotView } from '../materials';

// The Dial: the sky of the level. A black-oxide face seen from behind, so the
// brass numerals read mirrored, with the chapter ring, minute ticks, frozen
// hands, and a gateway at XII the Free Run exits through.

export type DialLayout = {
  /** Centre of the face. The face lies in the plane z = center.z and faces +z. */
  center: Vector3;
  radius: number;
  /** Radius of the numeral centres. */
  numeralRadius: number;
  /** Opening at XII the rail passes through. */
  doorway: { width: number; height: number };
  /** Frozen hand angles in hours on the front face (0 is XII, 3 is III). */
  hands: { hour: number; minute: number };
};

const FACE_DEPTH = 24;
const NUMERAL_HEIGHT = 96;
const STROKE = 15;
const STROKE_DEPTH = 12;
const TICK_LENGTH = 26;

type Stroke = { x: number; width: number; slant: number };

/** Roman numeral strokes: x offsets in glyph space (right-handed, reading left to right), before mirroring. */
function glyphStrokes(numeral: string): Stroke[] {
  const strokes: Stroke[] = [];
  const advance = (letter: string) => (letter === 'I' ? STROKE * 2.2 : letter === 'V' ? STROKE * 4.4 : STROKE * 4.6);
  let width = 0;
  for (const letter of numeral) width += advance(letter);
  let cursor = -width / 2;
  for (const letter of numeral) {
    const w = advance(letter);
    const mid = cursor + w / 2;
    if (letter === 'I') strokes.push({ x: mid, width: STROKE, slant: 0 });
    if (letter === 'V') {
      strokes.push({ x: mid - STROKE * 0.75, width: STROKE, slant: -0.34 });
      strokes.push({ x: mid + STROKE * 0.75, width: STROKE * 0.75, slant: 0.34 });
    }
    if (letter === 'X') {
      strokes.push({ x: mid, width: STROKE, slant: 0.4 });
      strokes.push({ x: mid, width: STROKE * 0.75, slant: -0.4 });
    }
    cursor += w;
  }
  return strokes;
}

const NUMERALS = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/**
 * Position on the face for hour `h` seen from behind: the front-face angle is
 * mirrored across the vertical axis, so I sits to the upper left of XII.
 */
function hourDirection(hour: number) {
  const angle = Math.PI / 2 + (hour * Math.PI) / 6;
  return { x: Math.cos(angle), y: Math.sin(angle), angle };
}

function createFace(layout: DialLayout) {
  const shape = new Shape();
  shape.absarc(0, 0, layout.radius, 0, Math.PI * 2, false);
  const door = new Path();
  const doorY = layout.numeralRadius;
  const hw = layout.doorway.width / 2;
  const hh = layout.doorway.height / 2;
  door.moveTo(-hw, doorY - hh);
  door.lineTo(hw, doorY - hh);
  door.lineTo(hw, doorY + hh);
  door.lineTo(-hw, doorY + hh);
  door.closePath();
  shape.holes.push(door);
  const face = new ExtrudeGeometry(shape, { depth: FACE_DEPTH, bevelEnabled: false, curveSegments: 160 });
  face.translate(0, 0, -FACE_DEPTH);

  const parts: BufferGeometry[] = [face];
  // Frozen hands on the front side, seen mirrored from behind.
  for (const [hours, length, width] of [
    [layout.hands.hour, layout.numeralRadius * 0.62, 34],
    [layout.hands.minute, layout.numeralRadius * 0.92, 24],
  ]) {
    const { angle } = hourDirection(hours);
    const hand = new BoxGeometry(length + 60, width, 10);
    hand.translate(length / 2 - 30, 0, 0);
    hand.applyMatrix4(new Matrix4().makeRotationZ(angle));
    hand.translate(0, 0, 8);
    parts.push(hand.toNonIndexed());
    hand.dispose();
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.translate(layout.center.x, layout.center.y, layout.center.z);
  const mesh = new Mesh(merged, createOxideMaterial({ seamScale: 1 / 150, seamAniso: 1, roughness: 0.55, metalness: 0.5, brushAxis: new Vector3(1, 0, 0) }));
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

function ring(radius: number, tube: number, depth: number) {
  const shape = new Shape();
  shape.absarc(0, 0, radius + tube, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absarc(0, 0, radius - tube, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 160 });
}

/** Chapter rings, numerals, ticks, centre boss and the XII gateway frame: all brass, one mesh. */
function createBrasswork(layout: DialLayout) {
  const parts: BufferGeometry[] = [];
  const lift = 4;
  parts.push(ring(layout.numeralRadius + NUMERAL_HEIGHT * 0.75, 9, 10).translate(0, 0, lift));
  parts.push(ring(layout.numeralRadius - NUMERAL_HEIGHT * 0.75, 7, 10).translate(0, 0, lift));

  for (let minute = 0; minute < 60; minute += 1) {
    const { x, y, angle } = hourDirection(minute / 5);
    const long = minute % 5 === 0;
    const tick = new BoxGeometry(long ? TICK_LENGTH * 1.6 : TICK_LENGTH, long ? 9 : 5, 8);
    const radius = layout.numeralRadius + NUMERAL_HEIGHT * 0.75 + 30;
    tick.applyMatrix4(new Matrix4().makeRotationZ(angle).setPosition(x * radius, y * radius, lift + 4));
    parts.push(tick.toNonIndexed());
    tick.dispose();
  }

  NUMERALS.forEach((numeral, hour) => {
    const { x, y, angle } = hourDirection(hour);
    const isTwelve = hour === 0;
    const scale = isTwelve ? 1.35 : 1;
    const strokes = glyphStrokes(numeral);
    const up = angle - Math.PI / 2;
    for (const stroke of strokes) {
      const box = new BoxGeometry(stroke.width * scale, NUMERAL_HEIGHT * scale, STROKE_DEPTH);
      // Mirror: the glyph is read from behind, so its strokes are laid out right to left.
      let mirroredX = -stroke.x * scale;
      // XII splits around the gateway: X on one side of the opening, II on the other.
      if (isTwelve) mirroredX += mirroredX < 0 ? -(layout.doorway.width / 2 + STROKE * 2.2) : layout.doorway.width / 2 + STROKE * 2.2;
      const local = new Matrix4().makeRotationZ(-stroke.slant).setPosition(mirroredX, 0, 0);
      const place = new Matrix4().makeRotationZ(up).setPosition(x * layout.numeralRadius, y * layout.numeralRadius, lift + 6);
      box.applyMatrix4(place.multiply(local));
      parts.push(box.toNonIndexed());
      box.dispose();
    }
  });

  // Gateway lintel and sill around the doorway at XII.
  const doorY = layout.numeralRadius;
  const hw = layout.doorway.width / 2;
  const hh = layout.doorway.height / 2;
  for (const [y, h] of [
    [doorY + hh + 9, 18],
    [doorY - hh - 9, 18],
  ]) {
    const beam = new BoxGeometry(hw * 2 + 40, h, 30);
    beam.translate(0, y, lift + 6);
    parts.push(beam.toNonIndexed());
    beam.dispose();
  }

  const boss = new CylinderGeometry(layout.radius * 0.06, layout.radius * 0.06, 30, 40);
  boss.rotateX(Math.PI / 2);
  boss.translate(0, 0, lift + 8);
  parts.push(boss.toNonIndexed());
  boss.dispose();

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.translate(layout.center.x, layout.center.y, layout.center.z);
  const mesh = new Mesh(merged, createBrassMaterial({ tarnish: 0.3, roughness: 0.4, brushAxis: new Vector3(0, 0, 1) }));
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

/** World position of the XII gateway's centre. */
export function dialGateway(layout: DialLayout) {
  return layout.center.clone().add(new Vector3(0, layout.numeralRadius, 0));
}

export function createDial(layout: DialLayout) {
  const group = new Group();
  group.name = 'dial';
  group.add(createFace(layout));
  group.add(createBrasswork(layout));
  return group;
}

export const PREVIEW_DIAL_LAYOUT: DialLayout = {
  center: new Vector3(54, -640, -1560),
  radius: 980,
  numeralRadius: 840,
  doorway: { width: 150, height: 120 },
  hands: { hour: 4.6, minute: 7.3 },
};

/** Snapshot factory: the dial from behind. */
export function previewDial() {
  const group = createDial(PREVIEW_DIAL_LAYOUT);
  group.add(createPreviewLights(PREVIEW_DIAL_LAYOUT.center.clone().add(new Vector3(0, 0, 400)), 900));
  return group;
}

/** Snapshot factory: the Free Run approach, climbing toward the XII gateway from the bob's rest position. */
export function previewDialApproach() {
  const group = createDial(PREVIEW_DIAL_LAYOUT);
  group.add(createPreviewLights(new Vector3(54, 400, -1200), 500));
  const from = new Vector3(54, 20, -1200);
  const direction = dialGateway(PREVIEW_DIAL_LAYOUT).sub(from).normalize();
  return pinSnapshotView(group, from.clone().addScaledVector(direction, 60), direction);
}
