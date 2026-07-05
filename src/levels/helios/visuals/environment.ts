import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  mix,
  mx_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionView,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { createHeliosRail, CORONA_TIME, GATE_TIME, railU, STAR_CENTER, STAR_RADIUS } from '../gameplay';
import { ASH_VIOLET, BLOOD, EMBER, GOLD, hdr, mulberry32, OBSIDIAN, SPACE_MAROON, WHITE_HOT, type Rng } from './palette';
import { createSerpentBody, type SerpentBody } from './serpent';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const novaUniform = uniform(0); // 0 normal → 1 supernova whiteout
export const streakOffsetUniform = uniform(0); // accumulated travel distance
export const streakGlowUniform = uniform(0.35); // streak brightness by act

const STREAK_SPAN = 52;
const STREAK_BACK = 46;

export type Environment = {
  root: Group;
  gatePosition: Vector3;
  gateRunes: Group;
  coronaPosition: Vector3;
  geysers: Array<{ mesh: Mesh; phase: number; speed: number; baseHeight: number }>;
  streaks: Group;
  serpent: SerpentBody;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = SPACE_MAROON.clone();
  const root = new Group();
  const rng = mulberry32(20260704);
  const curve = createHeliosRail();

  root.add(createStar());
  root.add(createEmberField(rng, curve));

  const { gate, gatePosition, gateRunes } = createGate(curve);
  root.add(gate);

  root.add(createWreckField(rng, curve));
  root.add(createConduit(curve));

  const geysers = createGeysers(rng, curve, root);
  const streaks = createSpeedStreaks(rng);
  root.add(streaks);

  const serpent = createSerpentBody(STAR_CENTER, STAR_RADIUS);
  root.add(serpent.root);

  scene.add(root);
  const coronaFrame = sampleRailFrame(curve, railU(CORONA_TIME));
  return { root, gatePosition, gateRunes, coronaPosition: coronaFrame.position.clone(), geysers, streaks, serpent };
}

// ---- the star -----------------------------------------------------------------

// One colossal sphere is both the horizon of act 1 and the burning sea the
// player skims in act 3. Granulation cells churn across it; the rim burns
// gold; the beat breathes through it; `novaUniform` whites it out at the end.
function createStar() {
  const group = new Group();

  const material = new MeshBasicNodeMaterial();
  const p = positionLocal.mul(0.0042);
  const churn = time.mul(0.016);
  const cells = mx_noise_float(p.mul(3.1).add(vec3(0, churn, 0)))
    .mul(0.52)
    .add(mx_noise_float(p.mul(8.7).add(vec3(churn.mul(1.7), 0, churn))).mul(0.33))
    .add(mx_noise_float(p.mul(23)).mul(0.15))
    .mul(0.5)
    .add(0.5);

  const deep = vec3(BLOOD.r * 0.5, BLOOD.g * 0.35, BLOOD.b * 0.4);
  const emberBand = vec3(EMBER.r, EMBER.g, EMBER.b);
  const goldBand = vec3(GOLD.r, GOLD.g, GOLD.b);
  const hotBand = vec3(WHITE_HOT.r, WHITE_HOT.g, WHITE_HOT.b).mul(1.7);

  let color = mix(deep, emberBand, smoothstep(float(0.28), float(0.58), cells));
  color = mix(color, goldBand, smoothstep(float(0.58), float(0.8), cells));
  color = mix(color, hotBand, smoothstep(float(0.82), float(0.96), cells));

  // Keep the vast surface below the bloom threshold; only cell peaks and the
  // rim run hot, so the star reads as texture instead of a white wall.
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(3.2);
  color = color
    .mul(0.34)
    .add(goldBand.mul(rim).mul(0.85))
    .mul(beatUniform.mul(0.12).add(1));
  color = mix(color, vec3(2.4, 2.1, 1.75), novaUniform);
  material.colorNode = color;

  const star = new Mesh(new SphereGeometry(STAR_RADIUS, 110, 72), material);
  star.position.copy(STAR_CENTER);
  group.add(star);

  // Corona: an additive fresnel shell just outside the surface.
  const coronaMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const coronaView = cameraPosition.sub(positionWorld).normalize();
  const coronaRim = float(1).sub(normalWorld.dot(coronaView).abs()).pow(2.6);
  coronaMaterial.colorNode = vec3(GOLD.r, GOLD.g, GOLD.b)
    .mul(coronaRim)
    .mul(float(0.9).add(beatUniform.mul(0.25)).add(novaUniform.mul(3)));
  const corona = new Mesh(new SphereGeometry(STAR_RADIUS * 1.035, 80, 52), coronaMaterial);
  corona.position.copy(STAR_CENTER);
  group.add(corona);

  return group;
}

// ---- ember field -----------------------------------------------------------------

