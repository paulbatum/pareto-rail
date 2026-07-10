import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, mx_noise_float, positionLocal, positionView, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { createDownpourRail, railU } from '../gameplay';
import { AVENUE_TIME, CANAL_TIME, CITADEL_TIME, OUTRO_TIME, PLUNGE_TIME, UNDERCITY_TIME } from '../timing';
import { AMBER, CYAN, HAZARD_WHITE, MAGENTA, MOONLIGHT, RAIN_BLACK, RAIN_STREAK, SLATE, SLATE_LIGHT, SLATE_WET } from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0);
export const rainOffsetUniform = uniform(0);
export const rainGlowUniform = uniform(0.4);
export const lightningUniform = uniform(0);
export const moonlightUniform = uniform(0);

const RAIN_SPAN = 46;
const RAIN_BACK = 40;

// Rail progress at each movement boundary — used to zone the scattered city
// lights and set-piece placement without re-deriving section math here.
const U_PLUNGE = railU(PLUNGE_TIME);
const U_AVENUE = railU(AVENUE_TIME);
const U_UNDERCITY = railU(UNDERCITY_TIME);
const U_CANAL = railU(CANAL_TIME);
const U_CITADEL = railU(CITADEL_TIME);
const U_OUTRO = railU(OUTRO_TIME);

export type Environment = {
  root: Group;
  curve: ReturnType<typeof createDownpourRail>;
  stormCloudPosition: Vector3;
  cloudBreakPosition: Vector3;
  citadelBeaconPosition: Vector3;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = RAIN_BLACK.clone();
  const root = new Group();
  const rng = mulberry32(20260710);
  const curve = createDownpourRail();

  root.add(createCityLights(rng, curve));
  root.add(createTowerField(rng, curve, U_PLUNGE, U_AVENUE, 'plunge'));
  root.add(createSignageStrip(curve, U_AVENUE, U_UNDERCITY));
  root.add(createSkyways(curve, U_AVENUE, U_UNDERCITY));
  root.add(createTunnelRibs(curve, U_UNDERCITY, U_CANAL));
  root.add(createTrainField(rng, curve, U_UNDERCITY, U_CITADEL));
  root.add(createCanalWater(curve, U_CANAL, U_CITADEL));
  root.add(createTowerField(rng, curve, U_CITADEL, U_OUTRO, 'citadel'));

  const stormDeck = createCloudDeck(24, RAIN_BLACK.clone().multiplyScalar(1.4), SLATE.clone());
  const stormFrame = sampleRailFrame(curve, 0.05);
  stormDeck.position.set(0, 96, -110);
  root.add(stormDeck);

  const breakDeck = createCloudDeck(30, SLATE.clone(), MOONLIGHT.clone());
  breakDeck.position.set(0, 172, -1408);
  root.add(breakDeck);

  const rain = createRainStreaks(rng);
  root.add(rain);

  const citadelFrame = sampleRailFrame(curve, railU(CITADEL_TIME) + (U_OUTRO - U_CITADEL) * 0.55);
  const beaconPosition = citadelFrame.position.clone().addScaledVector(citadelFrame.up, 90);
  root.add(createCitadelBeacon(beaconPosition));

  root.add(createMoon());

  scene.add(root);
  return {
    root,
    curve,
    stormCloudPosition: stormFrame.position.clone().addScaledVector(stormFrame.up, 40),
    cloudBreakPosition: breakDeck.position.clone(),
    citadelBeaconPosition: beaconPosition,
  };
}

// ---- scattered city lights: one field, zoned by rail progress -----------------

function zoneColor(u: number): Color {
  if (u < U_AVENUE) return Math.random() < 0.5 ? CYAN : MAGENTA;
  if (u < U_UNDERCITY) return Math.random() < 0.5 ? CYAN : MAGENTA;
  if (u < U_CANAL) return AMBER;
  if (u < U_CITADEL) return AMBER;
  if (u < U_OUTRO) return HAZARD_WHITE;
  return MOONLIGHT;
}

