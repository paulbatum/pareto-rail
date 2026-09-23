import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  dot,
  exp,
  float,
  floor,
  length,
  max,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type { Rng } from '../../../engine/rng';
import { additiveMaterialParameters } from '../../../engine/visual-kit';

type FloatUniform = UniformNode<'float', number>;
type ColorUniform = UniformNode<'color', Color>;

// Leaf: the water around the animal. A camera-centred dome carries the
// gradient (sunlit overhead, deep blue below), the sun's diffuse glow and
// Snell's window with its rippling caustic edge; long additive shafts carry
// the light down through the forest; marine snow wraps around the camera for
// parallax. Every colour and amount is a uniform or a parameter.

export type WaterUniforms = {
  surface: ColorUniform;
  horizon: ColorUniform;
  abyss: ColorUniform;
  sunlight: ColorUniform;
  sunStrength: FloatUniform;
  clock: FloatUniform;
  shafts: FloatUniform;
  snow: FloatUniform;
};

export function createWaterUniforms(colors: { surface: Color; horizon: Color; abyss: Color; sunlight: Color }): WaterUniforms {
  return {
    surface: uniform(colors.surface.clone()),
    horizon: uniform(colors.horizon.clone()),
    abyss: uniform(colors.abyss.clone()),
    sunlight: uniform(colors.sunlight.clone()),
    sunStrength: uniform(1),
    clock: uniform(0),
    shafts: uniform(1),
    snow: uniform(1),
  };
}

export function createWaterDome(radius: number, sunDirection: Vector3, uniforms: WaterUniforms) {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal);
  const y = dir.y;
  const sun = vec3(sunDirection.x, sunDirection.y, sunDirection.z);
  const sunDot = max(dot(dir, sun), float(0));

  let color = mix(uniforms.horizon, uniforms.surface, pow(smoothstep(float(-0.1), float(1.0), y), float(1.5)));
  color = mix(color, uniforms.abyss, smoothstep(float(0.02), float(-0.7), y));

  // Snell's window: the whole sky above squeezed into a bright disc with a
  // wobbling edge, criss-crossed by caustic ripples.
  const azimuth = atan(dir.z, dir.x);
  const ripple = sin(azimuth.mul(9).add(uniforms.clock.mul(0.7))).mul(0.012)
    .add(sin(azimuth.mul(23).sub(uniforms.clock.mul(1.3))).mul(0.006));
  const window = smoothstep(float(0.64), float(0.74), y.add(ripple));
  const causticA = abs(sin(dir.x.mul(34).add(sin(dir.z.mul(27).add(uniforms.clock.mul(0.7))).mul(1.8)).add(uniforms.clock.mul(0.4))));
  const causticB = abs(sin(dir.z.mul(29).sub(sin(dir.x.mul(23).sub(uniforms.clock.mul(0.6))).mul(2.1)).add(uniforms.clock.mul(0.3))));
  const caustic = pow(causticA.mul(causticB), float(6)).mul(window);
  const glow = pow(sunDot, float(6)).mul(0.16).add(pow(sunDot, float(64)).mul(0.3));
  color = color.add(uniforms.sunlight.mul(glow.add(window.mul(0.07)).add(caustic.mul(0.1))).mul(uniforms.sunStrength));
  material.colorNode = color;

  const dome = new Mesh(new SphereGeometry(radius, 48, 32), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

export type ShaftPlacement = { base: Vector3; radius: number; length: number; strength: number; seed: number };

export function createLightShafts(placements: readonly ShaftPlacement[], sunDirection: Vector3, uniforms: WaterUniforms) {
  const geometries: BufferGeometry[] = [];
  const orient = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), sunDirection.clone().normalize());
  for (const shaft of placements) {
    const geometry = new CylinderGeometry(shaft.radius * 0.7, shaft.radius * 1.5, shaft.length, 14, 1, true);
    const count = geometry.getAttribute('position').count;
    const along = new Float32Array(count);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < count; i += 1) along[i] = positions.getY(i) / shaft.length + 0.5;
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(count).fill(shaft.seed), 1));
    geometry.setAttribute('aStrength', new BufferAttribute(new Float32Array(count).fill(shaft.strength), 1));
    const center = shaft.base.clone().addScaledVector(sunDirection, shaft.length / 2);
    geometry.applyMatrix4(new Matrix4().compose(center, orient, new Vector3(1, 1, 1)));
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();

  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false, side: BackSide }));
  const along = attribute<'float'>('aAlong', 'float');
  const seed = attribute<'float'>('aSeed', 'float');
  const strength = attribute<'float'>('aStrength', 'float');
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const core = pow(abs(dot(normalWorld, viewDirection)), float(2.6));
  const verticalFade = smoothstep(float(0), float(0.55), along).mul(float(1).sub(smoothstep(float(0.9), float(1), along)));
  const flicker = sin(uniforms.clock.mul(0.37).add(seed.mul(17))).mul(0.3).add(0.7)
    .mul(sin(uniforms.clock.mul(1.1).add(seed.mul(5))).mul(0.12).add(0.88));
  const distance = length(positionWorld.sub(cameraPosition));
  const fade = exp(distance.mul(-0.0055)).mul(smoothstep(float(3), float(22), distance));
  material.colorNode = uniforms.sunlight.mul(core.mul(verticalFade).mul(flicker).mul(fade).mul(strength).mul(uniforms.shafts).mul(0.05));
  const mesh = new Mesh(merged, material);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

