import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial, PointsMaterial as PointsNodeMaterial } from 'three/webgpu';
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
  vec3,
} from 'three/tsl';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { createStrandlineRail, railU } from '../gameplay';
import { BELL_CENTER, BELL_RADIUS, DIVE_BACK_TIME } from '../timing';
import { BELL_GREEN, LAGOON, MIDWATER, STRAND_GOLD, STRAND_GREEN, VIOLET_SICK, hdr, mulberry32, type Rng } from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const cleanUniform = uniform(0); // 0 infested → 1 every strand glowing clean
export const bellRevealUniform = uniform(0); // surge when the curve swings wide

// Shared uniforms object identity is stable across module reloads within a
// session; the environment rebuild simply reuses them.

const STRAND_COUNT = 150;
const ROOT_COUNT = 26;

export type Environment = {
  root: Group;
  bellPosition: Vector3;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const rng = mulberry32(84848);
  const curve = createStrandlineRail();

  scene.background = LAGOON.clone();
  scene.fog = new FogExp2(LAGOON.clone().lerp(MIDWATER, 0.4), 0.0082);

  const root = new Group();
  root.add(createStrandForest(rng, curve));
  root.add(createCrownRoots(rng, curve));
  root.add(createBell());
  root.add(createLightShafts(rng, curve));
  root.add(createMarineSnow(rng, curve));

  scene.add(root);
  return { root, bellPosition: new Vector3(BELL_CENTER.x, BELL_CENTER.y, BELL_CENTER.z) };
}