function createCityLights(rng: () => number, curve: ReturnType<typeof createDownpourRail>) {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 12 + rng() * 130;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius * (rng() < 0.7 ? 0.6 : 1))
      .addScaledVector(frame.tangent, (rng() - 0.5) * 40);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const base = zoneColor(u);
    const intensity = rng() < 0.06 ? 1.6 : 0.14 + rng() * 0.3;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 0.55, vertexColors: true, sizeAttenuation: true }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- tower monoliths: colossal slate faces flanking the plunge / citadel ------

function createTowerField(
  rng: () => number,
  curve: ReturnType<typeof createDownpourRail>,
  uStart: number,
  uEnd: number,
  zone: 'plunge' | 'citadel',
) {
  const group = new Group();
  const dark = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.55) });
  const stripeColor = zone === 'plunge' ? CYAN : HAZARD_WHITE;
  // Plain (non-additive, non-HDR) material: a tall thin accent would bloom
  // into a screen-filling column otherwise. Environment accents stay dim;
  // bloom is reserved for enemy cores and small foreground effects.
  const stripe = new MeshBasicMaterial({ color: stripeColor.clone().multiplyScalar(0.55) });
  const towers = 9;
  for (let i = 0; i < towers; i += 1) {
    const u = uStart + ((uEnd - uStart) * (i + 0.5)) / towers;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 44 + (i % 3) * 22;
    const height = 70 + (i % 5) * 20;
    const pylon = new Group();
    pylon.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * distance)
      .addScaledVector(frame.up, -height * 0.35 + (i % 2) * 20);
    pylon.add(new Mesh(new BoxGeometry(12, height, 12), dark));
    for (const offset of [-5.5, 5.5]) {
      const seam = new Mesh(new BoxGeometry(0.5, height * 0.4, 0.5), stripe);
      seam.position.set(offset, height * 0.18, 6.3);
      pylon.add(seam);
    }
    pylon.rotation.z = (rng() - 0.5) * 0.05;
    group.add(pylon);
  }
  return group;
}

// ---- avenue signage strip: rail-hugging neon lines, like Helios's conduit ----

function createSignageStrip(curve: ReturnType<typeof createDownpourRail>, uStart: number, uEnd: number) {
  const group = new Group();
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const travel = positionLocal.z.mul(0.05).add(time.mul(5)).sin().mul(0.5).add(0.5).pow(4).mul(1.6);
  material.colorNode = vec3(CYAN.r, CYAN.g, CYAN.b)
    .mul(travel.add(0.4))
    .mul(positionView.z.negate().mul(-0.01).exp())
    .mul(beatUniform.mul(0.6).add(1));

  for (const [side, lift] of [
    [-9, -1.6],
    [9, -1.6],
    [-11.5, 3.2],
    [11.5, 3.2],
  ] as const) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 100; i += 1) {
      const u = uStart + ((uEnd - uStart) * i) / 100;
      const frame = sampleRailFrame(curve, u);
      points.push(frame.position.clone().addScaledVector(frame.right, side).addScaledVector(frame.up, lift));
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    group.add(new Line(geometry, material));
  }
  return group;
}

// ---- skyway bridges: overhead arcs, magenta accented ---------------------------