export function createMarineSnow(count: number, box: number, rng: Rng, color: Color, uniforms: WaterUniforms) {
  const geometries: BufferGeometry[] = [];
  const base = new TetrahedronGeometry(1, 0);
  for (let i = 0; i < count; i += 1) {
    const size = 0.025 + rng() ** 3 * 0.06;
    const center = new Vector3((rng() - 0.5) * box, (rng() - 0.5) * box, (rng() - 0.5) * box);
    const geometry = base.clone();
    geometry.applyMatrix4(new Matrix4().makeRotationY(rng() * Math.PI * 2).multiply(new Matrix4().makeRotationX(rng() * Math.PI * 2)));
    geometry.scale(size, size, size);
    geometry.translate(center.x, center.y, center.z);
    const vertexCount = geometry.getAttribute('position').count;
    const centers = new Float32Array(vertexCount * 3);
    const twinkle = new Float32Array(vertexCount).fill(rng());
    for (let v = 0; v < vertexCount; v += 1) centers.set([center.x, center.y, center.z], v * 3);
    geometry.setAttribute('aCenter', new BufferAttribute(centers, 3));
    geometry.setAttribute('aTwinkle', new BufferAttribute(twinkle, 1));
    geometries.push(geometry);
  }
  base.dispose();
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();

  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const center = attribute<'vec3'>('aCenter', 'vec3');
  const twinkle = attribute<'float'>('aTwinkle', 'float');
  // Drift down and with the current, and wrap in a box that follows the camera.
  const drift = vec3(float(0.35), float(-0.55), float(0.25)).mul(uniforms.clock);
  const relative = center.add(drift).sub(cameraPosition);
  const wrapped = relative.sub(floor(relative.div(box).add(0.5)).mul(box));
  material.positionNode = cameraPosition.add(wrapped).add(positionLocal.sub(center));
  const distance = length(wrapped);
  const fade = smoothstep(float(box * 0.5), float(box * 0.18), distance).mul(smoothstep(float(2.5), float(6), distance));
  const sparkle = sin(uniforms.clock.mul(2.3).add(twinkle.mul(40))).mul(0.35).add(0.65);
  material.colorNode = vec3(color.r, color.g, color.b).mul(fade).mul(sparkle).mul(uniforms.snow);
  const mesh = new Mesh(merged, material);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}
