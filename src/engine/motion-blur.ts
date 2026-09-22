import { HalfFloatType, Matrix4, NearestFilter, Vector2, type Camera, type InstancedMesh, type Object3D } from 'three';
import { NodeMaterial, NodeUpdateType, QuadMesh, RenderTarget, RendererUtils, TempNode, type Node, type NodeBuilder, type NodeFrame, type TextureNode } from 'three/webgpu';
import {
  buffer,
  cameraProjectionMatrix,
  clamp,
  float,
  Fn,
  fract,
  If,
  instanceIndex,
  int,
  length,
  Loop,
  max,
  min,
  mix,
  modelViewMatrix,
  passTexture,
  perspectiveDepthToViewZ,
  positionLocal,
  positionPrevious,
  renderGroup,
  screenCoordinate,
  screenUV,
  smoothstep,
  step,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';

/* Object motion blur: a per-object motion-vector attachment on the scene pass, and a
   reconstruction filter after McGuire et al., "A Reconstruction Filter for Plausible
   Motion Blur" (I3D 2012).

   The motion vector of a pixel is split into two parts. The camera's own turn and zoom
   moves every pixel regardless of depth; it is computed analytically from the two frames'
   view rotations and projections, scaled down and clamped, because a rail camera turning
   to follow the reticle should not smear the frame. The rest is translation parallax and
   object motion, which is what reads as speed. An object that travels with the camera has
   none of it, so it stays sharp.

   Lengths are in pixels and stored as half-extents: a pixel blurs over ±v. The shutter is
   a duration, so the blur length does not change with frame rate. */

/** Exposure time. At 60 fps the blur spans one frame of motion. */
const SHUTTER_SECONDS = 1 / 60;
/** Largest half-extent, as a fraction of the frame height. Also the tile size. */
const MAX_HALF_BLUR = 0.027;
/** Share of the camera's turn and zoom that blurs, and its largest half-extent as a fraction of the frame height. */
const CAMERA_TURN_SCALE = 0.25;
const CAMERA_TURN_MAX_HALF = 0.004;
/** Most gather taps along the dominant direction. */
const SAMPLES = 12;
/** A neighbourhood whose shortest blur is at least this share of its longest takes the plain average. */
const FAST_PATH_RATIO = 0.8;
/** Depth band, as a fraction of the pixel's distance, inside which two surfaces blur into each other. */
const SOFT_DEPTH = 0.03;

export type MotionBlurState = ReturnType<typeof createMotionBlurState>;

/** Per-frame camera bookkeeping shared by the motion vectors and the filter. */
export function createMotionBlurState(level: Node<'float'>) {
  const previousViewProjection = uniform(new Matrix4()).setGroup(renderGroup);
  const cameraTurn = uniform(new Matrix4());
  const exposure = uniform(1);
  const near = uniform(0.1);
  const far = uniform(1000);
  const current = new Matrix4();
  const previous = new Matrix4();
  const currentTurn = new Matrix4();
  const previousTurn = new Matrix4();
  const scratch = new Matrix4();
  let initialized = false;
  const state = {
    frame: 0,
    previousViewProjection,
    cameraTurn,
    exposure,
    level,
    near,
    far,
    /** Starts a new frame of motion: last frame's camera becomes the previous one. */
    advance(camera: Camera, dt: number) {
      camera.updateMatrixWorld();
      const projection = camera.projectionMatrix;
      current.multiplyMatrices(projection, camera.matrixWorldInverse);
      scratch.extractRotation(camera.matrixWorldInverse);
      currentTurn.multiplyMatrices(projection, scratch);
      if (!initialized) {
        previous.copy(current);
        previousTurn.copy(currentTurn);
        initialized = true;
      }
      previousViewProjection.value.copy(previous);
      cameraTurn.value.multiplyMatrices(previousTurn, scratch.copy(currentTurn).invert());
      previous.copy(current);
      previousTurn.copy(currentTurn);
      exposure.value = dt > 0 ? Math.min(4, SHUTTER_SECONDS / dt) : exposure.value;
      const perspective = camera as Camera & { near?: number; far?: number };
      if (perspective.near !== undefined) near.value = perspective.near;
      if (perspective.far !== undefined) far.value = perspective.far;
      state.frame += 1;
    },
    /** Forgets the previous camera, so the next frame has no camera motion (a camera cut). */
    reset() {
      initialized = false;
    },
  };
  return state;
}

type ObjectHistory = { previous: Matrix4; previousFrame: number; current: Matrix4; currentFrame: number };
const histories = new WeakMap<Object3D, ObjectHistory>();

/* three 0.185 refills its previous instance matrices with the current ones before every
   draw, so instances that move by rewriting their matrices report no motion of their own.
   The engine keeps its own history and, before each draw, the per-instance transform from
   this frame's matrix back to last frame's; applied to three's `positionPrevious`, it keeps
   any displacement that position carries. It lives in a uniform buffer, so an instanced
   mesh above this count keeps three's behaviour. */
const MAX_TRACKED_INSTANCES = 1024;
type InstanceHistory = { previous: Float32Array; previousFrame: number; current: Float32Array; currentFrame: number; back: Float32Array };
const instanceHistories = new WeakMap<InstancedMesh, InstanceHistory>();
const _current = new Matrix4();
const _previous = new Matrix4();

function instanceHistory(mesh: InstancedMesh) {
  let history = instanceHistories.get(mesh);
  if (!history) {
    const size = mesh.instanceMatrix.array.length;
    const back = new Float32Array(size);
    for (let i = 0; i < size; i += 16) back[i] = back[i + 5] = back[i + 10] = back[i + 15] = 1;
    history = { previous: new Float32Array(size), previousFrame: -1, current: new Float32Array(size), currentFrame: -1, back };
    instanceHistories.set(mesh, history);
  }
  return history;
}

function tracksInstances(object: Object3D | null | undefined): object is InstancedMesh {
  return (object as InstancedMesh | undefined)?.isInstancedMesh === true && (object as InstancedMesh).instanceMatrix.count <= MAX_TRACKED_INSTANCES;
}

/* Screen motion of each vertex since the previous frame, as an NDC delta, for the scene
   pass's `velocity` attachment. The attachment name is what three checks to supply
   skinning and `positionPrevious`. An object that was not
   drawn last frame reports no motion of its own. Transparent materials write zero with
   zero alpha, which the attachment's material blending turns into "keep what is behind". */
class MotionVectorNode extends TempNode {
  static get type() {
    return 'MotionVectorNode';
  }

  private readonly previousModelWorldMatrix = uniform(new Matrix4());

  constructor(private readonly state: MotionBlurState) {
    super('vec4');
    this.updateType = NodeUpdateType.OBJECT;
    this.updateAfterType = NodeUpdateType.OBJECT;
  }

  update({ object }: NodeFrame): undefined {
    if (!object) return;
    const history = histories.get(object);
    const frame = this.state.frame;
    let previous: Matrix4 = object.matrixWorld;
    if (history) {
      if (history.currentFrame === frame - 1) previous = history.current;
      else if (history.currentFrame === frame && history.previousFrame === frame - 1) previous = history.previous;
    }
    this.previousModelWorldMatrix.value.copy(previous);
    if (tracksInstances(object)) {
      const instances = instanceHistory(object);
      const matrices = object.instanceMatrix.array as Float32Array;
      const last =
        instances.currentFrame === frame - 1 ? instances.current
        : instances.currentFrame === frame && instances.previousFrame === frame - 1 ? instances.previous
        : null;
      for (let i = 0; i < object.count * 16; i += 16) {
        if (last) _previous.fromArray(last, i);
        else _previous.fromArray(matrices, i);
        _current.fromArray(matrices, i).invert();
        _previous.multiply(_current).toArray(instances.back, i);
      }
    }
  }

  updateAfter({ object }: NodeFrame): undefined {
    if (!object) return;
    const frame = this.state.frame;
    let history = histories.get(object);
    if (!history) {
      history = { previous: new Matrix4(), previousFrame: -1, current: new Matrix4(), currentFrame: -1 };
      histories.set(object, history);
    }
    if (history.currentFrame !== frame) {
      history.previous.copy(history.current);
      history.previousFrame = history.currentFrame;
      history.currentFrame = frame;
    }
    history.current.copy(object.matrixWorld);
    if (tracksInstances(object)) {
      const instances = instanceHistory(object);
      if (instances.currentFrame !== frame) {
        instances.previous.set(instances.current);
        instances.previousFrame = instances.currentFrame;
        instances.currentFrame = frame;
      }
      instances.current.set(object.instanceMatrix.array);
    }
  }

  setup(builder: NodeBuilder) {
    if (builder.material?.transparent) return vec4(0);
    // Clip positions interpolate correctly, so the matrices run per vertex and only the divide per fragment.
    const currentClip = cameraProjectionMatrix.mul(modelViewMatrix).mul(positionLocal).toVarying('motionCurrentClip');
    const object = builder.object;
    const previousLocal = tracksInstances(object)
      ? (buffer(instanceHistory(object).back, 'mat4', Math.max(object.instanceMatrix.count, 1)) as unknown as { element(i: Node<'uint'>): Node<'mat4'> }).element(instanceIndex).mul(vec4(positionPrevious, 1))
      : vec4(positionPrevious, 1);
    const previousClip = this.state.previousViewProjection.mul(this.previousModelWorldMatrix).mul(previousLocal as Node<'vec4'>).toVarying('motionPreviousClip');
    const delta = currentClip.xy.div(currentClip.w).sub(previousClip.xy.div(previousClip.w));
    return vec4(delta, 0, 1);
  }
}

export function motionVectors(state: MotionBlurState) {
  return new MotionVectorNode(state) as unknown as Node<'vec4'>;
}

type Sampled = { sample(uv: Node<'vec2'>): Node<'vec4'>; value: { image: { width: number; height: number } } };

const _quad = new QuadMesh();
/* The declaration requires a state object; three creates one when handed undefined. */
let _rendererState = undefined as unknown as ReturnType<typeof RendererUtils.resetRendererState>;

function clampLength(v: Node<'vec2'>, limit: Node<'float'>) {
  return v.mul(min(float(1), limit.div(max(length(v), float(1e-5)))));
}

function createTarget(name: string) {
  const target = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter });
  target.texture.name = name;
  return target;
}

