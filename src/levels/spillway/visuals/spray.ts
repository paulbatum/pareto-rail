import { Vector3 } from 'three';
import type { ColorRepresentation, Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { float, mix, positionView, smoothstep, uniform, vec4 } from 'three/tsl';
import { createGpuParticles, type GpuParticleSpawnInput, type GpuParticles } from '../../../engine/gpu-particles';

// Spray and mist as two GPU particle systems. Spray is short-lived droplets
// thrown off rapids, the cascade, the walker's feet and the flood; mist is a
// few hundred large, faint sprites that drift over the water. Both are unlit,
// so `light` darkens them in the shade of the gorge.

export type SprayEmit = {
  /** Centre of the emitter. */
  at: Vector3;
  count: number;
  direction?: Vector3;
  speed?: number;
  spread?: number;
  life?: number;
  size?: number;
  /** Half-vector of a line the particles are spread along. */
  line?: Vector3;
  /** Random scatter radius around the emitter. */
  radius?: number;
  color?: ColorRepresentation;
};

export type Spray = {
  objects: Object3D[];
  /** 0..1 brightness of the unlit particles: low in the shaded gorge, 1 in the open. */
  light: { value: number };
  spray(emit: SprayEmit): void;
  mist(emit: SprayEmit): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
};

const lineSpawn = (input: GpuParticleSpawnInput) => {
  const direction = mix(input.direction, input.randomDirection(1), input.spread).normalize();
  const jitter = (salt: number) => input.random(salt).mul(2).sub(1).mul(input.jitter).add(1);
  const along = input.random(7).mul(2).sub(1);
  const position = input.origin.add(input.custom.xyz.mul(along)).add(input.randomDirection(9).mul(input.random(11).mul(input.custom.w)));
  return {
    position,
    velocity: direction.mul(input.speed.mul(jitter(3))),
    life: input.life.mul(jitter(4)).max(0.01),
    color: input.color,
    size: input.size.mul(jitter(5)),
  };
};

const scratchDirection = new Vector3();
const scratchCustom: [number, number, number, number] = [0, 0, 0, 0];

function emitInto(system: GpuParticles, emit: SprayEmit, defaults: Required<Pick<SprayEmit, 'speed' | 'spread' | 'life' | 'size'>>) {
  const count = Math.floor(emit.count + Math.random());
  if (count <= 0) return;
  scratchCustom[0] = emit.line?.x ?? 0;
  scratchCustom[1] = emit.line?.y ?? 0;
  scratchCustom[2] = emit.line?.z ?? 0;
  scratchCustom[3] = emit.radius ?? 0;
  system.emit(emit.at, count, {
    direction: emit.direction ?? scratchDirection.set(0, 1, 0),
    speed: emit.speed ?? defaults.speed,
    spread: emit.spread ?? defaults.spread,
    life: emit.life ?? defaults.life,
    size: emit.size ?? defaults.size,
    jitter: 0.45,
    color: emit.color ?? 0xdde6e6,
    custom: scratchCustom,
  });
}

export function createSpray(renderer: WebGPURenderer, options: { sprayCapacity: number; mistCapacity: number }): Spray {
  const light = uniform(1);
  const spray = createGpuParticles(renderer, {
    capacity: options.sprayCapacity,
    additive: false,
    fog: true,
    spawn: lineSpawn,
    forces: { gravity: new Vector3(0, -11, 0), drag: 1.1, turbulence: { strength: 3, scale: 0.15, drift: 0.6 } },
    // Droplets swell and soften as they age, so a burst thins into a cloud rather than a scatter of dots.
    sizeOverLife: ({ size, lifeFraction }) => size.mul(lifeFraction.mul(1.5).add(0.6)),
    colorOverLife: ({ color, uv, lifeFraction }) => {
      const r = uv.sub(0.5).length().mul(2).min(1);
      const disc = float(1).sub(r.mul(r)).pow(2);
      const fade = smoothstep(0, 0.06, lifeFraction).mul(smoothstep(1, 0.35, lifeFraction));
      // Droplets right at the lens would read as big soft discs; they fade out instead.
      const near = smoothstep(3, 14, positionView.z.negate());
      return vec4(color.mul(light), disc.mul(fade).mul(near).mul(float(0.34).sub(lifeFraction.mul(0.2))));
    },
  });
  const mist = createGpuParticles(renderer, {
    capacity: options.mistCapacity,
    additive: false,
    fog: true,
    spawn: lineSpawn,
    forces: { gravity: new Vector3(0, 0.15, 0), drag: 0.3 },
    sizeOverLife: ({ size, lifeFraction }) => size.mul(lifeFraction.mul(0.7).add(0.6)),
    colorOverLife: ({ color, uv, lifeFraction }) => {
      const disc = smoothstep(0.5, float(0), uv.sub(0.5).length());
      const fade = smoothstep(0, 0.25, lifeFraction).mul(smoothstep(1, 0.6, lifeFraction));
      // A sprite tens of units across fills the screen when the camera flies into it, and
      // stacked ones white the frame out; they thin to nothing close to the lens.
      const near = smoothstep(10, 55, positionView.z.negate());
      return vec4(color.mul(light.mul(0.5).add(0.5)), disc.mul(disc).mul(fade).mul(near).mul(0.05));
    },
  });
  spray.object.name = 'spray';
  mist.object.name = 'mist';
  for (const object of [spray.object, mist.object]) object.userData.raildIgnoreOcclusion = true;
  mist.object.renderOrder = 1;
  spray.object.renderOrder = 2;

  return {
    objects: [mist.object, spray.object],
    light,
    spray: (emit) => emitInto(spray, emit, { speed: 6, spread: 0.5, life: 1.2, size: 0.45 }),
    mist: (emit) => emitInto(mist, emit, { speed: 0.6, spread: 1, life: 12, size: 36 }),
    update(dt) {
      spray.update(dt);
      mist.update(dt);
    },
    reset() {
      spray.reset();
      mist.reset();
    },
    dispose() {
      spray.dispose();
      mist.dispose();
    },
  };
}
