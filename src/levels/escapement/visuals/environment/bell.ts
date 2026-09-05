import { BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Mesh, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBrassMaterial, createOxideMaterial, createPreviewLights, createSteelMaterial, strikeAge, strikeOrigin, strikeStrength, withPreviewEnvironment } from '../materials';

// The hour bell in its headstock: a brass yoke with trunnions turning in
// bearing blocks on an A-frame, a bell wheel on one trunnion, and the hammer on
// a pivoted arm bracketed to the frame. The hammer is raised over the last bar
// before the strike and falls on the downbeat; the fall starts the strike wave
// that every environment material displaces by.

export type BellLayout = {
  /** Centre of the bell's mouth. */
  mouth: Vector3;
  radius: number;
  height: number;
  /** +1 puts the hammer on the +x side of the bell, -1 on the -x side. */
  hammerSide: 1 | -1;
};

const PROFILE_STEPS = 26;
const SHELL_THICKNESS_FRACTION = 0.07;
/** Hammer arm angle when resting on the bell, radians. */
const HAMMER_REST = 0;
/** Hammer arm angle at full lift, radians. */
const HAMMER_LIFT = 1.25;

function nonIndexed(geometry: BufferGeometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  return result;
}

/** Outer silhouette control points as (radius fraction, height fraction), crown to lip. */
const BELL_SILHOUETTE: Array<[number, number]> = [
  [0, 1],
  [0.2, 1],
  [0.42, 0.97],
  [0.53, 0.88],
  [0.57, 0.7],
  [0.6, 0.5],
  [0.64, 0.32],
  [0.72, 0.17],
  [0.86, 0.07],
  [1, 0],
];

/** Bell shell profile: crown at the top, waist, sound bow at the lip, then the inner surface back up. */
function bellProfile(radius: number, height: number) {
  const curve = new CatmullRomCurve3(BELL_SILHOUETTE.map(([r, h]) => new Vector3(r * radius, h * height, 0)), false, 'catmullrom', 0.5);
  const outer = curve.getPoints(PROFILE_STEPS).map((point) => new Vector2(Math.max(0, point.x), point.y));
  const thickness = radius * SHELL_THICKNESS_FRACTION;
  const points: Vector2[] = [...outer];
  points.push(new Vector2(outer[outer.length - 1].x - thickness * 1.6, -thickness * 0.6));
  for (let i = outer.length - 2; i >= 1; i -= 1) {
    points.push(new Vector2(Math.max(0.5, outer[i].x - thickness), outer[i].y));
  }
  points.push(new Vector2(0, height * 0.86));
  return points;
}

function createBellBody(layout: BellLayout) {
  const R = layout.radius;
  const shell = new LatheGeometry(bellProfile(R, layout.height), 64);
  shell.translate(layout.mouth.x, layout.mouth.y, layout.mouth.z);
  const parts: BufferGeometry[] = [nonIndexed(shell)];
  // Crown loop, the headstock yoke the bell hangs from, and its trunnions.
  const crown = new CylinderGeometry(R * 0.16, R * 0.16, R * 0.34, 16);
  crown.translate(layout.mouth.x, layout.mouth.y + layout.height + R * 0.2, layout.mouth.z);
  parts.push(nonIndexed(crown));
  const yokeY = layout.mouth.y + layout.height + R * 0.52;
  const yoke = new BoxGeometry(R * 2.6, R * 0.44, R * 0.9);
  yoke.translate(layout.mouth.x, yokeY, layout.mouth.z);
  parts.push(nonIndexed(yoke));
  for (const side of [-1, 1]) {
    const cheek = new BoxGeometry(R * 0.5, R * 0.9, R * 1.1);
    cheek.translate(layout.mouth.x + side * R * 1.05, yokeY - R * 0.1, layout.mouth.z);
    parts.push(nonIndexed(cheek));
  }
  const trunnion = new CylinderGeometry(R * 0.14, R * 0.14, R * 4.2, 16);
  trunnion.rotateZ(Math.PI / 2);
  trunnion.translate(layout.mouth.x, yokeY, layout.mouth.z);
  parts.push(nonIndexed(trunnion));
  // Bell wheel on the trunnion opposite the hammer: a rim with spokes.
  const wheelX = layout.mouth.x - layout.hammerSide * R * 1.85;
  const wheelRadius = R * 1.35;
  const wheel = new TorusGeometry(wheelRadius, R * 0.09, 10, 64);
  wheel.rotateY(Math.PI / 2);
  wheel.translate(wheelX, yokeY, layout.mouth.z);
  parts.push(nonIndexed(wheel));
  for (let i = 0; i < 8; i += 1) {
    const spoke = new BoxGeometry(R * 0.08, wheelRadius, R * 0.08);
    spoke.translate(0, wheelRadius / 2, 0);
    spoke.rotateX((i * Math.PI) / 4);
    spoke.translate(wheelX, yokeY, layout.mouth.z);
    parts.push(nonIndexed(spoke));
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ tarnish: 0.28, roughness: 0.32, brushAxis: new Vector3(0, 1, 0) }));
}