function createEmberField(rng: Rng, curve: ReturnType<typeof createHeliosRail>) {
  const count = 1700;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 40 + rng() * 260;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.abs(Math.sin(angle)) * radius * (rng() < 0.75 ? 1 : -0.4))
      .addScaledVector(frame.tangent, (rng() - 0.5) * 60);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;

    const roll = rng();
    const base = roll < 0.55 ? EMBER : roll < 0.82 ? GOLD : roll < 0.94 ? ASH_VIOLET : WHITE_HOT;
    const intensity = rng() < 0.05 ? 1.7 : 0.12 + rng() * 0.3;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 0.5,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- the last gate -----------------------------------------------------------------

function createGate(curve: ReturnType<typeof createHeliosRail>) {
  const gate = new Group();
  const frame = sampleRailFrame(curve, railU(GATE_TIME));
  gate.position.copy(frame.position);
  gate.lookAt(frame.position.clone().add(frame.tangent));

  const dark = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) });
  const seamMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  // A hot spot of energy orbits the ring; the beat kicks the whole seam.
  const around = normalize(positionLocal.xy);
  const crawl = around
    .dot(vec2(time.mul(1.3).cos(), time.mul(1.3).sin()))
    .mul(0.5)
    .add(0.5)
    .pow(3);
  seamMaterial.colorNode = vec3(EMBER.r, EMBER.g, EMBER.b)
    .mul(crawl.mul(1.6).add(0.4))
    .mul(beatUniform.mul(0.6).add(1));

  // The ring itself is broken: two arcs with wound gaps.
  for (const [start, arc] of [
    [0.22, Math.PI * 1.18],
    [Math.PI * 1.52, Math.PI * 0.38],
  ] as const) {
    const body = new Mesh(new TorusGeometry(58, 4.4, 8, 90, arc), dark);
    body.rotation.z = start;
    gate.add(body);
    const seam = new Mesh(new TorusGeometry(58, 4.9, 8, 90, arc), seamMaterial);
    seam.rotation.z = start;
    gate.add(seam);
  }

  // Rune ring: charred plates orbiting inside the break.
  const gateRunes = new Group();
  const runeGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2;
    const plate = new BoxGeometry(2.6, 4.2, 0.5);
    const matrix = new Matrix4()
      .makeRotationZ(angle)
      .multiply(new Matrix4().makeTranslation(0, 47, 0));
    runeGeometries.push(plate.applyMatrix4(matrix));
  }
  const runeMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const flicker = positionWorld.y.mul(0.7).add(time.mul(2.1)).sin().mul(0.25).add(0.75);
  runeMaterial.colorNode = vec3(GOLD.r, GOLD.g, GOLD.b).mul(flicker).mul(beatUniform.mul(0.8).add(0.75));
  gateRunes.add(new Mesh(mergeGeometries(runeGeometries), runeMaterial));
  gate.add(gateRunes);

  // Sheared strut wreckage hanging off the break.
  for (const [angle, length, tilt] of [
    [Math.PI * 1.45, 60, 0.5],
    [Math.PI * 0.1, 42, -0.7],
  ] as const) {
    const strut = new Mesh(new BoxGeometry(6, length, 6), dark);
    strut.position.set(Math.cos(angle) * 62, Math.sin(angle) * 62, 0);
    strut.rotation.z = angle + tilt;
    gate.add(strut);
  }

  return { gate, gatePosition: frame.position.clone(), gateRunes };
}

// ---- act 1 wreck field ---------------------------------------------------------------

function createWreckField(rng: Rng, curve: ReturnType<typeof createHeliosRail>) {
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const scratch = new Matrix4();
  const rotation = new Quaternion();
  for (let i = 0; i < 46; i += 1) {
    const u = 0.005 + rng() * 0.15;
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 26 + rng() * 120;
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 50);
    const plate = new BoxGeometry(3 + rng() * 14, 1 + rng() * 5, 6 + rng() * 22);
    rotation.setFromAxisAngle(
      new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rng() * Math.PI * 2,
    );
    scratch.compose(position, rotation, new Vector3(1, 1, 1));
    fills.push(plate.clone().applyMatrix4(scratch));
    edges.push(new EdgesGeometry(plate).applyMatrix4(scratch));
    plate.dispose();
  }
  const group = new Group();
  group.add(new Mesh(mergeGeometries(fills), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.4) })));
  const edgeMaterial = new LineBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  // Faint ember rims that fade with distance so the field has depth.
  edgeMaterial.colorNode = vec3(EMBER.r, EMBER.g, EMBER.b)
    .mul(0.32)
    .mul(positionView.z.negate().mul(-0.012).exp())
    .mul(beatUniform.mul(0.4).add(1));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of [...fills, ...edges]) geometry.dispose();
  return group;
}

// ---- act 2 conduit corridor ------------------------------------------------------------

