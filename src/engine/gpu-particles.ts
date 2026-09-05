import { AdditiveBlending, Color, Mesh, Sprite, Vector3, Vector4 } from 'three';
import type { BufferGeometry, ColorRepresentation, Object3D, SpriteMaterial } from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import type { ComputeNode, Node, NodeMaterial, UniformNode, WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  float,
  hash,
  instanceIndex,
  instancedArray,
  int,
  mix,
  positionLocal,
  select,
  smoothstep,
  uint,
  uniform,
  uniformArray,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { curlNoise } from 'three/addons/tsl/math/curlNoise.js';

/**
 * GPU particle system: one scene object, one draw call, any particle count.
 *
 * Three storage buffers hold the particles (`instancedArray`, one vec4 each):
 * position + age, velocity + life, color + size. A particle whose life is 0 is
 * dead. Two compute kernels run over every slot each frame:
 *
 * - spawn: `emit()` claims a window of slots from a ring cursor and queues a
 *   request; the kernel re-initializes every slot inside a queued window from
 *   the level's `spawn` function (or the built-in cone emitter);
 * - update: every live slot ages, then the level's `simulate` function (or the
 *   built-in forces: gravity, drag, attractor, curl-noise turbulence) moves it.
 *
 * Both kernels read and write only their own slot, so they run under three's
 * WebGL2 transform-feedback fallback as well as on WebGPU. Rendering reads the
 * same buffers as instanced vertex attributes, one sprite or one instance of the
 * supplied geometry per slot; dead slots collapse to zero size.
 *
 * The level calls `update(dt)` once per frame before the renderer draws. When the
 * renderer refuses a compute dispatch, the system hides its object and reports
 * `status().computeAvailable === false` instead of throwing.
 */

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;

export interface GpuParticleSpawnInput {
  /** Slot index of the particle being spawned. */
  index: Node<'uint'>;
  /** 0 for the first particle of the batch, approaching 1 for the last. */
  batchFraction: FloatNode;
  /** Pseudo-random float in [0, 1). Different `salt` values give independent streams. */
  random: (salt: number) => FloatNode;
  /** Pseudo-random unit vector. Different `salt` values give independent vectors. */
  randomDirection: (salt: number) => Vec3Node;
  /** Fields of the `emit()` request that claimed this slot. */
  origin: Vec3Node;
  direction: Vec3Node;
  speed: FloatNode;
  spread: FloatNode;
  life: FloatNode;
  size: FloatNode;
  jitter: FloatNode;
  color: Vec3Node;
  custom: Vec4Node;
  /** Seconds accumulated over `update()` calls. */
  time: FloatNode;
}

export interface GpuParticleSpawnResult {
  position: Vec3Node;
  velocity: Vec3Node;
  life: FloatNode;
  color: Vec3Node;
  size: FloatNode;
}

export interface GpuParticleSimulateInput {
  index: Node<'uint'>;
  position: Vec3Node;
  velocity: Vec3Node;
  age: FloatNode;
  life: FloatNode;
  /** age / life, 0 at spawn, 1 at death. */
  lifeFraction: FloatNode;
  /** Stable per-slot random in [0, 1). */
  seed: FloatNode;
  color: Vec3Node;
  size: FloatNode;
  dt: FloatNode;
  time: FloatNode;
}

export interface GpuParticleSimulateResult {
  velocity: Vec3Node;
  /** Defaults to `position + velocity * dt` using the returned velocity. */
  position?: Vec3Node;
}

export interface GpuParticleShadeInput {
  color: Vec3Node;
  size: FloatNode;
  lifeFraction: FloatNode;
  velocity: Vec3Node;
  /** Sprite-local uv in [0, 1]; for `mesh` particles this is the geometry uv. */
  uv: Node<'vec2'>;
}

export interface GpuParticleForcesConfig {
  /** Constant acceleration in world units per second squared. */
  gravity?: Vector3;
  /** Velocity decay per second: velocity scales by exp(-drag * dt). */
  drag?: number;
  /** Pull toward a point. Magnitude is `strength` inside `radius` and falls off as the inverse square beyond it. */
  attractor?: { position: Vector3; strength: number; radius?: number };
  /** Curl-noise acceleration. Compiled into the kernel only when this field is present. */
  turbulence?: { strength: number; scale: number; drift?: number };
}

export interface GpuParticleForces {
  gravity: UniformNode<'vec3', Vector3>;
  drag: UniformNode<'float', number>;
  attractorPosition: UniformNode<'vec3', Vector3>;
  attractorStrength: UniformNode<'float', number>;
  attractorRadius: UniformNode<'float', number>;
  turbulenceStrength: UniformNode<'float', number>;
  turbulenceScale: UniformNode<'float', number>;
  turbulenceDrift: UniformNode<'float', number>;
}

export interface GpuParticlesOptions {
  /** Slot count. `emit()` beyond it recycles the oldest slots. */
  capacity: number;
  /** `sprite` draws a camera-facing quad per slot; `mesh` draws one instance of `geometry` per slot. */
  material?: 'sprite' | 'mesh';
  /** Required for `material: 'mesh'`. The system does not dispose it. */
  geometry?: BufferGeometry;
  /** Material for `mesh` particles. Its `positionNode` and `colorNode` are filled in when unset. */
  meshMaterial?: NodeMaterial;
  /** Built-in force uniforms used by the default simulate function. */
  forces?: GpuParticleForcesConfig;
  /** Replaces the built-in cone emitter. */
  spawn?: (input: GpuParticleSpawnInput) => GpuParticleSpawnResult;
  /** Replaces the built-in force integration. Runs only for live particles. */
  simulate?: (input: GpuParticleSimulateInput) => GpuParticleSimulateResult;
  /** Fragment color with alpha. Default: stored color, soft disc for sprites, fading in and out over life. */
  colorOverLife?: (input: GpuParticleShadeInput) => Vec4Node;
  /** World-unit size used at render time. Default: the stored size. */
  sizeOverLife?: (input: { size: FloatNode; lifeFraction: FloatNode }) => FloatNode;
  /** Sprites default to additive blending without depth writes; `false` keeps normal blending. */
  additive?: boolean;
  /** Whether `scene.fogNode` applies. Defaults to false so additive effects are not fogged. */
  fog?: boolean;
}

export interface GpuParticleEmitParams {
  direction?: Vector3;
  /** World units per second. */
  speed?: number;
  /** 0 emits along `direction`; 1 emits in every direction. */
  spread?: number;
  /** Seconds. */
  life?: number;
  /** World units (sprite width, or mesh scale). */
  size?: number;
  /** Fraction of random variation applied to speed, life, and size. */
  jitter?: number;
  color?: ColorRepresentation;
  /** Four free floats handed to a custom `spawn` function. */
  custom?: [number, number, number, number];
}

export interface GpuParticleStatus {
  backend: 'webgpu' | 'webgl' | 'unknown';
  computeAvailable: boolean;
  capacity: number;
  /** Next slot the ring cursor will hand out. */
  cursor: number;
  /** Emit requests waiting for a later frame because this frame's request slots were full. */
  queued: number;
}

export interface GpuParticles {
  /** Add this to the scene. Particles live in its local space. */
  object: Object3D;
  /** Queue `count` particles at `position`. Runs on the next `update()`. */
  emit(position: Vector3, count: number, params?: GpuParticleEmitParams): void;
  /** Steps the simulation by `dt` seconds. Call once per frame before rendering. */
  update(dt: number): void;
  /** Kills every particle and drops queued requests. */
  reset(): void;
  status(): GpuParticleStatus;
  /** Live uniforms behind the default simulate function. Unused when `simulate` is supplied. */
  forces: GpuParticleForces;
  /** Per-slot attribute reads for a custom material: valid in vertex and fragment stages. */
  attributes: {
    position: Vec3Node;
    velocity: Vec3Node;
    age: FloatNode;
    life: FloatNode;
    lifeFraction: FloatNode;
    alive: FloatNode;
    color: Vec3Node;
    size: FloatNode;
  };
  dispose(): void;
}

/* Emit requests are packed into a uniform array of vec4s, this many per request:
   [origin.xyz, start], [direction.xyz, count], [speed, spread, life, size],
   [color.rgb, jitter], [custom]. */
const REQUEST_STRIDE = 5;
const MAX_REQUESTS_PER_FRAME = 16;
const DEFAULT_SPEED = 6;
const DEFAULT_SPREAD = 1;
const DEFAULT_LIFE = 1.5;
const DEFAULT_SIZE = 0.3;
const DEFAULT_JITTER = 0.3;
const DEFAULT_COLOR = 0xffffff;
const DEFAULT_ATTRACTOR_RADIUS = 1;
const FADE_IN_END = 0.08;
const FADE_OUT_START = 0.55;
const SPRITE_DISC_INNER = 0.3;
const SPRITE_DISC_OUTER = 0.5;
const SALT_STRIDE = 7919;
const SEED_SALT = 104729;
const TINY = 1e-5;

export function createGpuParticles(renderer: WebGPURenderer, options: GpuParticlesOptions): GpuParticles {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const mode = options.material ?? 'sprite';
  if (mode === 'mesh' && !options.geometry) throw new Error('createGpuParticles: material "mesh" needs a geometry');

  const positionAge = instancedArray(capacity, 'vec4');
  const velocityLife = instancedArray(capacity, 'vec4');
  const colorSize = instancedArray(capacity, 'vec4');

  const dtUniform = uniform(0);
  const timeUniform = uniform(0);
  const frameSeed = uniform(0, 'uint');
  const requestCount = uniform(0, 'uint');
  const requestArray = Array.from({ length: MAX_REQUESTS_PER_FRAME * REQUEST_STRIDE }, () => new Vector4());
  const requests = uniformArray<'vec4'>(requestArray, 'vec4');

  const forcesConfig = options.forces ?? {};
  const forces: GpuParticleForces = {
    gravity: uniform((forcesConfig.gravity ?? new Vector3()).clone()),
    drag: uniform(forcesConfig.drag ?? 0),
    attractorPosition: uniform((forcesConfig.attractor?.position ?? new Vector3()).clone()),
    attractorStrength: uniform(forcesConfig.attractor?.strength ?? 0),
    attractorRadius: uniform(forcesConfig.attractor?.radius ?? DEFAULT_ATTRACTOR_RADIUS),
    turbulenceStrength: uniform(forcesConfig.turbulence?.strength ?? 0),
    turbulenceScale: uniform(forcesConfig.turbulence?.scale ?? 1),
    turbulenceDrift: uniform(forcesConfig.turbulence?.drift ?? 0),
  };
  const turbulenceCompiled = forcesConfig.turbulence !== undefined;

  const spawnFn = options.spawn ?? defaultSpawn;
  const simulateFn = options.simulate ?? ((input: GpuParticleSimulateInput) => defaultSimulate(input, forces, turbulenceCompiled));

  function randomFor(index: Node<'uint'>, salt: number, extra: Node<'uint'>) {
    return hash(index.add(uint(salt * SALT_STRIDE)).add(extra));
  }

  const spawnKernel = Fn(() => {
    const index = instanceIndex;
    const slot = int(index);
    const p = positionAge.element(index).toVar();
    const v = velocityLife.element(index).toVar();
    const c = colorSize.element(index).toVar();

    Loop({ start: uint(0), end: requestCount, type: 'uint' }, ({ i }) => {
      const base = i.mul(REQUEST_STRIDE);
      const a = requests.element(base);
      const b = requests.element(base.add(1));
      const params = requests.element(base.add(2));
      const tint = requests.element(base.add(3));
      const custom = requests.element(base.add(4));
      const count = int(b.w);
      const offset = slot.sub(int(a.w)).toVar();
      If(offset.lessThan(0), () => {
        offset.addAssign(capacity);
      });
      If(offset.lessThan(count), () => {
        const salt = frameSeed.add(i.mul(SALT_STRIDE));
        const random = (s: number) => randomFor(index, s, salt);
        const result = spawnFn({
          index,
          batchFraction: float(offset).div(float(count).max(1)),
          random,
          randomDirection: (s: number) => randomUnitVector(random(s), random(s + 1)),
          origin: a.xyz,
          direction: b.xyz,
          speed: params.x,
          spread: params.y,
          life: params.z,
          size: params.w,
          jitter: tint.w,
          color: tint.xyz,
          custom,
          time: timeUniform,
        });
        p.assign(vec4(result.position, 0));
        v.assign(vec4(result.velocity, result.life));
        c.assign(vec4(result.color, result.size));
      });
    });

    positionAge.element(index).assign(p);
    velocityLife.element(index).assign(v);
    colorSize.element(index).assign(c);
  })().compute(capacity);

  const updateKernel = Fn(() => {
    const index = instanceIndex;
    const p = positionAge.element(index).toVar();
    const v = velocityLife.element(index).toVar();
    const c = colorSize.element(index);
    const life = v.w;

    If(life.greaterThan(0), () => {
      const age = p.w.add(dtUniform).toVar();
      If(age.greaterThanEqual(life), () => {
        v.assign(vec4(v.xyz, 0));
        p.assign(vec4(p.xyz, age));
      }).Else(() => {
        const result = simulateFn({
          index,
          position: p.xyz,
          velocity: v.xyz,
          age,
          life,
          lifeFraction: age.div(life),
          seed: hash(index.add(uint(SEED_SALT))),
          color: c.xyz,
          size: c.w,
          dt: dtUniform,
          time: timeUniform,
        });
        const velocity = result.velocity;
        const position = result.position ?? p.xyz.add(velocity.mul(dtUniform));
        p.assign(vec4(position, age));
        v.assign(vec4(velocity, life));
      });
    });

    positionAge.element(index).assign(p);
    velocityLife.element(index).assign(v);
  })().compute(capacity);

  const resetKernel = Fn(() => {
    const index = instanceIndex;
    const v = velocityLife.element(index);
    velocityLife.element(index).assign(vec4(v.xyz, 0));
    positionAge.element(index).assign(vec4(0));
  })().compute(capacity);

  const positionAttribute = positionAge.toAttribute();
  const velocityAttribute = velocityLife.toAttribute();
  const colorAttribute = colorSize.toAttribute();
  const life = velocityAttribute.w;
  const age = positionAttribute.w;
  const alive = select(life.greaterThan(0), float(1), float(0));
  const lifeFraction = age.div(life.max(TINY)).clamp(0, 1);
  const attributes: GpuParticles['attributes'] = {
    position: positionAttribute.xyz,
    velocity: velocityAttribute.xyz,
    age,
    life,
    lifeFraction,
    alive,
    color: colorAttribute.xyz,
    size: colorAttribute.w,
  };

  const sizeOverLife = options.sizeOverLife ?? ((input: { size: FloatNode }) => input.size);
  const renderSize = sizeOverLife({ size: attributes.size, lifeFraction }).mul(alive);
  const shadeInput: GpuParticleShadeInput = {
    color: attributes.color,
    size: attributes.size,
    lifeFraction,
    velocity: attributes.velocity,
    uv: uv(),
  };
  const shade = options.colorOverLife ?? (mode === 'sprite' ? defaultSpriteShade : defaultMeshShade);

  let object: Sprite | Mesh;
  let material: NodeMaterial;
  if (mode === 'sprite') {
    const spriteMaterial = new SpriteNodeMaterial();
    spriteMaterial.positionNode = attributes.position;
    spriteMaterial.scaleNode = renderSize;
    spriteMaterial.colorNode = shade(shadeInput);
    material = spriteMaterial;
    const sprite = new Sprite(spriteMaterial as unknown as SpriteMaterial);
    sprite.count = capacity;
    object = sprite;
  } else {
    material = options.meshMaterial ?? new MeshBasicNodeMaterial();
    if (!material.positionNode) material.positionNode = positionLocal.mul(renderSize).add(attributes.position);
    if (!material.colorNode) material.colorNode = shade(shadeInput);
    const mesh = new Mesh(options.geometry, material);
    mesh.count = capacity;
    object = mesh;
  }
  material.transparent = true;
  material.depthWrite = false;
  material.fog = options.fog ?? false;
  if (options.additive !== false) material.blending = AdditiveBlending;
  object.frustumCulled = false;
  object.name = 'gpu-particles';

  let cursor = 0;
  let computeAvailable = true;
  let disposed = false;
  let frame = 0;
  const pending: PendingRequest[] = [];

  function dispatch(kernel: ComputeNode) {
    if (!computeAvailable || disposed) return false;
    if (!renderer.initialized) return false;
    try {
      renderer.compute(kernel);
      return true;
    } catch (error) {
      computeAvailable = false;
      object.visible = false;
      console.warn('gpu-particles: compute is unavailable on this renderer; particles disabled.', error);
      return false;
    }
  }

  function flushRequests() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, MAX_REQUESTS_PER_FRAME);
    batch.forEach((request, i) => {
      const base = i * REQUEST_STRIDE;
      requestArray[base].set(request.origin.x, request.origin.y, request.origin.z, request.start);
      requestArray[base + 1].set(request.direction.x, request.direction.y, request.direction.z, request.count);
      requestArray[base + 2].set(request.speed, request.spread, request.life, request.size);
      requestArray[base + 3].set(request.color.r, request.color.g, request.color.b, request.jitter);
      requestArray[base + 4].copy(request.custom);
    });
    requestCount.value = batch.length;
    frameSeed.value = Math.imul(frame, 2654435761) >>> 0;
    if (!dispatch(spawnKernel)) pending.unshift(...batch);
  }

  return {
    object,
    forces,
    attributes,
    emit(position, count, params = {}) {
      if (disposed) return;
      const claimed = Math.min(capacity, Math.max(0, Math.floor(count)));
      if (claimed === 0) return;
      const direction = (params.direction ?? new Vector3(0, 1, 0)).clone();
      if (direction.lengthSq() < TINY) direction.set(0, 1, 0);
      direction.normalize();
      pending.push({
        origin: position.clone(),
        start: cursor,
        count: claimed,
        direction,
        speed: params.speed ?? DEFAULT_SPEED,
        spread: params.spread ?? DEFAULT_SPREAD,
        life: params.life ?? DEFAULT_LIFE,
        size: params.size ?? DEFAULT_SIZE,
        jitter: params.jitter ?? DEFAULT_JITTER,
        color: new Color(params.color ?? DEFAULT_COLOR),
        custom: params.custom ? new Vector4(...params.custom) : new Vector4(),
      });
      cursor = (cursor + claimed) % capacity;
    },
    update(dt) {
      if (disposed) return;
      frame += 1;
      dtUniform.value = Math.max(0, dt);
      timeUniform.value += Math.max(0, dt);
      flushRequests();
      dispatch(updateKernel);
    },
    reset() {
      pending.length = 0;
      cursor = 0;
      timeUniform.value = 0;
      dispatch(resetKernel);
    },
    status() {
      return {
        backend: readBackend(renderer),
        computeAvailable,
        capacity,
        cursor,
        queued: pending.length,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending.length = 0;
      object.removeFromParent();
      material.dispose();
      for (const node of [positionAge, velocityLife, colorSize]) destroyStorage(renderer, node.value);
    },
  };
}

