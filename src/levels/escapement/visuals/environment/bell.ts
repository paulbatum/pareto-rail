import { BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Mesh, SphereGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBrassMaterial, createOxideMaterial, createPreviewLights, createSteelMaterial, strikeAge, strikeOrigin, strikeStrength } from '../materials';

// The hour bell and its hammer. The hammer is raised over the last bar before
// the strike and falls on the downbeat; the fall starts the strike wave that
// every environment material displaces by.

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
  const shell = new LatheGeometry(bellProfile(layout.radius, layout.height), 64);
  shell.translate(layout.mouth.x, layout.mouth.y, layout.mouth.z);
  const parts: BufferGeometry[] = [nonIndexed(shell)];
  // Crown loop and yoke beam.
  const crown = new CylinderGeometry(layout.radius * 0.14, layout.radius * 0.14, layout.radius * 0.3, 16);
  crown.translate(layout.mouth.x, layout.mouth.y + layout.height + layout.radius * 0.18, layout.mouth.z);
  parts.push(nonIndexed(crown));
  const yoke = new BoxGeometry(layout.radius * 2.4, layout.radius * 0.24, layout.radius * 0.3);
  yoke.translate(layout.mouth.x, layout.mouth.y + layout.height + layout.radius * 0.42, layout.mouth.z);
  parts.push(nonIndexed(yoke));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createBrassMaterial({ tarnish: 0.28, roughness: 0.36, brushAxis: new Vector3(0, 1, 0) }));
}

function createSteelwork(layout: BellLayout) {
  const parts: BufferGeometry[] = [];
  const top = layout.mouth.y + layout.height + layout.radius * 0.54;
  // Hangers from the yoke ends up to the beam, and the beam itself.
  for (const side of [-1, 1]) {
    const hanger = new CylinderGeometry(3.2, 3.2, layout.radius * 0.9, 12);
    hanger.translate(layout.mouth.x + side * layout.radius * 1.05, top + layout.radius * 0.45, layout.mouth.z);
    parts.push(nonIndexed(hanger));
  }
  const beam = new BoxGeometry(layout.radius * 3.6, 14, 18);
  beam.translate(layout.mouth.x, top + layout.radius * 0.9 + 7, layout.mouth.z);
  parts.push(nonIndexed(beam));
  // Clapper: rod and ball inside the mouth.
  const rod = new CylinderGeometry(2.5, 2.5, layout.height * 0.8, 10);
  rod.translate(layout.mouth.x, layout.mouth.y + layout.height * 0.5, layout.mouth.z);
  parts.push(nonIndexed(rod));
  const ball = new SphereGeometry(layout.radius * 0.16, 20, 14);
  ball.translate(layout.mouth.x, layout.mouth.y + layout.radius * 0.18, layout.mouth.z);
  parts.push(nonIndexed(ball));
  // Hammer post.
  const post = new CylinderGeometry(6, 8, layout.height * 1.1, 14);
  post.translate(layout.mouth.x + layout.hammerSide * (layout.radius + 70), layout.mouth.y + layout.height * 0.55, layout.mouth.z);
  parts.push(nonIndexed(post));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return new Mesh(merged, createSteelMaterial({ tarnish: 0.25 }));
}

/** The hammer: an arm pivoting at the post, head toward the bell. Rotates about +z. */
function createHammer(layout: BellLayout) {
  const pivot = new Group();
  pivot.position.set(layout.mouth.x + layout.hammerSide * (layout.radius + 70), layout.mouth.y + layout.height * 0.62, layout.mouth.z);
  const reach = 70 - layout.radius * 0.1;
  const arm = new BoxGeometry(reach, 9, 9);
  arm.translate(-layout.hammerSide * reach / 2, 0, 0);
  const head = new BoxGeometry(26, 30, 30);
  head.translate(-layout.hammerSide * (reach + 8), 0, 0);
  const parts = [nonIndexed(arm), nonIndexed(head)];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  pivot.add(new Mesh(merged, createOxideMaterial({ roughness: 0.5, brushAxis: new Vector3(1, 0, 0) })));
  return pivot;
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
  mouth: new Vector3(-60, 30, -1010),
  radius: 52,
  height: 78,
  hammerSide: 1,
};

/** Snapshot factory: bell and hammer, hammer half raised. */
export function previewBell() {
  const bell = createBell(PREVIEW_BELL_LAYOUT);
  bell.setHammer(0.6);
  bell.group.add(createPreviewLights(bell.origin, 140));
  return bell.group;
}

/** Snapshot factory: the bell mid-strike, the wave front crossing the bell body. */
export function previewBellStrike() {
  const bell = createBell(PREVIEW_BELL_LAYOUT);
  bell.setHammer(0.05);
  beginStrike(bell.origin, 12);
  strikeAge.value = 0.06;
  bell.group.add(createPreviewLights(bell.origin, 140));
  return bell.group;
}
