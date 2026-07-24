import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
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
  uv,
  vec3,
} from 'three/tsl';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CABLE_OFFSET, createSkyhookRail, railU } from '../gameplay';
import { DECK_TIME } from '../timing';
import { AMBER, HAZARD, hdr, mulberry32, PANEL, PLANET_CLOUD, PLANET_LAND, PLANET_SEA, RUST, SLATE, STEEL, type Rng } from './palette';

// Soft cloud puffs peak at this alpha: they are volume, never a wall, so a
// target is always readable through weather.
const CLOUD_PEAK_ALPHA = 0.22;

// Shader knobs the runtime writes every frame. Everything about the look of the
// sky is one of these — the level's whole colour arc is a ramp over altitude.
export const skyHorizonUniform = uniform(new Vector3(0.31, 0.33, 0.36));
export const skyZenithUniform = uniform(new Vector3(0.2, 0.22, 0.25));
export const skyGroundUniform = uniform(new Vector3(0.1, 0.11, 0.13));
export const starsUniform = uniform(0);
export const sunGlowUniform = uniform(0.15);
export const cloudOpacityUniform = uniform(CLOUD_PEAK_ALPHA);
export const deckOpacityUniform = uniform(0);
export const streakOffsetUniform = uniform(0);
export const streakGlowUniform = uniform(0.4);
export const streakLengthUniform = uniform(1);
export const beaconUniform = uniform(0);
export const beatUniform = uniform(0);

const BACKDROP_RADIUS = 200;
const STREAK_SPAN = 46;
const STREAK_BACK = 40;
const SUN_DIRECTION = new Vector3(0.46, 0.2, -0.86).normalize();
const FORWARD = new Vector3(0, 0, 1);

export type Environment = {
  root: Group;
  backdrop: Group;
  planet: Mesh;
  clouds: ScatterField;
  flotsam: ScatterField;
  streaks: Group;
  station: Group;
  deckAltitude: number;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  const rng = mulberry32(20260724);
  const curve = createSkyhookRail();

  const backdrop = new Group();
  backdrop.add(createSkyDome());
  const planet = createPlanet();
  backdrop.add(planet);
  root.add(backdrop);

  root.add(createTether(curve));
  root.add(createAnchor(curve));

  const deckU = railU(DECK_TIME);
  const deckAltitude = curve.getPointAt(deckU).y;
  root.add(createDeckSlab(rng, curve, deckU));

  const clouds = createCloudField(rng, curve, deckU);
  root.add(clouds.group);
  const flotsam = createFlotsamField(rng, curve);
  root.add(flotsam.group);

  const streaks = createSpeedStreaks(rng);
  root.add(streaks);

  const station = createStation(curve);
  root.add(station);

  scene.add(root);
  return { root, backdrop, planet, clouds, flotsam, streaks, station, deckAltitude };
}

/** Park the backdrop on the camera and size the planet for the current altitude. */
export function updateBackdrop(environment: Environment, camera: PerspectiveCamera, planetAngle: number) {
  environment.backdrop.position.copy(camera.position);
  const radius = BACKDROP_RADIUS * Math.sin(planetAngle);
  environment.planet.position.set(0, -BACKDROP_RADIUS, 0);
  environment.planet.scale.setScalar(radius);
}

// ---- sky ---------------------------------------------------------------------

// One inside-out sphere carries the entire colour arc: storm grey at the anchor,
// sunlit blue above the deck, indigo, then black with stars. Stars live in the
// same shader so they cost nothing and can never sort in front of the world.
function createSkyDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthTest: false, depthWrite: false, fog: false });
  const direction = normalize(positionLocal);
  const height = direction.y;

  const sky = mix(skyHorizonUniform, skyZenithUniform, smoothstep(float(-0.12), float(1.05), height));
  const ground = mix(skyGroundUniform, skyHorizonUniform, smoothstep(float(-0.55), float(0.0), height));
  let color = mix(ground, sky, smoothstep(float(-0.06), float(0.06), height));

  // A low sun off the starboard quarter: the reason the cloud tops are lit.
  const sun = direction.dot(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).max(0);
  color = color.add(vec3(1.0, 0.88, 0.7).mul(sun.pow(760).mul(1.1).add(sun.pow(30).mul(0.1))).mul(sunGlowUniform));

  // Two star layers plus a faint band, revealed only as the air runs out.
  const fine = smoothstep(float(0.72), float(0.9), mx_noise_float(direction.mul(210)));
  const coarse = smoothstep(float(0.79), float(0.95), mx_noise_float(direction.mul(96).add(vec3(11, 3, 7))));
  const band = smoothstep(float(0.42), float(0.0), direction.y.mul(0.8).sub(direction.x.mul(0.25)).abs()).mul(0.05);
  color = color.add(
    vec3(0.86, 0.9, 1.0).mul(fine.pow(2).mul(1.6).add(coarse.pow(2).mul(2.6)).add(band)).mul(starsUniform),
  );
  material.colorNode = color;

  const dome = new Mesh(new SphereGeometry(1, 40, 28), material);
  dome.scale.setScalar(BACKDROP_RADIUS * 2.2);
  dome.renderOrder = -30;
  dome.frustumCulled = false;
  return dome;
}

