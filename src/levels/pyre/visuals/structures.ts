import { addCragTower, addMass, addPyramid, addSlit, hash01, type EnvironmentSink, type TowerSection } from './kit';
import { stoneMaterial } from './stone';
import { PYRE_BACKDROP, PYRE_MEGASTRUCTURE, PYRE_PYRAMID, PYRE_TOWERS, PYRE_TOWN } from './world';

/**
 * Construction only: raises every authored mass from `world.ts` — the great
 * pyramid, the framing crag towers, the overhead megastructure, and the seeded
 * town band along the pit rims.
 */
export function addStructures(sink: EnvironmentSink) {
  addMass(sink, { ...PYRE_BACKDROP, outline: false });
  addPyramid(sink, { ...PYRE_PYRAMID, yaw: 0 });

  const stone = stoneMaterial();
  for (const tower of PYRE_TOWERS) {
    addCragTower(sink, { ...tower, sections: tower.sections as readonly TowerSection[], material: stone });
  }

  for (const slab of PYRE_MEGASTRUCTURE) {
    addMass(sink, slab);
  }

  addTown(sink);
}

/**
 * Seeded block strips: pitch sets the grid, the hash sets each block's exact
 * footprint, height, and whether it appears at all — so the band reads built,
 * not tiled, and survives rebuilds unchanged.
 */
function addTown(sink: EnvironmentSink) {
  const { color, strips, door } = PYRE_TOWN;
  for (let s = 0; s < strips.length; s += 1) {
    const strip = strips[s];
    const { x0, x1, z0, z1, pitch, hMin, hMax } = strip;
    for (let x = x0 + pitch / 2; x < x1; x += pitch) {
      for (let z = z0 + pitch / 2; z < z1; z += pitch) {
        const g = hash01(x * 0.73 + s * 17, z * 0.31);
        if (g < 0.18) continue;
        const h = hMin + (hMax - hMin) * hash01(x * 1.9, z * 0.57 + s);
        const w = pitch * (0.55 + 0.4 * hash01(x * 0.11, z * 1.3));
        const d = pitch * (0.55 + 0.4 * hash01(x * 1.7, z * 0.23));
        const bx = x + (g - 0.5) * pitch * 0.4;
        const bz = z + (hash01(x, z) - 0.5) * pitch * 0.4;
        addMass(sink, { x: bx, y: h / 2, z: bz, sx: w, sy: h, sz: d, color });
        // Lit slits on the camera-facing walls of the far band only: the city
        // shows its windows to the viewer, not to the void behind it.
        if (s === 0 && h > 30 && hash01(bx * 0.37, bz * 1.13) > 0.6) {
          addSlit(sink, {
            x: bx + (hash01(bx, bz * 3.1) - 0.5) * w * 0.5,
            y: h * 0.42,
            z: bz + d / 2 + 1.2,
            sx: 2.4 + 3 * hash01(bz, bx),
            sy: Math.min(h * 0.7, 12 + 26 * hash01(bx * 1.7, bz * 0.9)),
            sz: 1,
          }, [1.0, 0.45, 0.12], 5);
        }
      }
    }
  }
  addMass(sink, {
    x: door.x,
    y: door.y,
    z: door.z,
    sx: door.sx,
    sy: door.sy,
    sz: door.sz,
    color,
  });
}
