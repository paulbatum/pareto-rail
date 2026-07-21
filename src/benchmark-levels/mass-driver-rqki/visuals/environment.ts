import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  MUZZLE_U,
  RAIL_LENGTH,
  barrelRadiusAt,
  createMassDriverRail,
  ringHeat,
  ringU,
  railBasis,
} from '../barrel';
import { LAST_RING_BEAT } from '../timing';
import { ARC_BLUE, BORE_PLATE, BUSBAR, ICE, VOID, WHITE_HOT, ringColor } from './palette';

// THE BARREL. Everything here is derived from the rail and the speed curve, so
// the accelerator geometry and the run's pacing can never disagree: rings sit
// at runProgress(beat), the bore tapers toward the muzzle, and the wall's baked
// vertex colours carry the blue → violet → white heat ramp down the tunnel so
// the far end is visibly hotter than the near end even with bloom at zero.

const RING_POOL = 38;
const WALL_SEGMENTS = 200;
const WALL_SIDES = 16;
const BUSBAR_COUNT = 8;
const STREAK_COUNT = 210;
const STAR_COUNT = 900;

const rail = createMassDriverRail();

type RingSlot = {
  group: Group;
  coil: MeshBasicMaterial;
  aperture: MeshBasicMaterial;
  beat: number;
};

export type Environment = {
  root: Group;
  rings: RingSlot[];
  muzzle: Group;
  muzzlePosition: Vector3;
  starfield: Points;
  update(dt: number, context: EnvironmentFrame): void;
  dispose(): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  cameraU: number;
  runTime: number;
  running: boolean;
  /** Speed factor from the level's speed profile — drives streak scroll and ring bloom. */
  speed: number;
  beatEnergy: number;
  /** Firing-charge progress in [0, 1]; reddens the bore near the muzzle. */
  charge: number;
  /** True once the payload is past the muzzle aperture. */
  launched: boolean;
};

// ---- shared ring geometry ---------------------------------------------------
// Built at unit radius and scaled per slot, so a breech ring is chunky and a
// muzzle ring is a fine bright hoop — the taper does that for free.

const coilGeometry = new TorusGeometry(1, 0.035, 4, 44);
const apertureGeometry = new RingGeometry(0.82, 0.98, 44);
const housingGeometry = buildHousingGeometry();

function buildHousingGeometry() {
  const parts: BufferGeometry[] = [];
  const tab = new TorusGeometry(1, 0.02, 3, 6);
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    const block = new BufferGeometry().copy(tab);
    block.scale(0.055, 0.055, 1);
    block.rotateY(Math.PI / 2);
    block.translate(Math.cos(angle) * 1.06, Math.sin(angle) * 1.06, 0);
    parts.push(block);
  }
  tab.dispose();
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

// ---- construction -----------------------------------------------------------

