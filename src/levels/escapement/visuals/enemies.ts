import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  Curve,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PointLight,
  Quaternion,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeEnvironment, createGradientSky } from '../../../engine/environment-light';
import { disposeObject3D } from '../../../engine/visual-kit';
import {
  brassMaterial,
  createTargetPaint,
  oxideMaterial,
  silverMaterial,
  steelMaterial,
  steelTwoSidedMaterial,
  type TargetPaint,
} from './enemy-materials';
import { LAMP_WARM, RUBY, STEEL_BLUE, VERDIGRIS, VOID, WHITE_HOT } from './palette';

// The Escapement roster. Every target is lit metal plus a verdigris or ruby
// accent plus one solid white-hot spark. Silhouette and motion carry identity:
// motes drift, burrs tumble, ticks walk and leap, ratchets step on the beat,
// wasps ride and fire, chimes hang and swing.
//
// Each factory returns a Group whose origin is the lock point: the runner
// projects `mesh.position` to test the reticle, so the origin sits where the
// player should aim. Gameplay owns position and facing; the rig animates only
// its children.
//
// The spark is an unlit octahedron placed inside the silhouette, at the centre
// of the read, so it shows from every angle. Its diameter is at least 8 percent
// of the rig's height.

export type EscapementEnemyKind = 'tarnish-mote' | 'burr' | 'oxide-tick' | 'ratchet' | 'jewel-wasp' | 'chime' | 'ruby-bolt';

export interface EnemyRig extends Group {
  /** Advances the rig's animation. `beatPhase` is 0..1 within the current beat. */
  update(dt: number, beatPhase: number): void;
  setLocked(locked: boolean): void;
  /** Starts the rejected-release flash; it decays over the next half second. */
  setDenied(): void;
  /** Starts the hit flash; it decays over the next third of a second. */
  setDamaged(): void;
  dispose(): void;
}

export type TickGait = 'walk' | 'raised' | 'leap';

export interface OxideTickRig extends EnemyRig {
  setGait(gait: TickGait): void;
}

export interface RatchetRig extends EnemyRig {
  /** `stage` is the count of armour stages already broken, 0..3. */
  setStage(stage: number): void;
}

export interface JewelWaspRig extends EnemyRig {
  /** 0..1 charge before a shot; the spark swells and the ruby heats. */
  setCharge(charge: number): void;
}

const DENIED_SECONDS = 0.5;
const DAMAGED_SECONDS = 0.32;
const SPARK_GEOMETRIES = new Map<number, OctahedronGeometry>();

function sparkGeometry(radius: number) {
  let geometry = SPARK_GEOMETRIES.get(radius);
  if (!geometry) {
    geometry = new OctahedronGeometry(radius, 1);
    SPARK_GEOMETRIES.set(radius, geometry);
  }
  return geometry;
}

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

type Part = {
  geometry: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

const scratchMatrix = new Matrix4();

/** Bakes each part's transform into its geometry and merges them into one geometry. */
function mergeParts(parts: Part[]): BufferGeometry {
  const pieces: BufferGeometry[] = [];
  for (const part of parts) {
    const matrix = scratchMatrix.compose(
      new Vector3(...(part.position ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]))),
      new Vector3(...(part.scale ?? [1, 1, 1])),
    );
    const transformed = part.geometry.clone().applyMatrix4(matrix);
    // Primitive geometries mix indexed and non-indexed layouts; mergeGeometries
    // needs one layout.
    if (transformed.index) {
      pieces.push(transformed.toNonIndexed());
      transformed.dispose();
    } else {
      pieces.push(transformed);
    }
  }
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

// ---- rig plumbing --------------------------------------------------------------

type RigClock = {
  time: number;
  beatIndex: number;
  beatPhase: number;
  lastBeatPhase: number;
};

type RigState = {
  locked: boolean;
  deniedUntil: number;
  damagedUntil: number;
  heat: number;
  dim: number;
};

type Animate = (dt: number, clock: RigClock, state: RigState) => void;