/** Frame height above the mouth where the trunnions turn. */
function trunnionHeight(layout: BellLayout) {
  return layout.mouth.y + layout.height + layout.radius * 0.52;
}

/** The hammer pivot: on the frame leg on the hammer side, level with the bell's sound bow. */
function hammerPivot(layout: BellLayout) {
  const R = layout.radius;
  return new Vector3(layout.mouth.x + layout.hammerSide * R * 2.3, layout.mouth.y + layout.height * 0.55, layout.mouth.z);
}

function createSteelwork(layout: BellLayout) {
  const R = layout.radius;
  const parts: BufferGeometry[] = [];
  const top = trunnionHeight(layout);
  const legSpread = R * 2.3;
  const footY = layout.mouth.y - R * 0.6;
  // A-frame on each side: two legs to a bearing block at the trunnion, and a tie beam between the sides.
  for (const side of [-1, 1]) {
    const x = layout.mouth.x + side * legSpread;
    const block = new BoxGeometry(R * 0.6, R * 0.5, R * 0.7);
    block.translate(x, top, layout.mouth.z);
    parts.push(nonIndexed(block));
    for (const dz of [-1, 1]) {
      const height = top - footY;
      const leg = new CylinderGeometry(R * 0.11, R * 0.15, Math.hypot(height, R * 0.8), 12);
      leg.rotateX(Math.atan2(dz * R * 0.8, height));
      leg.translate(x, (top + footY) / 2, layout.mouth.z + dz * R * 0.4);
      parts.push(nonIndexed(leg));
    }
    const foot = new BoxGeometry(R * 0.5, R * 0.16, R * 2.2);
    foot.translate(x, footY, layout.mouth.z);
    parts.push(nonIndexed(foot));
  }
  const tie = new BoxGeometry(legSpread * 2, R * 0.24, R * 0.3);
  tie.translate(layout.mouth.x, top + R * 0.36, layout.mouth.z);
  parts.push(nonIndexed(tie));
  // Clapper: rod and ball inside the mouth.
  const rod = new CylinderGeometry(R * 0.05, R * 0.05, layout.height * 0.8, 10);
  rod.translate(layout.mouth.x, layout.mouth.y + layout.height * 0.5, layout.mouth.z);
  parts.push(nonIndexed(rod));
  const ball = new SphereGeometry(R * 0.16, 20, 14);
  ball.translate(layout.mouth.x, layout.mouth.y + R * 0.18, layout.mouth.z);
  parts.push(nonIndexed(ball));
  // Hammer bracket on the hammer-side leg, with the pivot pin through it.
  const pivot = hammerPivot(layout);
  const bracket = new BoxGeometry(R * 0.5, R * 0.4, R * 0.5);
  bracket.translate(pivot.x, pivot.y, pivot.z);
  parts.push(nonIndexed(bracket));
  const pin = new CylinderGeometry(R * 0.06, R * 0.06, R * 0.7, 10);
  pin.rotateX(Math.PI / 2);
  pin.translate(pivot.x, pivot.y, pivot.z);
  parts.push(nonIndexed(pin));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createSteelMaterial({ tarnish: 0.25, roughness: 0.48 }));
}

