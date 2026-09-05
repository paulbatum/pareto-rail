import type { WebGPURenderer } from 'three/webgpu';

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