// The world you are leaving. A camera-anchored proxy: the engine's 500-unit far
// plane cannot hold a real planet, so this sphere is sized every frame to
// subtend the angle the true horizon would at the current altitude.
function createPlanet() {
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false });
  const p = positionLocal.mul(2.6);
  const relief = mx_noise_float(p)
    .mul(0.6)
    .add(mx_noise_float(p.mul(2.7)).mul(0.28))
    .add(mx_noise_float(p.mul(7.1)).mul(0.12))
    .mul(0.5)
    .add(0.5);

  const sea = vec3(PLANET_SEA.r, PLANET_SEA.g, PLANET_SEA.b);
  const land = vec3(PLANET_LAND.r, PLANET_LAND.g, PLANET_LAND.b);
  let color = mix(sea, land, smoothstep(float(0.5), float(0.6), relief));

  // Weather systems: slow, bright, and the reason the surface never reads flat.
  const swirl = mx_noise_float(positionLocal.mul(4.4).add(vec3(time.mul(0.008), 0, time.mul(0.005))))
    .mul(0.5)
    .add(0.5);
  color = mix(color, vec3(PLANET_CLOUD.r, PLANET_CLOUD.g, PLANET_CLOUD.b), smoothstep(float(0.54), float(0.78), swirl).mul(0.8));

  // Day side falls off toward the terminator; the limb keeps a blue rim of air.
  const lambert = normalWorld.dot(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).mul(0.5).add(0.62).clamp(0.06, 1);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const rim = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(2.4);
  material.colorNode = color.mul(lambert).add(vec3(0.32, 0.56, 0.92).mul(rim).mul(0.85));

  const planet = new Mesh(new SphereGeometry(1, 72, 48), material);
  planet.renderOrder = -28;
  planet.frustumCulled = false;
  return planet;
}

// ---- the tether ---------------------------------------------------------------

// The cable, its two guide rails, and a hazard band every seven metres. The
// bands are the level's metronome: at cruise you cross two a second, and the
// docking brake is visible the instant they start to space out.
function createTether(curve: CatmullRomCurve3) {
  const group = new Group();
  const cableCurve = offsetCurve(curve, CABLE_OFFSET.x, CABLE_OFFSET.y);
  const dark = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(2.4) });

  // One cable and nothing else running the length of the level: a continuous
  // rail offset to either side would sit exactly where a ray from the camera to
  // a low target crosses, and would quietly hide targets all run long.
  const cable = new Mesh(new TubeGeometry(cableCurve, 340, 0.42, 8, false), dark);
  cable.name = 'skyhook.cable';
  cable.frustumCulled = false;
  group.add(cable);

  // Hazard bands. Merged into one mesh: 130 rings for the price of one draw call.
  const bands: BufferGeometry[] = [];
  const total = cableCurve.getLength();
  const count = Math.floor(total / 7);
  const ringGeometry = new TorusGeometry(0.8, 0.17, 4, 10);
  const stripeGeometry = new BoxGeometry(1.8, 0.14, 0.14);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const unitScale = new Vector3(1, 1, 1);
  for (let i = 0; i <= count; i += 1) {
    const u = i / count;
    const point = cableCurve.getPointAt(u);
    const tangent = cableCurve.getTangentAt(u).normalize();
    // Ring axis along the cable. Roll is irrelevant for a torus, and aligning a
    // single axis avoids the mirrored (left-handed) rail basis entirely.
    quaternion.setFromUnitVectors(FORWARD, tangent);
    matrix.compose(point, quaternion, unitScale);
    bands.push(ringGeometry.clone().applyMatrix4(matrix));
    // Every fifth band gets a wider crossbar: a coarser count for the eye.
    if (i % 5 === 0) bands.push(stripeGeometry.clone().applyMatrix4(matrix));
  }
  const bandMaterial = new MeshBasicNodeMaterial();
  // Bands dim hard with distance so the cable does not become a glowing spine.
  bandMaterial.colorNode = vec3(HAZARD.r, HAZARD.g, HAZARD.b)
    .mul(float(1.35).add(beatUniform.mul(0.7)))
    .mul(smoothstep(float(150), float(12), positionView.z.negate()).mul(0.85).add(0.15));
  const bandMesh = new Mesh(mergeGeometries(bands), bandMaterial);
  bandMesh.name = 'skyhook.bands';
  bandMesh.frustumCulled = false;
  group.add(bandMesh);
  for (const geometry of bands) geometry.dispose();
  ringGeometry.dispose();
  stripeGeometry.dispose();

  return group;
}