function createSkyways(curve: ReturnType<typeof createDownpourRail>, uStart: number, uEnd: number) {
  const positions: number[] = [];
  const colors: number[] = [];
  const bridges = 6;
  for (let i = 0; i < bridges; i += 1) {
    const u = uStart + ((uEnd - uStart) * (i + 0.5)) / bridges;
    const frame = sampleRailFrame(curve, u);
    const color = MAGENTA.clone().multiplyScalar(0.6);
    const radius = 15;
    let previous: Vector3 | null = null;
    const sides = 6;
    for (let s = 0; s <= sides; s += 1) {
      const angle = Math.PI * (0.08 + (0.84 * s) / sides);
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius + 6);
      if (previous) {
        positions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        for (let k = 0; k < 2; k += 1) colors.push(color.r, color.g, color.b);
      }
      previous = point;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  material.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(positionView.z.negate().mul(-0.011).exp())
    .mul(beatUniform.mul(0.8).add(0.9));
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

// ---- tunnel ribs: undercity arches, sodium amber --------------------------------

function createTunnelRibs(curve: ReturnType<typeof createDownpourRail>, uStart: number, uEnd: number) {
  const positions: number[] = [];
  const colors: number[] = [];
  const arches = 30;
  const sides = 6;
  for (let i = 0; i < arches; i += 1) {
    const u = uStart + ((uEnd - uStart) * i) / (arches - 1);
    const frame = sampleRailFrame(curve, u);
    const hot = i % 4 === 0;
    const color = AMBER.clone().multiplyScalar(hot ? 0.85 : 0.32);
    const radius = 13 + Math.sin(i * 2.1) * 1.6;
    let previous: Vector3 | null = null;
    for (let s = 0; s <= sides; s += 1) {
      const angle = Math.PI * (0.05 + (0.9 * s) / sides);
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius);
      if (previous) {
        positions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        for (let k = 0; k < 2; k += 1) colors.push(color.r, color.g, color.b);
      }
      previous = point;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  material.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(positionView.z.negate().mul(-0.01).exp().mul(smoothstep(float(2), float(9), positionView.z.negate())))
    .mul(beatUniform.mul(0.9).add(0.85));
  const ribs = new LineSegments(geometry, material);
  ribs.frustumCulled = false;
  return ribs;
}

// ---- trains: parked / passing cars close enough to strobe by -------------------

function createTrainField(rng: () => number, curve: ReturnType<typeof createDownpourRail>, uStart: number, uEnd: number) {
  const fills: BufferGeometry[] = [];
  const scratch = new Matrix4();
  const rotation = new Quaternion();
  const litMaterial = new MeshBasicMaterial({ color: SLATE_LIGHT.clone().multiplyScalar(0.7) });
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const u = uStart + ((uEnd - uStart) * (i + rng() * 0.6)) / count;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 17 + rng() * 7;
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, side * distance)
      .addScaledVector(frame.up, -6 + rng() * 3);
    rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(frame.tangent.x, frame.tangent.z));
    const car = new BoxGeometry(2.2, 2.6, 9);
    scratch.compose(position, rotation, new Vector3(1, 1, 1));
    fills.push(car.applyMatrix4(scratch));
    car.dispose();
  }
  const group = new Group();
  group.add(new Mesh(mergeGeometries(fills), litMaterial));
  for (const geometry of fills) geometry.dispose();

  // Window lights: amber slivers along each car.
  const windowPositions: number[] = [];
  const windowColors: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = uStart + ((uEnd - uStart) * (i + 0.3)) / count;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 17 + (i % 3) * 2;
    for (let w = -3; w <= 3; w += 1) {
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, side * distance)
        .addScaledVector(frame.up, -5.5)
        .addScaledVector(frame.tangent, w * 1.3);
      windowPositions.push(point.x, point.y, point.z);
      windowColors.push(AMBER.r * 1.4, AMBER.g * 1.4, AMBER.b * 1.4);
    }
  }
  const windowGeometry = new BufferGeometry();
  windowGeometry.setAttribute('position', new Float32BufferAttribute(windowPositions, 3));
  windowGeometry.setAttribute('color', new Float32BufferAttribute(windowColors, 3));
  const windowMaterial = new PointsMaterial(additiveMaterialParameters({ size: 0.4, vertexColors: true, sizeAttenuation: true }));
  const windows = new Points(windowGeometry, windowMaterial);
  windows.frustumCulled = false;
  group.add(windows);

  return group;
}

// ---- canal water: a shimmering amber-lit ribbon --------------------------------

