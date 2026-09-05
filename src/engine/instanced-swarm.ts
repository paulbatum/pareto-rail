import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { instancedBufferAttribute, uniform } from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';

/**
 * One InstancedMesh standing in for many identical enemies or props.
 *
 * `createLockOnRunner` requires one Object3D per enemy: it adds the object to
 * the scene, moves it, reads its position for events, and removes it on kill.
 * A swarm gives each live instance a proxy Group for that role. The proxy
 * renders nothing itself. Once per frame, `update` copies every live proxy's
 * world matrix into the instance matrix of its slot, so the instanced mesh
 * draws the whole swarm in one call. Children added to a proxy (a lock ring,
 * a letter) render as ordinary scene objects.
 *
 * Per-instance data lives in instanced attributes the level declares by name
 * and type. `nodes.<name>` is the TSL node that reads the attribute, for use in
 * the material's colorNode, positionNode, or opacityNode; `write` stores a
 * value for one slot. Inside a positionNode, `positionLocal` has already been
 * multiplied by the instance matrix, so an offset added there is in the space
 * of the swarm mesh, not of the instance geometry. The shader clock `nodes.time` advances with `update(dt)`,
 * so a decay such as a damage flash stores its start time once and the shader
 * computes the fade: `time.sub(nodes.flashAt).mul(-6).exp()`.
 *
 * The instanced mesh carries `userData.raildIgnoreOcclusion`, so the target
 * occlusion check never counts the swarm as scenery blocking a target.
 */

export type SwarmAttributeType = 'float' | 'vec2' | 'vec3' | 'vec4';

export type SwarmOptions<A extends Record<string, SwarmAttributeType>> = {
  geometry: BufferGeometry;
  material: Material;
  /** Number of instance slots. `acquire` returns null once every slot is live. */
  capacity: number;
  /** Per-instance attributes by name. Each one becomes a node under `nodes`. */
  attributes?: A;
};

export type SwarmSlot = {
  /** The Object3D to hand to the runner. Its world matrix drives the instance. */
  proxy: Group;
  index: number;
};

export type SwarmNodes<A extends Record<string, SwarmAttributeType>> = {
  [K in keyof A]: Node<A[K]>;
} & {
  /** Seconds of `update(dt)` since creation or the last `reset`, as a uniform. */
  time: UniformNode<'float', number>;
};

export type Swarm<A extends Record<string, SwarmAttributeType>> = {
  /** Add this to the scene at the root. Its own transform stays identity. */
  mesh: InstancedMesh;
  nodes: SwarmNodes<A>;
  /** Seconds of `update(dt)` since creation or the last `reset`. */
  readonly time: number;
  /** Number of live slots. */
  readonly liveCount: number;
  /**
   * Take a free slot. The proxy is a fresh Group with
   * `userData.raildSwarmIndex` recording its slot. Returns null when the swarm is full.
   */
  acquire(): SwarmSlot | null;
  /** Free a slot by index or by its proxy. The instance stops drawing on the next `update`. */
  release(slot: number | Object3D): void;
  /** Slot index of a proxy from this swarm, or -1. */
  indexOf(proxy: Object3D): number;
  /** Store a per-instance attribute value for one slot. Extra components are ignored. */
  write(index: number, name: keyof A & string, x: number, y?: number, z?: number, w?: number): void;
  /**
   * Copy every live proxy's world matrix into its instance and advance the
   * shader clock. Call once per frame after gameplay has moved the proxies.
   * A proxy that is invisible, or has no parent, draws nothing.
   */
  update(dt: number): void;
  /** Free every slot and zero the clock. Call on run start. */
  reset(): void;
  /** Free every slot and release the instance buffers. Geometry and material stay the caller's. */
  dispose(): void;
};

const COMPONENTS: Record<SwarmAttributeType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

export function createSwarm<A extends Record<string, SwarmAttributeType>>(options: SwarmOptions<A>): Swarm<A> {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const mesh = new InstancedMesh(options.geometry, options.material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.count = 0;

  const attributeSpecs = options.attributes ?? ({} as A);
  const attributes = new Map<string, InstancedBufferAttribute>();
  const nodes = {} as Record<string, unknown>;
  for (const name of Object.keys(attributeSpecs)) {
    const type = attributeSpecs[name];
    const attribute = new InstancedBufferAttribute(new Float32Array(capacity * COMPONENTS[type]), COMPONENTS[type]);
    attribute.setUsage(DynamicDrawUsage);
    attributes.set(name, attribute);
    nodes[name] = instancedBufferAttribute(attribute, type);
  }
  const timeUniform = uniform(0);
  nodes.time = timeUniform;

  const proxies: Array<Group | null> = new Array<Group | null>(capacity).fill(null);
  let liveCount = 0;
  let highWater = 0;
  let disposed = false;

  for (let i = 0; i < capacity; i += 1) mesh.setMatrixAt(i, HIDDEN_MATRIX);

  function acquire(): SwarmSlot | null {
    if (disposed) return null;
    const index = proxies.indexOf(null);
    if (index < 0) return null;
    const proxy = new Group();
    proxy.userData.raildSwarmIndex = index;
    proxies[index] = proxy;
    liveCount += 1;
    if (index >= highWater) highWater = index + 1;
    return { proxy, index };
  }

  function indexOf(proxy: Object3D) {
    const index = proxy.userData.raildSwarmIndex;
    return typeof index === 'number' && proxies[index] === proxy ? index : -1;
  }

  function release(slot: number | Object3D) {
    const index = typeof slot === 'number' ? slot : indexOf(slot);
    if (index < 0 || index >= capacity || proxies[index] === null) return;
    proxies[index] = null;
    liveCount -= 1;
    mesh.setMatrixAt(index, HIDDEN_MATRIX);
    mesh.instanceMatrix.needsUpdate = true;
    while (highWater > 0 && proxies[highWater - 1] === null) highWater -= 1;
  }

  function write(index: number, name: keyof A & string, x: number, y = 0, z = 0, w = 0) {
    const attribute = attributes.get(name);
    if (!attribute || index < 0 || index >= capacity) return;
    const size = attribute.itemSize;
    if (size === 1) attribute.setX(index, x);
    else if (size === 2) attribute.setXY(index, x, y);
    else if (size === 3) attribute.setXYZ(index, x, y, z);
    else attribute.setXYZW(index, x, y, z, w);
    attribute.needsUpdate = true;
  }

  function update(dt: number) {
    if (disposed) return;
    timeUniform.value += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (let index = 0; index < highWater; index += 1) {
      const proxy = proxies[index];
      if (proxy === null) continue;
      if (proxy.parent === null || !isVisibleThroughAncestors(proxy)) {
        mesh.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      proxy.updateMatrixWorld();
      mesh.setMatrixAt(index, proxy.matrixWorld);
    }
    mesh.count = highWater;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    for (let index = 0; index < capacity; index += 1) {
      proxies[index] = null;
      mesh.setMatrixAt(index, HIDDEN_MATRIX);
    }
    liveCount = 0;
    highWater = 0;
    mesh.count = 0;
    mesh.instanceMatrix.needsUpdate = true;
    timeUniform.value = 0;
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    mesh.dispose();
  }

  return {
    mesh,
    nodes: nodes as SwarmNodes<A>,
    get time() {
      return timeUniform.value;
    },
    get liveCount() {
      return liveCount;
    },
    acquire,
    release,
    indexOf,
    write,
    update,
    reset,
    dispose,
  };
}

function isVisibleThroughAncestors(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