function offsetCurve(curve: CatmullRomCurve3, x: number, y: number) {
  const points: Vector3[] = [];
  const samples = 40;
  const length = curve.getLength();
  // Straight extrapolation past both ends: the cable has to run out of sight
  // below the anchor and above the station, not stop where the rail stops.
  for (let i = -4; i <= samples + 6; i += 1) {
    const u = i / samples;
    const frame = sampleRailFrame(curve, Math.min(1, Math.max(0, u)));
    const point = frame.position.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, y);
    if (u < 0) point.addScaledVector(frame.tangent, u * length);
    if (u > 1) point.addScaledVector(frame.tangent, (u - 1) * length);
    points.push(point);
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// The anchor works you leave behind: a gantry cradle around the cable at the
// bottom of the climb, visible for the first couple of seconds and never again.
function createAnchor(curve: CatmullRomCurve3) {
  const group = new Group();
  group.name = 'skyhook.anchor';
  const frame = sampleRailFrame(curve, 0);
  const fills: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const seat = (geometry: BufferGeometry, x: number, y: number, z: number) => {
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, x)
      .addScaledVector(frame.up, y)
      .addScaledVector(frame.tangent, z);
    matrix.makeTranslation(position.x, position.y, position.z);
    fills.push(geometry.applyMatrix4(matrix));
  };

  for (const side of [-1, 1]) {
    seat(new BoxGeometry(3, 26, 3), side * 16, -22, -18);
    seat(new BoxGeometry(26, 2.2, 2.2), side * 8, -9, -18);
  }
  seat(new BoxGeometry(46, 3, 46), 0, -36, -20);
  const merged = mergeGeometries(fills);
  group.add(new Mesh(merged, new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(3.2) })));
  group.add(new LineSegments(new EdgesGeometry(merged), new MeshBasicMaterial({ color: hdr(RUST, 0.9) })));
  for (const geometry of fills) geometry.dispose();
  return group;
}

// ---- weather ------------------------------------------------------------------

const cloudMaterial = () => {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // Peak alpha, kept honest so soft weather never registers as a hard occluder.
    opacity: CLOUD_PEAK_ALPHA,
  });
  const falloff = smoothstep(float(0.5), float(0.06), uv().sub(0.5).length());
  material.colorNode = attribute<'vec3'>('color', 'vec3');
  material.opacityNode = falloff.pow(1.4).mul(cloudOpacityUniform);
  return material;
};

/** Three discs on skewed planes read as one lump of vapour from any angle. */
function puffGeometry(rng: Rng, radius: number, tint: Color) {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  for (let i = 0; i < 3; i += 1) {
    const disc = new CircleGeometry(radius * (0.7 + rng() * 0.6), 12);
    const axis = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    quaternion.setFromAxisAngle(axis, rng() * Math.PI * 2);
    matrix.compose(
      new Vector3((rng() - 0.5) * radius, (rng() - 0.5) * radius * 0.5, (rng() - 0.5) * radius),
      quaternion,
      new Vector3(1, 1, 1),
    );
    parts.push(disc.applyMatrix4(matrix));
  }
  const merged = mergeGeometries(parts);
  const colors = new Float32Array((merged.getAttribute('position').count) * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = tint.r;
    colors[i + 1] = tint.g;
    colors[i + 2] = tint.b;
  }
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  for (const part of parts) part.dispose();
  return merged;
}

