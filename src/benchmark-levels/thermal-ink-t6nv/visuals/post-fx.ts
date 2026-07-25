import { float, mix, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Uniforms driven by runtime state each frame:
// - irUniform: 0.0 (normal sodium-harbor murk) -> 1.0 (stark thermal charcoal display)
// - inkUniform: 0.0 (clear) -> 1.0 (dense ink cloud obscurity)
export const irUniform = uniform(0);
export const inkUniform = uniform(0);

export function composeThermalInkOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Subtle water / air shimmer wobble
  const shimmer = vec2(
    screenUV.y.mul(24.0).add(time.mul(3.5)).sin(),
    screenUV.x.mul(18.0).add(time.mul(2.8)).sin(),
  ).mul(float(0.0015));

  const sampledScene = sceneTexture.sample(screenUV.add(shimmer));

  // Combine scene + bloom
  const normalColor = sampledScene.add(bloomPass);

  // Apply ink cloud blackout in normal vision (dims screen, hides distant details)
  const inkDarken = float(1.0).sub(inkUniform.mul(float(0.85)));
  const normalSight = normalColor.mul(inkDarken);

  // Compute thermal infrared representation:
  // 1. Convert rgb to luminance for charcoal background
  const luma = normalSight.x.mul(0.299).add(normalSight.y.mul(0.587)).add(normalSight.x.mul(0.114));
  const charcoalBase = vec3(luma.mul(0.25), luma.mul(0.28), luma.mul(0.32));

  // 2. High-brightness elements (> 1.2) blaze as white-hot thermal silhouettes
  const isWhiteHot = normalColor.x.max(normalColor.y).max(normalColor.z).sub(1.1).max(0.0);
  const whiteHotGlow = vec3(1.2, 1.3, 1.4).mul(isWhiteHot.mul(2.5));

  // 3. Red-dominant emissives burn as red signal cores
  const redSignal = normalColor.x.sub(normalColor.y.add(normalColor.z).mul(0.5)).max(0.0);
  const redCoreGlow = vec3(2.5, 0.08, 0.12).mul(redSignal.mul(3.0));

  // 4. Subtle thermal scanline raster effect
  const scanline = screenUV.y.mul(360.0).sin().mul(0.04).add(1.0);
  const thermalColor = charcoalBase.add(whiteHotGlow).add(redCoreGlow).mul(scanline);

  // Cold black ink mask in thermal mode (ink stays pure cold black)
  const thermalWithInk = mix(thermalColor, vec3(0.02, 0.02, 0.03), inkUniform.mul(0.9));

  // Smoothly blend between Normal Vision and Infrared Thermal Vision
  const finalRgb = mix(normalSight.xyz, thermalWithInk, irUniform.clamp(0.0, 1.0));

  return vec4(finalRgb, float(1.0));
}
