import { Color, Matrix4, Mesh, PlaneGeometry, Vector2, Vector3, type Camera, type DirectionalLight, type Object3D, type PointLight, type Scene } from 'three';
import { MeshStandardNodeMaterial, type Node, type PassNode, type TextureNode, type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { convertToTexture, float, int, max, mix, uniform, vec3, vec4 } from 'three/tsl';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { radialBlur } from 'three/addons/tsl/display/radialBlur.js';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import type { LevelPostColorNode } from './types';

/* Declarative post stages. `createPost` in ./post.ts builds each entry of
   `LevelPostConfig.stages` in order, after the level's composeOutput hook and
   before the vignette. Every stage wraps one node from three/addons/tsl/display.

   A numeric parameter becomes an engine-owned uniform, exposed on the post handle
   under the stage name. A node parameter, usually a uniform the level owns at
   module scope, is used as is, so the level runtime can write it every frame. */

export type PostStageValue = number | Node;
export type PostStageVec2 = { x: number; y: number } | Node;
/** A hex number is an sRGB color. A triple is linear RGB and may exceed 1. */
export type PostStageColor = number | [number, number, number] | Node;

type PostStageBase = {
  /** Key of this stage's uniforms on the post handle. Defaults to the stage type. */
  name?: string;
};

export type ChromaticAberrationStageConfig = PostStageBase & {
  type: 'chromaticAberration';
  /** Fringe amount. 0 is off. 1 separates the channels by about 2 percent of the frame at the edge. Default 0.4. */
  strength?: PostStageValue;
  /** Screen UV the fringe radiates from. Default screen center. */
  center?: PostStageVec2;
  /** Per-channel scale step, multiplied by strength. Default 1.1. */
  scale?: PostStageValue;
};

export type FilmStageConfig = PostStageBase & {
  type: 'film';
  /** Grain mix, 0 to 1. Default 0.25. */
  intensity?: PostStageValue;
};

export type LensflareStageConfig = PostStageBase & {
  type: 'lensflare';
  /** Texture the ghosts are cut from. 'bloom' follows the player's bloom slider. Default 'bloom'. */
  source?: 'bloom' | 'scene';
  /** Multiplier on the ghost color added to the frame. Default 1. */
  strength?: PostStageValue;
  /** Brightness a source pixel must exceed to produce ghosts. Default 0.5. */
  threshold?: PostStageValue;
  /** Ghost tint. Default white. */
  tint?: PostStageColor;
  /** Ghosts per bright spot, mirrored through the screen center. Default 4. */
  ghostSamples?: number;
  /** Distance between ghosts in screen UV. Default 0.25. */
  ghostSpacing?: PostStageValue;
  /** Falloff exponent toward the frame edge. Default 25. */
  ghostAttenuation?: PostStageValue;
  /** The ghost target is the frame divided by this. Default 4. */
  downSampleRatio?: number;
};

export type AfterImageStageConfig = PostStageBase & {
  type: 'afterImage';
  /** Fraction of the previous frame kept, 0 to 1. Default 0.9. */
  damp?: PostStageValue;
};

export type RgbShiftStageConfig = PostStageBase & {
  type: 'rgbShift';
  /** Channel offset in screen UV. Default 0.005. */
  amount?: PostStageValue;
  /** Offset direction in radians. Default 0. */
  angle?: PostStageValue;
};

export type RadialBlurStageConfig = PostStageBase & {
  type: 'radialBlur';
  /** Without threshold: mix between the frame and its blur, 0 to 1. With threshold: multiplier on the added shafts. Default 1. */
  amount?: PostStageValue;
  /** Screen UV the blur radiates from. Default screen center. Ignored when lightName is set. */
  center?: PostStageVec2;
  /** Name of a scene object whose projected position becomes the center each frame. The stage fades out while the object is off screen or behind the camera. */
  lightName?: string;
  /** When set, only color above this value is blurred and the blur is added to the frame as light shafts. */
  threshold?: PostStageValue;
  /** Blur taps, 16 to 64. Default 32. */
  count?: number;
  /** Per-tap weight decay, 0 to 1. Default 0.95. */
  decay?: number;
  /** First tap weight, 0 to 1. Default 0.9. */
  weight?: number;
  /** Brightness multiplier on the blur. Default 5. */
  exposure?: number;
};

export type GodraysStageConfig = PostStageBase & {
  type: 'godrays';
  /** Name of a DirectionalLight or PointLight in the scene. The stage sets castShadow on it and turns the renderer's shadow maps on. */
  lightName: string;
  /** Color the rays blend toward. Default white. */
  color?: PostStageColor;
  /** Multiplier on color. Default 1. */
  intensity?: PostStageValue;
  /** Accumulation rate per unit marched. Default 0.7. */
  density?: PostStageValue;
  /** Cap on ray brightness, 0 to 1. Default 0.5. */
  maxDensity?: PostStageValue;
  /** Falloff exponent with distance from the light. Default 2. */
  distanceAttenuation?: PostStageValue;
  /** Raymarch steps per pixel. Default 60. */
  raymarchSteps?: number;
  /** Ray target size as a fraction of the frame. Default 0.5. */
  resolutionScale?: number;
  /** Bilateral blur over the ray texture before compositing. Default true. */
  blur?: boolean;
};

export type PostStageConfig =
  | ChromaticAberrationStageConfig
  | FilmStageConfig
  | LensflareStageConfig
  | AfterImageStageConfig
  | RgbShiftStageConfig
  | RadialBlurStageConfig
  | GodraysStageConfig;

export type PostStageUniform = UniformNode<'float', number> | UniformNode<'vec2', Vector2> | UniformNode<'vec3', Vector3> | UniformNode<'color', Color>;

export type PostStageContext = {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: Camera;
  scenePass: PassNode;
  sceneColor: TextureNode;
  depth: TextureNode;
  bloomTexture: TextureNode;
};

export type BuiltPostStage = {
  name: string;
  output: LevelPostColorNode;
  uniforms: Record<string, PostStageUniform>;
  /** Runs once per frame before the pipeline renders, with the camera the scene pass uses. */
  update?: (camera: Camera) => void;
  /** Runs once, after every stage is built and before the first pipeline render. */
  warmUp?: () => void;
  dispose?: () => void;
};

const SHADOW_RECEIVER_NAME = 'post:shadow-receiver';
const RADIAL_FADE_START_NDC = 1.2;
const RADIAL_FADE_END_NDC = 1.8;

export function buildPostStage(config: PostStageConfig, input: LevelPostColorNode, context: PostStageContext): BuiltPostStage {
  switch (config.type) {
    case 'chromaticAberration': return buildChromaticAberration(config, input);
    case 'film': return buildFilm(config, input);
    case 'lensflare': return buildLensflare(config, input, context);
    case 'afterImage': return buildAfterImage(config, input);
    case 'rgbShift': return buildRgbShift(config, input);
    case 'radialBlur': return buildRadialBlur(config, input, context);
    case 'godrays': return buildGodrays(config, input, context);
  }
}

function buildChromaticAberration(config: ChromaticAberrationStageConfig, input: LevelPostColorNode): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const strength = floatParam(uniforms, 'strength', config.strength, 0.4);
  const scale = floatParam(uniforms, 'scale', config.scale, 1.1);
  const center = vec2Param(uniforms, 'center', config.center, 0.5, 0.5);
  return { name: config.name ?? config.type, uniforms, output: asColor(chromaticAberration(input, strength, center, scale)) };
}