/* Four passes, then the gather in the output graph:
   prepare   full size: each pixel's blur vector (xy) and distance (z);
   rows      k pixels wide: the longest blur vector along each row of a tile;
   tiles     one texel per k x k tile;
   neighbour the longest blur vector among each tile and its eight neighbours.
   Every pass reads texels by pixel centre in screenUV space, the space the scene pass
   textures are written in, so no pass depends on the quad's own uv orientation. */
class MotionBlurNode extends TempNode {
  static get type() {
    return 'MotionBlurNode';
  }

  private readonly size = uniform(new Vector2(1, 1));
  private readonly tiles = uniform(new Vector2(1, 1));
  private readonly tileSize = uniform(1);
  private readonly targets = {
    prepare: createTarget('MotionBlur.prepare'),
    rows: createTarget('MotionBlur.rows'),
    tiles: createTarget('MotionBlur.tiles'),
    neighbour: createTarget('MotionBlur.neighbour'),
  };
  private readonly materials = {
    prepare: new NodeMaterial(),
    rows: new NodeMaterial(),
    tiles: new NodeMaterial(),
    neighbour: new NodeMaterial(),
  };

  constructor(
    private readonly color: TextureNode,
    private readonly velocity: TextureNode,
    private readonly depth: TextureNode,
    private readonly state: MotionBlurState,
  ) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  updateBefore(frame: NodeFrame): undefined {
    const renderer = frame.renderer;
    if (!renderer) return;
    const { width, height } = (this.color as unknown as Sampled).value.image;
    const k = Math.max(1, Math.ceil(MAX_HALF_BLUR * height));
    const tilesX = Math.ceil(width / k);
    const tilesY = Math.ceil(height / k);
    this.size.value.set(width, height);
    this.tiles.value.set(tilesX, tilesY);
    this.tileSize.value = k;
    this.targets.prepare.setSize(width, height);
    this.targets.rows.setSize(tilesX, height);
    this.targets.tiles.setSize(tilesX, tilesY);
    this.targets.neighbour.setSize(tilesX, tilesY);

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);
    for (const pass of ['prepare', 'rows', 'tiles', 'neighbour'] as const) {
      renderer.setRenderTarget(this.targets[pass]);
      _quad.material = this.materials[pass];
      _quad.name = `Motion Blur [ ${pass} ]`;
      _quad.render(renderer);
    }
    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  setup(builder: NodeBuilder) {
    const { size, tiles, tileSize, state, materials, targets } = this;
    const color = this.color as unknown as Sampled;
    const velocity = this.velocity as unknown as Sampled;
    const depth = this.depth as unknown as Sampled;
    /* The method exists at runtime; the type declaration lags it. */
    const shared = (builder as NodeBuilder & { getSharedContext(): Record<string, unknown> }).getSharedContext();
    const texelOf = (target: RenderTarget) => passTexture(this as unknown as Parameters<typeof passTexture>[0], target.texture) as unknown as Sampled;
    const larger = (a: Node<'vec2'>, b: Node<'vec2'>) => mix(a, b, step(length(a), length(b)));
    const pixelUv = (pixel: Node<'vec2'>, extent: Node<'vec2'>) => pixel.floor().add(0.5).div(extent);

    materials.prepare.fragmentNode = Fn(() => {
      const at = screenUV;
      const rawDepth = depth.sample(at).r;
      const ndc = vec2(at.x.mul(2).sub(1), at.y.mul(-2).add(1));
      const turned = state.cameraTurn.mul(vec4(ndc, 0.5, 1));
      const turn = ndc.sub(turned.xy.div(turned.w));
      // Nothing was drawn at the far plane; the sky moves with the camera's turn alone.
      const total = mix(velocity.sample(at).xy, turn, step(0.999999, rawDepth));
      const toPixels = vec2(size.x.mul(0.5), size.y.mul(-0.5));
      const rest = total.sub(turn).mul(toPixels).mul(0.5);
      const turnKept = clampLength(turn.mul(toPixels).mul(CAMERA_TURN_SCALE * 0.5), size.y.mul(CAMERA_TURN_MAX_HALF));
      const blur = clampLength(rest.add(turnKept).mul(state.exposure).mul(state.level), size.y.mul(MAX_HALF_BLUR));
      const distance = perspectiveDepthToViewZ(rawDepth, state.near, state.far).negate();
      return vec4(blur, distance, 1);
    })().context(shared);
    const prepared = texelOf(targets.prepare);

    materials.rows.fragmentNode = Fn(() => {
      const first = screenCoordinate.x.floor().mul(tileSize);
      const best = vec2(0).toVar();
      const shortest = float(1e4).toVar();
      Loop({ start: int(0), end: int(tileSize), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        const x = min(first.add(float(i)), size.x.sub(1));
        const blur = prepared.sample(pixelUv(vec2(x, screenCoordinate.y), size)).xy;
        best.assign(larger(best, blur));
        shortest.assign(min(shortest, length(blur)));
      });
      return vec4(best, shortest, 1);
    })().context(shared);
    const rows = texelOf(targets.rows);
    const rowsExtent = vec2(tiles.x, size.y);

    materials.tiles.fragmentNode = Fn(() => {
      const first = screenCoordinate.y.floor().mul(tileSize);
      const best = vec2(0).toVar();
      const shortest = float(1e4).toVar();
      Loop({ start: int(0), end: int(tileSize), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        const y = min(first.add(float(i)), size.y.sub(1));
        const row = rows.sample(pixelUv(vec2(screenCoordinate.x, y), rowsExtent));
        best.assign(larger(best, row.xy));
        shortest.assign(min(shortest, row.z));
      });
      return vec4(best, shortest, 1);
    })().context(shared);
    const tileMax = texelOf(targets.tiles);

    materials.neighbour.fragmentNode = Fn(() => {
      const best = vec2(0).toVar();
      const shortest = float(1e4).toVar();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const tile = tileMax.sample(pixelUv(clamp(screenCoordinate.xy.add(vec2(dx, dy)), vec2(0), tiles.sub(1)), tiles));
          best.assign(larger(best, tile.xy));
          shortest.assign(min(shortest, tile.z));
        }
      }
      return vec4(best, shortest, 1);
    })().context(shared);
    const neighbourMax = texelOf(targets.neighbour);

    const cone = (d: Node<'float'>, v: Node<'float'>) => clamp(float(1).sub(d.div(v)), 0, 1);
    const cylinder = (d: Node<'float'>, v: Node<'float'>) => float(1).sub(smoothstep(v.mul(0.95), v.mul(1.05), d));

    return Fn(() => {
      const pixel = screenCoordinate.xy;
      const here = pixelUv(pixel, size);
      const centre = color.sample(screenUV).toVar();
      // Interleaved gradient noise offsets the taps and the tile lookup so neither shows bands.
      const noise = fract(float(52.9829189).mul(fract(pixel.x.mul(0.06711056).add(pixel.y.mul(0.00583715)))));
      const jitter = vec2(noise.sub(0.5), fract(noise.mul(7.13)).sub(0.5)).mul(tileSize.mul(0.5));
      const tile = clamp(pixel.add(jitter).div(tileSize), vec2(0), tiles.sub(1));
      const neighbourhood = neighbourMax.sample(pixelUv(tile, tiles));
      const dominant = neighbourhood.xy;
      const reach = length(dominant);
      // Taps about four pixels apart, so a short blur takes few.
      const taps = int(clamp(reach.div(2).ceil(), float(3), float(SAMPLES)));
      const spread = (i: Node<'int'>) => mix(float(-1), float(1), float(i).add(noise).add(0.5).div(float(taps).add(1)));
      const tapUv = (offset: Node<'vec2'>) => pixelUv(clamp(pixel.add(offset), vec2(0), size.sub(1)), size);
      const result = centre.toVar();
      If(reach.greaterThan(0.5).and(neighbourhood.z.greaterThan(reach.mul(FAST_PATH_RATIO))), () => {
        // Every pixel nearby blurs about as far: no edge to reconstruct, so a plain average along the vector.
        const sum = centre.toVar();
        Loop({ start: int(0), end: taps, type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
          sum.addAssign(color.sample(tapUv(dominant.mul(spread(i)))));
        });
        result.assign(sum.div(float(taps).add(1)));
      }).ElseIf(reach.greaterThan(0.5), () => {
        const self = prepared.sample(here);
        const selfBlur = max(length(self.xy), float(0.5));
        const band = self.z.mul(SOFT_DEPTH).add(0.05);
        const weight = float(1).div(selfBlur).toVar();
        const sum = centre.mul(weight).toVar();
        Loop({ start: int(0), end: taps, type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
          const offset = dominant.mul(spread(i));
          const d = length(offset);
          const there = tapUv(offset);
          const other = prepared.sample(there);
          const otherBlur = max(length(other.xy), float(0.5));
          const inFront = clamp(float(1).sub(other.z.sub(self.z).div(band)), 0, 1);
          const behind = clamp(float(1).sub(self.z.sub(other.z).div(band)), 0, 1);
          const w = inFront
            .mul(cone(d, otherBlur))
            .add(behind.mul(cone(d, selfBlur)))
            .add(cylinder(d, otherBlur).mul(cylinder(d, selfBlur)).mul(2));
          sum.addAssign(color.sample(there).mul(w));
          weight.addAssign(w);
        });
        result.assign(sum.div(weight));
      });
      return result;
    })();
  }

  dispose() {
    for (const target of Object.values(this.targets)) target.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}

export function objectMotionBlur(color: TextureNode, velocity: TextureNode, depth: TextureNode, state: MotionBlurState) {
  return new MotionBlurNode(color, velocity, depth, state) as unknown as Node<'vec4'>;
}