function createConduit(curve: ReturnType<typeof createHeliosRail>) {
  const group = new Group();
  const uStart = railU(GATE_TIME) + 0.004;
  const uEnd = railU(CORONA_TIME) - 0.006;

  // Twin energy rails flanking the path, pulsing toward the star.
  const railMaterial = new LineBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const travel = positionWorld.z.mul(0.06).add(time.mul(6.5)).sin().mul(0.5).add(0.5).pow(4).mul(1.8);
  railMaterial.colorNode = vec3(GOLD.r, GOLD.g, GOLD.b)
    .mul(travel.add(0.35))
    .mul(positionView.z.negate().mul(-0.009).exp())
    .mul(beatUniform.mul(0.7).add(1));

  for (const [side, lift] of [
    [-13, -2.5],
    [13, -2.5],
    [-16.5, 7],
    [16.5, 7],
  ] as const) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 130; i += 1) {
      const u = uStart + ((uEnd - uStart) * i) / 130;
      const frame = sampleRailFrame(curve, u);
      points.push(
        frame.position
          .clone()
          .addScaledVector(frame.right, side)
          .addScaledVector(frame.up, lift),
      );
    }
    group.add(new Line(new BufferGeometry().setFromPoints(points), railMaterial));
  }

  // Broken arch ribs overhead — half-octagons, some hot.
  const ribPositions: number[] = [];
  const ribColors: number[] = [];
  const ARCHES = 34;
  const SIDES = 5;
  for (let i = 0; i < ARCHES; i += 1) {
    const u = uStart + ((uEnd - uStart) * i) / (ARCHES - 1);
    const frame = sampleRailFrame(curve, u);
    const hot = i % 4 === 0;
    const color = (hot ? GOLD : EMBER).clone().multiplyScalar(hot ? 0.9 : 0.35);
    const radius = 21 + Math.sin(i * 2.4) * 3;
    let previous: Vector3 | null = null;
    for (let s = 0; s <= SIDES; s += 1) {
      const angle = Math.PI * (0.12 + (0.76 * s) / SIDES);
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius);
      if (previous) {
        ribPositions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        for (let k = 0; k < 2; k += 1) ribColors.push(color.r, color.g, color.b);
      }
      previous = point;
    }
  }
  const ribGeometry = new BufferGeometry();
  ribGeometry.setAttribute('position', new Float32BufferAttribute(ribPositions, 3));
  ribGeometry.setAttribute('color', new Float32BufferAttribute(ribColors, 3));
  const ribMaterial = new LineBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  ribMaterial.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(positionView.z.negate().mul(-0.01).exp().mul(smoothstep(float(2), float(9), positionView.z.negate())))
    .mul(beatUniform.mul(0.9).add(0.8));
  const ribs = new LineSegments(ribGeometry, ribMaterial);
  ribs.frustumCulled = false;
  group.add(ribs);

  // Colossal pylon monoliths off to the sides.
  const dark = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.42) });
  const seam = new MeshBasicMaterial({ color: hdr(EMBER, 0.75), transparent: true, blending: AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 8; i += 1) {
    const u = uStart + ((uEnd - uStart) * (i + 0.5)) / 8;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 55 + (i % 3) * 30;
    const pylon = new Group();
    pylon.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * distance)
      .addScaledVector(frame.up, -20 + (i % 2) * 30);
    const height = 70 + (i % 4) * 26;
    pylon.add(new Mesh(new BoxGeometry(11, height, 11), dark));
    const stripe = new Mesh(new BoxGeometry(1.1, height * 0.8, 1.1), seam);
    stripe.position.set(5.6 * side, 0, 0);
    pylon.add(stripe);
    pylon.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
    group.add(pylon);
  }

  return group;
}

// ---- act 3 flare geysers -----------------------------------------------------------------

function createGeysers(rng: Rng, curve: ReturnType<typeof createHeliosRail>, root: Group) {
  const geysers: Environment['geysers'] = [];
  const material = new MeshBasicMaterial({
    color: hdr(GOLD, 0.8),
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
    side: 2,
  });
  for (let i = 0; i < 8; i += 1) {
    const u = 0.47 + (0.27 * i) / 7;
    const frame = sampleRailFrame(curve, u);
    const side = i % 2 === 0 ? 1 : -1;
    const mesh = new Mesh(new CylinderGeometry(1.6, 3.4, 1, 9, 1, true), material.clone());
    const baseHeight = 26 + rng() * 30;
    mesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * (24 + rng() * 46))
      .addScaledVector(frame.up, -34);
    root.add(mesh);
    geysers.push({ mesh, phase: rng() * Math.PI * 2, speed: 0.55 + rng() * 0.5, baseHeight });
  }
  return geysers;
}

// ---- speed streaks -----------------------------------------------------------------------

// A cylinder of ash streaks around the camera. The shader recycles each
// segment along z as `streakOffsetUniform` accumulates travel; brightness
// rides `streakGlowUniform`, so the corona dive visibly doubles the airspeed.
function createSpeedStreaks(rng: Rng) {
  const COUNT = 240;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 9;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 2.5 + rng() * 5;
    const color = (rng() < 0.6 ? EMBER : rng() < 0.85 ? GOLD : ASH_VIOLET).clone().multiplyScalar(0.2 + rng() * 0.5);
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

  const material = new LineBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const wrapped = attribute<'float'>('z0', 'float')
    .add(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 10), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

export const STREAK_WRAP = STREAK_SPAN;
