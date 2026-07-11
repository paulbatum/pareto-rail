import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
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
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createMassDriverRail, MUZZLE_U, RAIL_ANGLES, ringU, TUNNEL_RADIUS } from '../gameplay';
import { MUZZLE_BEAT } from '../timing';
import {
  ARC_BLUE,
  ARC_VIOLET,
  ARC_WHITE,
  BARREL_HAZE,
  GUNMETAL,
  HOSTILE_MAGENTA,
  mulberry32,
  SPACE_BLACK,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatFloatUniform = uniform(-10); // continuous beat position; ring k flashes as it is crossed
export const beatPulseUniform = uniform(0); // global beat throb 0..~1.5
export const chargeUniform = uniform(0); // 0 cold barrel → 1 the moment of firing
export const streakOffsetUniform = uniform(0); // accumulated travel distance
export const streakGlowUniform = uniform(0.2); // ionization streak brightness

const STREAK_SPAN = 46;
const STREAK_BACK = 40;

export type Environment = {
  root: Group;
  streaks: Group;
  /** Zero-parallax star shell; the runtime pins its position to the camera. */
  starShell: Group;
  greebleField: ScatterField;
  muzzlePosition: Vector3;
  applyAtmosphere: (progress: number) => void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = BARREL_HAZE.clone();
  scene.fog = new FogExp2(BARREL_HAZE.clone(), 0.023);

  const root = new Group();
  const rng = mulberry32(20260711);
  const curve = createMassDriverRail();

  root.add(createBeatRings(curve));
  root.add(createRingHousings(curve));
  root.add(createConduitRails(curve));
  root.add(createPinlights(rng, curve));

  const greebleField = createCoilGreebles(rng, curve);
  root.add(greebleField.group);

  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);
  root.add(createMuzzleAssembly(curve));
  root.add(createSpace(curve));

  const starShell = createStarShell(rng);
  root.add(starShell);

  const streaks = createIonStreaks(rng);
  root.add(streaks);

  scene.add(root);

  // Barrel haze inside; the fog wall breaks the instant the muzzle passes.
  const applyAtmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: BARREL_HAZE, fog: BARREL_HAZE, density: 0.023 },
    { progress: MUZZLE_U - 0.008, background: BARREL_HAZE, fog: BARREL_HAZE, density: 0.025 },
    { progress: MUZZLE_U + 0.01, background: SPACE_BLACK, fog: SPACE_BLACK, density: 0.0006 },
    { progress: 1, background: SPACE_BLACK, fog: SPACE_BLACK, density: 0.0002 },
  ]);

  return { root, streaks, starShell, greebleField, muzzlePosition: muzzleFrame.position.clone(), applyAtmosphere };
}

// ---- the accelerator rings -------------------------------------------------------

