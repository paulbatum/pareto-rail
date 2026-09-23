import { BufferAttribute, BufferGeometry, Color, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  modelWorldMatrix,
  normalize,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { strandPointAt, strandRootY, type StrandSpec } from '../world';

type FloatUniform = UniformNode<'float', number>;

// Leaf: builds one merged tube mesh for a set of strands and the glowing
// material that animates them. Every look decision (colours, glow, fade,
// sway) arrives as a parameter or a uniform owned by the caller.
//
// Per-vertex attributes carry what the shader needs to tell strands apart:
//   aAlong  0 at the root → 1 at the tip
//   aSeed   per-strand random
//   aHeal   clock time the strand was cleansed (far future = still sick)
//   aInfect parasite infection around latch points
//   aHost   1 for strands that carried parasites

export const NEVER = 1e6;

export type StrandFieldUniforms = {
  clock: FloatUniform;
  beat: FloatUniform;
  life: FloatUniform;
  hostLife: FloatUniform;
  fade: FloatUniform;
  sway: FloatUniform;
  glow: FloatUniform;
  pulse: FloatUniform;
  /** Far strands swell toward a minimum on-screen width (world units per unit distance). */
  inflate: FloatUniform;
  flashGain: FloatUniform;
  /** Clock time a phrase wave left the bell (runs root to tip). */
  waveAt: FloatUniform;
};

export type StrandFieldLook = {
  sick: Color;
  healthy: Color;
  band: Color;
  infection: Color;
  flash: Color;
  radialSegments: number;
  segmentLength: number;
  /** Bead knots (nematocyst clusters) per unit length and how much they swell. */
  beadFrequency: number;
  beadSwell: number;
  /** Beat bands visible along a whole strand. */
  bandsPerStrand: number;
};

export type StrandField = {
  mesh: Mesh;
  /** Cleanse one strand: the heal starts at `clockTime` and flows toward the bell. */
  heal(strand: number, clockTime: number): void;
  /** Cleanse everything, flowing from the roots down: delay = along × `spread` + jitter. */
  healAll(clockTime: number, spread: number): void;
  reset(): void;
  isHealed(strand: number): boolean;
};

export function createStrandUniforms(): StrandFieldUniforms {
  return {
    clock: uniform(0),
    beat: uniform(0),
    life: uniform(0.1),
    hostLife: uniform(0.05),
    fade: uniform(0.011),
    sway: uniform(1),
    glow: uniform(1),
    pulse: uniform(0),
    inflate: uniform(0.0007),
    flashGain: uniform(2.2),
    waveAt: uniform(-100),
  };
}

export function createStrandField(specs: readonly StrandSpec[], hostFlags: readonly boolean[], look: StrandFieldLook, uniforms: StrandFieldUniforms): StrandField {
  const radial = look.radialSegments;
  const positions: number[] = [];
  const normals: number[] = [];
  const alongs: number[] = [];
  const seeds: number[] = [];
  const infects: number[] = [];
  const hosts: number[] = [];
  const indices: number[] = [];
  const ranges: Array<{ start: number; count: number }> = [];

  const point = new Vector3();
  const prev = new Vector3();
  const next = new Vector3();
  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const reference = new Vector3(1, 0, 0);

  specs.forEach((spec, strandIndex) => {
    const rootY = strandRootY(spec);
    const segments = Math.max(18, Math.min(80, Math.round(spec.length / look.segmentLength)));
    const vertexStart = positions.length / 3;
    const host = hostFlags[strandIndex] ? 1 : 0;
    for (let i = 0; i <= segments; i += 1) {
      const s = i / segments;
      const y = rootY - s * spec.length;
      strandPointAt(spec, y, point);
      strandPointAt(spec, y + 0.5, prev);
      strandPointAt(spec, y - 0.5, next);
      tangent.subVectors(next, prev).normalize();
      normal.crossVectors(tangent, reference).normalize();
      binormal.crossVectors(tangent, normal).normalize();

      const distance = s * spec.length;
      const bead = 1 + look.beadSwell * Math.max(0, Math.sin(distance * look.beadFrequency + spec.seed * 31)) ** 10;
      const flare = 1 + 1.3 * Math.exp(-distance / 4);
      const radius = spec.thickness * (1 - 0.74 * s ** 0.85) * bead * flare;

      let infection = 0;
      for (const at of spec.infections) infection += Math.exp(-((((s - at) * spec.length) / 7) ** 2));
      infection = Math.min(1, infection);

      for (let j = 0; j < radial; j += 1) {
        const angle = (j / radial) * Math.PI * 2;
        const nx = normal.x * Math.cos(angle) + binormal.x * Math.sin(angle);
        const ny = normal.y * Math.cos(angle) + binormal.y * Math.sin(angle);
        const nz = normal.z * Math.cos(angle) + binormal.z * Math.sin(angle);
        positions.push(point.x + nx * radius, point.y + ny * radius, point.z + nz * radius);
        normals.push(nx, ny, nz);
        alongs.push(s);
        seeds.push(spec.seed);
        infects.push(infection);
        hosts.push(host);
      }
    }
    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < radial; j += 1) {
        const a = vertexStart + i * radial + j;
        const b = vertexStart + i * radial + ((j + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        indices.push(a, c, b, b, c, d);
      }
    }
    ranges.push({ start: vertexStart, count: (segments + 1) * radial });
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(alongs), 1));
  geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1));
  geometry.setAttribute('aInfect', new BufferAttribute(new Float32Array(infects), 1));
  geometry.setAttribute('aHost', new BufferAttribute(new Float32Array(hosts), 1));
  const healAttribute = new BufferAttribute(new Float32Array(alongs.length).fill(NEVER), 1);
  geometry.setAttribute('aHeal', healAttribute);
  const vertexCount = alongs.length;
  geometry.setIndex(vertexCount > 65535 ? new BufferAttribute(new Uint32Array(indices), 1) : new BufferAttribute(new Uint16Array(indices), 1));
  geometry.computeBoundingSphere();

  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const along = attribute<'float'>('aAlong', 'float');
  const seed = attribute<'float'>('aSeed', 'float');
  const healAt = attribute<'float'>('aHeal', 'float');
  const infectAmount = attribute<'float'>('aInfect', 'float');
  const hostAmount = attribute<'float'>('aHost', 'float');

  // Sway: a slow travelling wave, stronger toward the tips.
  const tipWeight = pow(along, float(1.35));
  const phase = uniforms.clock.mul(0.6).add(seed.mul(6.283));
  const swayX = sin(along.mul(5.0).sub(phase)).add(sin(along.mul(11.0).sub(phase.mul(1.7)).add(seed.mul(3.1))).mul(0.45));
  const swayZ = cos(along.mul(4.2).sub(phase.mul(0.9)).add(1.3));
  const swayed = positionLocal.add(vec3(swayX, float(0), swayZ).mul(tipWeight).mul(uniforms.sway));
  const viewDistance = length(modelWorldMatrix.mul(vec4(swayed, float(1))).xyz.sub(cameraPosition));
  material.positionNode = swayed.add(normalLocal.mul(viewDistance.mul(uniforms.inflate)));

  // Health: global vitality, host strands held sick until cleansed.
  const since = uniforms.clock.sub(healAt);
  const healed = clamp(since.div(1.4), 0, 1);
  const baseLife = mix(uniforms.life, uniforms.hostLife, hostAmount);
  const life = max(baseLife, healed);

  // Beat bands: pulses of light leave the bell on every beat and run down.
  const bandPhase = fract(uniforms.beat.sub(along.mul(look.bandsPerStrand)).add(seed.mul(0.37)));
  const band = exp(bandPhase.mul(-6.5)).mul(float(0.3).add(life.mul(0.9)));
  // The downbeat contraction: one brighter ring near the roots.
  const rootPulse = uniforms.pulse.mul(exp(along.mul(-9)));

  // Cleansing flash: a bright front runs from the tip back up to the bell.
  const front = float(1).sub(since.div(1.5));
  const flashGate = step(float(0), since).mul(float(1).sub(smoothstep(float(1.4), float(1.9), since)));
  const flash = exp(pow(along.sub(front).mul(6.5), float(2)).negate()).mul(flashGate);

  // Phrase wave: on a section downbeat the whole forest lights from the
  // bell down, root to tip in a couple of seconds.
  const waveSince = uniforms.clock.sub(uniforms.waveAt);
  const waveFront = waveSince.mul(0.42);
  const wave = exp(pow(along.sub(waveFront).mul(13), float(2)).negate())
    .mul(step(float(0), waveSince))
    .mul(float(1).sub(smoothstep(float(2.1), float(2.7), waveSince)));

  // Parasite infection: violet mottling around latch points, sour shimmer.
  const infection = infectAmount.mul(float(1).sub(healed));
  const mottle = sin(uniforms.clock.mul(2.6).add(along.mul(90)).add(seed.mul(20))).mul(0.4).add(0.6);

  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const rim = float(1).sub(abs(dot(normalWorld, viewDirection)));
  const sheath = float(0.28).add(pow(rim, float(1.6)).mul(0.72));
  const distance = length(positionWorld.sub(cameraPosition));
  const fade = exp(distance.mul(uniforms.fade).negate()).mul(smoothstep(float(1.4), float(6.5), distance));
  const tipFade = float(1).sub(smoothstep(float(0.86), float(1.0), along));

  const sick = vec3(look.sick.r, look.sick.g, look.sick.b);
  const healthy = vec3(look.healthy.r, look.healthy.g, look.healthy.b);
  const bandColor = vec3(look.band.r, look.band.g, look.band.b);
  const infectionColor = vec3(look.infection.r, look.infection.g, look.infection.b);
  const flashColor = vec3(look.flash.r, look.flash.g, look.flash.b);

  const body = mix(sick, healthy, life).mul(sheath).mul(float(0.22).add(life.mul(0.28)));
  const glow = mix(healthy, bandColor, life).mul(band.add(rootPulse)).mul(float(0.35).add(life.mul(0.9)));
  const sour = infectionColor.mul(infection).mul(mottle).mul(0.9);
  const cleanse = flashColor.mul(flash).mul(uniforms.flashGain);
  const phrase = mix(healthy, bandColor, float(0.55)).mul(wave).mul(float(0.16).add(life.mul(0.3)));
  material.colorNode = body.add(glow).add(sour).add(cleanse).add(phrase).mul(fade).mul(tipFade).mul(uniforms.glow);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;

  const healArray = healAttribute.array as Float32Array;
  const healedStrands = new Set<number>();

  return {
    mesh,
    heal(strand, clockTime) {
      const range = ranges[strand];
      if (!range || healedStrands.has(strand)) return;
      healedStrands.add(strand);
      healArray.fill(clockTime, range.start, range.start + range.count);
      healAttribute.needsUpdate = true;
    },
    healAll(clockTime, spread) {
      specs.forEach((spec, strand) => {
        const range = ranges[strand];
        const jitter = spec.seed * 0.6;
        for (let v = range.start; v < range.start + range.count; v += 1) {
          const at = clockTime + alongs[v] * spread + jitter;
          if (healArray[v] > at) healArray[v] = at;
        }
        healedStrands.add(strand);
      });
      healAttribute.needsUpdate = true;
    },
    reset() {
      healedStrands.clear();
      healArray.fill(NEVER);
      healAttribute.needsUpdate = true;
    },
    isHealed(strand) {
      return healedStrands.has(strand);
    },
  };
}
