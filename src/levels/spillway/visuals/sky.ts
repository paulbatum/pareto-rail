import { DirectionalLight, Matrix4, Scene, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { positionWorldDirection } from 'three/tsl';
import { bakeEnvironment, createGradientSky } from '../../../engine/environment-light';
import { createHeightHaze, type HeightHaze } from '../../../engine/height-haze';
import { SKY, SUNLIGHT } from './palette';

export type SkyOptions = {
  sunDirection: Vector3;
  sunIntensity: number;
  /** Half-size of the sun's shadow box, and how far ahead of the camera its centre sits. */
  shadowHalfSize: number;
  shadowLead: number;
};

export type SkyRig = {
  sun: DirectionalLight;
  haze: HeightHaze;
  /** Keeps the shadow box on the camera, snapped to shadow texels so edges do not crawl. */
  follow(camera: PerspectiveCamera): void;
  dispose(): void;
};

const SHADOW_MAP_SIZE = 2048;
const SHADOW_DEPTH = 1500;

/**
 * Clear morning sky, the image-based light baked from it, the sun with its
 * shadow box, and the height haze. The visible sky and the baked one are two
 * skies from the same gradient: the baked copy has a dim, wide sun, because the
 * directional light already paints the sun's highlight and its shadows, and a
 * sharp sun in the environment map would glint on water that lies in shadow.
 */
export function createSky(renderer: WebGPURenderer, scene: Scene, options: SkyOptions): SkyRig {
  const common = {
    zenith: SKY.zenith,
    horizon: SKY.horizon,
    ground: SKY.ground,
    horizonWidth: 0.2,
    sunDirection: options.sunDirection,
    sunColor: SKY.sun,
  };
  const visible = createGradientSky({ ...common, skyIntensity: 1.05, sunIntensity: 30, sunAngularRadius: 0.011, haloAngularRadius: 0.5, haloIntensity: 0.005 });
  scene.backgroundNode = visible.colorFor(positionWorldDirection);
  const baked = createGradientSky({ ...common, skyIntensity: 0.62, sunIntensity: 2.5, sunAngularRadius: 0.08, haloAngularRadius: 0.9, haloIntensity: 0.12 });
  const environment = bakeEnvironment(renderer, () => baked.scene, { sigma: 0.04, size: 128 });
  const detach = environment.attach(scene);

  const sun = new DirectionalLight(SUNLIGHT, options.sunIntensity);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -options.shadowHalfSize;
  shadowCamera.right = options.shadowHalfSize;
  shadowCamera.top = options.shadowHalfSize;
  shadowCamera.bottom = -options.shadowHalfSize;
  shadowCamera.near = 1;
  shadowCamera.far = SHADOW_DEPTH;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  scene.add(sun, sun.target);

  const haze = createHeightHaze({
    coldColor: SKY.haze,
    density: 0.0012,
    floorHeight: 0,
    falloffHeight: 60,
    glowColor: SKY.hazeWarm,
    glowStrength: 0.12,
    glowRadius: 700,
    glowFalloffHeight: 160,
  });
  const detachHaze = haze.attach(scene);

  const lightSpace = new Matrix4();
  const inverse = new Matrix4();
  const focus = new Vector3();
  const forward = new Vector3();
  const texel = (options.shadowHalfSize * 2) / SHADOW_MAP_SIZE;
  const up = Math.abs(options.sunDirection.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  lightSpace.lookAt(new Vector3(), options.sunDirection.clone().negate(), up);
  inverse.copy(lightSpace).invert();
  const horizon = options.sunDirection.clone().setY(0).normalize();

  return {
    sun,
    haze,
    follow(camera) {
      camera.getWorldDirection(forward);
      focus.copy(camera.position).addScaledVector(forward, options.shadowLead);
      focus.applyMatrix4(inverse);
      focus.x = Math.round(focus.x / texel) * texel;
      focus.y = Math.round(focus.y / texel) * texel;
      focus.applyMatrix4(lightSpace);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(options.sunDirection, SHADOW_DEPTH * 0.6);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      // The warm glow sits low on the horizon toward the sun.
      haze.uniforms.glowStart.value.copy(camera.position).addScaledVector(horizon, 2400).setY(haze.uniforms.floorHeight.value + 60);
      haze.uniforms.glowEnd.value.copy(haze.uniforms.glowStart.value);
    },
    dispose() {
      detachHaze();
      detach();
      environment.dispose();
      visible.dispose();
      baked.dispose();
      scene.backgroundNode = null;
      scene.remove(sun, sun.target);
      sun.dispose();
    },
  };
}
