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
    // No outline: the stone surface separates the sections now, and the shells
    // read as wireframe at tower distances.
    addCragTower(sink, { ...tower, sections: tower.sections as readonly TowerSection[], material: stone, outline: false });
  }

  for (const slab of PYRE_MEGASTRUCTURE) {
    addMass(sink, slab);
  }

  addTown(sink);
  addTrenchLining(sink);
  addSky(sink);
}

/**
 * The trench faces: dark machinery panels lining the pit walls, hung with the
 * lit slits that make the cut read as a burning city canyon rather than a bare
 * excavation. Far wall faces the camera; the side walls face into the pit for
 * the overhead legs of the fly-around.
 */
function addTrenchLining(sink: EnvironmentSink) {
  const color = PYRE_TOWN.color;
  const warm: readonly [number, number, number] = [1.0, 0.45, 0.12];
  // far wall, x across the pit at z = -1200
  for (let x = -290; x <= 290; x += 64) {
    const g = hash01(x * 0.77, 3.1);
    const drop = 180 + 90 * hash01(x * 1.21, 7.7);
    addMass(sink, { x, y: -drop / 2 + 6, z: -1186, sx: 58, sy: drop, sz: 26, color, outline: false });
    if (g > 0.45) {
      addSlit(sink, {
        x: x + (g - 0.7) * 30,
        y: -40 - 110 * hash01(x * 0.53, 1.9),
        z: -1171.5,
        sx: 3 + 4 * hash01(x, 11),
        sy: 22 + 40 * hash01(x * 2.3, 5.1),
        sz: 1,
      }, warm, 6);
    }
  }
  // side walls, z along the pit depth
  for (const side of [-1, 1]) {
    for (let z = -1130; z <= -260; z += 72) {
      const g = hash01(z * 0.61, side * 9.7);
      const drop = 160 + 80 * hash01(z * 0.87, side * 3.3);
      addMass(sink, { x: side * 306, y: -drop / 2 + 4, z, sx: 26, sy: drop, sz: 64, color, outline: false });
      if (g > 0.55) {
        addSlit(sink, {
          x: side * 291.5,
          y: -50 - 90 * hash01(z * 1.7, side * 2.1),
          z: z + (g - 0.75) * 34,
          sx: 1,
          sy: 20 + 34 * hash01(z * 0.91, side * 6.3),
          sz: 3 + 4 * hash01(z, side * 13),
        }, warm, 6);
      }
    }
  }
}

/**
 * The sky details on and just in front of the backdrop: a starfield kept to the
 * open upper-right corner, and the small blue sun low on the left — a single
 * hot card whose apparent size is mostly bloom.
 */
function addSky(sink: EnvironmentSink) {
  const cool: readonly [number, number, number] = [0.72, 0.85, 1.0];
  for (let i = 0; i < 70; i += 1) {
    const a = hash01(i * 1.37, 4.9);
    const b = hash01(i * 0.71, 12.3);
    const c = hash01(i * 2.11, 0.7);
    addSlit(sink, {
      x: 700 + a * 5600,
      y: 1500 + b * 3400,
      z: -4260,
      sx: 3 + 5 * c,
      sy: 3 + 5 * hash01(i, 3.3),
      sz: 1,
    }, cool, 1.4 + 1.6 * hash01(i * 3.7, 8.1));
  }
  // Small and far over threshold: the bloom is the sun's apparent size, the card
  // is only its core.
  addSlit(sink, { x: -2400, y: 1500, z: -4220, sx: 34, sy: 34, sz: 1 }, [0.45, 0.7, 1.0], 18);
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
