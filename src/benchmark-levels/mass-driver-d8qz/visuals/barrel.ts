import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Points,
  PointsMaterial,
  RingGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, mix, positionView, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';

// Construction only. Every colour, count, radius and rate arrives as a
// parameter; the visuals spine decides all of them and writes the uniforms
// below every frame.

/** Blend of arc blue → violet on the barrel wall. */
export const barrelVioletUniform = uniform(0);
/** Blend of the current wall colour → white. */
export const barrelWhiteUniform = uniform(0);
/** Overall wall brightness; climbs with the firing charge. */
export const barrelGlowUniform = uniform(0.5);
/** Accumulated travel of the charge pulses running toward the muzzle. */
export const barrelPulseUniform = uniform(0);
/** Depth at which the wall has faded to black, in world units. */
export const barrelFadeUniform = uniform(340);

const scratchMatrix = new Matrix4();
const scratchRadial = new Vector3();
const scratchCirc = new Vector3();
const scratchPosition = new Vector3();
const scratchScale = new Vector3();

export type RingBankParams = {
  curve: CatmullRomCurve3;
  us: readonly number[];
  boreRadius: number;
  coreWidth: number;
  coilRadius: number;
  coilTube: number;
  vaneRadius: number;
  vaneCount: number;
  vaneLength: number;
  vaneThickness: number;
  twistPerRing: number;
};

export type RingBank = {
  group: Group;
  count: number;
  positions: Vector3[];
  setRingColor(index: number, core: Color, coil: Color, vane: Color): void;
  commit(): void;
};

/**
 * The accelerator rings: one flat glowing bore edge, one faceted coil housing,
 * and a crown of radial vanes, all instanced so the whole barrel costs three
 * draw calls. Consecutive rings are rotated by `twistPerRing` so the vanes
 * spiral like rifling when the payload flies through them.
 */
