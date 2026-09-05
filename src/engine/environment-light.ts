import { BackSide, Color, Mesh, Scene, SphereGeometry, Vector3 } from 'three';
import type { ColorRepresentation, RenderTarget, Texture } from 'three';
import { MeshBasicNodeMaterial, PMREMGenerator } from 'three/webgpu';
import type { Node, UniformNode, WebGPURenderer } from 'three/webgpu';
import { Fn, float, mix, pmremTexture, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';

/**
 * Image-based lighting from a procedural sky.
 *
 * `bakeEnvironment` renders a sky scene into a prefiltered cube map (PMREM) once
 * and exposes it as a `pmremTexture` node. `attach(scene)` assigns that node to
 * `scene.environmentNode`, which every `MeshStandardNodeMaterial` and
 * `MeshPhysicalNodeMaterial` reads for diffuse and specular reflections. Unlit
 * materials ignore it, so a level that mixes emissive props with lit props keeps
 * both.
 *
 * `createGradientSky` builds the sky scene: an inside-out sphere whose color is a
 * zenith-to-horizon-to-ground gradient plus a sun disc with a halo. Every knob is
 * a uniform; write `.value` and call `rebake()` to move the sun mid-level.
 *
 * Lit materials return HDR values above 1 where the sun reflects, so pair this with
 * `render: { toneMapping: 'agx' | 'neutral', exposure }` on the level definition.
 * The tone-mapping curve runs after the post chain, so bloom still sees linear
 * HDR color: a bloom threshold tuned for an unlit emissive level catches every
 * sunlit highlight under a curve, and usually needs raising.
 *
 * Call `bakeEnvironment` after `renderer.init()` has resolved. `createRuntime`
 * satisfies that; `PMREMGenerator.fromScene` throws before it.
 */

export interface EnvironmentBakeOptions {
  /** Blur radius in radians applied to the sky before prefiltering. 0 keeps the sun disc sharp. */
  sigma?: number;
  /** Cube face size of the PMREM in texels. */
  size?: number;
  /** Depth range of the internal cube camera; the sky sphere must fit inside `far`. */
  near?: number;
  far?: number;
  /** Cube camera position inside the sky scene. */
  position?: Vector3;
}

export interface EnvironmentLight {
  /** Assign to `scene.environmentNode`, or use `attach`. */
  node: Node<'vec3'>;
  /** The prefiltered cube map; also usable as `scene.environment` on a non-node consumer. */
  texture: Texture;
  /** Sets `scene.environmentNode`; the returned function restores what was there. */
  attach(scene: Scene): () => void;
  /** Renders the sky scene into the same PMREM target again. */
  rebake(): void;
  /** Frees the PMREM target and the generator. The sky scene is the caller's. */
  dispose(): void;
}

export interface GradientSkyConfig {
  zenith?: ColorRepresentation;
  horizon?: ColorRepresentation;
  ground?: ColorRepresentation;
  /** Width of the horizon band in world-space direction y; smaller is a sharper horizon line. */
  horizonWidth?: number;
  /** Multiplier on the gradient. Values above 1 are HDR and light lit materials harder. */
  skyIntensity?: number;
  /** Direction toward the sun; normalised on construction. */
  sunDirection?: Vector3;
  sunColor?: ColorRepresentation;
  /** HDR radiance of the sun disc. Lit metals reflect this value directly. */
  sunIntensity?: number;
  /** Angular radius of the sun disc in radians. */
  sunAngularRadius?: number;
  /** Angular radius of the halo around the sun in radians, and its peak strength relative to the disc. */
  haloAngularRadius?: number;
  haloIntensity?: number;
}

export interface GradientSkyUniforms {
  zenith: UniformNode<'color', Color>;
  horizon: UniformNode<'color', Color>;
  ground: UniformNode<'color', Color>;
  horizonWidth: UniformNode<'float', number>;
  skyIntensity: UniformNode<'float', number>;
  sunDirection: UniformNode<'vec3', Vector3>;
  sunColor: UniformNode<'color', Color>;
  sunIntensity: UniformNode<'float', number>;
  sunAngularRadius: UniformNode<'float', number>;
  haloAngularRadius: UniformNode<'float', number>;
  haloIntensity: UniformNode<'float', number>;
}

export interface GradientSky {
  /** Pass to `bakeEnvironment`. */
  scene: Scene;
  /** Live knobs; call `rebake()` after writing them. */
  uniforms: GradientSkyUniforms;
  /** Radiance for a world-space direction. Usable as `scene.backgroundNode` so the visible sky matches the lighting. */
  colorFor(direction: Node<'vec3'>): Node<'vec3'>;
  dispose(): void;
}

const DEFAULT_SIGMA = 0;
const DEFAULT_SIZE = 256;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 100;
const SKY_RADIUS = 50;
const SKY_SEGMENTS = 24;
const DEFAULT_ZENITH = 0x1c3f7a;
const DEFAULT_HORIZON = 0x9fb8d4;
const DEFAULT_GROUND = 0x2a2420;
const DEFAULT_HORIZON_WIDTH = 0.25;
const DEFAULT_SKY_INTENSITY = 1;
const DEFAULT_SUN_DIRECTION = new Vector3(0.4, 0.6, 0.5);
const DEFAULT_SUN_COLOR = 0xfff2d6;
const DEFAULT_SUN_INTENSITY = 40;
const DEFAULT_SUN_ANGULAR_RADIUS = 0.03;
const DEFAULT_HALO_ANGULAR_RADIUS = 0.35;
const DEFAULT_HALO_INTENSITY = 0.08;

export function bakeEnvironment(renderer: WebGPURenderer, buildSkyScene: () => Scene, options: EnvironmentBakeOptions = {}): EnvironmentLight {
  const sigma = options.sigma ?? DEFAULT_SIGMA;
  const size = options.size ?? DEFAULT_SIZE;
  const near = options.near ?? DEFAULT_NEAR;
  const far = options.far ?? DEFAULT_FAR;
  const position = options.position;
  const generator = new PMREMGenerator(renderer);
  const skyScene = buildSkyScene();

  const bake = (target: RenderTarget | null) => generator.fromScene(skyScene, sigma, near, far, { size, position, renderTarget: target });
  const target = bake(null);
  const node = pmremTexture(target.texture);
  let disposed = false;

  return {
    node,
    texture: target.texture,
    attach(scene: Scene) {
      const previous = scene.environmentNode ?? null;
      scene.environmentNode = node;
      return () => {
        scene.environmentNode = previous;
      };
    },
    rebake() {
      if (disposed) return;
      bake(target);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
      generator.dispose();
    },
  };
}

export function createGradientSky(config: GradientSkyConfig = {}): GradientSky {
  const uniforms: GradientSkyUniforms = {
    zenith: uniform(new Color(config.zenith ?? DEFAULT_ZENITH)),
    horizon: uniform(new Color(config.horizon ?? DEFAULT_HORIZON)),
    ground: uniform(new Color(config.ground ?? DEFAULT_GROUND)),
    horizonWidth: uniform(config.horizonWidth ?? DEFAULT_HORIZON_WIDTH),
    skyIntensity: uniform(config.skyIntensity ?? DEFAULT_SKY_INTENSITY),
    sunDirection: uniform((config.sunDirection ?? DEFAULT_SUN_DIRECTION).clone().normalize()),
    sunColor: uniform(new Color(config.sunColor ?? DEFAULT_SUN_COLOR)),
    sunIntensity: uniform(config.sunIntensity ?? DEFAULT_SUN_INTENSITY),
    sunAngularRadius: uniform(config.sunAngularRadius ?? DEFAULT_SUN_ANGULAR_RADIUS),
    haloAngularRadius: uniform(config.haloAngularRadius ?? DEFAULT_HALO_ANGULAR_RADIUS),
    haloIntensity: uniform(config.haloIntensity ?? DEFAULT_HALO_INTENSITY),
  };

  const colorFor = (direction: Node<'vec3'>): Node<'vec3'> => {
    const up = direction.y;
    const aboveHorizon = smoothstep(float(0), uniforms.horizonWidth, up);
    const belowHorizon = smoothstep(float(0), uniforms.horizonWidth, up.negate());
    const sky = mix(uniforms.horizon, uniforms.zenith, aboveHorizon);
    const gradient = mix(sky, uniforms.ground, belowHorizon).mul(uniforms.skyIntensity);

    const angle = direction.dot(uniforms.sunDirection).clamp(-1, 1).acos();
    const disc = smoothstep(uniforms.sunAngularRadius, uniforms.sunAngularRadius.mul(0.8), angle);
    const halo = smoothstep(uniforms.haloAngularRadius, float(0), angle).mul(uniforms.haloIntensity);
    const sun = uniforms.sunColor.mul(uniforms.sunIntensity).mul(disc.add(halo));
    return gradient.add(sun);
  };

  const sky = createSkyScene(colorFor);
  return { scene: sky.scene, uniforms, colorFor, dispose: sky.dispose };
}

/** A sky scene from any radiance node of world direction, for levels that write their own sky. */
export function createSkyScene(colorFor: (direction: Node<'vec3'>) => Node<'vec3'>): { scene: Scene; dispose(): void } {
  const material = new MeshBasicNodeMaterial({ side: BackSide });
  material.fog = false;
  material.colorNode = Fn(() => vec3(colorFor(positionWorld.normalize())))();
  const geometry = new SphereGeometry(SKY_RADIUS, SKY_SEGMENTS, SKY_SEGMENTS);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  return {
    scene,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