// One ring per beat, 120 rings of barrel. Ring k sits at the rail progress
// the speed profile reaches at beat k, so the camera crosses it exactly on
// the beat; spacing widens as the launch accelerates while the crossing
// cadence stays locked. The shader colors each ring by its position on the
// arc-blue → violet → blinding-white charge ramp and flashes it as the
// payload passes through.
function createBeatRings(curve: ReturnType<typeof createMassDriverRail>) {
  const geometries: BufferGeometry[] = [];
  const ringBeats: number[] = [];
  const transform = new Matrix4();
  const basis = new Matrix4();

  for (let k = 1; k <= MUZZLE_BEAT; k += 1) {
    const frame = sampleRailFrameForBeat(curve, k);
    const torus = new TorusGeometry(TUNNEL_RADIUS, 0.3, 6, 30);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    transform.copy(basis).setPosition(frame.position);
    torus.applyMatrix4(transform);
    const vertexCount = torus.getAttribute('position').count;
    for (let v = 0; v < vertexCount; v += 1) ringBeats.push(k);
    geometries.push(torus);
  }

  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  merged.setAttribute('ringBeat', new Float32BufferAttribute(ringBeats, 1));

  const material = new MeshBasicNodeMaterial();
  const k = attribute<'float'>('ringBeat', 'float');
  const rampT = k.div(MUZZLE_BEAT);
  const blue = vec3(ARC_BLUE.r, ARC_BLUE.g, ARC_BLUE.b);
  const violet = vec3(ARC_VIOLET.r, ARC_VIOLET.g, ARC_VIOLET.b);
  const white = vec3(ARC_WHITE.r, ARC_WHITE.g, ARC_WHITE.b);
  const ramp = mix(
    mix(blue, violet, rampT.mul(2).clamp(0, 1)),
    white,
    rampT.sub(0.5).mul(2).clamp(0, 1),
  );
  // Asymmetric crossing pulse: a short anticipation glow, then a hard flash
  // that decays over roughly two beats after the payload passes through.
  const beatDelta = beatFloatUniform.sub(k);
  const decayRate = mix(float(3.4), float(1.15), step(0, beatDelta));
  const flash = beatDelta.abs().mul(decayRate).negate().exp();
  const brightness = float(0.34)
    .add(chargeUniform.mul(0.6))
    .add(beatPulseUniform.mul(0.2))
    .add(flash.mul(float(1.2).add(chargeUniform.mul(0.85))));
  material.colorNode = ramp.mul(brightness);

  const rings = new Mesh(merged, material);
  rings.frustumCulled = false;
  return rings;
}

// Dark octagonal collars seated behind every ring — the coil housings that
// give each crossing physical mass.
function createRingHousings(curve: ReturnType<typeof createMassDriverRail>) {
  const geometries: BufferGeometry[] = [];
  const transform = new Matrix4();
  const basis = new Matrix4();
  for (let k = 1; k <= MUZZLE_BEAT; k += 1) {
    const frame = sampleRailFrameForBeat(curve, k);
    const housing = new TorusGeometry(TUNNEL_RADIUS + 0.75, 0.62, 4, 8);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    transform.copy(basis).setPosition(
      frame.position.clone().addScaledVector(frame.tangent, -0.55),
    );
    housing.applyMatrix4(transform);
    geometries.push(housing);
  }
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  const mesh = new Mesh(merged, new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.8) }));
  mesh.frustumCulled = false;
  return mesh;
}

function sampleRailFrameForBeat(curve: ReturnType<typeof createMassDriverRail>, beatIndex: number) {
  return sampleRailFrame(curve, ringU(beatIndex));
}

// ---- conduit rails -----------------------------------------------------------------

