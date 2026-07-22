import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PartBin, glowMesh, solidMesh } from './build';
import { AMBER, CHROME, GANG_RED, HEADLIGHT, NEON_PINK, STEEL, TAILLIGHT, hdr } from './palette';

/**
 * Gang hardware. Every bike is modelled nose-down -Z with its tyre contact
 * patch at y = -1.05, which is the ride height the rail seats riders at, so a
 * model drops straight onto the tarmac without a fudge offset.
 *
 * The four rider kinds are built to be told apart in one glance at speed:
 * the weaver is long and low with the rider folded over the tank, the swinger
 * is a raked chopper with ape-hangers and an upright rider, the hauler is a
 * wide boxy tourer wearing panniers, and the flyer is a tall dirt bike with the
 * rider standing on the pegs.
 */

const HALF_PI = Math.PI / 2;
const bodyCache = new Map<string, BufferGeometry>();
const glowCache = new Map<string, BufferGeometry>();

export function createRiderMesh(kind: string): Group {
  const group = new Group();
  const body = solidMesh(cachedBody(kind));
  const glow = glowMesh(cachedGlow(kind));
  group.add(body, glow);
  group.userData.kind = kind;
  group.userData.bodyMaterial = body.material;
  group.userData.glowMaterial = glow.material;
  return group;
}

function cachedBody(kind: string) {
  const cached = bodyCache.get(kind);
  if (cached) return cached;
  const bin = new PartBin();
  BUILDERS[kind]?.body(bin) ?? BUILDERS.weaver.body(bin);
  const merged = bin.merge();
  bodyCache.set(kind, merged);
  return merged;
}

function cachedGlow(kind: string) {
  const cached = glowCache.get(kind);
  if (cached) return cached;
  const bin = new PartBin();
  BUILDERS[kind]?.lights(bin) ?? BUILDERS.weaver.lights(bin);
  const merged = bin.merge();
  glowCache.set(kind, merged);
  return merged;
}

type Builder = { body(bin: PartBin): void; lights(bin: PartBin): void };

/** A spoked wheel standing upright, axle along X. */
function wheel(bin: PartBin, z: number, radius: number, tube: number, rimColor: Color) {
  bin.add(new TorusGeometry(radius, tube, 6, 18), STEEL, { at: [0, -1.05 + radius, z], rotate: [0, HALF_PI, 0] });
  bin.add(new TorusGeometry(radius * 0.42, tube * 0.5, 5, 12), rimColor, {
    at: [0, -1.05 + radius, z],
    rotate: [0, HALF_PI, 0],
  });
}

function rider(bin: PartBin, options: {
  torsoAt: readonly [number, number, number];
  torsoScale: readonly [number, number, number];
  pitch: number;
  headAt: readonly [number, number, number];
  jacket: Color;
}) {
  bin.add(new BoxGeometry(1, 1, 1), options.jacket, {
    at: options.torsoAt,
    scale: options.torsoScale,
    rotate: [options.pitch, 0, 0],
  });
  bin.add(new SphereGeometry(0.21, 8, 6), CHROME, { at: options.headAt });
  // Shoulders read the pose at distance far better than arms do.
  bin.add(new BoxGeometry(0.86, 0.12, 0.2), hdr(CHROME, 0.6), {
    at: [options.torsoAt[0], options.torsoAt[1] + options.torsoScale[1] * 0.42, options.torsoAt[2]],
    rotate: [options.pitch, 0, 0],
  });
}