export function createRingBank(params: RingBankParams): RingBank {
  const count = params.us.length;
  const vaneTotal = count * params.vaneCount;
  const group = new Group();

  const core = new InstancedMesh(
    new RingGeometry(params.boreRadius, params.boreRadius + params.coreWidth, 72),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    count,
  );
  const coil = new InstancedMesh(
    new TorusGeometry(params.coilRadius, params.coilTube, 5, 22),
    new MeshBasicNodeMaterial({ color: 0xffffff }),
    count,
  );
  const vanes = new InstancedMesh(
    new BoxGeometry(params.vaneThickness, params.vaneLength, params.vaneThickness * 1.6),
    new MeshBasicNodeMaterial({ color: 0xffffff }),
    vaneTotal,
  );
  for (const mesh of [core, coil, vanes]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const positions: Vector3[] = [];
  const white = new Color(1, 1, 1);
  for (let index = 0; index < count; index += 1) {
    const frame = sampleRailFrame(params.curve, params.us[index]);
    positions.push(frame.position.clone());
    scratchMatrix.makeBasis(frame.right, frame.up, frame.tangent).setPosition(frame.position);
    core.setMatrixAt(index, scratchMatrix);
    coil.setMatrixAt(index, scratchMatrix);
    core.setColorAt(index, white);
    coil.setColorAt(index, white);

    const twist = index * params.twistPerRing;
    for (let vane = 0; vane < params.vaneCount; vane += 1) {
      const angle = twist + (vane / params.vaneCount) * Math.PI * 2;
      scratchRadial.copy(frame.right).multiplyScalar(Math.cos(angle))
        .addScaledVector(frame.up, Math.sin(angle));
      scratchCirc.copy(frame.right).multiplyScalar(-Math.sin(angle))
        .addScaledVector(frame.up, Math.cos(angle));
      scratchPosition.copy(frame.position).addScaledVector(scratchRadial, params.vaneRadius);
      scratchMatrix.makeBasis(scratchCirc, scratchRadial, frame.tangent).setPosition(scratchPosition);
      const slot = index * params.vaneCount + vane;
      vanes.setMatrixAt(slot, scratchMatrix);
      vanes.setColorAt(slot, white);
    }
  }
  core.instanceMatrix.needsUpdate = true;
  coil.instanceMatrix.needsUpdate = true;
  vanes.instanceMatrix.needsUpdate = true;

  return {
    group,
    count,
    positions,
    setRingColor(index, coreColor, coilColor, vaneColor) {
      core.setColorAt(index, coreColor);
      coil.setColorAt(index, coilColor);
      for (let vane = 0; vane < params.vaneCount; vane += 1) {
        vanes.setColorAt(index * params.vaneCount + vane, vaneColor);
      }
    },
    commit() {
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      if (coil.instanceColor) coil.instanceColor.needsUpdate = true;
      if (vanes.instanceColor) vanes.instanceColor.needsUpdate = true;
    },
  };
}

export type BarrelWallParams = {
  curve: CatmullRomCurve3;
  uEnd: number;
  radius: number;
  lengthSegments: number;
  radialSegments: number;
  conductorCount: number;
  ribCount: number;
  pulseDensity: number;
  base: Color;
  cool: Color;
  warm: Color;
  hot: Color;
};

/**
 * The barrel itself: one long tube rendered from the inside, carrying the
 * conductor stripes and the charge pulses that race toward the muzzle. The wall
 * lives outside the bore, so it never stands between the camera and a target.
 */
export function createBarrelWall(params: BarrelWallParams) {
  const samples = 96;
  const spine = new CatmullRomCurve3(
    Array.from({ length: samples + 1 }, (_value, index) => params.curve.getPointAt((index / samples) * params.uEnd)),
    false,
    'catmullrom',
    0.5,
  );
  const geometry = new TubeGeometry(spine, params.lengthSegments, params.radius, params.radialSegments, false);

  const material = new MeshBasicNodeMaterial({ side: BackSide });
  const coordinates = uv();
  const along = coordinates.x;
  const around = coordinates.y;

  // Conductor rails: thin bright lines running the length of the barrel.
  const stripe = around.mul(params.conductorCount).fract().sub(0.5).abs();
  const stripeMask = smoothstep(float(0.03), float(0.006), stripe);

  // Structural ribs: broad soft bands that give the wall a scale to read speed against.
  const rib = along.mul(params.ribCount).fract().sub(0.5).abs();
  const ribMask = smoothstep(float(0.5), float(0.3), rib).mul(0.32);

  // Charge pulses: light sprinting toward the muzzle along the conductors.
  const pulse = along.mul(params.pulseDensity).sub(barrelPulseUniform).sin().mul(0.5).add(0.5).pow(9);

  const tint = mix(
    mix(vec3(params.cool.r, params.cool.g, params.cool.b), vec3(params.warm.r, params.warm.g, params.warm.b), barrelVioletUniform),
    vec3(params.hot.r, params.hot.g, params.hot.b),
    barrelWhiteUniform,
  );

  const lit = vec3(params.base.r, params.base.g, params.base.b)
    .add(tint.mul(ribMask).mul(0.3))
    .add(tint.mul(stripeMask).mul(barrelGlowUniform.mul(0.5)))
    .add(tint.mul(stripeMask).mul(pulse).mul(barrelGlowUniform.mul(0.9).add(0.25)));

  // Manual depth falloff instead of scene fog: additive ring stacks and a fogged
  // wall do not mix, and this keeps the far barrel reading as black distance.
  const depth = positionView.z.negate();
  const fade = float(1).sub(smoothstep(barrelFadeUniform.mul(0.18), barrelFadeUniform, depth));
  material.colorNode = lit.mul(fade);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

export type FilamentFieldParams = {
  curve: CatmullRomCurve3;
  count: number;
  radiusMin: number;
  radiusMax: number;
  spanUnits: number;
  behindUnits: number;
  railUnits: number;
  length: number;
  thickness: number;
  seed: number;
};

export type FilamentField = {
  mesh: InstancedMesh;
  update(cameraU: number, elapsed: number, color: Color, intensity: number): void;
};

/**
 * Arc filaments crawling along the barrel wall between the coils. They are
 * recycled around the camera so the field is a fixed cost, and they are the
 * closest fast-moving thing in frame — the main peripheral speed cue.
 */
export function createFilamentField(params: FilamentFieldParams): FilamentField {
  const rng = mulberry32(params.seed);
  const mesh = new InstancedMesh(
    new BoxGeometry(params.thickness, params.thickness, 1),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    params.count,
  );
  mesh.frustumCulled = false;

  const spanU = params.spanUnits / params.railUnits;
  const behindU = params.behindUnits / params.railUnits;
  const slots = Array.from({ length: params.count }, (_value, index) => ({
    u: (index / params.count) * spanU,
    angle: rng() * Math.PI * 2,
    radius: params.radiusMin + rng() * (params.radiusMax - params.radiusMin),
    length: params.length * (0.4 + rng() * 1.6),
    phase: rng() * Math.PI * 2,
    rate: 5 + rng() * 11,
  }));

  const color = new Color();
  let lastCameraU = 0;

  return {
    mesh,
    update(cameraU, elapsed, tint, intensity) {
      // Filaments are fixed to the barrel; recycling them forward once the camera
      // has overtaken them is what makes them stream past instead of ride along.
      if (cameraU + 0.0005 < lastCameraU) {
        for (const [index, slot] of slots.entries()) slot.u = (index / slots.length) * spanU;
      }
      lastCameraU = cameraU;
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        while (slot.u < cameraU - behindU) slot.u += spanU;
        const wrapped = Math.min(1, Math.max(0, slot.u));
        const frame = sampleRailFrame(params.curve, wrapped);
        scratchRadial.copy(frame.right).multiplyScalar(Math.cos(slot.angle))
          .addScaledVector(frame.up, Math.sin(slot.angle));
        scratchCirc.copy(frame.right).multiplyScalar(-Math.sin(slot.angle))
          .addScaledVector(frame.up, Math.cos(slot.angle));
        scratchPosition.copy(frame.position).addScaledVector(scratchRadial, slot.radius);
        scratchMatrix.makeBasis(scratchCirc, scratchRadial, frame.tangent).setPosition(scratchPosition);
        scratchScale.set(1, 1, slot.length);
        scratchMatrix.scale(scratchScale);
        mesh.setMatrixAt(index, scratchMatrix);
        const flicker = Math.max(0, Math.sin(elapsed * slot.rate + slot.phase)) ** 3;
        color.copy(tint).multiplyScalar(intensity * (0.12 + flicker * 1.6));
        mesh.setColorAt(index, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

export type MuzzleParams = {
  curve: CatmullRomCurve3;
  u: number;
  boreRadius: number;
  spikeCount: number;
};

export type Muzzle = {
  group: Group;
  position: Vector3;
  iris: Mesh;
  flare: Mesh;
  spikes: Group;
};

/** The end of the barrel: an iris of light with a corona of aperture spikes. */
export function createMuzzle(params: MuzzleParams): Muzzle {
  const frame = sampleRailFrame(params.curve, params.u);
  const group = new Group();
  group.position.copy(frame.position);
  group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));

  const iris = new Mesh(
    new RingGeometry(params.boreRadius * 0.97, params.boreRadius * 1.06, 96),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
  );
  const flare = new Mesh(
    new RingGeometry(params.boreRadius * 1.06, params.boreRadius * 2.1, 72),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide, opacity: 0.55 }),
  );
  const spikes = new Group();
  const spikeGeometry = new BoxGeometry(0.55, params.boreRadius * 0.42, 0.55);
  for (let index = 0; index < params.spikeCount; index += 1) {
    const angle = (index / params.spikeCount) * Math.PI * 2;
    const spike = new Mesh(spikeGeometry, createAdditiveBasicMaterial({ color: 0xffffff }));
    spike.position.set(
      Math.cos(angle) * params.boreRadius * 1.2,
      Math.sin(angle) * params.boreRadius * 1.2,
      0,
    );
    spike.rotation.z = angle - Math.PI / 2;
    spikes.add(spike);
  }
  group.add(flare, iris, spikes);
  return { group, position: frame.position.clone(), iris, flare, spikes };
}

export type StarFieldParams = {
  center: Vector3;
  radius: number;
  count: number;
  size: number;
  seed: number;
};

/** Open space beyond the muzzle. Visible through the aperture the whole run. */
export function createStarField(params: StarFieldParams) {
  const rng = mulberry32(params.seed);
  const positions = new Float32Array(params.count * 3);
  const colors = new Float32Array(params.count * 3);
  for (let index = 0; index < params.count; index += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const distance = params.radius * (0.7 + rng() * 0.6);
    positions[index * 3] = params.center.x + Math.cos(angle) * planar * distance;
    positions[index * 3 + 1] = params.center.y + Math.sin(angle) * planar * distance;
    positions[index * 3 + 2] = params.center.z + z * distance;
    const warmth = rng();
    const level = 0.35 + rng() * 0.9;
    colors[index * 3] = level * (0.7 + warmth * 0.35);
    colors[index * 3 + 1] = level * 0.85;
    colors[index * 3 + 2] = level;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: params.size,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