export function createBarrelEnvironment(scene: Scene): Environment {
  const root = new Group();
  root.name = 'mass-driver-barrel';

  scene.background = VOID.clone();
  scene.fog = new Fog(VOID.clone(), 26, 230);

  const housingMaterial = new MeshBasicMaterial({ color: BORE_PLATE.clone().multiplyScalar(4.2) });
  const wall = buildBoreWall();
  const busbars = buildBusbars();
  const wallMaterial = wall.material as MeshBasicMaterial;
  const busbarMaterial = busbars.material as LineBasicMaterial;
  root.add(wall, busbars);

  const rings: RingSlot[] = [];
  for (let i = 0; i < RING_POOL; i += 1) {
    const group = new Group();
    const coil = createAdditiveBasicMaterial({ color: ARC_BLUE.clone(), side: DoubleSide });
    const aperture = createAdditiveBasicMaterial({ color: ARC_BLUE.clone(), opacity: 0.3, side: DoubleSide });
    group.add(new Mesh(coilGeometry, coil), new Mesh(apertureGeometry, aperture), new Mesh(housingGeometry, housingMaterial));
    group.visible = false;
    root.add(group);
    rings.push({ group, coil, aperture, beat: -1 });
  }

  const { muzzle, muzzlePosition } = buildMuzzle();
  root.add(muzzle);

  const starfield = buildStarfield();
  const orbit = buildOrbitLimb();
  root.add(starfield, orbit);

  const streaks = buildStreaks();
  root.add(streaks.object);

  scene.add(root);

  const ringUs = new Float64Array(LAST_RING_BEAT + 1);
  for (let beat = 0; beat <= LAST_RING_BEAT; beat += 1) ringUs[beat] = ringU(beat);

  const behindU = 26 / RAIL_LENGTH;
  const aheadU = 240 / RAIL_LENGTH;
  const scratchColor = new Color();
  const ringPosition = new Vector3();
  const basis = new Matrix4();
  let firstBeat = 0;

  function update(dt: number, frame: EnvironmentFrame) {
    const cameraU = frame.cameraU;
    if (cameraU < ringUs[Math.max(0, firstBeat)] - aheadU) firstBeat = 0;
    while (firstBeat < LAST_RING_BEAT && ringUs[firstBeat] < cameraU - behindU) firstBeat += 1;

    let slot = 0;
    for (let beat = firstBeat; beat <= LAST_RING_BEAT && slot < rings.length; beat += 1) {
      const u = ringUs[beat];
      if (u > cameraU + aheadU) break;
      seatRing(rings[slot], beat, u, cameraU, frame, scratchColor, ringPosition, basis);
      slot += 1;
    }
    for (let i = slot; i < rings.length; i += 1) rings[i].group.visible = false;

    // The muzzle burns brighter the closer the charge gets to peak.
    const muzzleGlow = muzzle.userData.glow as MeshBasicMaterial;
    const muzzleRing = muzzle.userData.ring as MeshBasicMaterial;
    const approach = MathUtils.clamp(1 - (MUZZLE_U - cameraU) / 0.16, 0, 1);
    muzzleGlow.opacity = 0.1 + approach * 0.55 + frame.beatEnergy * 0.08;
    muzzleGlow.color.copy(WHITE_HOT).multiplyScalar(0.6 + approach * 2.4);
    muzzleRing.color.copy(WHITE_HOT).multiplyScalar(1.4 + approach * 3.2 + frame.beatEnergy * 0.5);

    // Fog opens up as you leave the barrel: inside is a lit tube, outside is
    // nothing at all, and the difference should be the loudest cut in the run.
    const fog = scene.fog as Fog;
    const outside = frame.launched ? 1 : 0;
    fog.near = MathUtils.lerp(fog.near, outside ? 900 : 26, Math.min(1, dt * 3));
    fog.far = MathUtils.lerp(fog.far, outside ? 4200 : 230, Math.min(1, dt * 3));
    ringColor(MathUtils.clamp(cameraU / MUZZLE_U, 0, 1), scratchColor).multiplyScalar(0.035);
    scratchColor.lerp(VOID, outside ? 0.9 : 0.0);
    fog.color.copy(scratchColor).add(VOID);
    (scene.background as Color).copy(fog.color);

    busbarMaterial.opacity = frame.launched ? 0 : 0.55 + frame.beatEnergy * 0.35;
    wallMaterial.opacity = frame.launched ? 0.25 : 1;

    updateStreaks(streaks, dt, frame);
    starfield.position.copy(frame.camera.position);
    orbit.rotation.z += dt * 0.006;
  }

  function seatRing(
    slotRing: RingSlot,
    beat: number,
    u: number,
    cameraU: number,
    frame: EnvironmentFrame,
    color: Color,
    position: Vector3,
    matrix: Matrix4,
  ) {
    slotRing.beat = beat;
    slotRing.group.visible = true;
    const isMuzzleRing = beat === LAST_RING_BEAT;
    position.copy(rail.getPointAt(MathUtils.clamp(u, 0, 1)));
    slotRing.group.position.copy(position);
    slotRing.group.quaternion.setFromRotationMatrix(railBasis(rail, u, 0, matrix));
    slotRing.group.scale.setScalar(barrelRadiusAt(u) * (isMuzzleRing ? 1.18 : 1));

    const heat = ringHeat(beat);
    const aheadUnits = (u - cameraU) * RAIL_LENGTH;
    // Crossing flash: the payload passes exactly one ring per beat, and this is
    // that beat made visible. It is deliberately short and very bright.
    const pass = Math.max(0, 1 - Math.abs(aheadUnits) / 14);
    // Distance falloff so thirty stacked additive hoops do not blob into a wall
    // of white at the vanishing point.
    const fade = MathUtils.clamp(1 - Math.max(0, aheadUnits - 40) / 190, 0.12, 1);
    const heatGain = 0.5 + heat * 1.5;
    const charged = frame.charge * MathUtils.clamp((u - cameraU) * RAIL_LENGTH < 150 ? 1 : 0, 0, 1);

    ringColor(heat, color).multiplyScalar(heatGain * fade * (1 + pass * pass * 5 + frame.beatEnergy * 0.45));
    color.r += charged * 0.9 * fade;
    slotRing.coil.color.copy(color);
    slotRing.coil.opacity = MathUtils.clamp(0.55 + fade * 0.45, 0, 1);

    ringColor(heat, color).multiplyScalar(heatGain * fade * (0.18 + pass * 1.5));
    slotRing.aperture.color.copy(color);
    slotRing.aperture.opacity = MathUtils.clamp(0.1 + pass * 0.5, 0, 0.7) * fade;
  }

  function dispose() {
    root.removeFromParent();
    disposeObject3D(root);
    streaks.geometry.dispose();
  }

  return { root, rings, muzzle, muzzlePosition, starfield, update, dispose };
}