function buildFilm(config: FilmStageConfig, input: LevelPostColorNode): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const intensity = floatParam(uniforms, 'intensity', config.intensity, 0.25);
  return { name: config.name ?? config.type, uniforms, output: asColor(film(input, intensity)) };
}

function buildLensflare(config: LensflareStageConfig, input: LevelPostColorNode, context: PostStageContext): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const strength = floatParam(uniforms, 'strength', config.strength, 1);
  const threshold = floatParam(uniforms, 'threshold', config.threshold, 0.5);
  const tint = colorParam(uniforms, 'tint', config.tint, [1, 1, 1]);
  const ghostSpacing = floatParam(uniforms, 'ghostSpacing', config.ghostSpacing, 0.25);
  const ghostAttenuation = floatParam(uniforms, 'ghostAttenuation', config.ghostAttenuation, 25);
  const source = config.source === 'scene' ? context.sceneColor : context.bloomTexture;
  const flare = lensflare(source, {
    ghostTint: tint,
    threshold,
    ghostSamples: float(config.ghostSamples ?? 4),
    ghostSpacing,
    ghostAttenuationFactor: ghostAttenuation,
    downSampleRatio: config.downSampleRatio ?? 4,
  });
  const output = input.add(vec4(asColor(flare).rgb.mul(strength), 0));
  return { name: config.name ?? config.type, uniforms, output, dispose: () => flare.dispose() };
}