function createCanalWater(curve: ReturnType<typeof createDownpourRail>, uStart: number, uEnd: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  const steps = 80;
  const width = 10;
  for (let i = 0; i <= steps; i += 1) {
    const u = uStart + ((uEnd - uStart) * i) / steps;
    const frame = sampleRailFrame(curve, u);
    const left = frame.position.clone().addScaledVector(frame.right, -width).addScaledVector(frame.up, -3.5);
    const right = frame.position.clone().addScaledVector(frame.right, width).addScaledVector(frame.up, -3.5);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // A dim, mostly-dark reflective surface: only the ripple crests catch
  // amber light. Normal (not additive) blending keeps a wide plane from
  // reading as a solid glowing wall.
  const material = new MeshBasicNodeMaterial({ transparent: true });
  material.opacity = 0.55;
  const ripple = mx_noise_float(positionLocal.mul(0.05).add(vec3(0, 0, time.mul(1.6))))
    .mul(0.5)
    .add(0.5);
  const crest = ripple.pow(3);
  material.colorNode = vec3(AMBER.r * 0.05, AMBER.g * 0.035, AMBER.b * 0.02).add(
    vec3(AMBER.r, AMBER.g, AMBER.b).mul(crest.mul(0.5)).mul(beatUniform.mul(0.3).add(1)),
  );
  const mesh = new Mesh(geometry, material);
  return mesh;
}

// ---- citadel beacon: a hazard-white landmark spire near the run's end ---------

function createCitadelBeacon(position: Vector3) {
  const group = new Group();
  const spire = new Mesh(new CylinderGeometry(0.6, 3.2, 60, 8), new MeshBasicMaterial({ color: SLATE_WET.clone().multiplyScalar(0.6) }));
  group.add(spire);
  const beaconMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const pulse = time.mul(2.6).sin().mul(0.5).add(0.5).pow(2);
  beaconMaterial.colorNode = vec3(HAZARD_WHITE.r, HAZARD_WHITE.g, HAZARD_WHITE.b).mul(pulse.mul(1.4).add(0.6));
  const beacon = new Mesh(new CylinderGeometry(0.35, 0.35, 4, 8), beaconMaterial);
  beacon.position.y = 32;
  group.add(beacon);
  group.position.copy(position);
  return group;
}

// ---- moon: the outro's calm light source ---------------------------------------

function createMoon() {
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  material.colorNode = vec3(MOONLIGHT.r, MOONLIGHT.g, MOONLIGHT.b).mul(moonlightUniform.mul(1.6));
  const moon = new Mesh(new CircleGeometry(60, 32), material);
  moon.position.set(-120, 260, -1600);
  moon.lookAt(0, 210, -1470);
  return moon;
}

// ---- cloud decks: storm ceiling and the break above it -------------------------

function createCloudDeck(radius: number, colorA: Color, colorB: Color) {
  const geometry = new CircleGeometry(radius * 12, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ opacity: 0.5 }));
  const p = positionLocal.mul(0.006);
  const churn = time.mul(0.02);
  const noise = mx_noise_float(p.add(vec3(churn, 0, churn.mul(0.6)))).mul(0.5).add(0.5);
  const color = mix(vec3(colorA.r, colorA.g, colorA.b), vec3(colorB.r, colorB.g, colorB.b), moonlightUniform);
  material.colorNode = color.mul(noise.mul(0.7).add(0.3)).add(vec3(1, 1, 1).mul(lightningUniform.mul(0.8)));
  return new Mesh(geometry, material);
}

// ---- rain streaks: recycling camera-relative rain, the level's speed cue ------

function createRainStreaks(rng: () => number) {
  const COUNT = 260;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 2.5 + rng() * 8;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.6 + 1.5;
    const start = rng() * RAIN_SPAN;
    const length = 1.6 + rng() * 3.2;
    const roll = rng();
    const color = (roll < 0.75 ? RAIN_STREAK : roll < 0.9 ? CYAN : MAGENTA).clone().multiplyScalar(0.25 + rng() * 0.4);
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('z0', 'float').add(rainOffsetUniform).mod(RAIN_SPAN).sub(RAIN_BACK);
  material.positionNode = vec3(positionLocal.x, positionLocal.y, wrapped.add(attribute<'float'>('dz', 'float')));
  const envelope = smoothstep(float(-RAIN_BACK), float(-RAIN_BACK + 8), wrapped).mul(
    smoothstep(float(RAIN_SPAN - RAIN_BACK), float(RAIN_SPAN - RAIN_BACK - 5), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(rainGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}