// Storm cloud around the climber: recycled along the rail so it keeps whipping
// past for the whole atmospheric leg and costs nothing above it.
function createCloudField(rng: Rng, curve: CatmullRomCurve3, deckU: number) {
  const material = cloudMaterial();
  return scatterAlongRail(curve, {
    count: 30,
    seed: 20260724,
    rng,
    alignToRail: false,
    window: { behind: 90, ahead: 340 },
    make(_index, makeRng) {
      // Storm cloud is grey, not white: stacked puffs have to stay a long way
      // below the point where the frame loses its contrast.
      const shade = 0.18 + makeRng() * 0.45;
      const tint = new Color(0.26 + shade * 0.46, 0.28 + shade * 0.46, 0.32 + shade * 0.44);
      const mesh = new Mesh(puffGeometry(makeRng, 16 + makeRng() * 26, tint), material);
      mesh.name = 'skyhook.cloud';
      mesh.frustumCulled = false;
      return mesh;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = 26 + placeRng() * 74;
      return {
        u: placeRng() * Math.min(1, deckU + 0.06),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, (placeRng() - 0.5) * 60),
      };
    },
  });
}

// The deck itself: a slab of flat-lying cloud the climber punches through on the
// downbeat of bar 8. Merged, so the whole layer is one draw call.
function createDeckSlab(rng: Rng, curve: CatmullRomCurve3, deckU: number) {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const centre = curve.getPointAt(deckU);
  for (let i = 0; i < 46; i += 1) {
    const disc = new CircleGeometry(34 + rng() * 46, 14);
    disc.rotateX(-Math.PI / 2);
    disc.rotateY(rng() * Math.PI);
    const angle = rng() * Math.PI * 2;
    const radius = rng() ** 0.6 * 250;
    matrix.makeTranslation(
      centre.x + Math.cos(angle) * radius,
      centre.y + (rng() - 0.5) * 34,
      centre.z + Math.sin(angle) * radius - 40,
    );
    parts.push(disc.applyMatrix4(matrix));
  }
  const merged = mergeGeometries(parts);
  const colors = new Float32Array(merged.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    const shade = 0.36 + ((i / 3) % 7) * 0.022;
    colors[i] = shade;
    colors[i + 1] = shade * 1.01;
    colors[i + 2] = shade * 1.05;
  }
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  for (const part of parts) part.dispose();

  const material = cloudMaterial();
  material.opacityNode = smoothstep(float(0.5), float(0.02), uv().sub(0.5).length()).mul(deckOpacityUniform);
  const slab = new Mesh(merged, material);
  slab.name = 'skyhook.deck';
  slab.frustumCulled = false;
  return slab;
}

// Torn panelling and cable shards drifting near the tether. Static in the world,
// which is exactly why they streak downward past a climbing camera.
function createFlotsamField(rng: Rng, curve: CatmullRomCurve3) {
  const material = new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.7) });
  return scatterAlongRail(curve, {
    count: 16,
    seed: 771,
    rng,
    alignToRail: false,
    window: { behind: 60, ahead: 260 },
    make(_index, makeRng) {
      const mesh = new Mesh(
        new BoxGeometry(0.35 + makeRng() * 1.2, 0.22 + makeRng() * 0.5, 1.4 + makeRng() * 4),
        material,
      );
      mesh.name = 'skyhook.flotsam';
      mesh.userData.spin = new Vector3(makeRng() - 0.5, makeRng() - 0.5, makeRng() - 0.5).multiplyScalar(1.6);
      return mesh;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = 24 + placeRng() * 62;
      return {
        u: placeRng(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.8, (placeRng() - 0.5) * 90),
      };
    },
    onUpdate(item, dt) {
      const spin = item.object.userData.spin as Vector3;
      item.object.rotation.x += spin.x * dt;
      item.object.rotation.y += spin.y * dt;
      item.object.rotation.z += spin.z * dt;
    },
  });
}

// ---- speed ---------------------------------------------------------------------

