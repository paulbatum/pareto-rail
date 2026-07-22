import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PartBin, glowMesh, solidMesh } from './build';
import { AMBER, CHROME, GANG_RED, HEADLIGHT, PURSE_BLUE, STEEL, TAILLIGHT, hdr } from './palette';

const HALF_PI = Math.PI / 2;

/**
 * The gang boss: a long chromed cruiser, an oversized rider, and your purse on
 * a shoulder strap. Four bolt-on chrome plates armour the flanks; each one that
 * comes off is a stage break, and the bike underneath gets visibly rougher.
 *
 * The purse is the only blue object in the level, so it is built as its own
 * child group — it swings on the strap while the boss rides, and the same
 * factory makes the loose purse that sails out of the fireball at the end.
 */
export function createBossMesh(): Group {
  const group = new Group();

  const body = new PartBin();
  wheel(body, -1.9, 0.78);
  wheel(body, 1.7, 0.82);
  // Long low spine and a raked front end.
  body.add(new BoxGeometry(0.86, 0.62, 2.9), hdr(STEEL, 1.4), { at: [0, -0.22, -0.1] });
  body.add(new ConeGeometry(0.52, 1.5, 6), hdr(STEEL, 1.9), { at: [0, 0.02, -1.75], rotate: [-HALF_PI, 0, 0] });
  body.add(new BoxGeometry(1.16, 0.5, 0.62), hdr(STEEL, 2.1), { at: [0, 0.24, -1.2] });
  for (const side of [-0.3, 0.3]) {
    body.add(new CylinderGeometry(0.07, 0.07, 2.1, 5), hdr(CHROME, 0.85), { at: [side, 0.1, -1.5], rotate: [0.5, 0, 0] });
    body.add(new CylinderGeometry(0.13, 0.16, 2.2, 8), hdr(CHROME, 0.95), { at: [side * 2.2, -0.66, 0.55], rotate: [HALF_PI, 0, 0] });
  }
  // Ape-hangers wide enough to read as a boss at forty metres.
  body.add(new CylinderGeometry(0.06, 0.06, 1.6, 6), hdr(CHROME, 1.0), { at: [0, 0.78, -0.9], rotate: [0, 0, HALF_PI] });
  body.add(new BoxGeometry(1.5, 0.6, 0.14), hdr(STEEL, 1.6), { at: [0, 0.36, 1.5] });
  // Rider: heavy shoulders, no crouch.
  body.add(new BoxGeometry(1.1, 1.2, 0.66), hdr(GANG_RED, 0.16), { at: [0, 0.62, 0.24] });
  body.add(new BoxGeometry(1.52, 0.18, 0.3), hdr(CHROME, 0.55), { at: [0, 1.06, 0.2] });
  body.add(new SphereGeometry(0.28, 10, 8), hdr(CHROME, 0.75), { at: [0, 1.42, 0.14] });
  const chassis = solidMesh(body.merge());

  const lights = new PartBin();
  lights.add(new CircleGeometry(0.4, 14), hdr(HEADLIGHT, 2.6), { at: [0, 0.06, -2.5], rotate: [0, Math.PI, 0] });
  lights.add(new PlaneGeometry(1.3, 0.18), hdr(TAILLIGHT, 3.2), { at: [0, 0.42, 1.6] });
  lights.add(new PlaneGeometry(2.6, 0.16), hdr(GANG_RED, 1.8), { at: [0, -1.14, 0], rotate: [HALF_PI, 0, 0] });
  for (const side of [-1, 1]) {
    lights.add(new CircleGeometry(0.11, 8), hdr(AMBER, 2.8), { at: [side * 2.2, -0.66, 1.66] });
  }
  const glow = glowMesh(lights.merge());

  // Four chrome plates. Index 0 comes off first.
  const plates = new Group();
  const plateSpecs = [
    { at: [-0.62, -0.1, -0.5], rotate: [0, 0.22, 0] },
    { at: [0.62, -0.1, -0.5], rotate: [0, -0.22, 0] },
    { at: [-0.6, -0.2, 0.55], rotate: [0, 0.16, 0] },
    { at: [0.6, -0.2, 0.55], rotate: [0, -0.16, 0] },
  ] as const;
  for (const spec of plateSpecs) {
    const bin = new PartBin();
    bin.add(new BoxGeometry(0.16, 0.86, 1.35), hdr(CHROME, 0.62));
    bin.add(new BoxGeometry(0.2, 0.1, 1.4), hdr(CHROME, 1.15), { at: [0, 0.3, 0] });
    const plate = solidMesh(bin.merge());
    plate.position.set(spec.at[0], spec.at[1], spec.at[2]);
    plate.rotation.set(spec.rotate[0], spec.rotate[1], spec.rotate[2]);
    plates.add(plate);
  }

  const purse = createPurseProp();
  purse.position.set(0.62, 1.0, 0.3);

  group.add(chassis, glow, plates, purse);
  group.userData.kind = 'boss';
  group.userData.bodyMaterial = chassis.material;
  group.userData.glowMaterial = glow.material;
  group.userData.plates = plates;
  group.userData.purse = purse;
  return group;
}

