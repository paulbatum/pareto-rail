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

/**
 * Draws `objects` once so their shaders compile before the run needs them, then hides
 * them. The objects go into a group that follows the camera two units behind it with
 * frustum culling off: the renderer draws them, the GPU clips every vertex, and no
 * pixel changes. The group stays in the scene, hidden, so the renderer keeps counting
 * the objects as users of their shaders and never evicts them. Build the objects with
 * the same factories the run uses: the renderer keys shaders on material settings,
 * geometry layout, and lights, so a copy built any other way warms a different shader.
 */
export function warmUpShaders(scene: Scene, objects: Object3D[]): ShaderWarmUp {
  const group = new Group();
  group.name = 'shader-warm-up';
  group.userData.raildIgnoreOcclusion = true;
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
