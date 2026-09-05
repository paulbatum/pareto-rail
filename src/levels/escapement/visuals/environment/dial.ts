import { BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, Path, Shape, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBrassMaterial, createGlowDiscMaterial, createLamp, createOxideMaterial, pinSnapshotView, withPreviewEnvironment } from '../materials';

// The Dial: the sky of the level. A black-oxide face seen from behind, so the
// brass numerals read mirrored, with the chapter ring, minute ticks, frozen
// hands, and a gateway at XII the Free Run exits through. A lamp disc behind
// the gateway lights the opening, so the run ends into brightness.

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

/** A numeral stroke as cast metal: a rounded-rectangle extrusion with a bevel on every edge. */
function strokeGeometry(width: number, height: number, depth: number) {
  const bevel = Math.min(width, depth) * 0.22;
  const shape = new Shape();
  const hw = width / 2 - bevel;
  const hh = height / 2 - bevel;
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  return geometry;
}

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

  face.translate(layout.center.x, layout.center.y, layout.center.z);
  const mesh = new Mesh(face, createOxideMaterial({ seamScale: 1 / 420, seamAniso: 1, roughness: 0.55, metalness: 0.5, brushAxis: new Vector3(1, 0, 0) }));
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

/** Chapter rings, numerals, ticks, hands, centre boss and the XII gateway frame: all brass, one mesh. */
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
      const box = strokeGeometry(stroke.width * scale, NUMERAL_HEIGHT * scale, STROKE_DEPTH);
      // Mirror: the glyph is read from behind, so its strokes are laid out right to left.
      let mirroredX = -stroke.x * scale;
      // XII splits around the gateway: X on one side of the opening, II on the other.
      if (isTwelve) mirroredX += mirroredX < 0 ? -(layout.doorway.width / 2 + STROKE * 2.2) : layout.doorway.width / 2 + STROKE * 2.2;
      const local = new Matrix4().makeRotationZ(-stroke.slant).setPosition(mirroredX, 0, 0);
      const place = new Matrix4().makeRotationZ(up).setPosition(x * layout.numeralRadius, y * layout.numeralRadius, lift + 6);
      box.applyMatrix4(place.multiply(local));
      parts.push(box);
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

  // Frozen hands, mirrored like the numerals: a tapered bevelled blade, a counterweight tail, and a boss at the hub.
  for (const [hours, length, width] of [
    [layout.hands.hour, layout.numeralRadius * 0.62, 44],
    [layout.hands.minute, layout.numeralRadius * 0.92, 30],
  ]) {
    const { angle } = hourDirection(hours);
    const rotate = new Matrix4().makeRotationZ(angle);
    const blade = strokeGeometry(length, width, 14);
    blade.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
    blade.applyMatrix4(new Matrix4().makeScale(1, 1, 1));
    // Taper: scale the blade's far end down by squashing y toward the tip.
    const positions = blade.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const t = (positions.getX(i) + length / 2) / length;
      positions.setY(i, positions.getY(i) * (1 - 0.65 * t));
    }
    blade.translate(length / 2, 0, 0);
    blade.applyMatrix4(rotate);
    blade.translate(0, 0, lift + 12);
    parts.push(blade);
    const tail = strokeGeometry(length * 0.22, width * 1.3, 14);
    tail.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
    tail.translate(-length * 0.11 - 20, 0, 0);
    tail.applyMatrix4(rotate);
    tail.translate(0, 0, lift + 12);
    parts.push(tail);
    const weight = new CylinderGeometry(width * 1.1, width * 1.1, 16, 24);
    weight.rotateX(Math.PI / 2);
    weight.translate(-length * 0.22 - 20, 0, 0);
    weight.applyMatrix4(rotate);
    weight.translate(0, 0, lift + 12);
    parts.push(weight.toNonIndexed());
    weight.dispose();
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

/** Where the lamp that lights the gateway from beyond the dial sits. */
export function dialGatewayLamp(layout: DialLayout) {
  return dialGateway(layout).add(new Vector3(0, 40, -160));
}

/** Warm glow beyond the gateway: the outside the Free Run flies into, brightest at the centre of the opening. */
function createBeyond(layout: DialLayout) {
  const gate = dialGateway(layout);
  const disc = new Mesh(new CircleGeometry(layout.doorway.width * 0.9, 48), createGlowDiscMaterial(1.7, 0.45));
  disc.position.copy(gate).add(new Vector3(0, 0, -140));
  disc.userData.raildIgnoreOcclusion = true;
  return disc;
}

export function createDial(layout: DialLayout) {
  const group = new Group();
  group.name = 'dial';
  group.add(createFace(layout));
  group.add(createBrasswork(layout));
  group.add(createBeyond(layout));
  return group;
}

export const PREVIEW_DIAL_LAYOUT: DialLayout = {
  center: new Vector3(140, -640, -1780),
  radius: 980,
  numeralRadius: 840,
  doorway: { width: 150, height: 120 },
  hands: { hour: 4.6, minute: 7.3 },
};

/** The dial lamp: a warm light in front of the face so the numerals read from the orrery. */
export const PREVIEW_DIAL_LAMP = new Vector3(140, -100, -1520);

function previewDialLights(group: Group) {
  // The dial lamp is about 400 units from the XII region of the face; the gate lamp 160 units behind the gateway.
  group.add(createLamp({ name: 'preview-dial-lamp', position: PREVIEW_DIAL_LAMP, intensity: 60000 }));
  group.add(createLamp({ name: 'preview-gate-lamp', position: dialGatewayLamp(PREVIEW_DIAL_LAYOUT), intensity: 6000 }));
}

/** Snapshot factory: the dial from behind, under the level sky. */
export function previewDial() {
  return withPreviewEnvironment(() => {
    const group = createDial(PREVIEW_DIAL_LAYOUT);
    previewDialLights(group);
    return group;
  });
}

/** Snapshot factory: the Free Run approach, climbing toward the XII gateway from the bob's rest position. */
export function previewDialApproach() {
  return withPreviewEnvironment(() => {
    const group = createDial(PREVIEW_DIAL_LAYOUT);
    previewDialLights(group);
    const from = new Vector3(140, 70, -1420);
    const direction = dialGateway(PREVIEW_DIAL_LAYOUT).sub(from).normalize();
    return pinSnapshotView(group, from.clone().addScaledVector(direction, 120), direction);
  });
}
