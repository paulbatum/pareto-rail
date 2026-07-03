import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { float, pass, screenUV, smoothstep, vec2 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Camera, Scene } from 'three';

// Bloom is what turns flat neon colors into light. Threshold sits below the
// HDR values used on cores/edges so hot elements glow hard while the dark
// backdrop stays clean; a soft vignette pulls focus to the rail.
const BASE_BLOOM_STRENGTH = 1.15;
const BLOOM_UI_SCALE = 0.75;
let bloomRef: ReturnType<typeof bloom> | null = null;
let bloomLevel = 1;

// One knob for bloom intensity. 1.0 is the settings-menu maximum, scaled to
// the previous 75% intensity; 0 disables bloom. Safe to call before createPost.
export function setBloomLevel(level: number) {
  bloomLevel = Math.min(1, Math.max(0, level));
  if (bloomRef) bloomRef.strength.value = BASE_BLOOM_STRENGTH * bloomLevel * BLOOM_UI_SCALE;
}

export function getBloomLevel() {
  return bloomLevel;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const scenePass = pass(scene, camera);
  const bloomPass = bloom(scenePass, BASE_BLOOM_STRENGTH * bloomLevel * BLOOM_UI_SCALE, 0.55, 0.18);
  bloomRef = bloomPass;
  const vignette = smoothstep(float(1.05), float(0.32), screenUV.distance(vec2(0.5)).mul(1.15))
    .mul(0.82)
    .add(0.18);

  const post = new RenderPipeline(renderer);
  post.outputNode = scenePass.add(bloomPass).mul(vignette);

  return {
    render() {
      post.render();
    },
  };
}