// ---- the strand forest -------------------------------------------------------
// The trailing tentacles: long sagging tubes hanging through the whole run.
// Bioluminescent bands travel along each strand; a sickly violet blight creeps
// over everything until the parent dies and `cleanUniform` washes it away.
function createStrandForest(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  const geoms: BufferGeometry[] = [];
  for (let i = 0; i < STRAND_COUNT; i += 1) {
    // Spread strands across the full run; keep a clear corridor near the rail
    // itself so targets never hide behind scenery.
    const u = Math.min(0.985, rng() * 1.02);
    const frame = sampleFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 14 + rng() ** 1.6 * 110;

    // Keep a guaranteed clearing around the swim corridor so targets are
    // never seated behind a tentacle.
    let lateralX = Math.cos(angle) * radius;
    const lateralY = Math.sin(angle) * radius * 0.7 + 6;
    if (Math.abs(lateralX) < 18) lateralX = Math.sign(lateralX || 1) * 18;
    const base = frame.position
      .clone()
      .addScaledVector(frame.right, lateralX)
      .addScaledVector(frame.up, lateralY)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 30);

    // Sag downward from its root point — tentacles trail below their anchor.
    const length = 70 + rng() * 150;
    const sag = length * (0.35 + rng() * 0.4);
    const driftSign = Math.sign(lateralX || 1);
    const driftX = driftSign * (6 + rng() * 22);
    const driftZ = (rng() - 0.5) * 24;
    const points = [
      base.clone(),
      base.clone().add(new Vector3(driftX * 0.3, -length * 0.3, driftZ * 0.3)),
      base.clone().add(new Vector3(driftX * 0.75, -length * 0.62 - sag * 0.3, driftZ * 0.75)),
      base.clone().add(new Vector3(driftX, -length - sag, driftZ)),
    ];
    const tubeCurve = new CatmullRomCurve3(points);
    const tubeRadius = 0.45 + rng() * 1.5;
    const geometry = new TubeGeometry(tubeCurve, 20, tubeRadius, 5, false);
    // uv.x runs along the tube — the shader's pulse coordinate.
    geoms.push(geometry);
  }
  const merged = mergeGeometries(geoms);
  for (const geometry of geoms) geometry.dispose();

  const material = new MeshBasicNodeMaterial();
  const bands = positionWorld.mul(0.05).add(vec3(0, time.mul(-0.55), time.mul(0.32))).dot(normalize(vec3(0.7, 0.6, 0.4)))
    .sin().mul(0.5).add(0.5).pow(2.4);
  const shimmer = mx_noise_float(positionWorld.mul(0.11).add(vec3(0, time.mul(-0.22), 0))).mul(0.5).add(0.5);

  const cleanColor = mix(vec3(STRAND_GREEN.r, STRAND_GREEN.g, STRAND_GREEN.b), vec3(STRAND_GOLD.r, STRAND_GOLD.g, STRAND_GOLD.b), shimmer.mul(0.7))
    .mul(bands.mul(beatUniform.mul(0.9).add(0.55)).mul(1.15).add(0.16));
  const sickColor = mix(cleanColor, vec3(VIOLET_SICK.r, VIOLET_SICK.g, VIOLET_SICK.b).mul(0.85), smoothstep(float(0.25), float(0.75), shimmer).mul(0.66));

  material.colorNode = mix(sickColor, cleanColor.mul(1.7), cleanUniform)
    .mul(positionView.z.negate().mul(-0.0075).exp())
    .mul(smoothstep(float(2), float(12), positionView.z.negate()));
  material.side = DoubleSide;

  const mesh = new Mesh(merged, material);
  // Decorative backdrop: the forest keeps a hard clearing around the swim
  // corridor, and partial grazes behind distant tubes shouldn't read as
  // target illegibility.
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- crown roots ---------------------------------------------------------------
// Thick strands converging up into the bell's underside at the end of the run:
// the arena walls of the parent fight.
function createCrownRoots(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  const group = new Group();
  const geoms: BufferGeometry[] = [];
  const startU = railU(DIVE_BACK_TIME) + 0.02;
  for (let i = 0; i < ROOT_COUNT; i += 1) {
    const u = startU + ((0.99 - startU) * i) / ROOT_COUNT + rng() * 0.004;
    const frame = sampleFrame(curve, Math.min(u, 0.995));
    const side = i % 2 === 0 ? 1 : -1;
    const angle = rng() * Math.PI * 2;
    const radius = 34 + rng() * 56;
    const base = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius * side)
      .addScaledVector(frame.up, (rng() - 0.5) * 20)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 30);
    const top = new Vector3(
      BELL_CENTER.x + (rng() - 0.5) * BELL_RADIUS * 1.1,
      BELL_CENTER.y - BELL_RADIUS * (0.86 + rng() * 0.1),
      BELL_CENTER.z + (rng() - 0.5) * BELL_RADIUS * 1.1,
    );
    const mid1 = base.clone().lerp(top, 0.35).add(new Vector3((rng() - 0.5) * 30, -10, (rng() - 0.5) * 30));
    const mid2 = base.clone().lerp(top, 0.72).add(new Vector3((rng() - 0.5) * 24, -6, (rng() - 0.5) * 24));
    const rootCurve = new CatmullRomCurve3([base, mid1, mid2, top]);
    geoms.push(new TubeGeometry(rootCurve, 18, 0.9 + rng() * 1.7, 5, false));
  }
  const merged = mergeGeometries(geoms);
  for (const geometry of geoms) geometry.dispose();

  const material = new MeshBasicNodeMaterial();
  const shimmer = mx_noise_float(positionWorld.mul(0.08)).mul(0.5).add(0.5);
  const cleanColor = mix(vec3(STRAND_GREEN.r, STRAND_GREEN.g, STRAND_GREEN.b), vec3(STRAND_GOLD.r, STRAND_GOLD.g, STRAND_GOLD.b), shimmer)
    .mul(shimmer.mul(beatUniform.mul(0.7).add(0.5)).mul(0.55).add(0.09));
  const sickColor = mix(cleanColor, vec3(VIOLET_SICK.r, VIOLET_SICK.g, VIOLET_SICK.b), shimmer.mul(0.6));
  material.colorNode = mix(sickColor, cleanColor.mul(1.35), cleanUniform)
    .mul(positionView.z.negate().mul(-0.008).exp());
  const rootsMesh = new Mesh(merged, material);
  rootsMesh.userData.raildIgnoreOcclusion = true;
  group.add(rootsMesh);
  return group;
}