// Six longitudinal power rails at the coil clock positions. Ionization
// packets race up them toward the muzzle; the charge brightens everything.
function createConduitRails(curve: ReturnType<typeof createMassDriverRail>) {
  const positions: number[] = [];
  const along: number[] = [];
  const SEGMENTS = 340;
  for (const angle of RAIL_ANGLES) {
    let previous: Vector3 | null = null;
    let travelled = 0;
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const u = (MUZZLE_U * i) / SEGMENTS;
      const frame = sampleRailFrame(curve, u);
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * (TUNNEL_RADIUS - 0.65))
        .addScaledVector(frame.up, Math.sin(angle) * (TUNNEL_RADIUS - 0.65));
      if (previous) {
        positions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        const nextTravelled = travelled + previous.distanceTo(point);
        along.push(travelled, nextTravelled);
        travelled = nextTravelled;
      } else {
        travelled = 0;
      }
      previous = point;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('along', new Float32BufferAttribute(along, 1));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const distanceAlong = attribute<'float'>('along', 'float');
  const packet = distanceAlong.mul(0.16).sub(time.mul(26)).sin().mul(0.5).add(0.5).pow(6);
  material.colorNode = vec3(ARC_BLUE.r, ARC_BLUE.g, ARC_BLUE.b)
    .mul(packet.mul(1.9).add(0.22))
    .mul(chargeUniform.mul(1.1).add(0.55))
    .mul(beatPulseUniform.mul(0.35).add(1));
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

// ---- coil greebles -----------------------------------------------------------------

// Dark machinery hugging the outside of the ring line: housings, cable
// trunks, and occasional magenta service lights. Pure parallax density.
function createCoilGreebles(rng: Rng, curve: ReturnType<typeof createMassDriverRail>) {
  const dark = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.65) });
  const darker = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.4) });
  const lamp = createAdditiveBasicMaterial({ color: HOSTILE_MAGENTA.clone().multiplyScalar(0.7) });
  const lampBlue = createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.55) });

  return scatterAlongRail(curve, {
    count: 110,
    seed: 20260711,
    window: { behind: 24, ahead: 150 },
    make(index, itemRng) {
      const group = new Group();
      if (index % 3 === 0) {
        // Cable trunk: long thin box running with the barrel.
        const trunk = new Mesh(new BoxGeometry(0.5, 0.5, 9 + itemRng() * 14), darker);
        group.add(trunk);
      } else {
        const housing = new Mesh(
          new BoxGeometry(1.2 + itemRng() * 2.4, 1 + itemRng() * 1.6, 2 + itemRng() * 3.4),
          index % 2 === 0 ? dark : darker,
        );
        group.add(housing);
        if (index % 4 === 1) {
          const light = new Mesh(new BoxGeometry(0.22, 0.22, 0.22), index % 8 === 1 ? lamp : lampBlue);
          light.position.set(0, 0.9, 0);
          group.add(light);
        }
      }
      return group;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = TUNNEL_RADIUS + 1.4 + placeRng() * 2.6;
      return {
        u: placeRng() * MUZZLE_U,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, (placeRng() - 0.5) * 6),
      };
    },
    // Recycling pushes items into the ahead window; past the muzzle that
    // window is open space, and no machinery floats there.
    onUpdate(item) {
      if (item.u > MUZZLE_U) item.object.visible = false;
    },
  });
}

// ---- pinlights ----------------------------------------------------------------------

function createPinlights(rng: Rng, curve: ReturnType<typeof createMassDriverRail>) {
  const count = 700;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng() * MUZZLE_U;
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = TUNNEL_RADIUS + 0.4 + rng() * 2.2;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 6);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;

    const roll = rng();
    const base = roll < 0.5 ? ARC_BLUE : roll < 0.8 ? ARC_VIOLET : HOSTILE_MAGENTA;
    const intensity = rng() < 0.06 ? 1.1 : 0.12 + rng() * 0.3;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 0.4,
    vertexColors: true,
    sizeAttenuation: true,
  }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- the muzzle -----------------------------------------------------------------------

// The mouth of the gun: a stack of heavy exit rings with a live rim that
// burns hotter as the charge builds, and four brake pylons flaring outward.
function createMuzzleAssembly(curve: ReturnType<typeof createMassDriverRail>) {
  const group = new Group();
  const frame = sampleRailFrame(curve, MUZZLE_U);
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  group.position.copy(frame.position);
  group.quaternion.setFromRotationMatrix(basis);

  const dark = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.9) });
  for (const [radius, tube, z] of [
    [TUNNEL_RADIUS + 2.5, 1.3, 0],
    [TUNNEL_RADIUS + 4.6, 1.1, 5],
    [TUNNEL_RADIUS + 6.6, 0.9, 10],
  ] as const) {
    const ring = new Mesh(new TorusGeometry(radius, tube, 6, 24), dark);
    ring.position.z = z;
    group.add(ring);
  }

  const rimMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  rimMaterial.colorNode = vec3(ARC_WHITE.r, ARC_WHITE.g, ARC_WHITE.b)
    .mul(chargeUniform.mul(2.0).add(0.4))
    .mul(beatPulseUniform.mul(0.4).add(1));
  const rim = new Mesh(new TorusGeometry(TUNNEL_RADIUS + 1.1, 0.4, 6, 30), rimMaterial);
  group.add(rim);

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pylon = new Mesh(new BoxGeometry(2.2, 18, 4.5), dark);
    pylon.position.set(Math.cos(angle) * (TUNNEL_RADIUS + 10), Math.sin(angle) * (TUNNEL_RADIUS + 10), 6);
    pylon.rotation.z = angle - Math.PI / 2;
    group.add(pylon);
  }

  return group;
}