// A cage of streaks around the camera scrolling backwards down the travel axis:
// rain down low, ice dust up top. `streakOffsetUniform` is accumulated distance,
// so this is airspeed made visible without a single CPU-side particle.
function createSpeedStreaks(rng: Rng) {
  const COUNT = 260;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 2.6 + rng() * 10;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 1.6 + rng() * 4.4;
    const shade = 0.3 + rng() * 0.7;
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(0.62 * shade, 0.68 * shade, 0.76 * shade);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const wrapped = attribute<'float'>('z0', 'float').add(streakOffsetUniform).mod(STREAK_SPAN).sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float').mul(streakLengthUniform)),
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 9), wrapped)
    .mul(smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped));
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

// ---- the station -----------------------------------------------------------------

// Geostationary terminus: a counterweight ring, a truss cradle, and a lit throat
// the climber slides into. It hangs over the last third of the climb, growing
// from a bright speck to the whole sky.
function createStation(curve: CatmullRomCurve3) {
  const group = new Group();
  group.name = 'skyhook.station';
  // The mouth sits a few metres beyond the end of the rail, so the climber
  // decelerates into the collar and stops with the ring filling the frame
  // rather than parking inside a tube. lookAt (rather than a rail basis) keeps
  // the orientation a proper rotation — the rail frame is left-handed.
  const frame = sampleRailFrame(curve, 1);
  group.position.copy(frame.position).addScaledVector(frame.tangent, 22);
  group.lookAt(group.position.clone().add(frame.tangent));

  const hull = new MeshBasicMaterial({ color: PANEL.clone().multiplyScalar(0.42) });
  const dark = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(3.0) });

  const fills: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();

  // Counterweight ring, edge-on to the climb.
  const ring = new TorusGeometry(50, 4.6, 8, 40);
  fills.push(ring.clone().applyMatrix4(matrix.makeTranslation(0, 0, 96)));
  // Spokes down to the cable.
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    quaternion.setFromAxisAngle(new Vector3(0, 0, 1), angle);
    matrix.compose(new Vector3(Math.cos(angle) * 26, Math.sin(angle) * 26, 96), quaternion, new Vector3(1, 1, 1));
    fills.push(new BoxGeometry(2.6, 48, 2.6).applyMatrix4(matrix));
  }
  // Truss cradle around the throat.
  for (let i = 0; i < 10; i += 1) {
    const z = 16 + i * 9;
    fills.push(new TorusGeometry(13.5 + (i % 2) * 1.4, 0.7, 4, 18).applyMatrix4(matrix.makeTranslation(0, 0, z)));
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.3;
    fills.push(new BoxGeometry(1.4, 1.4, 96).applyMatrix4(
      matrix.makeTranslation(Math.cos(angle) * 14, Math.sin(angle) * 14, 52),
    ));
  }
  const merged = mergeGeometries(fills);
  group.add(new Mesh(merged, hull));
  group.add(new LineSegments(new EdgesGeometry(merged), new MeshBasicMaterial({ color: hdr(STEEL, 1.1) })));
  for (const geometry of fills) geometry.dispose();

  // The throat: an unlit tube the camera slides into, with a lit approach collar.
  const throat = new Mesh(new CylinderGeometry(12.6, 12.6, 110, 20, 1, true), dark);
  throat.name = 'skyhook.throat';
  throat.rotation.x = Math.PI / 2;
  throat.position.z = 63;
  group.add(throat);

  const collarMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  // Approach lights running up the throat, and a hazard collar at the mouth.
  const runner = positionLocal.y.mul(0.34).sub(time.mul(3.4)).sin().mul(0.5).add(0.5).pow(14);
  collarMaterial.colorNode = mix(
    vec3(AMBER.r, AMBER.g, AMBER.b),
    vec3(PANEL.r, PANEL.g, PANEL.b),
    runner,
  ).mul(runner.mul(1.6).add(0.04)).mul(beaconUniform);
  const collar = new Mesh(new CylinderGeometry(12.2, 12.2, 108, 20, 24, true), collarMaterial);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 63;
  group.add(collar);

  const mouth = new Mesh(
    new TorusGeometry(11.5, 1.1, 6, 28),
    createAdditiveBasicMaterial({ color: hdr(HAZARD, 1.5), fog: false }),
  );
  mouth.position.z = 0;
  group.add(mouth);

  return group;
}
