import {
  CatmullRomCurve3,
  Color,
  Fog,
  FogExp2,
  Group,
  MathUtils,
  Matrix4,
  Object3D,
  Scene,
  Vector3,
} from 'three';
import type { ColorRepresentation } from 'three';
import { sampleRailFrame } from './rail';
import { mulberry32 } from './rng';
import { disposeObject3D } from './visual-kit';

export type ScatterPlacement = {
  /** Rail progress in [0, 1] for initial placement. On recycle, the helper advances this sample into the ahead window. */
  u: number;
  /** Rail-relative offset: x=right, y=up, z=tangent. */
  offset: Vector3;
};

export type ScatterItem = {
  readonly object: Object3D;
  readonly index: number;
  u: number;
  offset: Vector3;
};

type MutableScatterItem = ScatterItem & {
  initialU: number;
  initialOffset: Vector3;
};

export type ScatterAlongRailOptions = {
  count: number;
  place: (index: number, rng: () => number) => ScatterPlacement;
  make: (index: number, rng: () => number) => Object3D;
  window: { behind: number; ahead: number };
  seed: number;
  /** Optional authored RNG stream; when omitted, `seed` creates a Mulberry32 stream. */
  rng?: () => number;
  /** Set false for scenery that should keep its authored world rotation while still using rail-relative placement. */
  alignToRail?: boolean;
  onUpdate?: (item: ScatterItem, dt: number) => void;
};

export type ScatterField = {
  readonly group: Group;
  readonly items: readonly ScatterItem[];
  update(cameraRailU: number, dt?: number): void;
  forEach(callback: (item: ScatterItem) => void): void;
  dispose(): void;
};

const transformMatrix = new Matrix4();

function applyRailTransform(curve: CatmullRomCurve3, item: ScatterItem, alignToRail: boolean) {
  const frame = sampleRailFrame(curve, item.u);
  item.object.position.copy(frame.position)
    .addScaledVector(frame.right, item.offset.x)
    .addScaledVector(frame.up, item.offset.y)
    .addScaledVector(frame.tangent, item.offset.z);
  if (!alignToRail) return;
  transformMatrix.makeBasis(frame.right, frame.up, frame.tangent);
  item.object.quaternion.setFromRotationMatrix(transformMatrix);
}

export function scatterAlongRail(
  curve: CatmullRomCurve3,
  options: ScatterAlongRailOptions,
): ScatterField {
  const rng = options.rng ?? mulberry32(options.seed);
  const group = new Group();
  const items: MutableScatterItem[] = [];
  let lastCameraU = 0;
  const length = curve.getLength();
  const behindU = options.window.behind / length;
  const aheadU = Math.max(0.0001, options.window.ahead / length);
  const alignToRail = options.alignToRail ?? true;

  const createPlacement = (index: number) => {
    const placement = options.place(index, rng);
    return {
      u: MathUtils.clamp(placement.u, 0, 1),
      offset: placement.offset.clone(),
    };
  };

  for (let index = 0; index < options.count; index += 1) {
    const object = options.make(index, rng);
    const placement = createPlacement(index);
    const item: MutableScatterItem = {
      object,
      index,
      u: placement.u,
      offset: placement.offset.clone(),
      initialU: placement.u,
      initialOffset: placement.offset.clone(),
    };
    applyRailTransform(curve, item, alignToRail);
    group.add(object);
    items.push(item);
  }

  return {
    group,
    items,
    update(cameraRailU: number, dt = 0) {
      const cameraU = MathUtils.clamp(cameraRailU, 0, 1);
      if (cameraU + 0.001 < lastCameraU) {
        for (const item of items) {
          item.u = item.initialU;
          item.offset.copy(item.initialOffset);
        }
      }
      lastCameraU = cameraU;

      const minU = cameraU - behindU;
      const maxU = cameraU + aheadU;

      for (const item of items) {
        if (item.u < minU) {
          const placement = createPlacement(item.index);
          item.u = placement.u;
          item.offset.copy(placement.offset);
          while (item.u < minU) item.u += aheadU;
        }

        const visible = item.u >= minU && item.u <= maxU && item.u <= 1;
        item.object.visible = visible;
        if (!visible) continue;

        applyRailTransform(curve, item, alignToRail);
        options.onUpdate?.(item, dt);
      }
    },
    forEach(callback) {
      for (const item of items) callback(item);
    },
    dispose() {
      group.removeFromParent();
      disposeObject3D(group);
      group.clear();
      items.length = 0;
    },
  };
}

export type AtmosphereKeyframe = {
  progress: number;
  background?: ColorRepresentation;
  fog?: ColorRepresentation;
  density?: number;
  near?: number;
  far?: number;
};

export function createAtmosphereRamp(scene: Scene, keyframes: readonly AtmosphereKeyframe[]) {
  const points = [...keyframes].sort((a, b) => a.progress - b.progress).map((point) => ({
    ...point,
    backgroundColor: point.background === undefined ? undefined : new Color(point.background),
    fogColor: point.fog === undefined ? undefined : new Color(point.fog),
  }));

  return (progress: number) => {
    if (points.length === 0) return;
    const clamped = MathUtils.clamp(progress, 0, 1);
    const nextIndex = points.findIndex((point) => point.progress >= clamped);
    if (nextIndex <= 0) {
      applyAtmosphere(scene, points[0], points[0], 0);
      return;
    }
    if (nextIndex === -1) {
      const last = points[points.length - 1];
      applyAtmosphere(scene, last, last, 0);
      return;
    }
    const previous = points[nextIndex - 1];
    const next = points[nextIndex];
    const span = Math.max(0.0001, next.progress - previous.progress);
    applyAtmosphere(scene, previous, next, (clamped - previous.progress) / span);
  };
}

type PreparedAtmosphereKeyframe = AtmosphereKeyframe & {
  backgroundColor?: Color;
  fogColor?: Color;
};

function applyAtmosphere(
  scene: Scene,
  from: PreparedAtmosphereKeyframe,
  to: PreparedAtmosphereKeyframe,
  t: number,
) {
  if (from.backgroundColor && to.backgroundColor) {
    scene.background = from.backgroundColor.clone().lerp(to.backgroundColor, t);
  }

  if (!scene.fog) return;
  if (from.fogColor && to.fogColor) scene.fog.color.copy(from.fogColor).lerp(to.fogColor, t);
  if (scene.fog instanceof FogExp2) {
    if (from.density !== undefined && to.density !== undefined) {
      scene.fog.density = MathUtils.lerp(from.density, to.density, t);
    }
  } else if (scene.fog instanceof Fog) {
    if (from.near !== undefined && to.near !== undefined) scene.fog.near = MathUtils.lerp(from.near, to.near, t);
    if (from.far !== undefined && to.far !== undefined) scene.fog.far = MathUtils.lerp(from.far, to.far, t);
  }
}