// ---- bore wall --------------------------------------------------------------

function buildBoreWall() {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();
  const point = new Vector3();

  for (let i = 0; i <= WALL_SEGMENTS; i += 1) {
    const t = i / WALL_SEGMENTS;
    const u = t * MUZZLE_U;
    const frame = sampleRailFrame(rail, u);
    // Plate seams: a shallow ripple every few segments so the tube reads as
    // assembled sections rather than a smooth pipe.
    const seam = i % 5 === 0 ? 0.965 : 1;
    const radius = barrelRadiusAt(u) * 1.035 * seam;
    ringColor(t, color).multiplyScalar(0.055 + t * 0.16);
    color.add(BORE_PLATE).multiplyScalar(i % 5 === 0 ? 1.9 : 1);

    for (let s = 0; s < WALL_SIDES; s += 1) {
      const angle = (s / WALL_SIDES) * Math.PI * 2;
      point.copy(frame.position)
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
      // Alternating facet shading so the octagonal bore catches an edge.
      const facet = 0.72 + 0.28 * (s % 2);
      colors.push(color.r * facet, color.g * facet, color.b * facet);
    }
  }

  for (let i = 0; i < WALL_SEGMENTS; i += 1) {
    for (let s = 0; s < WALL_SIDES; s += 1) {
      const a = i * WALL_SIDES + s;
      const b = i * WALL_SIDES + ((s + 1) % WALL_SIDES);
      const c = a + WALL_SIDES;
      const d = b + WALL_SIDES;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    transparent: true,
  }));
  mesh.frustumCulled = false;
  return mesh;
}

// ---- busbars ----------------------------------------------------------------
// Eight conductors running the whole barrel. They carry the same heat ramp as
// the rings, so the tunnel ahead of you is always the brightest thing on screen.