function buildRig(group: Group, kind: EscapementEnemyKind, accent: Color, paint: TargetPaint, animate: Animate, lockRingScale: number) {
  const clock: RigClock = { time: 0, beatIndex: 0, beatPhase: 0, lastBeatPhase: 0 };
  const state: RigState = { locked: false, deniedUntil: -1, damagedUntil: -1, heat: 0, dim: 0 };
  group.userData.kind = kind;
  group.userData.accent = accent.clone();
  group.userData.lockRingScale = lockRingScale;

  const rig = group as EnemyRig;
  rig.update = (dt, beatPhase) => {
    clock.time += dt;
    if (beatPhase < clock.lastBeatPhase) clock.beatIndex += 1;
    clock.lastBeatPhase = beatPhase;
    clock.beatPhase = beatPhase;
    animate(dt, clock, state);
    const denied = MathUtils.clamp((state.deniedUntil - clock.time) / DENIED_SECONDS, 0, 1);
    const damaged = MathUtils.clamp((state.damagedUntil - clock.time) / DAMAGED_SECONDS, 0, 1);
    paint.apply({
      locked: state.locked,
      denied,
      damaged,
      pulse: (1 - beatPhase) ** 3,
      heat: state.heat,
      dim: state.dim,
    });
  };
  rig.setLocked = (locked) => {
    state.locked = locked;
  };
  rig.setDenied = () => {
    state.deniedUntil = clock.time + DENIED_SECONDS;
  };
  rig.setDamaged = () => {
    state.damagedUntil = clock.time + DAMAGED_SECONDS;
  };
  rig.dispose = () => {
    paint.dispose();
    disposeObject3D(group);
  };
  // Paint once so a rig that has not ticked yet still shows its base colours.
  paint.apply({ locked: false, denied: 0, damaged: 0, pulse: 0, heat: 0, dim: 0 });
  return { rig, state, clock };
}

function addSpark(parent: Group, paint: TargetPaint, radius: number, position: [number, number, number], intensity = 2.4) {
  const spark = new Mesh(sparkGeometry(radius), paint.spark(intensity));
  spark.position.set(...position);
  parent.add(spark);
  return spark;
}

// ---- tarnish mote: a verdigris fleck, 0.6 m, that drifts --------------------------

const MOTE_RADIUS = 0.3;

/** One cupped hex flake: the rim bends up a tenth of the radius. Shared with the instanced swarm. */
export const moteGeometry = once(() => {
  const outline = new Shape();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * MOTE_RADIUS;
    const y = Math.sin(angle) * MOTE_RADIUS;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const fraction = Math.hypot(x, z) / MOTE_RADIUS;
    positions.setY(i, positions.getY(i) + MOTE_RADIUS * 0.1 * fraction * fraction);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
});

export function createTarnishMote(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  const body = new Group();
  body.add(new Mesh(moteGeometry(), paint.accent('verdigris', DoubleSide)));
  // The spark sits through the flake's centre and shows from both faces.
  addSpark(body, paint, 0.075, [0, 0.015, 0], 2.2);
  group.add(body);

  const { rig } = buildRig(group, 'tarnish-mote', VERDIGRIS, paint, (dt, clock) => {
    // Drift: the flake tilts on a slow wobble while turning about its own axis.
    body.rotation.x = 0.55 + Math.sin(clock.time * 0.9) * 0.3;
    body.rotation.z = Math.sin(clock.time * 0.7 + 1.3) * 0.25;
    body.rotation.y += dt * 1.3;
  }, 0.75);
  return rig;
}

// ---- burr: a curled steel shaving, 1.5 m, that tumbles ----------------------------

const BURR_TURNS = 1.6;

function burrCenter(t: number, target: Vector3) {
  const angle = t * BURR_TURNS * Math.PI * 2;
  const radius = 0.55 - 0.38 * t;
  return target.set(Math.cos(angle) * radius, Math.sin(angle) * radius, (t - 0.5) * 1.1);
}

function burrAcross(t: number, target: Vector3) {
  const angle = t * BURR_TURNS * Math.PI * 2;
  return target.set(Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 1).normalize();
}

function burrWidth(t: number) {
  return 0.38 - 0.24 * t;
}