const BUILDERS: Record<string, Builder> = {
  // --- Sport bike. Long, low, rider folded flat over the tank.
  weaver: {
    body(bin) {
      wheel(bin, -1.1, 0.5, 0.11, hdr(CHROME, 0.5));
      wheel(bin, 1.0, 0.52, 0.13, hdr(CHROME, 0.5));
      bin.add(new ConeGeometry(0.34, 1.15, 6), hdr(CHROME, 0.42), {
        at: [0, -0.28, -0.9],
        rotate: [-HALF_PI, 0, 0],
      });
      bin.add(new BoxGeometry(0.44, 0.38, 1.35), hdr(STEEL, 1.6), { at: [0, -0.16, 0.05] });
      bin.add(new BoxGeometry(0.3, 0.2, 0.9), hdr(CHROME, 0.34), { at: [0, 0.12, 0.6], rotate: [-0.28, 0, 0] });
      bin.add(new CylinderGeometry(0.06, 0.06, 0.9, 5), STEEL, { at: [0.2, -0.42, 0.55], rotate: [HALF_PI, 0, 0] });
      bin.add(new CylinderGeometry(0.06, 0.06, 0.9, 5), STEEL, { at: [-0.2, -0.42, 0.55], rotate: [HALF_PI, 0, 0] });
      rider(bin, {
        torsoAt: [0, 0.24, 0.24],
        torsoScale: [0.58, 0.8, 0.44],
        pitch: 0.62,
        headAt: [0, 0.6, -0.15],
        jacket: hdr(NEON_PINK, 0.12),
      });
    },
    lights(bin) {
      bin.add(new CircleGeometry(0.2, 10), hdr(HEADLIGHT, 2.4), { at: [0, -0.28, -1.48], rotate: [0, Math.PI, 0] });
      bin.add(new PlaneGeometry(0.42, 0.09), hdr(TAILLIGHT, 2.6), { at: [0, 0.1, 1.05] });
      bin.add(new PlaneGeometry(1.05, 0.1), hdr(NEON_PINK, 1.9), { at: [0, -0.86, 0.0], rotate: [HALF_PI, 0, 0] });
      bin.add(new PlaneGeometry(0.06, 1.1), hdr(NEON_PINK, 1.5), { at: [0.24, -0.16, 0.05], rotate: [0, HALF_PI, 0] });
      bin.add(new PlaneGeometry(0.06, 1.1), hdr(NEON_PINK, 1.5), { at: [-0.24, -0.16, 0.05], rotate: [0, HALF_PI, 0] });
    },
  },

  // --- Chopper. Raked forks throw the front wheel way out, ape-hangers stand
  // above the rider's shoulders, and the rider sits bolt upright.
  swinger: {
    body(bin) {
      wheel(bin, -1.62, 0.58, 0.1, hdr(AMBER, 0.5));
      wheel(bin, 0.95, 0.6, 0.2, hdr(AMBER, 0.5));
      for (const side of [-0.16, 0.16]) {
        bin.add(new CylinderGeometry(0.055, 0.055, 1.85, 5), hdr(CHROME, 0.75), {
          at: [side, -0.12, -1.05],
          rotate: [0.66, 0, 0],
        });
      }
      bin.add(new BoxGeometry(0.36, 0.3, 1.5), hdr(STEEL, 1.3), { at: [0, -0.3, 0.1] });
      bin.add(new BoxGeometry(0.5, 0.16, 0.62), hdr(CHROME, 0.3), { at: [0, -0.06, 0.34] });
      // Ape-hangers: the silhouette tell.
      bin.add(new CylinderGeometry(0.045, 0.045, 1.02, 5), hdr(CHROME, 0.9), { at: [0, 0.62, -0.5], rotate: [0, 0, HALF_PI] });
      for (const side of [-0.48, 0.48]) {
        bin.add(new CylinderGeometry(0.045, 0.045, 0.5, 5), hdr(CHROME, 0.9), { at: [side, 0.4, -0.44], rotate: [0.2, 0, 0] });
      }
      // Twin fishtail pipes.
      for (const side of [-0.26, 0.26]) {
        bin.add(new CylinderGeometry(0.075, 0.1, 1.5, 6), hdr(CHROME, 0.85), { at: [side, -0.5, 0.5], rotate: [HALF_PI, 0, 0] });
      }
      bin.add(new BoxGeometry(0.72, 0.5, 0.1), hdr(STEEL, 1.1), { at: [0, 0.18, 0.86] });
      rider(bin, {
        torsoAt: [0, 0.36, 0.3],
        torsoScale: [0.66, 0.9, 0.42],
        pitch: 0.1,
        headAt: [0, 0.94, 0.26],
        jacket: hdr(AMBER, 0.16),
      });
    },
    lights(bin) {
      bin.add(new CircleGeometry(0.26, 12), hdr(HEADLIGHT, 2.2), { at: [0, 0.06, -1.72], rotate: [0, Math.PI, 0] });
      bin.add(new PlaneGeometry(0.36, 0.12), hdr(TAILLIGHT, 2.8), { at: [0, 0.2, 0.92] });
      for (const side of [-0.26, 0.26]) {
        bin.add(new CircleGeometry(0.085, 8), hdr(AMBER, 2.6), { at: [side, -0.5, 1.26] });
      }
      bin.add(new PlaneGeometry(1.3, 0.11), hdr(AMBER, 1.7), { at: [0, -0.9, 0.1], rotate: [HALF_PI, 0, 0] });
    },
  },

  // --- Touring bike. Wide as a car, panniers out either side, a screen up
  // front. Reads as a slab even at forty metres.
  hauler: {
    body(bin) {
      wheel(bin, -1.15, 0.54, 0.14, hdr(GANG_RED, 0.5));
      wheel(bin, 1.05, 0.56, 0.18, hdr(GANG_RED, 0.5));
      bin.add(new BoxGeometry(0.78, 0.62, 1.7), hdr(STEEL, 1.5), { at: [0, -0.16, 0] });
      bin.add(new BoxGeometry(0.92, 0.72, 0.5), hdr(STEEL, 1.9), { at: [0, 0.06, -1.0] });
      bin.add(new PlaneGeometry(0.86, 0.72), hdr(CHROME, 0.34), { at: [0, 0.56, -1.06], rotate: [-0.34, 0, 0] });
      for (const side of [-1, 1]) {
        bin.add(new BoxGeometry(0.44, 0.6, 0.92), hdr(STEEL, 1.7), { at: [side * 0.76, -0.18, 0.72] });
        bin.add(new BoxGeometry(0.46, 0.09, 0.94), hdr(GANG_RED, 0.5), { at: [side * 0.76, 0.15, 0.72] });
      }
      bin.add(new BoxGeometry(1.34, 0.12, 0.28), hdr(CHROME, 0.4), { at: [0, 0.34, 1.12] });
      for (const side of [-0.3, 0.3]) {
        bin.add(new CylinderGeometry(0.09, 0.09, 1.3, 6), hdr(CHROME, 0.7), { at: [side, -0.56, 0.4], rotate: [HALF_PI, 0, 0] });
      }
      rider(bin, {
        torsoAt: [0, 0.42, 0.2],
        torsoScale: [0.82, 0.94, 0.56],
        pitch: 0.2,
        headAt: [0, 1.02, 0.14],
        jacket: hdr(GANG_RED, 0.18),
      });
    },
    lights(bin) {
      bin.add(new PlaneGeometry(0.62, 0.16), hdr(HEADLIGHT, 2.3), { at: [0, 0.04, -1.27] });
      bin.add(new PlaneGeometry(0.9, 0.14), hdr(TAILLIGHT, 3.0), { at: [0, 0.34, 1.27] });
      for (const side of [-1, 1]) {
        bin.add(new PlaneGeometry(0.1, 0.7), hdr(AMBER, 2.2), { at: [side * 0.99, -0.18, 0.72], rotate: [0, HALF_PI, 0] });
      }
      bin.add(new PlaneGeometry(1.9, 0.12), hdr(GANG_RED, 1.6), { at: [0, -0.94, 0.1], rotate: [HALF_PI, 0, 0] });
    },
  },

  // --- Dirt bike off the overpass ramp. Tall, spindly, rider standing on the
  // pegs with the front wheel up. Only kind you ever see against the sky.
  flyer: {
    body(bin) {
      wheel(bin, -1.22, 0.66, 0.16, hdr(HEADLIGHT, 0.5));
      wheel(bin, 1.1, 0.66, 0.16, hdr(HEADLIGHT, 0.5));
      for (const side of [-0.19, 0.19]) {
        bin.add(new CylinderGeometry(0.06, 0.06, 1.5, 5), hdr(CHROME, 0.8), { at: [side, -0.06, -0.86], rotate: [0.36, 0, 0] });
      }
      bin.add(new BoxGeometry(0.34, 0.34, 1.3), hdr(STEEL, 1.4), { at: [0, -0.1, 0.05] });
      bin.add(new BoxGeometry(0.62, 0.08, 0.72), hdr(CHROME, 0.42), { at: [0, 0.44, -1.2], rotate: [0.3, 0, 0] });
      bin.add(new BoxGeometry(0.5, 0.06, 0.6), hdr(CHROME, 0.36), { at: [0, 0.2, 1.0], rotate: [-0.24, 0, 0] });
      bin.add(new CylinderGeometry(0.04, 0.04, 0.94, 5), hdr(CHROME, 0.9), { at: [0, 0.5, -0.66], rotate: [0, 0, HALF_PI] });
      bin.add(new CylinderGeometry(0.08, 0.05, 1.1, 6), hdr(CHROME, 0.7), { at: [0.22, -0.18, 0.45], rotate: [HALF_PI, 0, 0.2] });
      rider(bin, {
        torsoAt: [0, 0.62, 0.16],
        torsoScale: [0.56, 0.96, 0.4],
        pitch: 0.36,
        headAt: [0, 1.2, -0.06],
        jacket: hdr(CHROME, 0.22),
      });
      // Legs down to the pegs — the standing pose.
      for (const side of [-0.22, 0.22]) {
        bin.add(new BoxGeometry(0.17, 0.72, 0.2), hdr(STEEL, 1.8), { at: [side, -0.12, 0.34] });
      }
    },
    lights(bin) {
      bin.add(new CircleGeometry(0.19, 10), hdr(HEADLIGHT, 2.8), { at: [0, 0.44, -1.4], rotate: [0.3, Math.PI, 0] });
      bin.add(new PlaneGeometry(0.42, 0.3), hdr(AMBER, 1.6), { at: [0, 0.5, -1.16], rotate: [0.3, 0, 0] });
      bin.add(new PlaneGeometry(0.3, 0.1), hdr(TAILLIGHT, 2.4), { at: [0, 0.24, 1.24] });
      bin.add(new PlaneGeometry(0.09, 1.4), hdr(HEADLIGHT, 1.1), { at: [0, -0.62, 0], rotate: [0, HALF_PI, 0] });
    },
  },

  // --- Thrown hardware: a strapped satchel charge, tumbling, fuse lit.
  bomb: {
    body(bin) {
      bin.add(new IcosahedronGeometry(0.44, 0), hdr(STEEL, 1.5));
      bin.add(new TorusGeometry(0.46, 0.06, 5, 12), hdr(CHROME, 0.55));
      bin.add(new TorusGeometry(0.46, 0.06, 5, 12), hdr(CHROME, 0.55), { rotate: [HALF_PI, 0, 0] });
      bin.add(new CylinderGeometry(0.05, 0.03, 0.42, 5), hdr(CHROME, 0.6), { at: [0, 0.56, 0] });
    },
    lights(bin) {
      bin.add(new SphereGeometry(0.17, 8, 6), hdr(TAILLIGHT, 3.2));
      bin.add(new SphereGeometry(0.1, 6, 5), hdr(AMBER, 3.4), { at: [0, 0.78, 0] });
      bin.add(new TorusGeometry(0.6, 0.035, 4, 14), hdr(TAILLIGHT, 2.0), { rotate: [0.6, 0.3, 0] });
    },
  },

  // --- Spike cluster: a caltrop star flattened onto the tarmac.
  spike: {
    body(bin) {
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        bin.add(new ConeGeometry(0.12, 0.86, 4), hdr(CHROME, 0.7), {
          at: [Math.cos(angle) * 0.24, 0.1, Math.sin(angle) * 0.24],
          rotate: [Math.sin(angle) * 0.8, 0, -Math.cos(angle) * 0.8],
        });
      }
      bin.add(new OctahedronGeometry(0.26, 0), hdr(STEEL, 1.6));
    },
    lights(bin) {
      bin.add(new TorusGeometry(0.72, 0.045, 4, 16), hdr(AMBER, 2.2), { at: [0, -0.28, 0], rotate: [HALF_PI, 0, 0] });
      bin.add(new SphereGeometry(0.12, 6, 5), hdr(AMBER, 3.0), { at: [0, 0.16, 0] });
    },
  },
};

/** Kill-time debris: a wheel, a shard of fairing and a spray of chrome. */
export function createDebrisMesh(accent: Color): Mesh {
  const bin = new PartBin();
  bin.add(new TorusGeometry(0.3, 0.07, 4, 10), hdr(STEEL, 1.6), { rotate: [0, HALF_PI, 0] });
  bin.add(new BoxGeometry(0.34, 0.06, 0.24), hdr(accent, 0.8), { at: [0.2, 0.1, 0] });
  bin.add(new OctahedronGeometry(0.16, 0), hdr(CHROME, 0.9), { at: [-0.16, -0.1, 0.1] });
  return solidMesh(bin.merge());
}
