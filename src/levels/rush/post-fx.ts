import { Matrix4, MathUtils } from 'three';
import { clamp, float, length, max, min, mix, step, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Camera } from 'three';
import type { LevelPostColorNode, LevelPostComposeInput, LevelPostUvNode } from '../../engine/types';
import { motionBlurLevelUniform } from '../../engine/post';
import { RUSH_TUNING } from './tuning';

const MAX_TAPS = 8;
const currentViewProjection = new Matrix4();
const currentViewProjectionInverse = new Matrix4();
const previousViewProjection = new Matrix4();
const clipToPreviousClip = new Matrix4();
const currentView = new Matrix4();
let previousMatrixInitialized = false;

export const rushClipToPreviousClipUniform = uniform(new Matrix4());
export const rushMotionBlurStrengthUniform = uniform(0);
export const rushMotionBlurTapCountUniform = uniform(RUSH_TUNING.motionBlur.tapCount);
export const rushMotionBlurMaxVelocityUniform = uniform(RUSH_TUNING.motionBlur.maxVelocityUv);
export const rushSurgeFlashUniform = uniform(0);

export function resetRushMotionBlur(camera: Camera) {
  computeViewProjection(camera, previousViewProjection);
  rushClipToPreviousClipUniform.value.identity();
  previousMatrixInitialized = true;
}

export function updateRushMotionBlur(camera: Camera, strength: number, options: { reset?: boolean } = {}) {
  // The caller applies the authored maxStrength cap before the player multiplier; only guard the mix range here.
  const safeStrength = MathUtils.clamp(strength, 0, 1);
  rushMotionBlurStrengthUniform.value = safeStrength;
  rushMotionBlurTapCountUniform.value = MathUtils.clamp(Math.round(RUSH_TUNING.motionBlur.tapCount), 1, MAX_TAPS);
  rushMotionBlurMaxVelocityUniform.value = MathUtils.clamp(RUSH_TUNING.motionBlur.maxVelocityUv, 0.001, 0.25);

  computeViewProjection(camera, currentViewProjection);
  if (!previousMatrixInitialized || options.reset === true) {
    previousViewProjection.copy(currentViewProjection);
    rushClipToPreviousClipUniform.value.identity();
    previousMatrixInitialized = true;
    return;
  }

  currentViewProjectionInverse.copy(currentViewProjection).invert();
  clipToPreviousClip.multiplyMatrices(previousViewProjection, currentViewProjectionInverse);
  rushClipToPreviousClipUniform.value.copy(clipToPreviousClip);
  previousViewProjection.copy(currentViewProjection);
}

export function kickRushSurgeFlash(value = RUSH_TUNING.motionBlur.surgePulse) {
  rushSurgeFlashUniform.value = Math.max(rushSurgeFlashUniform.value, Math.max(0, value));
}

export function decayRushPost(dt: number) {
  rushSurgeFlashUniform.value = Math.max(0, rushSurgeFlashUniform.value - dt * RUSH_TUNING.motionBlur.surgeDecay);
}

export function composeRushOutput({ scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();
  const depthTexture = scenePass.getTextureNode('depth');
  const depth = depthTexture.sample(screenUV).r;
  const currentNdc = vec2(screenUV.x, screenUV.y.oneMinus()).mul(2).sub(1);
  const currentClip = vec4(vec3(currentNdc, depth), 1);
  const previousClip = rushClipToPreviousClipUniform.mul(currentClip);
  const previousNdc = previousClip.xy.div(previousClip.w);
  const previousUv = vec2(previousNdc.x.mul(0.5).add(0.5), previousNdc.y.mul(0.5).add(0.5).oneMinus());
  // Player slider: 12.5% is the authored reference strength; the old 100% lands at 25% now.
  // Applied in-shader so slider changes are visible immediately, including while paused.
  const effectiveStrength = min(rushMotionBlurStrengthUniform.mul(motionBlurLevelUniform.div(0.125)), float(1));
  const rawVelocity = screenUV.sub(previousUv);
  const velocityLength = length(rawVelocity);
  const velocityScale = min(float(1), rushMotionBlurMaxVelocityUniform.div(max(velocityLength, float(0.00001))));
  const velocity = rawVelocity.mul(velocityScale).mul(effectiveStrength);

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
  const flash = vec4(0.95, 0.38, 0.08, 0).mul(rushSurgeFlashUniform.mul(0.22));
  return mix(sceneColor, blurredScene, effectiveStrength).add(bloomPass).add(flash);
}

function computeViewProjection(camera: Camera, target: Matrix4) {
  camera.updateMatrixWorld();
  currentView.copy(camera.matrixWorld).invert();
  target.multiplyMatrices(camera.projectionMatrix, currentView);
}

function tapGate(index: number) {
  return step(float(index), rushMotionBlurTapCountUniform);
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
