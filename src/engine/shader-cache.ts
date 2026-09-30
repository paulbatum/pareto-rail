import { Group, Mesh, Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { disposeObject3D } from './visual-kit';

/* Keeps compiled shaders alive for the life of the renderer.

   three reference-counts three caches: node builder states (WGSL generated from a
   material's node graph), shader programs, and render pipelines. When the last object
   using an entry is disposed, three evicts the entry. A level that disposes an enemy
   mesh on every kill and spawns the same kind again a bar later therefore rebuilds the
   node graph (about 10 ms of JavaScript) and compiles the pipeline again (a blocking
   driver compile, 20 to 100 ms) on every wave. Retaining the entries makes each shader
   a one-time cost.

   The caches are private renderer fields (`_nodes`, `_pipelines`) whose `Map`s three
   fills with `set` and then increments the entry's `usedTimes`. Wrapping `set` to add one
   extra use per entry keeps the count above zero, so three's own eviction branch never
   runs. The renderer still frees everything in `dispose()`. When a three upgrade changes
   these fields the hook warns once and does nothing, which restores today's behaviour. */

type CountedEntry = { usedTimes: number };

type RendererCaches = {
  _nodes?: { nodeBuilderCache?: Map<string, CountedEntry> };
  _pipelines?: {
    caches?: Map<string, CountedEntry>;
    programs?: Record<string, Map<string, CountedEntry>>;
  };
};

const RETAINED = Symbol('retained');

/**
 * Call after `renderer.init()` has resolved; the caches do not exist before it.
 * Returns true when every cache was found and wrapped.
 */
export function retainCompiledShaders(renderer: WebGPURenderer): boolean {
  const internals = renderer as unknown as RendererCaches;
  const maps = [
    internals._nodes?.nodeBuilderCache,
    internals._pipelines?.caches,
    ...Object.values(internals._pipelines?.programs ?? {}),
  ];
  if (maps.length < 3 || maps.some((map) => !(map instanceof Map))) {
    console.warn('retainCompiledShaders: the renderer does not expose the shader caches this hook expects; shaders will be evicted as usual.');
    return false;
  }
  for (const map of maps as Array<Map<string, CountedEntry> & { [RETAINED]?: boolean }>) {
    if (map[RETAINED]) continue;
    const set = map.set.bind(map);
    map.set = (key, entry) => {
      entry.usedTimes += 1;
      return set(key, entry);
    };
    map[RETAINED] = true;
  }
  return true;
}

export type ShaderWarmUp = {
  /** True once every mesh handed in has been drawn. */
  readonly done: boolean;
  /** Call once per frame before the render until `done`; keeps the group behind the camera. */
  update(camera: Camera): void;
  dispose(): void;
};

const WARM_UP_BEHIND_CAMERA = 2;
const WARM_UP_SCALE = 0.01;

/**
 * Draws `objects` once so their shaders compile before the run needs them, then hides
 * them. The objects go into a shrunken group that follows the camera two units behind it
 * with frustum culling off: the renderer draws them, the GPU clips every vertex, and no
 * pixel changes. The group stays in the scene, hidden, so the renderer keeps counting
 * the objects as users of their shaders and never evicts them. Build the objects with
 * the same factories the run uses: the renderer keys shaders on material settings,
 * geometry layout, and lights, so a copy built any other way warms a different shader.
 */
export function warmUpShaders(scene: Scene, objects: Object3D[]): ShaderWarmUp {
  const group = new Group();
  group.name = 'shader-warm-up';
  group.userData.raildIgnoreOcclusion = true;
  /* Shrunk so no full-size model reaches past the lens from two units behind it. Scale does not change the shader. */
  group.scale.setScalar(WARM_UP_SCALE);
  /* Draws count only after the first update: the post chain renders the scene once while it is
     built, before any update, through a plain pass whose shaders the run never uses again. */
  let armed = false;
  let pending = 0;
  for (const object of objects) {
    group.add(object);
    object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      pending += 1;
      const previous = mesh.onAfterRender;
      mesh.onAfterRender = (...args) => {
        previous.apply(mesh, args);
        if (!armed) return;
        mesh.onAfterRender = previous;
        pending -= 1;
        if (pending === 0) group.visible = false;
      };
    });
  }
  scene.add(group);
  const back = new Vector3();
  return {
    get done() {
      return pending === 0;
    },
    update(camera) {
      armed = true;
      if (pending === 0) return;
      camera.updateMatrixWorld();
      camera.getWorldDirection(back).multiplyScalar(-WARM_UP_BEHIND_CAMERA);
      camera.getWorldPosition(group.position).add(back);
      camera.getWorldQuaternion(group.quaternion);
    },
    dispose() {
      scene.remove(group);
      disposeObject3D(group);
    },
  };
}

type RenderPipelines = {
  updateForRender?: (renderObject: unknown) => void;
  getForRender?: (renderObject: unknown, promises: Promise<void>[] | null) => unknown;
};

/* Chrome on D3D12 compiles a burst of pipelines no faster than it compiles them two at a
   time, and simple ones up to twice as slowly. A burst also holds up the browser's own
   drawing, which freezes the whole page until it drains. */