function buildAfterImage(config: AfterImageStageConfig, input: LevelPostColorNode): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const damp = floatParam(uniforms, 'damp', config.damp, 0.9);
  const node = afterImage(input, damp);
  return { name: config.name ?? config.type, uniforms, output: asColor(node), dispose: () => node.dispose() };
}

function buildRgbShift(config: RgbShiftStageConfig, input: LevelPostColorNode): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const amount = floatParam(uniforms, 'amount', config.amount, 0.005);
  const angle = floatParam(uniforms, 'angle', config.angle, 0);
  const node = rgbShift(input);
  /* The node reads these two fields when it builds; replacing them routes the stage's parameters through them. */
  Object.assign(node, { amount, angle });
  return { name: config.name ?? config.type, uniforms, output: asColor(node), dispose: () => node.dispose() };
}

function buildRadialBlur(config: RadialBlurStageConfig, input: LevelPostColorNode, context: PostStageContext): BuiltPostStage {
  const uniforms: Record<string, PostStageUniform> = {};
  const amount = floatParam(uniforms, 'amount', config.amount, 1);
  const trackedLight = config.lightName ? requireObject(context.scene, config.lightName, 'radialBlur') : null;
  const center = trackedLight ? registerUniform(uniforms, 'center', uniform(new Vector2(0.5, 0.5))) : vec2Param(uniforms, 'center', config.center, 0.5, 0.5);
  /* 1 while the tracked object is on screen, fading to 0 past the frame edge and behind the camera. */
  const visible = uniform(1);
  const options = {
    center,
    count: int(config.count ?? 32),
    decay: float(config.decay ?? 0.95),
    weight: float(config.weight ?? 0.9),
    exposure: float(config.exposure ?? 5),
  };
  const frame = convertToTexture(input);
  let output: LevelPostColorNode;
  if (config.threshold === undefined) {
    output = asColor(mix(frame, asColor(radialBlur(frame, options)), amount.mul(visible)));
  } else {
    const threshold = floatParam(uniforms, 'threshold', config.threshold, 1);
    const bright = max(frame.rgb.sub(threshold), vec3(0));
    /* radialBlur returns the blur plus the unblurred source; subtracting the source leaves only the shafts. */
    const shafts = asColor(radialBlur(vec4(bright, 1), options)).rgb.sub(bright);
    output = asColor(frame.add(vec4(shafts.mul(amount.mul(visible)), 0)));
  }

  const worldPosition = new Vector3();
  const viewMatrix = new Matrix4();
  const update = trackedLight
    ? (camera: Camera) => {
      camera.updateMatrixWorld();
      viewMatrix.copy(camera.matrixWorld).invert();
      trackedLight.getWorldPosition(worldPosition).applyMatrix4(viewMatrix);
      if (worldPosition.z >= 0) {
        visible.value = 0;
        return;
      }
      worldPosition.applyMatrix4(camera.projectionMatrix);
      (center.value as Vector2).set(worldPosition.x * 0.5 + 0.5, 1 - (worldPosition.y * 0.5 + 0.5));
      const edge = Math.max(Math.abs(worldPosition.x), Math.abs(worldPosition.y));
      visible.value = 1 - smoothstep(RADIAL_FADE_START_NDC, RADIAL_FADE_END_NDC, edge);
    }
    : undefined;
  return { name: config.name ?? config.type, uniforms, output, update };
}

