import {
  BackSide,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  SphereGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import {
  acos,
  cameraPosition,
  clamp,
  exp,
  float,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { colorUniform } from './materials';

// The sky is one camera-centred dome painted from uniforms: a zenith→horizon
// gradient that hugs the planet's limb, the planet itself (weather, then the
// cloud sea, then ocean under swirling cloud), an atmosphere rim, storm
// overcast with lightning, and the sun. Stars are points that the same planet
// test hides. The spine drives every value; nothing here knows the timeline.

export const skyUniforms = {
  zenith: colorUniform(),
  horizon: colorUniform(),
  ground: colorUniform(),
  groundCloud: colorUniform(),
  cloudCover: uniform(0.5),
  limb: colorUniform(),
  /** Planet centre direction (unit) and angular radius (radians). */
  planetCenter: uniform(new Vector3(0, -1, 0)),
  planetRadius: uniform(1.5),
  overcast: uniform(1),
  lightning: uniform(0),
  lightningCenter: uniform(new Vector3(0, 0, -1)),
  sunDirection: uniform(new Vector3(0, 0, -1)),
  sunDisc: uniform(0),
  sunGlow: uniform(0),
  stars: uniform(0),
  /** Accumulated climb, scrolls the planet's cloud field so the ground drops away. */
  drift: uniform(0),
};

const DOME_RADIUS = 3000;
const STAR_RADIUS = 2800;

export type Sky = {
  root: Group;
  update(cameraPosition: Vector3): void;
};

export function createSky(): Sky {
  const root = new Group();
  const u = skyUniforms;

  const dir = normalize(positionWorld.sub(cameraPosition));
  const toCenter = acos(clamp(dir.dot(u.planetCenter), -1, 1));
  // Signed angle from the limb: positive in the sky, negative on the planet.
  const limbAngle = toCenter.sub(u.planetRadius);

  // Sky: the horizon glow sits on the limb, the zenith owns the rest.
  const skyT = smoothstep(float(0), float(0.85), limbAngle);
  let sky = mix(u.horizon, u.zenith, pow(skyT, float(0.8)));

  // Storm overcast: mottled churning cloud painted over the sky.
  const cloudP = dir.mul(3.2).add(vec3(time.mul(0.02), 0, time.mul(0.035)));
  const overcastNoise = mx_noise_float(cloudP).mul(0.6).add(mx_noise_float(cloudP.mul(2.7)).mul(0.3)).mul(0.5).add(0.5);
  const overcastDetail = mx_noise_float(cloudP.mul(7.5).add(vec3(0, time.mul(0.08), 0))).mul(0.5).add(0.5);
  const overcastShade = mix(u.zenith.mul(0.42), u.horizon.mul(1.3), smoothstep(float(0.25), float(0.85), overcastNoise.mul(0.8).add(overcastDetail.mul(0.3))));
  sky = mix(sky, overcastShade, u.overcast.mul(0.9));
  // Lightning lights the cloud from inside, strongest around its strike point.
  const strike = pow(max(float(0), dir.dot(u.lightningCenter)), float(6));
  sky = sky.add(vec3(0.75, 0.78, 0.95).mul(u.lightning).mul(strike.mul(0.9).add(0.18)).mul(overcastNoise.add(0.35)));

  // The sun.
  const sunDot = max(float(0), dir.dot(u.sunDirection));
  const disc = smoothstep(float(0.99985), float(0.99995), sunDot).mul(u.sunDisc).mul(2.2);
  const glow = pow(sunDot, float(48)).mul(u.sunGlow).add(pow(sunDot, float(6)).mul(u.sunGlow.mul(0.22)));
  sky = sky.add(vec3(1.0, 0.95, 0.85).mul(disc.add(glow)));

  // The planet: surface cloud field drifts as the ground falls away.
  const groundP = dir.mul(9).add(vec3(0, u.drift, u.drift.mul(0.4)));
  const cloudField = mx_noise_float(groundP)
    .mul(0.55)
    .add(mx_noise_float(groundP.mul(2.3)).mul(0.3))
    .add(mx_noise_float(groundP.mul(6.1)).mul(0.15))
    .mul(0.5)
    .add(0.5);
  const cloudMask = smoothstep(float(1).sub(u.cloudCover), float(1).sub(u.cloudCover).add(0.28), cloudField);
  // Toward the limb the surface foreshortens into haze.
  const depthToLimb = smoothstep(float(0), float(0.5), limbAngle.negate());
  let ground = mix(u.ground, u.groundCloud, cloudMask);
  ground = mix(u.limb.mul(0.8), ground, depthToLimb.mul(0.8).add(0.2));
  // Atmosphere rim: a thin bright band right on the limb, thinning with altitude.
  const rim = exp(limbAngle.abs().mul(-38)).mul(0.9);
  const planet = ground.add(u.limb.mul(rim));

  const onPlanet = float(1).sub(smoothstep(float(-0.003), float(0.003), limbAngle));
  const skyWithRim = sky.add(u.limb.mul(rim.mul(0.55)));
  const domeMaterial = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  domeMaterial.fog = false;
  domeMaterial.colorNode = mix(skyWithRim, planet, onPlanet);
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 64, 40), domeMaterial);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.raildIgnoreOcclusion = true;
  root.add(dome);

  // Stars: fixed field around the camera, hidden behind the planet disc.
  const rng = mulberry32(7031);
  const count = 2600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const v = new Vector3();
  for (let i = 0; i < count; i += 1) {
    v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (v.lengthSq() < 0.0001) v.set(0, 0, -1);
    v.normalize().multiplyScalar(STAR_RADIUS);
    positions.set([v.x, v.y, v.z], i * 3);
    const roll = rng();
    const bright = roll > 0.985 ? 1.6 : roll > 0.9 ? 0.9 : 0.3 + rng() * 0.4;
    const warm = rng();
    colors.set([bright * (0.85 + warm * 0.15), bright * 0.9, bright * (1.05 - warm * 0.15)], i * 3);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starMaterial = new PointsNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  starMaterial.fog = false;
  const starDir = normalize(positionWorld.sub(cameraPosition));
  const starLimb = acos(clamp(starDir.dot(u.planetCenter), -1, 1)).sub(u.planetRadius);
  starMaterial.opacityNode = u.stars.mul(smoothstep(float(0.01), float(0.05), starLimb));
  const stars = new Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  stars.userData.raildIgnoreOcclusion = true;
  root.add(stars);

  return {
    root,
    update(position) {
      root.position.copy(position);
    },
  };
}