// ---- open space -------------------------------------------------------------------------

// The camera far plane is 500 units, so space is staged, not literal: a
// zero-parallax star shell rides the camera, and the planet is a stage-set
// sphere whose limb crosses the lower frame as the payload is thrown over it.
function createStarShell(rng: Rng) {
  const starCount = 1200;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    positions[i * 3] = direction.x * 430;
    positions[i * 3 + 1] = direction.y * 430;
    positions[i * 3 + 2] = direction.z * 430;
    const warm = rng();
    const intensity = 0.25 + rng() * 0.75;
    colors[i * 3] = intensity * (warm < 0.15 ? 1 : 0.85);
    colors[i * 3 + 1] = intensity * 0.9;
    colors[i * 3 + 2] = intensity;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const stars = new Points(starGeometry, new PointsMaterial(additiveMaterialParameters({
    size: 1.7,
    vertexColors: true,
    sizeAttenuation: true,
  })));
  stars.frustumCulled = false;
  const group = new Group();
  group.add(stars);
  return group;
}

function createSpace(curve: ReturnType<typeof createMassDriverRail>) {
  const group = new Group();
  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);

  // The planet: a near-black body with a thin electric-blue atmosphere rim,
  // placed so the launch arcs over its limb.
  const planetMaterial = new MeshBasicNodeMaterial();
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(4.2);
  const body = vec3(0.012, 0.016, 0.028).mul(
    positionLocal.y.mul(0.012).sin().mul(0.3).add(0.7),
  );
  planetMaterial.colorNode = body.add(
    vec3(ARC_BLUE.r, ARC_BLUE.g, ARC_BLUE.b).mul(rim).mul(1.4),
  );
  const planet = new Mesh(new SphereGeometry(330, 72, 48), planetMaterial);
  planet.position
    .copy(muzzleFrame.position)
    .addScaledVector(muzzleFrame.tangent, 430)
    .addScaledVector(muzzleFrame.up, -400);
  group.add(planet);

  // Orbital frame rings out in the black: the rest of the gun's supporting
  // architecture, flashing past at muzzle velocity.
  const frameMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.4) });
  for (const [side, along] of [
    [-1, 130],
    [1, 320],
  ] as const) {
    const ring = new Mesh(new TorusGeometry(90, 3.5, 6, 40), frameMaterial);
    ring.position
      .copy(muzzleFrame.position)
      .addScaledVector(muzzleFrame.tangent, along)
      .addScaledVector(muzzleFrame.right, side * 150)
      .addScaledVector(muzzleFrame.up, 30 * side);
    ring.rotation.y = side * 0.7;
    group.add(ring);
  }

  const glowLine = new Mesh(
    new TorusGeometry(TUNNEL_RADIUS + 8.6, 0.25, 5, 40),
    createAdditiveBasicMaterial({ color: ARC_VIOLET.clone().multiplyScalar(0.8) }),
  );
  const exitFrame = sampleRailFrame(curve, Math.min(1, MUZZLE_U + 0.002));
  glowLine.position.copy(exitFrame.position);
  glowLine.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(exitFrame.right, exitFrame.up, exitFrame.tangent));
  group.add(glowLine);

  return group;
}

// ---- ionization streaks --------------------------------------------------------------

// A sleeve of ion streaks around the camera; the shader recycles each
// segment along z as travel accumulates. Brightness rides streakGlowUniform,
// so acceleration is visible even between rings.
function createIonStreaks(rng: Rng) {
  const COUNT = 220;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 8;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 2.2 + rng() * 4.6;
    const base = rng() < 0.55 ? ARC_BLUE : rng() < 0.85 ? ARC_VIOLET : ARC_WHITE;
    const color = base.clone().multiplyScalar(0.18 + rng() * 0.45);
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
  const wrapped = attribute<'float'>('z0', 'float')
    .add(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 9), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}