type PendingRequest = {
  origin: Vector3;
  start: number;
  count: number;
  direction: Vector3;
  speed: number;
  spread: number;
  life: number;
  size: number;
  jitter: number;
  color: Color;
  custom: Vector4;
};

/** Uniform random unit vector from two uniform samples. */
function randomUnitVector(u: FloatNode, v: FloatNode): Vec3Node {
  const z = u.mul(2).sub(1);
  const radius = z.mul(z).oneMinus().max(0).sqrt();
  const angle = v.mul(Math.PI * 2);
  return vec3(radius.mul(angle.cos()), radius.mul(angle.sin()), z);
}

/** Cone emitter: `direction` blended toward a random direction by `spread`, with jittered speed, life, and size. */
function defaultSpawn(input: GpuParticleSpawnInput): GpuParticleSpawnResult {
  const scatter = input.randomDirection(1);
  const direction = mix(input.direction, scatter, input.spread).normalize();
  const jitterFor = (salt: number) => input.random(salt).mul(2).sub(1).mul(input.jitter).add(1);
  return {
    position: input.origin,
    velocity: direction.mul(input.speed.mul(jitterFor(3))),
    life: input.life.mul(jitterFor(4)).max(TINY),
    color: input.color,
    size: input.size.mul(jitterFor(5)),
  };
}