function buildGodrays(config: GodraysStageConfig, input: LevelPostColorNode, context: PostStageContext): BuiltPostStage {
  const { renderer, scene, camera } = context;
  const light = requireObject(scene, config.lightName, 'godrays') as Object3D & { isDirectionalLight?: boolean; isPointLight?: boolean };
  if (!light.isDirectionalLight && !light.isPointLight) {
    throw new Error(`Post stage godrays: scene object "${config.lightName}" is not a DirectionalLight or PointLight`);
  }
  const shadowLight = light as DirectionalLight | PointLight;
  shadowLight.castShadow = true;
  renderer.shadowMap.enabled = true;
  const receiver = ensureShadowReceiver(scene);

  const uniforms: Record<string, PostStageUniform> = {};
  const color = colorParam(uniforms, 'color', config.color, [1, 1, 1]);
  const intensity = floatParam(uniforms, 'intensity', config.intensity, 1);
  const node = godrays(context.depth, camera, shadowLight);
  node.resolutionScale = config.resolutionScale ?? 0.5;
  node.raymarchSteps.value = config.raymarchSteps ?? 60;
  /* The node reads these three fields when it builds; replacing them routes the stage's parameters through them. */
  Object.assign(node, {
    density: floatParam(uniforms, 'density', config.density, 0.7),
    maxDensity: floatParam(uniforms, 'maxDensity', config.maxDensity, 0.5),
    distanceAttenuation: floatParam(uniforms, 'distanceAttenuation', config.distanceAttenuation, 2),
  });
  const blurred = config.blur === false ? null : bilateralBlur(node.getTextureNode());
  const rays = blurred ? blurred.getTextureNode() : node.getTextureNode();
  const frame = convertToTexture(input);
  const output = depthAwareBlend(frame, rays, context.depth, camera, { blendColor: color.mul(intensity) });
  return {
    name: config.name ?? config.type,
    uniforms,
    output,
    /* The node reads the light's shadow map when it builds, and three allocates that map
       the first time a shadow-receiving material renders. One plain scene render does that. */
    warmUp: () => renderer.render(scene, camera),
    dispose: () => {
      node.dispose();
      blurred?.dispose();
      scene.remove(receiver);
      receiver.geometry.dispose();
      (receiver.material as MeshStandardNodeMaterial).dispose();
    },
  };
}

/* three renders a light's shadow map only while a lit, shadow-receiving object is drawn.
   This mesh writes no color and no depth; it exists so the map renders in a scene whose
   materials are all unlit. */
function ensureShadowReceiver(scene: Scene): Mesh {
  const existing = scene.getObjectByName(SHADOW_RECEIVER_NAME);
  if (existing) return existing as Mesh;
  const material = new MeshStandardNodeMaterial();
  material.colorWrite = false;
  material.depthWrite = false;
  material.depthTest = false;
  const mesh = new Mesh(new PlaneGeometry(0.01, 0.01), material);
  mesh.name = SHADOW_RECEIVER_NAME;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  scene.add(mesh);
  return mesh;
}

function requireObject(scene: Scene, name: string, stage: string): Object3D {
  const object = scene.getObjectByName(name);
  if (!object) throw new Error(`Post stage ${stage}: no scene object named "${name}". Add it to the scene inside createRuntime.`);
  return object;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && (value as { isNode?: boolean }).isNode === true;
}

function isUniformNode(node: Node): node is PostStageUniform {
  return (node as { isUniformNode?: boolean }).isUniformNode === true;
}

function registerUniform<T extends PostStageUniform>(bag: Record<string, PostStageUniform>, name: string, node: T): T {
  bag[name] = node;
  return node;
}

function floatParam(bag: Record<string, PostStageUniform>, name: string, value: PostStageValue | undefined, fallback: number) {
  if (isNode(value)) {
    if (isUniformNode(value)) bag[name] = value;
    return value as UniformNode<'float', number>;
  }
  return registerUniform(bag, name, uniform(value ?? fallback));
}

function vec2Param(bag: Record<string, PostStageUniform>, name: string, value: PostStageVec2 | undefined, x: number, y: number) {
  if (isNode(value)) {
    if (isUniformNode(value)) bag[name] = value;
    return value as UniformNode<'vec2', Vector2>;
  }
  return registerUniform(bag, name, uniform(new Vector2(value?.x ?? x, value?.y ?? y)));
}

function colorParam(bag: Record<string, PostStageUniform>, name: string, value: PostStageColor | undefined, fallback: [number, number, number]): Node<'vec3'> {
  if (isNode(value)) {
    if (isUniformNode(value)) bag[name] = value;
    return value as Node<'vec3'>;
  }
  /* A color uniform is a vec3 in the shader. */
  if (typeof value === 'number') return registerUniform(bag, name, uniform(new Color(value))) as unknown as Node<'vec3'>;
  const [r, g, b] = value ?? fallback;
  return registerUniform(bag, name, uniform(new Vector3(r, g, b)));
}

function asColor(node: Node): LevelPostColorNode {
  return node as LevelPostColorNode;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
