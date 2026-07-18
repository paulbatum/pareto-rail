import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BELL_CENTER, BELL_FLATTEN, BELL_RADIUS, CROWN_CENTER, spineAtZ } from '../gameplay';
import {
  BELL_FLESH,
  BELL_RIM,
  JELLY_DEEP,
  JELLY_GOLD,
  JELLY_GREEN,
  PARASITE_VIOLET,
  SUNSHAFT,
  WATER_CLEAR,
  WATER_CROWN,
  WATER_DEEP,
  WATER_NEAR,
  WATER_OPEN,
  hdr,
} from './palette';

// The world is one animal and the water around it.
//
// Nothing in this file writes depth except the marine snow: the strands, the
// bell, the sun shafts and the roots are all additive, because that is what
// bioluminescence in clear water looks like — and because it means the forest
// never hides a target from the player.
//
// The strand forest is anchored to the *spine* (the un-banked centreline),
// not to the rail. That single decision is what makes the two lifts work: the
// rail leaves the tube, and the thicket stays behind.

const STRAND_COUNT = 78;
const STRAND_SPAN = 520;
const STRAND_AHEAD = 470;
const STRAND_BEHIND = 50;
const STRAND_LAYERS = 5;
const PRIMARY_COUNT = 8;
const SNOW_COUNT = 300;
const SNOW_BOX = new Vector3(90, 70, 150);
const SHAFT_COUNT = 6;
const TETHER_COUNT = 3;
/**
 * The skirt ends where it roots. Past this the forest stops, so the crown
 * fight happens in open water instead of behind a wall of converging strands —
 * and emerging from the thicket is itself the arrival at the boss.
 */
const STRAND_ROOT_Z = CROWN_CENTER.z + 58;

export type EnvironmentContext = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  progress: number;
  beatEnergy: number;
  /** Bell contraction, 0 relaxed → 1 fully squeezed. Driven by the transport. */
  contraction: number;
  /** How much of the colony has been freed, 0 → 1. Drains the violet out. */
  clean: number;
};

export type Environment = {
  root: Group;
  tethers: Mesh[];
  update(dt: number, context: EnvironmentContext): void;
};

type Strand = {
  group: Group;
  angle: number;
  radius: number;
  z: number;
  phase: number;
  lean: number;
  sickMaterialIndex: number;
};

type StrandLayer = {
  tube: MeshBasicMaterial;
  bead: MeshBasicMaterial;
  sick: MeshBasicMaterial;
};

const scratch = new Vector3();
const scratchMatrix = new Matrix4();
const scratchColor = new Color();

