import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { addPlate, hash01, shadeGeometry, type EnvironmentSink } from './kit';
import { PYRE_GROUND, PYRE_PIT, PYRE_TILES } from './world';

/**
 * The ground and the cut in it.
 *
 * Four slabs laid around the pit rather than one sheet with a hole in it, so the
 * pit walls are those slabs' own cut faces and cost nothing. Their dark outlines
 * define the pit rim without adding another layer of geometry.
 */
export function addGround(sink: EnvironmentSink) {
  const { edge, nearZ, farZ, color } = PYRE_GROUND;
  const ground = (x0: number, x1: number, z0: number, z1: number) =>
    addPlate(sink, { x0, x1, z0, z1, top: 0, drop: PYRE_PIT.depth, color, outline: true });

  ground(-edge, edge, nearZ, PYRE_PIT.nearZ);
  ground(-edge, edge, PYRE_PIT.farZ, farZ);
  ground(-edge, PYRE_PIT.x0, PYRE_PIT.nearZ, PYRE_PIT.farZ);
  ground(PYRE_PIT.x1, edge, PYRE_PIT.nearZ, PYRE_PIT.farZ);

  addTileField(sink);
}

/** All tiles in one instanced draw; facet shading is shared, tint is per tile. */
function addTileField(sink: EnvironmentSink) {
  const { x0, x1, z0, z1, pitch, gap, step, levels, color } = PYRE_TILES;
  const margin = pitch * 0.6;
  const inPit = (x: number, z: number) =>
    x > PYRE_PIT.x0 - margin && x < PYRE_PIT.x1 + margin && z < PYRE_PIT.nearZ + margin && z > PYRE_PIT.farZ - margin;

  const spots: Array<{ x: number; z: number; h: number; tint: number }> = [];
  for (let x = x0 + pitch / 2; x < x1; x += pitch) {
    for (let z = z0 + pitch / 2; z < z1; z += pitch) {
      if (inPit(x, z)) continue;
      // Terrace level keyed on 3x3 tile blocks, so steps run in courses.
      const course = hash01(Math.floor(x / (pitch * 3)) * 1.31, Math.floor(z / (pitch * 3)) * 0.87);
      const h = 2 + Math.floor(course * levels) * step + hash01(x * 0.7, z * 1.9) * 2;
      spots.push({ x, z, h, tint: 0.85 + 0.2 * hash01(x * 1.13, z * 0.41) });
    }
  }

  const geometry = shadeGeometry(new BoxGeometry(pitch - gap, 1, pitch - gap), color);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new InstancedMesh(geometry, material, spots.length);
  const matrix = new Matrix4();
  const tint = new Color();
  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i];
    matrix.makeScale(1, spot.h, 1);
    matrix.setPosition(spot.x, spot.h / 2, spot.z);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, tint.setScalar(spot.tint));
  }
  sink.track(geometry, material);
  sink.add(mesh);
}