// ---- the bell -------------------------------------------------------------------
// The animal itself: a green moon hanging in the blue. Its material ignores
// fog and fades by its own gentle law, so it glows through hundreds of metres
// of water before it resolves — bioluminescence reaching out first.
function createBell() {
  const group = new Group();
  const center = new Vector3(BELL_CENTER.x, BELL_CENTER.y, BELL_CENTER.z);

  const bodyMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const mottle = mx_noise_float(positionWorld.mul(0.012).add(vec3(time.mul(0.02), time.mul(-0.03), 0))).mul(0.5).add(0.5);
  const radial = positionWorld.sub(cameraPosition).length();
  const reach = radial.mul(-0.0022).exp(); // the bell's own distance law
  const canalPattern = mx_noise_float(positionWorld.mul(0.05)).mul(0.5).add(0.5).pow(3);

  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(2.4);

  const litBody = mix(
    vec3(BELL_GREEN.r, BELL_GREEN.g, BELL_GREEN.b).mul(0.44),
    vec3(BELL_GREEN.r, BELL_GREEN.g, BELL_GREEN.b).mul(1.3),
    mottle,
  ).add(vec3(STRAND_GOLD.r, STRAND_GOLD.g, STRAND_GOLD.b).mul(canalPattern).mul(0.6))
   .mul(beatUniform.mul(0.16).add(0.98));

  bodyMaterial.colorNode = litBody
    .mul(reach.mul(0.85).add(0.06))
    .add(vec3(BELL_GREEN.r, BELL_GREEN.g, BELL_GREEN.b).mul(rim).mul(reach).mul(1.1));

  const bell = new Mesh(new SphereGeometry(BELL_RADIUS, 72, 48), bodyMaterial);
  bell.position.copy(center);
  group.add(bell);

  // Inner lantern: a smaller hot core deep inside the bell, visible through
  // the translucent shell.
  const lanternMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  lanternMaterial.colorNode = vec3(BELL_GREEN.r * 1.2, BELL_GREEN.g * 1.2, BELL_GREEN.b)
    .mul(beatUniform.mul(0.5).add(0.8))
    .mul(radial.mul(-0.004).exp());
  const lantern = new Mesh(new SphereGeometry(BELL_RADIUS * 0.42, 40, 28), lanternMaterial);
  lantern.position.copy(center).add(new Vector3(0, -BELL_RADIUS * 0.18, 0));
  group.add(lantern);

  return group;
}

// ---- light shafts -----------------------------------------------------------------
// Sunlight falling from somewhere above: tall additive planes leaning with the
// current, scattered along the run.
function createLightShafts(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  const group = new Group();
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, depthWrite: false }));
  const flicker = positionWorld.x.mul(0.01).add(time.mul(0.14)).sin().mul(0.5).add(0.5);
  material.colorNode = vec3(0.55, 0.95, 0.85)
    .mul(flicker.mul(0.5).add(0.5))
    .mul(0.04)
    .mul(positionView.z.negate().mul(-0.014).exp())
    .mul(bellRevealUniform.mul(0.6).add(1));
  material.depthWrite = false;

  for (let i = 0; i < 26; i += 1) {
    const u = rng() * 0.99;
    const frame = sampleFrame(curve, u);
    const plane = new Mesh(new PlaneGeometry(3 + rng() * 7, 140 + rng() * 140), material);
    plane.userData.raildIgnoreOcclusion = true;
    plane.position
      .copy(frame.position)
      .addScaledVector(frame.right, (rng() - 0.5) * 180)
      .addScaledVector(frame.up, 60 + rng() * 60)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 60);
    plane.rotation.z = 0.3 + (rng() - 0.5) * 0.2;
    plane.rotation.y = rng() * Math.PI;
    group.add(plane);
  }
  return group;
}

// ---- marine snow --------------------------------------------------------------------
// Slow pale specks drifting up through the water column everywhere.
function createMarineSnow(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 6 + rng() ** 1.4 * 130;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 50);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    seeds[i] = rng();
    const tint = rng();
    const color = tint < 0.7 ? new Color(0.65, 0.85, 0.8) : tint < 0.92 ? hdr(STRAND_GREEN, 0.5) : hdr(STRAND_GOLD, 0.55);
    colors[i * 3] = color.r * (0.2 + rng() * 0.5);
    colors[i * 3 + 1] = color.g * (0.2 + rng() * 0.5);
    colors[i * 3 + 2] = color.b * (0.2 + rng() * 0.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new PointsMaterial(additiveMaterialParameters({
    size: 0.42,
    vertexColors: true,
    sizeAttenuation: true,
    depthWrite: false,
  }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  // Drift upward on the shader level: each speck wraps over a 40-unit window.
  const pointsNodeMaterial = material as unknown as PointsNodeMaterial;
  const seedAttr = attribute<'float'>('aSeed', 'float');
  const rise = time.mul(seedAttr.mul(0.55).add(0.2)).mod(40);
  pointsNodeMaterial.positionNode = vec3(
    positionLocal.x.add(rise.mul(0.12).sin()),
    positionLocal.y.add(rise),
    positionLocal.z,
  );
  return points;
}

// ---- helpers --------------------------------------------------------------------------

function sampleFrame(curve: CatmullRomCurve3, u: number) {
  const clampedU = Math.min(0.999, Math.max(0.001, u));
  const position = curve.getPointAt(clampedU);
  const tangent = curve.getTangentAt(clampedU).normalize();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(tangent, up).normalize();
  if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
  return { position, tangent, right, up: new Vector3().crossVectors(right, tangent).normalize() };
}
