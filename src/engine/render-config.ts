import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BasicShadowMap,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  PCFSoftShadowMap,
  VSMShadowMap,
  type ShadowMapType,
  type ToneMapping,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { LevelRenderConfig, LevelShadowMapType, LevelToneMapping } from './types';

const TONE_MAPPINGS: Record<LevelToneMapping, ToneMapping> = {
  none: NoToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

const SHADOW_MAP_TYPES: Record<LevelShadowMapType, ShadowMapType> = {
  basic: BasicShadowMap,
  pcf: PCFShadowMap,
  'pcf-soft': PCFSoftShadowMap,
  vsm: VSMShadowMap,
};

/* Every field is written on every call so a level that declares nothing gets the
   unlit emissive defaults back after an opted-in level released the renderer.
   Call before renderer.init(): shadow state has to be settled before the first frame.

   Tone mapping reaches the composed frame without extra wiring: RenderPipeline
   appends renderOutput(toneMapping, outputColorSpace) after our output node and
   rebuilds when renderer.toneMapping changes. So a level's composeOutput hook and
   the shared vignette both run on linear HDR color, ahead of the curve. */
export function applyRenderConfig(renderer: WebGPURenderer, config: LevelRenderConfig = {}) {
  renderer.toneMapping = TONE_MAPPINGS[config.toneMapping ?? 'none'];
  renderer.toneMappingExposure = config.exposure ?? 1;
  renderer.shadowMap.enabled = config.shadows !== undefined;
  renderer.shadowMap.type = SHADOW_MAP_TYPES[config.shadows?.type ?? 'pcf'];
}
