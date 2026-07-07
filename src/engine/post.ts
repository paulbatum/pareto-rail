import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { float, pass, screenUV, smoothstep, vec2 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Camera, Scene } from 'three';
import type { LevelPostConfig } from './types';

// Bloom is what turns flat neon colors into light. Threshold sits below the
// HDR values used on cores/edges so hot elements glow hard while the dark
// backdrop stays clean; a soft vignette pulls focus to the rail.
const DEFAULT_BLOOM_STRENGTH = 1.15;
const DEFAULT_BLOOM_THRESHOLD = 0.55;
const DEFAULT_BLOOM_RADIUS = 0.18;
const DEFAULT_VIGNETTE_INNER = 0.32;
const DEFAULT_VIGNETTE_OUTER = 1.05;
const DEFAULT_VIGNETTE_STRENGTH = 0.82;
const DEFAULT_VIGNETTE_FLOOR = 0.18;
const BLOOM_UI_SCALE = 0.75;
const bloomRefs = new Map<ReturnType<typeof bloom>, number>();
let bloomLevel = 1;
let motionBlurLevel = 1;

// One knob for bloom intensity. 1.0 is the settings-menu maximum, scaled to
// the previous 75% intensity; 0 disables bloom. Safe to call before createPost.
export function setBloomLevel(level: number) {
  bloomLevel = Math.min(1, Math.max(0, level));
  for (const [bloomRef, baseStrength] of bloomRefs) bloomRef.strength.value = baseStrength * bloomLevel * BLOOM_UI_SCALE;
}

export function getBloomLevel() {
  return bloomLevel;
}

// Shared player preference for levels that implement their own motion blur.
// The engine stores this value only; motion-blur levels must read and apply it.
export function setMotionBlurLevel(level: number) {
  motionBlurLevel = Math.min(1, Math.max(0, level));
}

export function getMotionBlurLevel() {
  return motionBlurLevel;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, config: LevelPostConfig = {}) {
  const scenePass = pass(scene, camera);
  const baseStrength = config.bloom?.strength ?? DEFAULT_BLOOM_STRENGTH;
  const bloomPass = bloom(
    scenePass,
    baseStrength * bloomLevel * BLOOM_UI_SCALE,
    config.bloom?.threshold ?? DEFAULT_BLOOM_THRESHOLD,
    config.bloom?.radius ?? DEFAULT_BLOOM_RADIUS,
  );
  bloomRefs.set(bloomPass, baseStrength);

  const post = new RenderPipeline(renderer);
  const base = scenePass.add(bloomPass);
  const composed = config.composeOutput?.({ base, scenePass, bloomPass, screenUV }) ?? base;
  if (config.vignette === false) {
    post.outputNode = composed;
  } else {
    const vignetteStrength = config.vignette?.strength ?? DEFAULT_VIGNETTE_STRENGTH;
    const vignetteFloor = config.vignette?.strength === undefined ? DEFAULT_VIGNETTE_FLOOR : 1 - vignetteStrength;
    const vignette = smoothstep(
      float(config.vignette?.outer ?? DEFAULT_VIGNETTE_OUTER),
      float(config.vignette?.inner ?? DEFAULT_VIGNETTE_INNER),
      screenUV.distance(vec2(0.5)).mul(1.15),
    )
      .mul(vignetteStrength)
      .add(vignetteFloor);
    post.outputNode = composed.mul(vignette);
  }

  return {
    render() {
      post.render();
    },
  };
}
