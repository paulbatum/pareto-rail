import { Matrix4 } from 'three';
import { RenderPipeline, WebGPURenderer, type UniformNode } from 'three/webgpu';
import { clamp, float, length, max, min, mix, pass, screenUV, smoothstep, step, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Camera, Scene } from 'three';
import type { LevelPostColorNode, LevelPostConfig, LevelPostUvNode } from './types';

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
const MOTION_BLUR_TAPS = 8;
const MOTION_BLUR_MAX_VELOCITY_UV = 0.045;
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

// Shared player preference for the engine-owned depth-reprojection blur. 1.0 is
// the intended shutter; 0 disables the effect. The uniform is sampled in post.
export const motionBlurLevelUniform = uniform(1);

export function setMotionBlurLevel(level: number) {
  motionBlurLevel = Math.min(1, Math.max(0, level));
  motionBlurLevelUniform.value = motionBlurLevel;
}

export function getMotionBlurLevel() {
  return motionBlurLevel;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, config: LevelPostConfig = {}) {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode();
  const clipToPreviousClipUniform = uniform(new Matrix4());
  const blurredScene = createDepthReprojectionMotionBlur(scenePass.getTextureNode(), scenePass.getTextureNode('depth'), clipToPreviousClipUniform);
  const baseStrength = config.bloom?.strength ?? DEFAULT_BLOOM_STRENGTH;
  const bloomPass = bloom(
    sceneColor,
    baseStrength * bloomLevel * BLOOM_UI_SCALE,
    config.bloom?.threshold ?? DEFAULT_BLOOM_THRESHOLD,
    config.bloom?.radius ?? DEFAULT_BLOOM_RADIUS,
  );
  bloomRefs.set(bloomPass, baseStrength);

  const post = new RenderPipeline(renderer);
  const base = blurredScene.add(bloomPass);
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

  const currentViewProjection = new Matrix4();
  const currentViewProjectionInverse = new Matrix4();
  const previousViewProjection = new Matrix4();
  const clipToPreviousClip = new Matrix4();
  const currentView = new Matrix4();
  let previousMatrixInitialized = false;

  function computeViewProjection(target: Matrix4) {
    camera.updateMatrixWorld();
    currentView.copy(camera.matrixWorld).invert();
    target.multiplyMatrices(camera.projectionMatrix, currentView);
  }

  function updateMotionBlurMatrix() {
    computeViewProjection(currentViewProjection);
    if (!previousMatrixInitialized) {
      previousViewProjection.copy(currentViewProjection);
      clipToPreviousClipUniform.value.identity();
      previousMatrixInitialized = true;
      return;
    }

    currentViewProjectionInverse.copy(currentViewProjection).invert();
    clipToPreviousClip.multiplyMatrices(previousViewProjection, currentViewProjectionInverse);
    clipToPreviousClipUniform.value.copy(clipToPreviousClip);
    previousViewProjection.copy(currentViewProjection);
  }

  return {
    render(options: { advanceMotionBlur?: boolean } = {}) {
      if (options.advanceMotionBlur !== false) updateMotionBlurMatrix();
      post.render();
    },
  };
}

function createDepthReprojectionMotionBlur(
  sceneTexture: { sample: (uv: LevelPostUvNode) => LevelPostColorNode },
  depthTexture: { sample: (uv: LevelPostUvNode) => LevelPostColorNode },
  clipToPreviousClipUniform: UniformNode<'mat4', Matrix4>,
) {
  const depth = depthTexture.sample(screenUV).r;
  const currentNdc = vec2(screenUV.x, screenUV.y.oneMinus()).mul(2).sub(1);
  const currentClip = vec4(vec3(currentNdc, depth), 1);
  const previousClip = clipToPreviousClipUniform.mul(currentClip);
  const previousNdc = previousClip.xy.div(previousClip.w);
  const previousUv = vec2(previousNdc.x.mul(0.5).add(0.5), previousNdc.y.mul(0.5).add(0.5).oneMinus());
  const rawVelocity = screenUV.sub(previousUv);
  const velocityLength = length(rawVelocity);
  const velocityScale = min(float(1), float(MOTION_BLUR_MAX_VELOCITY_UV).div(max(velocityLength, float(0.00001))));
  const velocity = rawVelocity.mul(velocityScale).mul(motionBlurLevelUniform);

  const tap1 = gatedTap(sceneTexture, screenUV, velocity, 1, 0.15);
  const tap2 = gatedTap(sceneTexture, screenUV, velocity, 2, 0.30);
  const tap3 = gatedTap(sceneTexture, screenUV, velocity, 3, 0.45);
  const tap4 = gatedTap(sceneTexture, screenUV, velocity, 4, 0.60);
  const tap5 = gatedTap(sceneTexture, screenUV, velocity, 5, 0.75);
  const tap6 = gatedTap(sceneTexture, screenUV, velocity, 6, 0.90);
  const tap7 = gatedTap(sceneTexture, screenUV, velocity, 7, 1.05);
  const tap8 = gatedTap(sceneTexture, screenUV, velocity, 8, 1.20);
  const weight = float(1)
    .add(tapGate(1))
    .add(tapGate(2))
    .add(tapGate(3))
    .add(tapGate(4))
    .add(tapGate(5))
    .add(tapGate(6))
    .add(tapGate(7))
    .add(tapGate(8));
  const sceneColor = sceneTexture.sample(screenUV);
  const blurredScene = sceneColor.add(tap1).add(tap2).add(tap3).add(tap4).add(tap5).add(tap6).add(tap7).add(tap8).div(weight);
  return mix(sceneColor, blurredScene, motionBlurLevelUniform);
}

function tapGate(index: number) {
  return step(float(index), float(MOTION_BLUR_TAPS));
}

function gatedTap(
  sceneTexture: { sample: (uv: LevelPostUvNode) => LevelPostColorNode },
  uv: LevelPostUvNode,
  velocity: LevelPostUvNode,
  index: number,
  offset: number,
) {
  const gate = tapGate(index);
  const sampleUv = clamp(uv.sub(velocity.mul(offset)), vec2(0), vec2(1));
  return sceneTexture.sample(sampleUv).mul(gate);
}