/** A strip swept along the burr spiral: `burrCenter` is the spine, `burrAcross` the strip direction. */
function ribbonGeometry(segments: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const center = new Vector3();
  const across = new Vector3();
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    burrCenter(t, center);
    burrAcross(t, across);
    const half = burrWidth(t) / 2;
    positions.push(
      center.x - across.x * half, center.y - across.y * half, center.z - across.z * half,
      center.x + across.x * half, center.y + across.y * half, center.z + across.z * half,
    );
    uvs.push(t, 0, t, 1);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

class BurrEdgeCurve extends Curve<Vector3> {
  private readonly across = new Vector3();

  constructor() {
    super();
  }

  getPoint(t: number, target = new Vector3()) {
    burrCenter(t, target);
    burrAcross(t, this.across);
    return target.addScaledVector(this.across, burrWidth(t) / 2 - 0.012);
  }
}

const burrGeometry = once(() => ribbonGeometry(72));
const burrRimGeometry = once(() => new TubeGeometry(new BurrEdgeCurve(), 72, 0.02, 5, false));

export function createBurr(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  const body = new Group();
  body.add(new Mesh(burrGeometry(), steelTwoSidedMaterial()));
  // A verdigris rim runs along the shaving's outer edge.
  body.add(new Mesh(burrRimGeometry(), paint.accent('verdigris')));
  // The spark sits on the helix axis, inside the curl through a full tumble.
  addSpark(body, paint, 0.13, [0, 0, 0], 2.6);
  group.add(body);

  const { rig } = buildRig(group, 'burr', STEEL_BLUE, paint, (dt) => {
    // Tumble end over end, with a slower roll so the curl catches the light.
    body.rotation.x += dt * 5.2;
    body.rotation.y += dt * 1.1;
  }, 0.95);
  return rig;
}

// ---- oxide tick: a six-legged mite, 1.2 m, that walks then leaps ------------------

const TICK_LEG_SLOTS: Array<{ z: number; yaw: number; tripod: 0 | 1; pair: 'front' | 'mid' | 'rear' }> = [
  { z: 0.3, yaw: -0.55, tripod: 0, pair: 'front' },
  { z: 0.03, yaw: 0, tripod: 1, pair: 'mid' },
  { z: -0.26, yaw: 0.55, tripod: 0, pair: 'rear' },
];
const TICK_HIP = { x: 0.3, y: -0.04 };

const tickBodyGeometry = once(() => {
  const thorax = new SphereGeometry(0.42, 12, 8);
  thorax.scale(1, 0.55, 1.05);
  const abdomen = new SphereGeometry(0.34, 12, 8);
  abdomen.scale(1, 0.62, 1.2);
  const head = new SphereGeometry(0.18, 10, 7);
  head.scale(1, 0.8, 1);
  return mergeParts([
    { geometry: thorax, position: [0, 0, 0.05] },
    { geometry: abdomen, position: [0, 0.02, -0.5] },
    { geometry: head, position: [0, 0.02, 0.5] },
  ]);
});

// Verdigris crust: a hip socket inside the body at each leg root, and a ring of
// tarnish at the head and abdomen seams.
const tickCrustGeometry = once(() => {
  const parts: Part[] = [
    { geometry: new TorusGeometry(0.2, 0.035, 6, 18), position: [0, 0.02, 0.37] },
    { geometry: new TorusGeometry(0.27, 0.035, 6, 20), position: [0, 0.01, -0.3] },
  ];
  for (const side of [1, -1]) {
    for (const slot of TICK_LEG_SLOTS) {
      parts.push({ geometry: new SphereGeometry(0.065, 8, 6), position: [side * TICK_HIP.x, TICK_HIP.y, slot.z] });
    }
  }
  return mergeParts(parts);
});

/** One leg in its hip frame: femur out and up, tibia down to the foot, a hooked claw at the tip. */
const tickLegGeometry = once(() => {
  const knee = new Vector3(0.3, 0.24, 0);
  const foot = new Vector3(0.5, -0.36, 0);
  const tibia = foot.clone().sub(knee);
  const femur = new CylinderGeometry(0.028, 0.045, knee.length(), 5);
  const shin = new CylinderGeometry(0.016, 0.032, tibia.length(), 5);
  const femurAngle = Math.atan2(knee.x, knee.y);
  const shinAngle = Math.atan2(tibia.x, tibia.y);
  return mergeParts([
    { geometry: femur, position: [knee.x / 2, knee.y / 2, 0], rotation: [0, 0, -femurAngle] },
    { geometry: new SphereGeometry(0.04, 6, 5), position: [knee.x, knee.y, knee.z] },
    { geometry: shin, position: [(knee.x + foot.x) / 2, (knee.y + foot.y) / 2, 0], rotation: [0, 0, -shinAngle] },
    { geometry: new ConeGeometry(0.03, 0.14, 5), position: [foot.x + 0.02, foot.y - 0.06, 0], rotation: [0, 0, 2.6] },
  ]);
});

export function createOxideTick(): OxideTickRig {
  const group = new Group();
  const paint = createTargetPaint();
  const body = new Group();
  body.add(new Mesh(tickBodyGeometry(), oxideMaterial()));
  const crustMaterial = paint.accent('verdigris');
  body.add(new Mesh(tickCrustGeometry(), crustMaterial));
  // The single white-hot eye, set into the front of the head so it faces the rail.
  addSpark(body, paint, 0.1, [0, 0.04, 0.6], 2.8);

  const legs: Array<{ pivot: Group; side: 1 | -1; slot: (typeof TICK_LEG_SLOTS)[number]; baseYaw: number }> = [];
  for (const side of [1, -1] as const) {
    for (const slot of TICK_LEG_SLOTS) {
      const pivot = new Group();
      pivot.position.set(side * TICK_HIP.x, TICK_HIP.y, slot.z);
      const baseYaw = side === 1 ? slot.yaw : Math.PI - slot.yaw;
      pivot.add(new Mesh(tickLegGeometry(), crustMaterial));
      body.add(pivot);
      legs.push({ pivot, side, slot, baseYaw });
    }
  }
  group.add(body);

  let gait: TickGait = 'walk';
  let raise = 0;
  let stretch = 0;
  let walkTime = 0;
  const rig = buildRig(group, 'oxide-tick', VERDIGRIS, paint, (dt) => {
    raise = MathUtils.damp(raise, gait === 'raised' ? 1 : 0, 14, dt);
    stretch = MathUtils.damp(stretch, gait === 'leap' ? 1 : 0, 16, dt);
    if (gait === 'walk') walkTime += dt;
    // Tripod gait: two sets of three legs alternate, each lifting on its swing.
    // Raised: the front two pairs lift and the rear pair stays planted, so the
    // crouch reads as a spring. Leap: every leg stretches back.
    for (const leg of legs) {
      const cycle = walkTime * Math.PI * 2 * 2.6 + leg.slot.tripod * Math.PI;
      const walkLift = Math.max(0, Math.sin(cycle)) * 0.5 - 0.08;
      const walkSwing = Math.cos(cycle) * 0.32;
      const raisedLift = leg.slot.pair === 'rear' ? -0.3 : 0.95;
      const raisedSwing = leg.slot.pair === 'rear' ? -0.3 : 0.3;
      const lift = MathUtils.lerp(MathUtils.lerp(walkLift, raisedLift, raise), -0.38, stretch);
      const swing = MathUtils.lerp(MathUtils.lerp(walkSwing, raisedSwing, raise), -0.55, stretch);
      leg.pivot.rotation.set(0, leg.baseYaw + swing * leg.side, lift);
    }
    body.rotation.x = -0.35 * raise + 0.12 * stretch;
    body.position.y = 0.1 * raise - 0.05 * stretch;
  }, 0.95).rig as OxideTickRig;
  rig.setGait = (next) => {
    gait = next;
  };
  return rig;
}

// ---- ratchet: a pawl, 2 m, that steps on each beat --------------------------------

// The lever runs from the pivot boss at the origin (the ruby pin, the lock
// point) out along +x to the hardened tooth. Three riveted plates stack on the
// lever's faces; each broken stage drops the outermost pair and the lever thins.
const RATCHET_SCALE = 1.15;
const RATCHET_BOSS_RADIUS = 0.42;
const RATCHET_DEPTH = 0.3;

const ratchetLeverGeometry = once(() => {
  const outline = new Shape();
  const s = RATCHET_SCALE;
  outline.moveTo(0, RATCHET_BOSS_RADIUS * s);
  outline.lineTo(0.55 * s, 0.36 * s);
  outline.lineTo(1.15 * s, 0.18 * s);
  outline.lineTo(1.42 * s, 0.02 * s);
  outline.lineTo(1.3 * s, -0.32 * s);
  outline.lineTo(1.05 * s, -0.16 * s);
  outline.lineTo(0.55 * s, -0.34 * s);
  outline.lineTo(0, -RATCHET_BOSS_RADIUS * s);
  outline.absarc(0, 0, RATCHET_BOSS_RADIUS * s, -Math.PI / 2, Math.PI / 2, true);
  const geometry = new ExtrudeGeometry(outline, {
    depth: RATCHET_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -RATCHET_DEPTH / 2);
  return geometry;
});

type RatchetPlateSpec = { from: number; to: number; halfHeight: number; layer: number };

// Innermost first; stages break from the outermost inward.
const RATCHET_PLATES: RatchetPlateSpec[] = [
  { from: 0.38, to: 1.2, halfHeight: 0.26, layer: 0 },
  { from: 0.48, to: 1.08, halfHeight: 0.2, layer: 1 },
  { from: 0.58, to: 0.96, halfHeight: 0.15, layer: 2 },
];

function ratchetPlateGeometry(spec: RatchetPlateSpec) {
  const s = RATCHET_SCALE;
  const thickness = 0.08;
  const z = RATCHET_DEPTH / 2 + thickness / 2 + spec.layer * thickness;
  const outline = new Shape([
    new Vector2(spec.from * s, spec.halfHeight * s),
    new Vector2(spec.to * s, spec.halfHeight * 0.55 * s),
    new Vector2(spec.to * s, -spec.halfHeight * 0.55 * s),
    new Vector2(spec.from * s, -spec.halfHeight * s),
  ]);
  const plate = new ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false });
  plate.translate(0, 0, -thickness / 2);
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    parts.push({ geometry: plate, position: [0, 0, side * z] });
    for (let i = 0; i < 3; i += 1) {
      const x = MathUtils.lerp(spec.from, spec.to, (i + 0.5) / 3) * s;
      parts.push({
        geometry: new CylinderGeometry(0.035, 0.035, 0.05, 6),
        position: [x, 0, side * (z + thickness / 2)],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
  }
  return mergeParts(parts);
}

const ratchetPlateGeometries = once(() => RATCHET_PLATES.map(ratchetPlateGeometry));
const ratchetCollarGeometry = once(() => mergeParts([
  { geometry: new TorusGeometry(0.3, 0.06, 6, 20), position: [0, 0, RATCHET_DEPTH / 2 + 0.02] },
  { geometry: new TorusGeometry(0.3, 0.06, 6, 20), position: [0, 0, -RATCHET_DEPTH / 2 - 0.02] },
]));
const ratchetPinGeometry = once(() => new CylinderGeometry(0.17, 0.17, 0.82, 12));

type Shearing = { object: Group; velocity: Vector3; spin: Vector3; age: number };

function stepShearing(pieces: Shearing[], dt: number, gravity: number) {
  for (const piece of pieces) {
    piece.age += dt;
    piece.velocity.y -= gravity * dt;
    piece.object.position.addScaledVector(piece.velocity, dt);
    piece.object.rotation.x += piece.spin.x * dt;
    piece.object.rotation.y += piece.spin.y * dt;
    piece.object.rotation.z += piece.spin.z * dt;
    if (piece.age > 1.4) piece.object.removeFromParent();
  }
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    if (!pieces[index].object.parent) pieces.splice(index, 1);
  }
}

export function createRatchet(): RatchetRig {
  const group = new Group();
  const paint = createTargetPaint();
  const body = new Group();
  body.add(new Mesh(ratchetLeverGeometry(), steelMaterial()));
  const plates = ratchetPlateGeometries().map((geometry) => {
    const plate = new Group();
    plate.add(new Mesh(geometry, steelMaterial()));
    body.add(plate);
    return plate;
  });
  body.add(new Mesh(ratchetCollarGeometry(), brassMaterial()));
  const pin = new Mesh(ratchetPinGeometry(), paint.accent('ruby'));
  pin.rotation.x = Math.PI / 2;
  body.add(pin);
  // The spark caps both ends of the pin, so it shows face-on and edge-on.
  const sparkMaterial = paint.spark(2.6);
  for (const side of [1, -1]) {
    const cap = new Mesh(sparkGeometry(0.12), sparkMaterial);
    cap.position.z = side * 0.42;
    body.add(cap);
  }
  group.add(body);

  let stage = 0;
  const shearing: Shearing[] = [];
  const rig = buildRig(group, 'ratchet', RUBY, paint, (dt, clock) => {
    // Tick-step: the pawl drops onto the next tooth at the beat and settles.
    body.rotation.z = -0.32 * Math.exp(-clock.beatPhase * 7);
    stepShearing(shearing, dt, 9);
  }, 1.15).rig as RatchetRig;
  rig.setStage = (next) => {
    const target = MathUtils.clamp(Math.round(next), 0, plates.length);
    while (stage < target) {
      const plate = plates[plates.length - 1 - stage];
      stage += 1;
      shearing.push({
        object: plate,
        velocity: new Vector3(2.5, 2.2, 0),
        spin: new Vector3(3, 5 + stage, 2),
        age: 0,
      });
    }
  };
  return rig;
}

// ---- jewel wasp: a faceted ruby with two brass vanes, 1.4 m, that rides and fires --

const waspBodyGeometry = once(() => {
  const geometry = new OctahedronGeometry(0.42, 1);
  geometry.scale(0.72, 0.58, 1.35);
  return geometry;
});

// Collar seated against the head, head, mandibles, a stinger, and the hinge
// block the vanes fold from.
const waspBrassGeometry = once(() => mergeParts([
  { geometry: new TorusGeometry(0.15, 0.045, 6, 16), position: [0, 0.01, 0.47] },
  { geometry: new SphereGeometry(0.17, 10, 7), position: [0, 0.02, 0.64] },
  { geometry: new ConeGeometry(0.03, 0.26, 5), position: [0.09, -0.06, 0.8], rotation: [1.35, 0, -0.4] },
  { geometry: new ConeGeometry(0.03, 0.26, 5), position: [-0.09, -0.06, 0.8], rotation: [1.35, 0, 0.4] },
  { geometry: new ConeGeometry(0.05, 0.3, 6), position: [0, 0, -0.68], rotation: [-Math.PI / 2, 0, 0] },
  { geometry: new BoxGeometry(0.26, 0.1, 0.22), position: [0, 0.23, 0.2] },
]));

// A vane with a fold along its length: the leading strip is flat and the
// trailing strip is bent down, so no view sees the vane edge-on.
const waspVaneGeometry = once(() => {
  const leading = new ExtrudeGeometry(
    new Shape([new Vector2(0, 0), new Vector2(0.86, 0.02), new Vector2(0.84, 0.16), new Vector2(0, 0.2)]),
    { depth: 0.02, bevelEnabled: false },
  );
  leading.rotateX(-Math.PI / 2);
  const trailing = new ExtrudeGeometry(
    new Shape([new Vector2(0, -0.17), new Vector2(0.8, -0.06), new Vector2(0.86, 0.02), new Vector2(0, 0)]),
    { depth: 0.02, bevelEnabled: false },
  );
  trailing.rotateX(-Math.PI / 2);
  trailing.rotateX(0.55);
  return mergeParts([{ geometry: leading }, { geometry: trailing }]);
});

export function createJewelWasp(): JewelWaspRig {
  const group = new Group();
  const paint = createTargetPaint();
  const body = new Group();
  body.add(new Mesh(waspBodyGeometry(), paint.accent('ruby', 0, true)));
  body.add(new Mesh(waspBrassGeometry(), brassMaterial()));
  // The eye, set into the top front of the head so it also shows over the head from behind.
  const spark = addSpark(body, paint, 0.14, [0, 0.18, 0.62], 2.8);

  const vanes = [1, -1].map((side) => {
    const hinge = new Group();
    hinge.position.set(side * 0.12, 0.28, 0.2);
    // Swept back so the vanes show their faces from the front and below.
    hinge.rotation.set(0, side === 1 ? -0.35 : Math.PI + 0.35, 0);
    hinge.add(new Mesh(waspVaneGeometry(), brassMaterial()));
    body.add(hinge);
    return { hinge, side };
  });
  group.add(body);

  let charge = 0;
  const rig = buildRig(group, 'jewel-wasp', RUBY, paint, (_dt, clock, state) => {
    // Vanes beat at 11 Hz; the body bobs against them.
    const flap = Math.sin(clock.time * Math.PI * 2 * 11) * 0.5 + 0.3;
    for (const vane of vanes) vane.hinge.rotation.z = flap;
    body.position.y = Math.sin(clock.time * Math.PI * 2 * 11) * 0.012 + Math.sin(clock.time * 2.1) * 0.05;
    body.rotation.z = Math.sin(clock.time * 1.7) * 0.08;
    state.heat = charge;
    spark.scale.setScalar(1 + charge * 1.2);
  }, 1.0).rig as JewelWaspRig;
  rig.setCharge = (next) => {
    charge = MathUtils.clamp(next, 0, 1);
  };
  return rig;
}

const boltGeometry = once(() => {
  const geometry = new OctahedronGeometry(0.28, 0);
  geometry.scale(0.5, 0.5, 2.2);
  return geometry;
});

/** The wasp's shot: a ruby dart with a white-hot head. The level's ribbon trail reads `userData.trailColor`. */
export function createRubyBolt(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  group.add(new Mesh(boltGeometry(), paint.accent('ruby', 0, true)));
  addSpark(group, paint, 0.13, [0, 0, 0.5], 3);
  group.userData.isHostileShot = true;
  group.userData.trailColor = WHITE_HOT.clone();
  const { rig } = buildRig(group, 'ruby-bolt', RUBY, paint, () => {}, 0.7);
  return rig;
}

// ---- chime: a small silver bell, 1 m, with a ruby clapper, that hangs and swings ---

const CHIME_PIVOT_Y = 0.9;
const CHIME_CLAPPER_TOP = 0.36;
const CHIME_CLAPPER_LENGTH = 0.98;

const chimeBellGeometry = once(() => new LatheGeometry([
  new Vector2(0.001, 0.5),
  new Vector2(0.09, 0.49),
  new Vector2(0.17, 0.43),
  new Vector2(0.23, 0.3),
  new Vector2(0.27, 0.1),
  new Vector2(0.31, -0.12),
  new Vector2(0.38, -0.32),
  new Vector2(0.47, -0.46),
  new Vector2(0.5, -0.53),
  new Vector2(0.44, -0.52),
  new Vector2(0.33, -0.4),
  new Vector2(0.24, -0.15),
  new Vector2(0.19, 0.15),
  new Vector2(0.12, 0.36),
  new Vector2(0.001, 0.42),
], 22));

const chimeCrownGeometry = once(() => mergeParts([
  { geometry: new TorusGeometry(0.075, 0.022, 6, 14), position: [0, 0.57, 0] },
  { geometry: new CylinderGeometry(0.018, 0.018, CHIME_PIVOT_Y - 0.62, 6), position: [0, (CHIME_PIVOT_Y + 0.62) / 2, 0] },
  { geometry: new CylinderGeometry(0.05, 0.03, 0.06, 8), position: [0, CHIME_PIVOT_Y - 0.02, 0] },
]));

// The clapper: a ruby stem ending in a ruby ring that holds the spark, hung
// just below the rim so both show from the rail.
const chimeClapperGeometry = once(() => mergeParts([
  { geometry: new CylinderGeometry(0.014, 0.014, CHIME_CLAPPER_LENGTH, 6), position: [0, -CHIME_CLAPPER_LENGTH / 2, 0] },
  { geometry: new TorusGeometry(0.11, 0.04, 8, 16), position: [0, -CHIME_CLAPPER_LENGTH, 0] },
]));

export function createChime(): EnemyRig {
  const group = new Group();
  const paint = createTargetPaint();
  const pivot = new Group();
  pivot.position.y = CHIME_PIVOT_Y;
  const hang = new Group();
  hang.position.y = -CHIME_PIVOT_Y;
  hang.add(new Mesh(chimeBellGeometry(), silverMaterial()));
  hang.add(new Mesh(chimeCrownGeometry(), brassMaterial()));
  const clapper = new Group();
  clapper.position.y = CHIME_CLAPPER_TOP;
  clapper.add(new Mesh(chimeClapperGeometry(), paint.accent('ruby')));
  addSpark(clapper, paint, 0.09, [0, -CHIME_CLAPPER_LENGTH, 0], 2.6);
  hang.add(clapper);
  pivot.add(hang);
  group.add(pivot);

  const { rig } = buildRig(group, 'chime', RUBY, paint, (_dt, clock) => {
    // One swing every two beats; the clapper lags the bell and strikes the rim.
    const phase = (clock.beatIndex + clock.beatPhase) * Math.PI;
    const swing = Math.sin(phase) * 0.34;
    pivot.rotation.z = swing;
    clapper.rotation.z = -swing * 0.5 + Math.sin(phase - 1.1) * 0.3;
  }, 1.0);
  return rig;
}

// ---- preview harness --------------------------------------------------------------

/**
 * The level's lighting for a snapshot: the sky bake (warm lamp above,
 * steel-blue sides, black below) attached as the scene environment on the
 * first frame, plus the lamp as a point light. `radius` scales the lamp
 * distance for a large subject.
 */
export function previewLightRig(center: Vector3, radius = 1) {
  const rig = new Group();
  const lamp = new PointLight(LAMP_WARM, 40 * radius * radius, 0, 2);
  lamp.position.copy(center).add(new Vector3(1.5, 5, 2.5).multiplyScalar(radius));
  rig.add(lamp);

  // The snapshot harness owns the scene and renderer, so a probe mesh installs
  // the bake from inside the first render: `scene.onBeforeRender` runs before
  // the backend opens its render pass, where a nested PMREM render is safe.
  const probe = new Mesh(new BoxGeometry(0.001, 0.001, 0.001), new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  probe.frustumCulled = false;
  let installed = false;
  probe.onBeforeRender = (_renderer, scene) => {
    if (installed) return;
    installed = true;
    let baked = false;
    scene.onBeforeRender = (renderer) => {
      if (baked) return;
      baked = true;
      const sky = createGradientSky({
        zenith: LAMP_WARM.clone().multiplyScalar(0.9),
        horizon: STEEL_BLUE.clone().multiplyScalar(0.55),
        ground: VOID,
        horizonWidth: 0.35,
        sunDirection: new Vector3(0.2, 1, 0.35),
        sunColor: LAMP_WARM,
        sunIntensity: 30,
        sunAngularRadius: 0.08,
        haloAngularRadius: 0.6,
        haloIntensity: 0.15,
      });
      bakeEnvironment(renderer as unknown as WebGPURenderer, () => sky.scene, { size: 128 }).attach(scene as Scene);
    };
  };
  rig.add(probe);
  return rig;
}

export type EnemyPreviewState = 'normal' | 'locked' | 'denied' | 'damaged' | 'raised' | 'leap' | 'stage1' | 'stage2' | 'charged';

const ENEMY_FACTORIES: Record<EscapementEnemyKind, () => EnemyRig> = {
  'tarnish-mote': createTarnishMote,
  burr: createBurr,
  'oxide-tick': createOxideTick,
  ratchet: createRatchet,
  'jewel-wasp': createJewelWasp,
  chime: createChime,
  'ruby-bolt': createRubyBolt,
};

/**
 * Snapshot entry point: builds one enemy, poses it `seconds` into its
 * animation at 120 BPM, applies a state, and lights it. For
 * `npm run snapshot -- --module src/levels/escapement/visuals/enemies.ts --export previewEnemy --args '["ratchet","locked"]'`.
 */
export function previewEnemy(kind: EscapementEnemyKind, state: EnemyPreviewState = 'normal', seconds = 0.37) {
  const rig = ENEMY_FACTORIES[kind]();
  if (state === 'raised' || state === 'leap') (rig as OxideTickRig).setGait?.(state);
  if (state === 'stage1') (rig as RatchetRig).setStage?.(1);
  if (state === 'stage2') (rig as RatchetRig).setStage?.(2);
  if (state === 'charged') (rig as JewelWaspRig).setCharge?.(1);
  rig.setLocked(state === 'locked');
  const step = 1 / 60;
  const beatSeconds = 0.5;
  for (let t = 0; t < seconds; t += step) rig.update(step, (t / beatSeconds) % 1);
  if (state === 'denied') rig.setDenied();
  if (state === 'damaged') rig.setDamaged();
  if (state === 'denied' || state === 'damaged') rig.update(0.05, (seconds / beatSeconds) % 1);

  const stage = new Group();
  stage.add(rig, previewLightRig(new Vector3()));
  return stage;
}