export function createEnvironmentInternal(scene: Scene): Environment {
  const rng = mulberry32(0x57241d);
  const root = new Group();
  root.name = 'strandline-environment';
  scene.add(root);

  scene.background = WATER_NEAR.clone();
  scene.fog = new FogExp2(WATER_NEAR.clone().getHex(), 0.0021);

  // Water grade. The strands are green and near; the deep is blue and far.
  // The two lifts thin the water out because that is when you are meant to see
  // the whole animal, and the last section clears it completely.
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0.0, background: WATER_NEAR, fog: WATER_NEAR, density: 0.0023 },
    { progress: 0.2, background: WATER_NEAR, fog: WATER_DEEP, density: 0.0021 },
    { progress: 0.29, background: WATER_OPEN, fog: WATER_OPEN, density: 0.00135 },
    { progress: 0.4, background: WATER_NEAR, fog: WATER_DEEP, density: 0.0024 },
    { progress: 0.68, background: WATER_NEAR, fog: WATER_DEEP, density: 0.0025 },
    { progress: 0.78, background: WATER_OPEN, fog: WATER_OPEN, density: 0.0013 },
    { progress: 0.86, background: WATER_CROWN, fog: WATER_CROWN, density: 0.0016 },
    { progress: 0.97, background: WATER_CLEAR, fog: WATER_CLEAR, density: 0.00075 },
    { progress: 1.0, background: WATER_CLEAR, fog: WATER_CLEAR, density: 0.0006 },
  ]);

  // ---- the bell ------------------------------------------------------------

  const bell = new Group();
  bell.position.copy(BELL_CENTER);
  root.add(bell);

  // The dome lives in its own flattened group so the contraction pulse can
  // squeeze it without deforming the oral arms hanging underneath.
  const dome = new Group();
  dome.scale.set(1, BELL_FLATTEN, 1);
  bell.add(dome);

  const bellSkin = new MeshBasicMaterial({
    color: hdr(BELL_FLESH, 1.35),
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    side: DoubleSide,
  });
  dome.add(new Mesh(new SphereGeometry(BELL_RADIUS, 44, 26, 0, Math.PI * 2, 0, Math.PI * 0.62), bellSkin));

  const bellCore = createAdditiveBasicMaterial({ color: hdr(JELLY_DEEP, 0.16), opacity: 0.45 });
  dome.add(new Mesh(new SphereGeometry(BELL_RADIUS * 0.58, 24, 16), bellCore));

  const bellRimMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_RIM, 0.34) });
  const rim = new Mesh(new TorusGeometry(BELL_RADIUS * 0.94, 2.6, 8, 64), bellRimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -BELL_RADIUS * 0.3;
  dome.add(rim);

  // Radial ribs over the dome — the structure that makes the pulse readable.
  const ribMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_RIM, 0.17) });
  for (let i = 0; i < 8; i += 1) {
    const rib = new Mesh(new TorusGeometry(BELL_RADIUS * 0.97, 1.1, 4, 40, Math.PI * 1.02), ribMaterial);
    rib.rotation.y = (i / 8) * Math.PI;
    rib.rotation.z = Math.PI / 2;
    dome.add(rib);
  }

  // Oral arms: four heavy frills hanging around the crown. They are what make
  // the pull-back read as an animal rather than a dome, and up close they
  // frame the boss arena without ever crossing the sightline to it.
  const armMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_DEEP, 0.4), opacity: 0.45, side: DoubleSide });
  const arms = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const arm = new Mesh(new PlaneGeometry(34, 160), armMaterial);
    arm.position.set(Math.cos(angle) * 62, -112, Math.sin(angle) * 62);
    arm.rotation.y = -angle;
    arms.add(arm);
  }
  bell.add(arms);

  // ---- the crown -----------------------------------------------------------

  const crown = new Group();
  crown.position.copy(CROWN_CENTER);
  root.add(crown);

  const crownRingMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GOLD, 0.26) });
  for (const [radius, thickness] of [[34, 1.1], [24, 0.7], [15, 0.5]] as const) {
    const ring = new Mesh(new TorusGeometry(radius, thickness, 6, 40), crownRingMaterial);
    ring.rotation.x = Math.PI * 0.42;
    crown.add(ring);
  }

  // Spread wide and kept dim: the crown has to read as a socket the strands
  // root into, not as a lamp the boss is silhouetted against.
  const crownRootMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.2) });
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    const rootStrand = new Mesh(new CylinderGeometry(0.9, 2.1, 66, 5), crownRootMaterial);
    rootStrand.position.set(Math.cos(angle) * 33, -16, Math.sin(angle) * 33 + 26);
    rootStrand.rotation.z = Math.cos(angle) * 0.5;
    rootStrand.rotation.x = 1.05 + Math.sin(angle) * 0.3;
    crown.add(rootStrand);
  }

  // ---- primary tentacles ---------------------------------------------------

  // Twelve heavy tentacles running the whole length of the skirt. They are
  // deliberately far outside the flight lane — from inside they read as the
  // far wall of the skirt, and only at the pull-back do they become the
  // animal's outline.
  const primaryMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_DEEP, 0.34) });
  const primaries = new Group();
  for (let i = 0; i < PRIMARY_COUNT; i += 1) {
    const angle = (i / PRIMARY_COUNT) * Math.PI * 2;
    const spread = 124 + (i % 3) * 34;
    const zStops = [CROWN_CENTER.z, -300, -60, 200];
    for (let s = 0; s < zStops.length - 1; s += 1) {
      const fromZ = zStops[s];
      const toZ = zStops[s + 1];
      const from = spineAtZ(fromZ, new Vector3());
      const to = spineAtZ(toZ, new Vector3());
      const grow = 1 + s * 0.55;
      from.x += Math.cos(angle) * spread * (1 + s * 0.3);
      from.y += Math.sin(angle) * spread * 0.7 * (1 + s * 0.3) - s * 22;
      to.x += Math.cos(angle) * spread * (1 + (s + 1) * 0.3);
      to.y += Math.sin(angle) * spread * 0.7 * (1 + (s + 1) * 0.3) - (s + 1) * 22;
      const segment = buildSegment(from, to, 3.2 / grow, 2.1 / grow, primaryMaterial);
      primaries.add(segment);
    }
  }
  root.add(primaries);

  // ---- the strand forest ---------------------------------------------------

  const layers: StrandLayer[] = [];
  for (let i = 0; i < STRAND_LAYERS; i += 1) {
    layers.push({
      tube: createAdditiveBasicMaterial({ color: hdr(JELLY_DEEP, 0.9), opacity: 0.85 }),
      bead: createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.9) }),
      sick: createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.65) }),
    });
  }

  const strandGroup = new Group();
  root.add(strandGroup);
  const strands: Strand[] = [];
  for (let i = 0; i < STRAND_COUNT; i += 1) {
    const layer = layers[i % STRAND_LAYERS];
    const length = 120 + rng() * 90;
    const group = new Group();

    const tube = new Mesh(new CylinderGeometry(0.34, 1.5, length, 5, 1, true), layer.tube);
    group.add(tube);

    // Photophores: a bead chain down the strand, merged into one mesh.
    const beadGeometries: BufferGeometry[] = [];
    const beadCount = 9 + Math.floor(rng() * 6);
    for (let b = 0; b < beadCount; b += 1) {
      const t = (b + 0.5) / beadCount;
      const bead = new OctahedronGeometry(0.62 + rng() * 0.5, 0);
      bead.applyMatrix4(scratchMatrix.makeTranslation(
        (rng() - 0.5) * 0.5,
        length * (0.5 - t),
        (rng() - 0.5) * 0.5,
      ));
      beadGeometries.push(bead);
    }
    group.add(new Mesh(mergeGeometries(beadGeometries), layer.bead));
    for (const geometry of beadGeometries) geometry.dispose();

    // Every fourth strand carries a violet bloom of infestation. These are what
    // drain away once the parent is off the animal.
    let sickMaterialIndex = -1;
    if (i % 4 === 0) {
      const sickGeometries: BufferGeometry[] = [];
      for (let s = 0; s < 3; s += 1) {
        const blot = new IcosahedronGeometry(0.9 + rng() * 0.7, 0);
        blot.applyMatrix4(scratchMatrix.makeTranslation((rng() - 0.5) * 1.2, (rng() - 0.5) * length * 0.7, (rng() - 0.5) * 1.2));
        sickGeometries.push(blot);
      }
      const sick = new Mesh(mergeGeometries(sickGeometries), layer.sick);
      sick.name = 'infestation';
      group.add(sick);
      for (const geometry of sickGeometries) geometry.dispose();
      sickMaterialIndex = i % STRAND_LAYERS;
    }

    strandGroup.add(group);
    strands.push({
      group,
      angle: rng() * Math.PI * 2,
      // Weighted toward the rail: the level is called Strandline because you
      // are meant to be inside them, not looking at them.
      radius: 7 + rng() ** 0.65 * 27,
      z: 90 - rng() * STRAND_SPAN,
      phase: rng() * Math.PI * 2,
      lean: (rng() - 0.5) * 0.5,
      sickMaterialIndex,
    });
  }

  // ---- sunlight ------------------------------------------------------------

  // Shafts hang entirely above the camera: they are light coming down from a
  // surface, not beams crossing the lane. Kept very dim — eight overlapping
  // additive planes add up fast.
  const shaftMaterial = createAdditiveBasicMaterial({ color: hdr(SUNSHAFT, 0.014), opacity: 0.45, side: DoubleSide });
  const shafts = new Group();
  for (let i = 0; i < SHAFT_COUNT; i += 1) {
    const shaft = new Mesh(new PlaneGeometry(11 + rng() * 16, 330), shaftMaterial);
    shaft.userData.offset = new Vector3((rng() - 0.5) * 240, 255 + rng() * 110, -70 - rng() * 320);
    shaft.userData.lean = (rng() - 0.5) * 0.24;
    shafts.add(shaft);
  }
  root.add(shafts);

  const surfaceMaterial = createAdditiveBasicMaterial({ color: hdr(SUNSHAFT, 0.010), opacity: 0.6, side: DoubleSide });
  const surface = new Mesh(new PlaneGeometry(4200, 4200), surfaceMaterial);
  surface.rotation.x = Math.PI / 2;
  root.add(surface);

  // ---- marine snow ---------------------------------------------------------

  // The only depth-writing thing in the environment, and the level's main
  // close-range speed cue: particles streaming past inches from the camera.
  const snow = new InstancedMesh(
    new OctahedronGeometry(0.075, 0),
    createAdditiveBasicMaterial({ color: hdr(SUNSHAFT, 0.9) }),
    SNOW_COUNT,
  );
  snow.frustumCulled = false;
  root.add(snow);
  const snowSeeds: Vector3[] = [];
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    snowSeeds.push(new Vector3(
      (rng() - 0.5) * SNOW_BOX.x,
      (rng() - 0.5) * SNOW_BOX.y,
      (rng() - 0.5) * SNOW_BOX.z,
    ));
  }

  // ---- brood umbilicals ----------------------------------------------------

  const tetherMaterial = createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.75), opacity: 0.7, side: DoubleSide });
  const tethers: Mesh[] = [];
  for (let i = 0; i < TETHER_COUNT; i += 1) {
    const tether = new Mesh(new PlaneGeometry(1, 1), tetherMaterial.clone());
    tether.visible = false;
    root.add(tether);
    tethers.push(tether);
  }

  // ---- per-frame -----------------------------------------------------------

  let recycleFloor = 90;

  function update(dt: number, context: EnvironmentContext) {
    const { camera, elapsed, contraction, clean, beatEnergy } = context;
    atmosphere(context.running ? context.progress : 0);

    // The bell contracts and relaxes. This is the level's metronome made flesh:
    // the squeeze lands on the downbeat and the recovery fills the bar.
    const squeeze = contraction;
    dome.scale.set(1 + squeeze * 0.06, BELL_FLATTEN * (1 - squeeze * 0.15), 1 + squeeze * 0.06);
    bell.rotation.y = elapsed * 0.012;
    bellRimMaterial.color.copy(hdr(BELL_RIM, 0.28 + squeeze * 0.34 + clean * 0.22));
    ribMaterial.color.copy(hdr(BELL_RIM, 0.13 + squeeze * 0.16 + clean * 0.12));
    bellCore.color.copy(hdr(JELLY_DEEP, 0.13 + squeeze * 0.12 + clean * 0.1));
    arms.rotation.y = Math.sin(elapsed * 0.18) * 0.09;
    arms.position.y = squeeze * 9;
    crownRingMaterial.color.copy(hdr(JELLY_GOLD, 0.16 + beatEnergy * 0.1 + clean * 0.22));
    crownRootMaterial.color.copy(hdr(JELLY_GREEN, 0.16 + clean * 0.22));
    primaryMaterial.color.copy(hdr(JELLY_DEEP, 0.24 + squeeze * 0.08 + clean * 0.18));

    // Strand light rides the beat, one layer at a time, so the forest ripples
    // rather than flashing as a block.
    for (const [index, layer] of layers.entries()) {
      const offset = Math.sin(elapsed * 1.5 + index * 1.25) * 0.5 + 0.5;
      const glow = 0.5 + beatEnergy * 0.38 * offset + clean * 0.4;
      layer.bead.color.copy(hdr(JELLY_GREEN, glow));
      layer.tube.color.copy(hdr(JELLY_DEEP, 0.5 + beatEnergy * 0.12 + clean * 0.2));
      // Infestation blooms die back with the colony.
      layer.sick.color.copy(hdr(PARASITE_VIOLET, Math.max(0, 0.6 * (1 - clean) ** 1.6)));
    }

    // Strand placement. Recycling only runs while the camera is going forward,
    // so the final pull-back never tears the forest apart behind you.
    const cameraZ = camera.position.z;
    const advancing = context.running && cameraZ < recycleFloor;
    if (advancing) recycleFloor = cameraZ;
    for (const strand of strands) {
      if (advancing && strand.z > cameraZ + STRAND_BEHIND) {
        strand.z -= STRAND_SPAN;
        strand.angle = rng() * Math.PI * 2;
        strand.radius = 7 + rng() ** 0.65 * 27;
        strand.lean = (rng() - 0.5) * 0.5;
        strand.phase = rng() * Math.PI * 2;
      }
      const sway = Math.sin(elapsed * 0.45 + strand.phase) * 0.06;
      spineAtZ(strand.z, scratch);
      strand.group.position.set(
        scratch.x + Math.cos(strand.angle) * strand.radius,
        scratch.y + Math.sin(strand.angle) * strand.radius * 0.78 + 16,
        strand.z,
      );
      strand.group.rotation.set(sway * 0.7, strand.phase, strand.lean + sway);
      strand.group.visible = strand.z < cameraZ + STRAND_BEHIND
        && strand.z > cameraZ - STRAND_AHEAD
        && strand.z > STRAND_ROOT_Z;
    }

    // Sunlight follows the camera so the water is always lit from above.
    for (const shaft of shafts.children) {
      const offset = shaft.userData.offset as Vector3;
      shaft.position.set(camera.position.x + offset.x, camera.position.y + offset.y, camera.position.z + offset.z);
      shaft.rotation.set(0, Math.atan2(camera.position.x - shaft.position.x, camera.position.z - shaft.position.z), shaft.userData.lean as number);
    }
    surface.position.set(camera.position.x, 700, camera.position.z - 200);
    surfaceMaterial.color.copy(hdr(SUNSHAFT, 0.009 + clean * 0.006));

    // Marine snow drifts down and slightly back, wrapped into a box around the
    // camera. It reads as the water having substance.
    const drift = elapsed * 1.6;
    for (let i = 0; i < SNOW_COUNT; i += 1) {
      const seed = snowSeeds[i];
      const x = wrap(seed.x + Math.sin(drift * 0.3 + i) * 1.4, SNOW_BOX.x);
      const y = wrap(seed.y - drift * (0.35 + (i % 5) * 0.08), SNOW_BOX.y);
      const z = wrap(seed.z + drift * 0.2, SNOW_BOX.z);
      scratch.set(camera.position.x + x, camera.position.y + y, camera.position.z + z);
      scratchMatrix.makeTranslation(scratch.x, scratch.y, scratch.z);
      snow.setMatrixAt(i, scratchMatrix);
      scratchColor.copy(SUNSHAFT).multiplyScalar(0.25 + ((i % 7) / 7) * 0.5);
      snow.setColorAt(i, scratchColor);
    }
    snow.instanceMatrix.needsUpdate = true;
    if (snow.instanceColor) snow.instanceColor.needsUpdate = true;

    void dt;
  }

  return {
    root,
    tethers,
    update,
  };
}

/** Builds one tapered tentacle segment spanning two world points. */
function buildSegment(from: Vector3, to: Vector3, radiusTop: number, radiusBottom: number, material: MeshBasicMaterial) {
  const direction = to.clone().sub(from);
  const length = Math.max(1, direction.length());
  const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, length, 6, 1, true), material);
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  // Cylinders are built along +Y; aim the segment down its own axis.
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function wrap(value: number, size: number) {
  const half = size / 2;
  return ((((value + half) % size) + size) % size) - half;
}