/**
 * The purse itself: a small hard-cornered handbag with a chain strap, a clasp,
 * and a blue halo. This is the level's signature object — it is deliberately
 * over-lit relative to its size so it reads the moment it enters frame.
 */
export function createPurseProp(): Group {
  const group = new Group();

  const body = new PartBin();
  body.add(new BoxGeometry(0.52, 0.4, 0.2), hdr(PURSE_BLUE, 0.9));
  body.add(new BoxGeometry(0.54, 0.1, 0.22), hdr(PURSE_BLUE, 1.6), { at: [0, 0.2, 0] });
  body.add(new BoxGeometry(0.1, 0.09, 0.24), hdr(CHROME, 1.3), { at: [0, 0.24, 0] });
  const bag = solidMesh(body.merge());

  const shine = new PartBin();
  shine.add(new TorusGeometry(0.34, 0.05, 5, 16), hdr(PURSE_BLUE, 2.8), { at: [0, 0.02, 0] });
  shine.add(new PlaneGeometry(0.46, 0.34), hdr(PURSE_BLUE, 1.5));
  shine.add(new PlaneGeometry(0.46, 0.34), hdr(PURSE_BLUE, 1.5), { rotate: [0, HALF_PI, 0] });
  // The strap: a thin chain arc up over the shoulder.
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    shine.add(new BoxGeometry(0.05, 0.05, 0.05), hdr(CHROME, 1.4), {
      at: [(t - 0.5) * 0.9, 0.3 + Math.sin(t * Math.PI) * 0.42, 0],
    });
  }
  const halo = glowMesh(shine.merge());

  group.add(bag, halo);
  group.userData.purseHalo = halo;
  group.userData.purseMaterials = [bag.material, halo.material];
  return group;
}

/** A single plate spinning away after a stage break. */
export function createPlateShard(): Mesh {
  const bin = new PartBin();
  bin.add(new BoxGeometry(0.16, 0.8, 1.2), hdr(CHROME, 1.1));
  bin.add(new BoxGeometry(0.22, 0.08, 1.24), hdr(CHROME, 1.8), { at: [0, 0.28, 0] });
  return solidMesh(bin.merge());
}

function wheel(bin: PartBin, z: number, radius: number) {
  bin.add(new TorusGeometry(radius, 0.2, 6, 18), STEEL, { at: [0, -1.05 + radius, z], rotate: [0, HALF_PI, 0] });
  bin.add(new TorusGeometry(radius * 0.44, 0.07, 5, 14), hdr(CHROME, 0.9), {
    at: [0, -1.05 + radius, z],
    rotate: [0, HALF_PI, 0],
  });
}
