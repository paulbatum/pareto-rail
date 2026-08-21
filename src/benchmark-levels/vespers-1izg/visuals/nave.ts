import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  Scene,
  Vector3,
} from 'three';
import type { Color } from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { LineSegments } from 'three';
import { attribute, float, positionView, positionWorld, smoothstep, time, uniform } from 'three/tsl';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';
import { createVespersRail } from '../gameplay';
import { FLOOR_Y, NAVE_HALF_WIDTH, VAULT_APEX_Y } from '../layout';
import { CANDLE, STONE } from './palette';

// The nave: a black gothic skeleton flown down its own axis. Pointed arcade
// arches, piers, string courses, vault diagonals, a candle floor far below,
// and slow dust. Everything is dim stone — the glass supplies all the color.

const RAIL_LENGTH_Z = 382;
const ARCH_STEP = 9.55;
const SPRING_Y = 1.5;
const STRING_Y = 9.2;
const VAPEX_MID = VAULT_APEX_Y - 1.2;

// Shared beat energy, written by the beat handler, read by the stone shader.
export const beatUniform = uniform(0);

export function createNave(scene: Scene): Group {
  const root = new Group();
  const rng = mulberry32(12018934);
  const curve = createVespersRail();

  const positions: number[] = [];
  const colors: number[] = [];
  const seg = (a: Vector3, b: Vector3, color: Color, intensity: number) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
  };

  // Pointed arch profiles: two mirrored curves meeting at a finite angle at
  // the apex, sampled from the rail so the arcade follows the processional.
  const ARCH_SAMPLES = 14;
  const archPoint = (t: number, side: -1 | 1, z: number): Vector3 => {
    const x = side * NAVE_HALF_WIDTH * Math.cos((t * Math.PI) / 2) ** 0.82;
    const y = SPRING_Y + (VAULT_APEX_Y - SPRING_Y) * Math.sin((t * Math.PI) / 2) ** 0.72;
    return new Vector3(x, y, z);
  };

  const archCount = Math.floor(RAIL_LENGTH_Z / ARCH_STEP);
  for (let i = 0; i <= archCount; i += 1) {
    const z = -i * ARCH_STEP;
    const hot = i % 4 === 0;
    for (const side of [-1, 1] as const) {
      seg(new Vector3(side * NAVE_HALF_WIDTH, FLOOR_Y, z), archPoint(0, side, z), STONE, 0.42);
      let previous = archPoint(0, side, z);
      for (let s = 1; s <= ARCH_SAMPLES; s += 1) {
        const point = archPoint(s / ARCH_SAMPLES, side, z);
        seg(previous, point, STONE, hot ? 0.6 : 0.38);
        previous = point;
      }
    }
    seg(
      new Vector3(-NAVE_HALF_WIDTH, FLOOR_Y, z),
      new Vector3(NAVE_HALF_WIDTH, FLOOR_Y, z),
      STONE,
      0.15,
    );
  }

  // String courses: long horizontal mouldings down both walls.
  for (const side of [-1, 1] as const) {
    seg(new Vector3(side * NAVE_HALF_WIDTH, SPRING_Y, 0), new Vector3(side * NAVE_HALF_WIDTH, SPRING_Y, -RAIL_LENGTH_Z), STONE, 0.32);
    seg(new Vector3(side * NAVE_HALF_WIDTH, STRING_Y, 0), new Vector3(side * NAVE_HALF_WIDTH, STRING_Y, -RAIL_LENGTH_Z), STONE, 0.24);
    seg(new Vector3(side * NAVE_HALF_WIDTH, FLOOR_Y, 0), new Vector3(side * NAVE_HALF_WIDTH, FLOOR_Y, -RAIL_LENGTH_Z), STONE, 0.28);
  }

  // Vault diagonals: X-braces between consecutive arches overhead.
  for (let i = 0; i < archCount; i += 1) {
    const z0 = -i * ARCH_STEP;
    const z1 = z0 - ARCH_STEP;
    const zMid = (z0 + z1) / 2;
    seg(new Vector3(-NAVE_HALF_WIDTH, STRING_Y, z0), new Vector3(0, VAULT_APEX_Y, zMid), STONE, 0.18);
    seg(new Vector3(0, VAULT_APEX_Y, zMid), new Vector3(NAVE_HALF_WIDTH, STRING_Y, z1), STONE, 0.18);
    seg(new Vector3(NAVE_HALF_WIDTH, STRING_Y, z0), new Vector3(0, VAPEX_MID, zMid), STONE, 0.12);
    seg(new Vector3(0, VAPEX_MID, zMid), new Vector3(-NAVE_HALF_WIDTH, STRING_Y, z1), STONE, 0.12);
  }

  // Longitudinal floor lines: the perspective cue that sells the floor.
  for (const x of [-8, -4, 0, 4, 8]) {
    seg(new Vector3(x, FLOOR_Y, 0), new Vector3(x, FLOOR_Y, -RAIL_LENGTH_Z), STONE, 0.11);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const viewDistance = positionView.z.negate();
  const travelingGlow = positionWorld.z
    .mul(0.05)
    .add(time.mul(-1.6))
    .sin()
    .mul(0.5)
    .add(0.5)
    .pow(5)
    .mul(0.5);
  material.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(travelingGlow.add(0.75).add(beatUniform.mul(0.35)))
    .mul(viewDistance.mul(-0.008).exp())
    .mul(smoothstep(float(1.2), float(6), viewDistance));

  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  root.add(lines);

  // Candle floor: a warm scatter of points far below, denser near the axis.
  root.add(makeCandles(rng, 620));
  // Dust: slow pale motes inside the nave volume.
  root.add(makeDust(rng, 260));

  scene.add(root);
  return root;
}

function makePoints(positions: Float32Array, colors: Float32Array, colorNode: unknown): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  (material as unknown as { colorNode: unknown }).colorNode = colorNode;
  const points = new Points(geometry, material as never);
  points.frustumCulled = false;
  return points;
}

function makeCandles(rng: () => number, count: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const gaussianish = (rng() + rng() + rng()) / 3;
    const x = (rng() * 2 - 1) * 9 * (0.35 + 0.65 * gaussianish);
    const z = -rng() * RAIL_LENGTH_Z;
    const y = FLOOR_Y + 0.15 + rng() * 1.1;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const intensity = rng() < 0.08 ? 1.6 : 0.35 + rng() * 0.5;
    colors[i * 3] = CANDLE.r * intensity;
    colors[i * 3 + 1] = CANDLE.g * intensity;
    colors[i * 3 + 2] = CANDLE.b * intensity;
  }
  return makePoints(
    positions,
    colors,
    attribute<'vec3'>('color', 'vec3')
      .mul(positionView.z.negate().mul(-0.02).exp().add(float(0.15)))
      .mul(beatUniform.mul(0.25).add(1)) as never,
  );
}

function makeDust(rng: () => number, count: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rng() * 2 - 1) * 10;
    positions[i * 3 + 1] = FLOOR_Y + rng() * (VAULT_APEX_Y - FLOOR_Y);
    positions[i * 3 + 2] = -rng() * RAIL_LENGTH_Z;
    const intensity = 0.1 + rng() * 0.16;
    colors[i * 3] = 0.7 * intensity;
    colors[i * 3 + 1] = 0.75 * intensity;
    colors[i * 3 + 2] = 0.9 * intensity;
  }
  return makePoints(
    positions,
    colors,
    attribute<'vec3'>('color', 'vec3').mul(positionView.z.negate().mul(-0.03).exp().add(float(0.1))) as never,
  );
}