const PIPELINE_COMPILES_IN_FLIGHT = 2;

export type BackgroundCompiles = {
  /**
   * Renders one frame through `render` with frustum culling off for every visible object
   * in `scene`, so the frame asks for every shader the scene can draw, not just the ones
   * in view. Those compile after anything an ordinary frame asks for. Resolves once
   * every shader asked for so far has compiled, and from then on the renderer compiles
   * on first draw again.
   */
  warmUp(scene: Scene, render: () => void): Promise<void>;
};

/**
 * Has the renderer compile each new render pipeline in the background, with the async
 * API `compileAsync` uses, until `warmUp` resolves. three skips drawing an object whose
 * pipeline is still compiling, so frames keep coming and each object appears once its
 * shader is ready. The default blocks instead: a frame that draws a new pipeline waits
 * for the driver to compile it, which for a level the shader caches have not seen is
 * seconds, and nothing reaches the screen meanwhile.
 *
 * The warm-up renders a real frame rather than calling `compileAsync`, because three
 * builds a shader from the renderer's render target and MRT at the time it builds, and
 * `compileAsync` builds after it yields, when the frames in between have moved both.
 *
 * Compiles are queued and run a couple at a time. `updateForRender` is the render path's
 * call into the private `_pipelines` cache. When a three upgrade changes that field the
 * hook warns once and does nothing, which restores compiling on first draw.
 */
export function compileInBackground(renderer: WebGPURenderer): BackgroundCompiles {
  const pipelines = (renderer as unknown as { _pipelines?: RenderPipelines })._pipelines;
  const { updateForRender, getForRender } = pipelines ?? {};
  const device = (renderer.backend as { device?: GPUDevice }).device;
  if (!pipelines || typeof updateForRender !== 'function' || typeof getForRender !== 'function' || !device) {
    console.warn('compileInBackground: the renderer does not expose the pipeline cache this hook expects; shaders will compile on first draw.');
    return {
      async warmUp(_scene, render) {
        render();
      },
    };
  }
  const pending: Promise<void>[] = [];
  const createAsync = device.createRenderPipelineAsync;
  type Compile = () => void;
  const inView: Compile[] = [];
  const outOfView: Compile[] = [];
  /* Warm-up compiles not started yet, by the pipeline they build, so a frame that comes to
     draw one can move it up. */
  const waiting = new Map<unknown, Compile>();
  let inFlight = 0;
  const next = () => {
    while (inFlight < PIPELINE_COMPILES_IN_FLIGHT) {
      const compile = inView.shift() ?? outOfView.shift();
      if (!compile) return;
      compile();
    }
  };
  /* three asks the device for a pipeline while it draws, so a request made during the
     warm-up frame comes from that frame. */
  let warmingUp = false;
  let requested: Compile | null = null;
  device.createRenderPipelineAsync = (descriptor) => {
    /* three reuses one descriptor object and clears it as soon as this call returns. Every
       field it clears is replaced rather than mutated, except the multisample state. */
    const copy = { ...descriptor, multisample: descriptor.multisample && { ...descriptor.multisample } };
    return new Promise((resolve, reject) => {
      const compile: Compile = () => {
        inFlight += 1;
        createAsync.call(device, copy).then(resolve, reject).finally(() => {
          inFlight -= 1;
          next();
        });
      };
      (warmingUp ? outOfView : inView).push(compile);
      requested = compile;
      next();
    });
  };
  pipelines.updateForRender = (renderObject) => {
    requested = null;
    const pipeline = getForRender.call(pipelines, renderObject, pending);
    if (requested) {
      if (warmingUp) {
        waiting.set(pipeline, requested);
      } else if ((renderObject as { object?: { isQuadMesh?: boolean } }).object?.isQuadMesh && inView.at(-1) === requested) {
        /* Nothing reaches the screen until the post chain's full-screen passes have
           compiled, and they are the last draws of a frame, so they go first. */
        inView.unshift(inView.pop()!);
      }
      return;
    }
    if (warmingUp || waiting.size === 0) return;
    const compile = waiting.get(pipeline);
    if (compile === undefined) return;
    waiting.delete(pipeline);
    const index = outOfView.indexOf(compile);
    if (index < 0) return;
    outOfView.splice(index, 1);
    inView.push(compile);
  };

  return {
    async warmUp(scene, render) {
      const culled: Object3D[] = [];
      scene.traverseVisible((object) => {
        if (!object.frustumCulled) return;
        object.frustumCulled = false;
        culled.push(object);
      });
      warmingUp = true;
      try {
        render();
      } finally {
        warmingUp = false;
        for (const object of culled) object.frustumCulled = true;
      }
      while (pending.length > 0) await Promise.all(pending.splice(0));
      delete pipelines.updateForRender;
      delete (device as Partial<GPUDevice>).createRenderPipelineAsync;
      /* A shadow map rendered once may have skipped casters whose shaders were still compiling. */
      scene.traverse((object) => {
        const shadow = (object as { shadow?: { autoUpdate: boolean; needsUpdate: boolean } }).shadow;
        if (shadow && !shadow.autoUpdate) shadow.needsUpdate = true;
      });
    },
  };
}
