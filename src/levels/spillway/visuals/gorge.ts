import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import type { Material } from 'three';
import { SPINE, rightVector, type SpineSample } from '../route';
import { wallDisplacement, wallProfile, wallSkyVisibility, type WallSide } from '../world';

// Gorge walls lofted along the river from the cross-sections in world.ts.
// Each profile segment is subdivided a fixed number of times, so every ring has
// the same vertex count and rings stitch into a plain grid; the rock
// displacement is sampled per subdivided vertex, which is where the jointed
// columns and overhang lips come from.

/** Subdivisions of each profile segment, from the underwater toe up to the tucked skirt. */
const SEGMENT_STEPS = [2, 1, 2, 6, 6, 3, 8, 5, 4, 5, 3, 5, 4, 2, 3, 2, 1];

export type LedgeSpot = { position: Vector3; side: WallSide; kind: 'ledge' | 'rim'; s: number };

export type GorgeOptions = {
  /** Spine index range to loft. */
  from: number;
  to: number;
  /** Spine samples between rings. */
  ringStride: number;
  /** Rings per mesh, for frustum culling. */
  chunkRings: number;
  material: Material;
};

export function createGorge(options: GorgeOptions) {
  const group = new Group();
  group.name = 'gorge';
  const ledges: LedgeSpot[] = [];
  const rings: SpineSample[] = [];
  for (let i = options.from; i <= options.to; i += options.ringStride) rings.push(SPINE[i]);

  for (let start = 0; start < rings.length - 1; start += options.chunkRings) {
    const chunk = rings.slice(start, Math.min(rings.length, start + options.chunkRings + 1));
    const mesh = new Mesh(buildChunk(chunk, ledges, start === 0), options.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, ledges };
}

const perRing = SEGMENT_STEPS.reduce((sum, steps) => sum + steps, 1);

function buildChunk(rings: SpineSample[], ledges: LedgeSpot[], first: boolean) {
  const sides: WallSide[] = [-1, 1];
  const count = rings.length * perRing * sides.length;
  const positions = new Float32Array(count * 3);
  const waterY = new Float32Array(count);
  const sky = new Float32Array(count);
  const right = new Vector3();
  let v = 0;
  for (const side of sides) {
    rings.forEach((sample, ringIndex) => {
      const profile = wallProfile(sample, side);
      rightVector(sample.heading, right);
      const emit = (lateral: number, height: number) => {
        const displaced = lateral + (height < -3 ? 0 : wallDisplacement(sample.s, side, height, profile.wall));
        positions[v * 3] = sample.x + right.x * side * displaced;
        positions[v * 3 + 1] = sample.y + height;
        positions[v * 3 + 2] = sample.z + right.z * side * displaced;
        waterY[v] = sample.y;
        sky[v] = height > profile.height[profile.rimIndex] - 0.5 ? 1 : wallSkyVisibility(sample, height, profile.wall);
        v += 1;
      };
      emit(profile.lateral[0], profile.height[0]);
      for (let segment = 0; segment < SEGMENT_STEPS.length; segment += 1) {
        const steps = SEGMENT_STEPS[segment];
        for (let k = 1; k <= steps; k += 1) {
          const t = k / steps;
          emit(
            profile.lateral[segment] + (profile.lateral[segment + 1] - profile.lateral[segment]) * t,
            profile.height[segment] + (profile.height[segment + 1] - profile.height[segment]) * t,
          );
        }
      }
      // Ledges, rims and the plateau for pines and boulders; skip the chunk's shared first ring.
      if ((ringIndex > 0 || first) && ringIndex % 3 === 0 && profile.wall > 8) {
        const spot = (index: number, t: number, kind: LedgeSpot['kind']) => {
          const lateral = profile.lateral[index] + (profile.lateral[index + 1] - profile.lateral[index]) * t;
          const height = profile.height[index] + (profile.height[index + 1] - profile.height[index]) * t;
          const displaced = lateral + wallDisplacement(sample.s, side, height, profile.wall);
          ledges.push({
            position: new Vector3(sample.x + right.x * side * displaced, sample.y + height, sample.z + right.z * side * displaced),
            side,
            kind,
            s: sample.s,
          });
        };
        spot(5, 0.6, 'ledge');
        spot(10, 0.6, 'ledge');
        spot(profile.rimIndex, 0.5, 'rim');
      }
    });
  }

  const indices: number[] = [];
  sides.forEach((side, sideIndex) => {
    const base = sideIndex * rings.length * perRing;
    for (let r = 0; r < rings.length - 1; r += 1) {
      for (let j = 0; j < perRing - 1; j += 1) {
        const a = base + r * perRing + j;
        const b = a + perRing;
        const c = a + 1;
        const d = b + 1;
        if (side === 1) indices.push(a, c, b, c, d, b);
        else indices.push(a, b, c, c, b, d);
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('waterY', new BufferAttribute(waterY, 1));
  geometry.setAttribute('sky', new BufferAttribute(sky, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