/** The hammer: a steel arm pivoting at the bracket with a black-oxide head toward the bell's sound bow. Rotates about +z. */
function createHammer(layout: BellLayout) {
  const R = layout.radius;
  const pivotGroup = new Group();
  pivotGroup.position.copy(hammerPivot(layout));
  const reach = R * 2.3 - R * 0.98;
  const arm = new BoxGeometry(reach, R * 0.16, R * 0.16);
  arm.translate(-layout.hammerSide * reach / 2, 0, 0);
  const hubs: BufferGeometry[] = [nonIndexed(arm)];
  const hub = new CylinderGeometry(R * 0.16, R * 0.16, R * 0.3, 16);
  hub.rotateX(Math.PI / 2);
  hubs.push(nonIndexed(hub));
  const steel = mergeGeometries(hubs, false);
  for (const part of hubs) part.dispose();
  pivotGroup.add(new Mesh(steel, createSteelMaterial({ tarnish: 0.2, roughness: 0.4, brushAxis: new Vector3(1, 0, 0) })));
  const head = new CylinderGeometry(R * 0.3, R * 0.3, R * 0.7, 20);
  head.rotateZ(Math.PI / 2);
  head.translate(-layout.hammerSide * (reach + R * 0.05), 0, 0);
  pivotGroup.add(new Mesh(head, createOxideMaterial({ roughness: 0.5, brushAxis: new Vector3(1, 0, 0) })));
  return pivotGroup;
}

export type Bell = {
  group: Group;
  /** Wave origin for the strike uniform. */
  origin: Vector3;
  /** 0 rests the hammer on the bell, 1 holds it at full lift. */
  setHammer(lift: number): void;
};

export function createBell(layout: BellLayout): Bell {
  const group = new Group();
  group.name = 'bell';
  group.add(createBellBody(layout));
  group.add(createSteelwork(layout));
  const hammer = createHammer(layout);
  group.add(hammer);
  const origin = layout.mouth.clone().setY(layout.mouth.y + layout.height * 0.5);
  return {
    group,
    origin,
    setHammer(lift) {
      const clamped = Math.min(1, Math.max(0, lift));
      hammer.rotation.z = layout.hammerSide * (HAMMER_REST + (HAMMER_LIFT - HAMMER_REST) * clamped);
    },
  };
}

/**
 * Hammer lift for a strike at `strikeTime`: raised over the bar before it,
 * dropped on the downbeat, then a short bounce.
 */
export function hammerLiftAt(time: number, strikeTime: number, barSeconds: number) {
  const untilStrike = strikeTime - time;
  if (untilStrike > barSeconds) return 0;
  if (untilStrike > 0) {
    const t = 1 - untilStrike / barSeconds;
    return t < 0.85 ? Math.sin((t / 0.85) * Math.PI * 0.5) : 1;
  }
  const since = -untilStrike;
  if (since < 0.08) return 1 - since / 0.08;
  const bounce = Math.exp(-since * 4) * Math.abs(Math.sin(since * 14)) * 0.25;
  return bounce;
}

/** Starts the strike wave at `origin` with peak displacement `strength` world units. */
export function beginStrike(origin: Vector3, strength = 7) {
  strikeOrigin.value.copy(origin);
  strikeStrength.value = strength;
  strikeAge.value = 0;
}

export const PREVIEW_BELL_LAYOUT: BellLayout = {
  mouth: new Vector3(-40, 20, -1240),
  radius: 52,
  height: 78,
  hammerSide: 1,
};

/** Snapshot factory: bell, headstock and hammer half raised, under the level sky. */
export function previewBell() {
  return withPreviewEnvironment(() => {
    const bell = createBell(PREVIEW_BELL_LAYOUT);
    bell.setHammer(0.6);
    bell.group.add(createPreviewLights(bell.origin, 140));
    return bell.group;
  });
}

/** Snapshot factory: the bell mid-strike, the wave front crossing the bell body. */
export function previewBellStrike() {
  return withPreviewEnvironment(() => {
    const bell = createBell(PREVIEW_BELL_LAYOUT);
    bell.setHammer(0.05);
    beginStrike(bell.origin, 12);
    strikeAge.value = 0.06;
    bell.group.add(createPreviewLights(bell.origin, 140));
    return bell.group;
  });
}
