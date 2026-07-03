import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { float, pass, screenUV, smoothstep, vec2 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Camera, Scene } from 'three';

// Bloom is what turns flat neon colors into light. Threshold sits below the
// HDR values used on cores/edges so hot elements glow hard while the dark
// backdrop stays clean; a soft vignette pulls focus to the rail.
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const scenePass = pass(scene, camera);
  const bloomPass = bloom(scenePass, 1.15, 0.55, 0.18);
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