function buildBusbars() {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  const point = new Vector3();
  const samples = 240;

  for (let b = 0; b < BUSBAR_COUNT; b += 1) {
    const angle = (b / BUSBAR_COUNT) * Math.PI * 2 + Math.PI / BUSBAR_COUNT;
    for (let i = 0; i < samples; i += 1) {
      for (const step of [i, i + 1]) {
        const t = MathUtils.clamp(step / samples, 0, 1);
        const u = t * MUZZLE_U;
        const frame = sampleRailFrame(rail, u);
        const radius = barrelRadiusAt(u) * 0.985;
        point.copy(frame.position)
          .addScaledVector(frame.right, Math.cos(angle) * radius)
          .addScaledVector(frame.up, Math.sin(angle) * radius);
        positions.push(point.x, point.y, point.z);
        ringColor(t, color).lerp(BUSBAR, 0.35).multiplyScalar(0.35 + t * 1.5);
        colors.push(color.r, color.g, color.b);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  lines.frustumCulled = false;
  return lines;
}

// ---- muzzle -----------------------------------------------------------------

function buildMuzzle() {
  const group = new Group();
  const radius = barrelRadiusAt(MUZZLE_U);
  const position = rail.getPointAt(MathUtils.clamp(MUZZLE_U, 0, 1));
  group.position.copy(position);
  group.quaternion.setFromRotationMatrix(railBasis(rail, MUZZLE_U, 0));

  const ringMaterial = createAdditiveBasicMaterial({ color: WHITE_HOT.clone().multiplyScalar(2), side: DoubleSide });
  const lip = new Mesh(new TorusGeometry(radius * 1.24, radius * 0.05, 6, 56), ringMaterial);

  const glowMaterial = createAdditiveBasicMaterial({ color: WHITE_HOT.clone(), opacity: 0.1, side: DoubleSide });
  const glow = new Mesh(new CircleGeometry(radius * 1.2, 48), glowMaterial);
  glow.position.z = 1.2;

  const flare = new Mesh(new RingGeometry(radius * 1.24, radius * 2.4, 48), createAdditiveBasicMaterial({
    color: ARC_BLUE.clone(),
    opacity: 0.14,
    side: DoubleSide,
  }));

  group.add(lip, glow, flare);
  group.userData.ring = ringMaterial;
  group.userData.glow = glowMaterial;
  return { muzzle: group, muzzlePosition: position };
}

// ---- open space -------------------------------------------------------------

function buildStarfield() {
  const random = mulberry32(0x4d415353);
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 700 + random() * 900;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
    positions[i * 3 + 2] = Math.cos(phi) * radius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const points = new Points(geometry, new PointsMaterial({
    color: ICE.clone().multiplyScalar(1.3),
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  }));
  points.frustumCulled = false;
  return points;
}

/** The world this gun is bolted to: a dim limb far below the exit corridor. */
function buildOrbitLimb() {
  const group = new Group();
  const body = new Mesh(
    new TorusGeometry(1500, 260, 8, 72),
    new MeshBasicMaterial({ color: new Color(0.018, 0.03, 0.062), fog: false }),
  );
  const limb = new Mesh(
    new TorusGeometry(1690, 5, 4, 96),
    createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.85), opacity: 0.6 }),
  );
  group.add(body, limb);
  group.position.set(0, -1750, -4600);
  group.rotation.x = Math.PI / 2.1;
  group.frustumCulled = false;
  return group;
}

// ---- speed streaks ----------------------------------------------------------
// Camera-local dashes that scroll at the felt airspeed. At the breech they are
// a faint drizzle; by the muzzle they are a solid rain of light.

type Streaks = {
  object: LineSegments;
  geometry: BufferGeometry;
  data: Float32Array;
  material: LineBasicMaterial;
};

function buildStreaks(): Streaks {
  const random = mulberry32(0x53545245);
  const data = new Float32Array(STREAK_COUNT * 4); // x, y, z, length
  const positions = new Float32Array(STREAK_COUNT * 6);
  for (let i = 0; i < STREAK_COUNT; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 4 + random() * 24;
    data[i * 4] = Math.cos(angle) * radius;
    data[i * 4 + 1] = Math.sin(angle) * radius;
    data[i * 4 + 2] = -random() * 190;
    data[i * 4 + 3] = 2 + random() * 5;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: ICE.clone(),
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const object = new LineSegments(geometry, material);
  object.frustumCulled = false;
  return { object, geometry, data, material };
}

function updateStreaks(streaks: Streaks, dt: number, frame: EnvironmentFrame) {
  const { data, geometry, material } = streaks;
  const attribute = geometry.getAttribute('position') as BufferAttribute;
  const positions = attribute.array as Float32Array;
  const travel = frame.speed * 78 * dt;
  const stretch = 1 + frame.speed * 2.6;

  streaks.object.position.copy(frame.camera.position);
  streaks.object.quaternion.copy(frame.camera.quaternion);

  for (let i = 0; i < STREAK_COUNT; i += 1) {
    let z = data[i * 4 + 2] + travel;
    if (z > 6) z -= 196;
    data[i * 4 + 2] = z;
    const x = data[i * 4];
    const y = data[i * 4 + 1];
    const length = data[i * 4 + 3] * stretch;
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = z - length;
  }
  attribute.needsUpdate = true;
  material.opacity = MathUtils.clamp(0.05 + frame.speed * 0.16, 0, 0.55);
  material.color.copy(ICE).lerp(WHITE_HOT, MathUtils.clamp(frame.speed / 3, 0, 1));
}
