import { BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import type { Color, Material } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { fbm2, nearestSpine, terrainSample } from '../world';

// Heightfield terrain around the gorge, the lake basin and the valley, in
// square tiles whose resolution falls off with distance from the river.
// Tiles of different resolution meet at T-junctions, so every tile hangs a
// skirt down from its border to hide the cracks.

export type TerrainOptions = {
  min: { x: number; z: number };
  max: { x: number; z: number };
  tileSize: number;
  /** Cell size by distance of the tile from the river: [distance below which it applies, cell size]. */
  cells: Array<[distance: number, cell: number]>;
  material: Material;
};

export function createTerrain(options: TerrainOptions) {
  const group = new Group();
  group.name = 'terrain';
  for (let x0 = options.min.x; x0 < options.max.x; x0 += options.tileSize) {
    for (let z0 = options.min.z; z0 < options.max.z; z0 += options.tileSize) {
      const centre = nearestSpine(x0 + options.tileSize / 2, z0 + options.tileSize / 2).distance - options.tileSize * 0.71;
      const cell = (options.cells.find(([distance]) => centre < distance) ?? options.cells[options.cells.length - 1])[1];
      const geometry = buildTile(x0, z0, options.tileSize, cell);
      if (!geometry) continue;
      const mesh = new Mesh(geometry, options.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

const SKIRT = 30;

function buildTile(x0: number, z0: number, size: number, cell: number) {
  const n = Math.round(size / cell) + 1;
  const step = size / (n - 1);
  const grid = n * n;
  const border = (n - 1) * 4;
  const positions = new Float32Array((grid + border) * 3);
  const waterY = new Float32Array(grid + border);
  const buried = new Uint8Array(grid);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const sample = terrainSample(x, z);
      const index = i * n + j;
      positions[index * 3] = x;
      positions[index * 3 + 1] = sample.height;
      positions[index * 3 + 2] = z;
      waterY[index] = sample.waterY;
      buried[index] = sample.buried ? 1 : 0;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < n - 1; j += 1) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = a + 1;
      const d = b + 1;
      if (buried[a] && buried[b] && buried[c] && buried[d]) continue;
      indices.push(a, c, b, c, d, b);
    }
  }
  if (indices.length === 0) return null;

  // Skirt: the border loop, duplicated and dropped.
  const loop: number[] = [];
  for (let j = 0; j < n - 1; j += 1) loop.push(j);
  for (let i = 0; i < n - 1; i += 1) loop.push(i * n + n - 1);
  for (let j = n - 1; j > 0; j -= 1) loop.push((n - 1) * n + j);
  for (let i = n - 1; i > 0; i -= 1) loop.push(i * n);
  loop.forEach((source, k) => {
    const target = grid + k;
    positions[target * 3] = positions[source * 3];
    positions[target * 3 + 1] = positions[source * 3 + 1] - SKIRT;
    positions[target * 3 + 2] = positions[source * 3 + 2];
    waterY[target] = waterY[source];
  });
  for (let k = 0; k < loop.length; k += 1) {
    const a = loop[k];
    const b = loop[(k + 1) % loop.length];
    const c = grid + k;
    const d = grid + ((k + 1) % loop.length);
    indices.push(a, b, c, b, d, c, a, c, b, b, c, d);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('waterY', new BufferAttribute(waterY, 1));
  geometry.setAttribute('sky', new BufferAttribute(new Float32Array(grid + border).fill(1), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Distant mountains as a ring that travels with the camera: at this distance
 * parallax is invisible, and moving the ring keeps it inside the far plane
 * from every point on the route. Unlit; the colour is already the haze.
 */
export function createFarRange(options: { radius: number; peak: Color; base: Color; seed: number }) {
  const segments = 256;
  const geometry = new CylinderGeometry(options.radius, options.radius, 1, segments, 6, true);
  const position = geometry.getAttribute('position');
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    const angle = Math.atan2(point.z, point.x);
    const t = point.y + 0.5;
    const ridge = 150 + 190 * (fbm2(Math.cos(angle) * 3 + options.seed, Math.sin(angle) * 3, 4) * 0.5 + 0.5) + 120 * Math.max(0, fbm2(Math.cos(angle) * 14, Math.sin(angle) * 14 + options.seed, 2));
    position.setXYZ(i, point.x, -260 + t * (ridge + 260), point.z);
  }
  geometry.computeVertexNormals();
  const material = new MeshBasicNodeMaterial({ side: 1 });
  material.name = 'far-range';
  material.fog = false;
  const height = positionLocal.y.add(260).div(560);
  material.colorNode = mix(vec3(options.base.r, options.base.g, options.base.b), vec3(options.peak.r, options.peak.g, options.peak.b), smoothstep(float(0.3), float(0.85), height));
  const mesh = new Mesh(geometry, material);
  mesh.name = 'far-range';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