function defaultSimulate(input: GpuParticleSimulateInput, forces: GpuParticleForces, turbulence: boolean): GpuParticleSimulateResult {
  const { position, dt } = input;
  let acceleration: Vec3Node = forces.gravity;

  const toAttractor = forces.attractorPosition.sub(position);
  const distanceSq = toAttractor.dot(toAttractor);
  const radiusSq = forces.attractorRadius.mul(forces.attractorRadius);
  const pull = forces.attractorStrength.mul(radiusSq).div(distanceSq.add(radiusSq));
  const attractorDirection = toAttractor.div(distanceSq.add(TINY).sqrt());
  acceleration = acceleration.add(attractorDirection.mul(pull));

  if (turbulence) {
    const sample = position.mul(forces.turbulenceScale).add(vec3(0, input.time.mul(forces.turbulenceDrift), 0));
    acceleration = acceleration.add(curlNoise(sample).mul(forces.turbulenceStrength));
  }

  const velocity = input.velocity.add(acceleration.mul(dt)).mul(forces.drag.mul(dt).negate().exp());
  return { velocity };
}

function lifeFade(lifeFraction: FloatNode): FloatNode {
  return smoothstep(0, FADE_IN_END, lifeFraction).mul(smoothstep(FADE_OUT_START, 1, lifeFraction).oneMinus());
}

function defaultSpriteShade(input: GpuParticleShadeInput): Vec4Node {
  const radial = input.uv.sub(0.5).length();
  const disc = smoothstep(SPRITE_DISC_INNER, SPRITE_DISC_OUTER, radial).oneMinus();
  return vec4(input.color, disc.mul(lifeFade(input.lifeFraction)));
}

function defaultMeshShade(input: GpuParticleShadeInput): Vec4Node {
  return vec4(input.color, lifeFade(input.lifeFraction));
}

function readBackend(renderer: WebGPURenderer): GpuParticleStatus['backend'] {
  const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean } }).backend;
  if (backend?.isWebGPUBackend) return 'webgpu';
  if (backend?.isWebGLBackend) return 'webgl';
  return 'unknown';
}

/* Storage attributes are not owned by a geometry, so nothing disposes their GPU
   buffers when the geometry goes away. The renderer's attribute cache does. */
function destroyStorage(renderer: WebGPURenderer, attribute: unknown) {
  const attributes = (renderer as unknown as { _attributes?: { delete(value: unknown): unknown } })._attributes;
  try {
    attributes?.delete(attribute);
  } catch {
    /* A buffer the renderer never uploaded has nothing to free. */
  }
}
