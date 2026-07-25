import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  Shape,
  ShapeGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, positionView } from 'three/tsl';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  AISLE_X,
  BAY,
  BAY_COUNT,
  FLOOR_Y,
  NAVE_END_Z,
  NAVE_HALF,
  ROSE_Z,
  TIER_COUNT,
  VAULT_CROWN_Y,
  VAULT_SPRING_Y,
  WINDOW_COUNT,
  WINDOW_TIERS,
  bayCenterZ,
  clampWindow,
  mirrorWindow,
  nearestWindowIndex,
  windowIndex,
} from '../nave';
import { CANDLE, LEAD, NIGHT, STONE, glassColour, mulberry32 } from './palette';
import { lancetPath, mergeParts } from './shapes';

// The building. Black stone piers, three stacked tiers of openings, ribbed
// vaults closing overhead and a floor of candles far below — and inside all
// that, one hundred and ninety-eight panes of glass that begin the run dark.
//
// Construction is deliberately instanced: one bay of dressed stone, one pier
// bundle and one rib bundle are each built once and stamped down the nave, so
// a cathedral this size costs a handful of draw calls. Everything that changes
// at runtime rides on per-instance colour — which pane is lit, how hard, and
// what that pane throws onto the stone beside it.

const TIERS = WINDOW_TIERS;
const PIER_COUNT = (BAY_COUNT + 1) * 2;

/** Faint ember in a stripped pane: enough to draw the tracery, not enough to be light. */
const DARK_LEVEL = 0.006;
const RELIGHT_RATE = 3.2;

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

export type Cathedral = {
  root: Group;
  windowCount: number;
  colourAt(index: number): Color;
  positionAt(index: number): Vector3;
  nearestWindow(point: Vector3): number;
  mirrorOf(index: number): number;
  /** Something in here has taken this pane: snuff it with a visible flicker. */
  strip(index: number): void;
  /** Won back, and lit for the rest of the run. */
  light(index: number): void;
  /** Every pane at once — the rose going up. */
  lightAll(): void;
  litFraction(): number;
  reset(): void;
  update(dt: number, elapsed: number, viewer: Vector3): void;
};

export function createCathedral(scene: Scene): Cathedral {
  scene.background = NIGHT.clone();
  scene.fog = new FogExp2(NIGHT.clone(), 0.0042);

  const root = new Group();
  const rng = mulberry32(0x5e5e05);
  const stone = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, color: 0xffffff });

  // --- dressed bay wall: one panel of elevation, pierced three times -------
  const bays = new InstancedMesh(buildBayGeometry(), stone, BAY_COUNT * 2);
  writeSideInstances(bays, BAY_COUNT, (bay) => bayCenterZ(bay), 1);
  root.add(bays);

  // --- pier bundles at every bay joint ------------------------------------
  const piers = new InstancedMesh(buildPierGeometry(), stone, PIER_COUNT);
  writeSideInstances(piers, BAY_COUNT + 1, (bay) => -bay * BAY, 1);
  root.add(piers);

  // Coloured light landing on the nearest stone: the same pier, blown up a
  // hair so it sits outside the solid one, additive and black until a pane
  // beside it comes back.
  const pierWash = new InstancedMesh(buildPierGeometry(), additiveStone(), PIER_COUNT);
  writeSideInstances(pierWash, BAY_COUNT + 1, (bay) => -bay * BAY, 1.035);
  fillInstanceColor(pierWash, PIER_COUNT);
  root.add(pierWash);

  // --- ribbed vault -------------------------------------------------------
  const ribs = new InstancedMesh(buildRibGeometry(), stone, BAY_COUNT);
  const ribMatrix = new Matrix4();
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    ribMatrix.makeTranslation(0, 0, -bay * BAY);
    ribs.setMatrixAt(bay, ribMatrix);
  }
  ribs.instanceMatrix.needsUpdate = true;
  root.add(ribs);

  // --- aisle backdrop, pavement and the blind west wall -------------------
  root.add(buildShell());

  // --- the glazing --------------------------------------------------------
  const glassGeometry = lancetGeometry(0.5, 0, 0.35, 1);
  const glass = new InstancedMesh(glassGeometry, additiveStone(), WINDOW_COUNT);
  const halo = new InstancedMesh(glassGeometry, additiveStone(), WINDOW_COUNT);
  const shafts = new InstancedMesh(buildShaftGeometry(), additiveStone(), WINDOW_COUNT);
  const came = new InstancedMesh(
    buildCameGeometry(),
    new MeshBasicMaterial({ color: LEAD, side: DoubleSide }),
    WINDOW_COUNT,
  );
  for (const mesh of [glass, halo, shafts, came]) root.add(mesh);
  for (const mesh of [glass, halo, shafts]) fillInstanceColor(mesh, WINDOW_COUNT);

  const colours: Color[] = [];
  const positions: Vector3[] = [];
  const level = new Float32Array(WINDOW_COUNT);
  const target = new Float32Array(WINDOW_COUNT);
  const flicker = new Float32Array(WINDOW_COUNT);
  const lit = new Uint8Array(WINDOW_COUNT);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  const scratch = new Color();
  let litTotal = 0;

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      for (let tier = 0; tier < TIER_COUNT; tier += 1) {
        const index = windowIndex(bay, side, tier);
        const spec = TIERS[tier];
        const height = spec.apex - spec.sill;
        const z = bayCenterZ(bay);
        colours[index] = glassColour(bay, tier).clone();
        positions[index] = new Vector3(sign * spec.glassX, (spec.sill + spec.apex) / 2, z);
        level[index] = DARK_LEVEL;
        target[index] = DARK_LEVEL;

        quaternion.setFromAxisAngle(UP, sign > 0 ? -Math.PI / 2 : Math.PI / 2);
        position.set(sign * spec.glassX, spec.sill, z);
        scale.set(spec.glassWidth, height, 1);
        glass.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        came.setMatrixAt(index, matrix.compose(position, quaternion, scale));

        position.set(sign * (spec.glassX - 0.4), spec.sill - height * 0.1, z);
        scale.set(spec.glassWidth * 1.8, height * 1.2, 1);
        halo.setMatrixAt(index, matrix.compose(position, quaternion, scale));

        // The shaft leans out of the window and falls across the nave.
        quaternion.setFromUnitVectors(FORWARD, new Vector3(-sign, spec.shaftPitch, 0).normalize());
        position.set(sign * (spec.glassX - 1.2), (spec.sill + spec.apex) / 2, z);
        scale.set(spec.glassWidth * 0.9, spec.glassWidth * 0.9, 1);
        shafts.setMatrixAt(index, matrix.compose(position, quaternion, scale));
      }
    }
  }
  for (const mesh of [glass, halo, shafts, came]) mesh.instanceMatrix.needsUpdate = true;

  // --- candles and incense ------------------------------------------------
  root.add(buildCandles(rng), buildDust(rng));
  scene.add(root);

  function writeWindow(index: number, breath: number, viewer: Vector3) {
    // A lit lancet is a big emissive surface. Close enough to fill the frame it
    // would white the whole shot out, so the last few metres pull it back down
    // to a colour the player can still see targets against.
    const distance = positions[index].distanceTo(viewer);
    const near = Math.min(1, Math.max(0.28, (distance - 6) / 26));
    const value = level[index] * (1 + flicker[index]) * (lit[index] ? breath : 1) * near;
    scratch.copy(colours[index]).multiplyScalar(value * 1.32);
    glass.setColorAt(index, scratch);
    scratch.copy(colours[index]).multiplyScalar(value * 0.085);
    halo.setColorAt(index, scratch);
    scratch.copy(colours[index]).multiplyScalar(Math.max(0, value - DARK_LEVEL) * 0.022);
    shafts.setColorAt(index, scratch);
  }

  const wash = new Color();
  function writeWash() {
    for (let pier = 0; pier < PIER_COUNT; pier += 1) {
      const bay = pier >> 1;
      const side = pier & 1;
      wash.setRGB(0, 0, 0);
      for (const neighbour of [bay - 1, bay]) {
        if (neighbour < 0 || neighbour >= BAY_COUNT) continue;
        for (let tier = 0; tier < TIER_COUNT; tier += 1) {
          const index = windowIndex(neighbour, side, tier);
          const value = Math.max(0, level[index] - DARK_LEVEL) * 0.13;
          wash.r += colours[index].r * value;
          wash.g += colours[index].g * value;
          wash.b += colours[index].b * value;
        }
      }
      pierWash.setColorAt(pier, wash);
    }
    if (pierWash.instanceColor) pierWash.instanceColor.needsUpdate = true;
  }

  function markLit(index: number) {
    if (!lit[index]) litTotal += 1;
    lit[index] = 1;
    target[index] = Math.max(target[index], 0.78);
  }

  return {
    root,
    windowCount: WINDOW_COUNT,
    colourAt: (index) => colours[clampWindow(index)],
    positionAt: (index) => positions[clampWindow(index)],
    nearestWindow: nearestWindowIndex,
    mirrorOf: mirrorWindow,
    strip(index) {
      const safe = clampWindow(index);
      if (lit[safe]) return;
      flicker[safe] = 5.5;
    },
    light(index) {
      const safe = clampWindow(index);
      markLit(safe);
      target[safe] = 1;
      flicker[safe] = 2.6;
    },
    lightAll() {
      // Every remaining pane comes up at once, but a little under the ones the
      // player actually won: the whole nave alight still has to read as stone
      // with windows in it rather than as a white screen.
      for (let index = 0; index < WINDOW_COUNT; index += 1) {
        if (!lit[index]) target[index] = 0.78;
        markLit(index);
        flicker[index] = 2.6;
      }
    },
    litFraction: () => litTotal / WINDOW_COUNT,
    reset() {
      litTotal = 0;
      for (let index = 0; index < WINDOW_COUNT; index += 1) {
        lit[index] = 0;
        level[index] = DARK_LEVEL;
        target[index] = DARK_LEVEL;
        flicker[index] = 0;
      }
    },
    update(dt, elapsed, viewer) {
      // A slow swell through the whole glazing: lit panes never sit still.
      const breath = 1 + Math.sin(elapsed * 0.85) * 0.06;
      for (let index = 0; index < WINDOW_COUNT; index += 1) {
        if (flicker[index] > 0) flicker[index] = Math.max(0, flicker[index] - dt * 8.5);
        const gap = target[index] - level[index];
        if (Math.abs(gap) > 0.0004) level[index] += gap * Math.min(1, dt * RELIGHT_RATE);
        writeWindow(index, breath, viewer);
      }
      if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
      if (shafts.instanceColor) shafts.instanceColor.needsUpdate = true;
      writeWash();
    },
  };
}

function additiveStone() {
  return new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff, side: DoubleSide }));
}

/** Stamp a per-bay geometry down both arcades; the far side is the same bay turned around. */
function writeSideInstances(mesh: InstancedMesh, count: number, zAt: (bay: number) => number, uniformScale: number) {
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(uniformScale, uniformScale, uniformScale);
  for (let bay = 0; bay < count; bay += 1) {
    for (let side = 0; side < 2; side += 1) {
      quaternion.setFromAxisAngle(UP, side === 0 ? 0 : Math.PI);
      position.set(0, 0, zAt(bay));
      mesh.setMatrixAt(bay * 2 + side, matrix.compose(position, quaternion, scale));
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
}

function fillInstanceColor(mesh: InstancedMesh, count: number) {
  const black = new Color(0, 0, 0);
  for (let index = 0; index < count; index += 1) mesh.setColorAt(index, black);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function lancetGeometry(halfWidth: number, sill: number, spring: number, apex: number) {
  return new ShapeGeometry(lancetPath(new Shape(), halfWidth, sill, spring, apex), 14);
}

/**
 * One bay of nave elevation, built flat and then stood up against the arcade:
 * a pierced wall plus moulded reveals around the arcade and clerestory
 * openings so the stone has depth instead of reading as a cut-out.
 */
function buildBayGeometry() {
  const wall = new Shape();
  const half = BAY / 2;
  wall.moveTo(-half, FLOOR_Y - 6);
  wall.lineTo(half, FLOOR_Y - 6);
  wall.lineTo(half, VAULT_SPRING_Y + 6);
  wall.lineTo(-half, VAULT_SPRING_Y + 6);
  wall.closePath();
  for (const tier of TIERS) {
    wall.holes.push(lancetPath(new Path(), tier.halfWidth, tier.sill, tier.spring, tier.apex));
  }

  const parts: BufferGeometry[] = [shade(new ShapeGeometry(wall, 14), 0.5, 1.6)];
  for (const tier of [TIERS[0], TIERS[2]]) {
    const ring = new Shape();
    lancetPath(ring, tier.halfWidth + 1.2, tier.sill, tier.spring, tier.apex + 1.3);
    ring.holes.push(lancetPath(new Path(), tier.halfWidth, tier.sill, tier.spring, tier.apex));
    parts.push(shade(new ShapeGeometry(ring, 14).translate(0, 0, 1.2), 1.6, 2.6));
  }

  return mergeParts(parts).rotateY(-Math.PI / 2).translate(NAVE_HALF, 0, 0);
}

/** A compound pier: core plus four attached shafts, running pavement to vault. */
function buildPierGeometry() {
  const height = VAULT_SPRING_Y + 6 - FLOOR_Y;
  const midY = (VAULT_SPRING_Y + 6 + FLOOR_Y) / 2;
  const parts: BufferGeometry[] = [
    shade(new BoxGeometry(3.4, height, 3.4).translate(0, midY, 0), 0.45, 1.5),
  ];
  for (const [dx, dz] of [[-1.9, 0], [1.9, 0], [0, -1.9], [0, 1.9]] as const) {
    parts.push(shade(new CylinderGeometry(0.85, 0.85, height, 7, 1, true).translate(dx, midY, dz), 0.8, 2.2));
  }
  parts.push(shade(new BoxGeometry(5.4, 1.6, 5.4).translate(0, VAULT_SPRING_Y - 1, 0), 2.2, 2.6));
  parts.push(shade(new BoxGeometry(5.8, 2.2, 5.8).translate(0, FLOOR_Y + 1.1, 0), 2.4, 2.8));

  return mergeParts(parts).translate(NAVE_HALF - 1.6, 0, 0);
}

/** One vault cell: the transverse arch plus the pair of diagonals under it. */
function buildRibGeometry() {
  const x = NAVE_HALF - 1.6;
  const arc = (from: Vector3, to: Vector3, crown: number) => new TubeGeometry(
    new CatmullRomCurve3([
      from,
      from.clone().lerp(to, 0.25).setY(from.y + (crown - from.y) * 0.74),
      from.clone().lerp(to, 0.5).setY(crown),
      from.clone().lerp(to, 0.75).setY(to.y + (crown - to.y) * 0.74),
      to,
    ]),
    18,
    0.62,
    5,
    false,
  );
  const parts = [
    arc(new Vector3(x, VAULT_SPRING_Y, 0), new Vector3(-x, VAULT_SPRING_Y, 0), VAULT_CROWN_Y),
    arc(new Vector3(x, VAULT_SPRING_Y, 0), new Vector3(-x, VAULT_SPRING_Y, -BAY), VAULT_CROWN_Y - 1.5),
    arc(new Vector3(-x, VAULT_SPRING_Y, 0), new Vector3(x, VAULT_SPRING_Y, -BAY), VAULT_CROWN_Y - 1.5),
  ].map((geometry) => shade(geometry, 1.3, 1.9));
  return mergeParts(parts);
}

/** Pavement, aisle backdrops and the blind walls that close both ends. */
function buildShell() {
  const group = new Group();
  const dark = new MeshBasicMaterial({ color: STONE.clone().multiplyScalar(0.5), side: DoubleSide });
  const length = 24 - ROSE_Z;
  const centreZ = (12 + ROSE_Z) / 2;

  const floor = new Mesh(new PlaneGeometry(AISLE_X * 2 + 12, length), dark);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, centreZ);
  group.add(floor);

  for (const sign of [1, -1]) {
    const backdrop = new Mesh(new PlaneGeometry(length, 74), dark);
    backdrop.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    backdrop.position.set(sign * (AISLE_X + 2), 6, centreZ);
    group.add(backdrop);
  }

  const west = new Mesh(new PlaneGeometry(AISLE_X * 2 + 12, 118), dark);
  west.position.set(0, 26, ROSE_Z - 2);
  group.add(west);

  const east = new Mesh(new PlaneGeometry(AISLE_X * 2 + 12, 118), dark);
  east.position.set(0, 26, 24);
  group.add(east);

  group.userData.raildIgnoreOcclusion = true;
  return group;
}

/**
 * Two quads crossed along the beam axis, faded to black at the edges and the
 * far end. Crossing them means the shaft never vanishes edge-on as the camera
 * slides past the window that casts it.
 */
function buildShaftGeometry() {
  const length = 48;
  const parts: BufferGeometry[] = [];
  for (const roll of [0, Math.PI / 2]) {
    const geometry = new PlaneGeometry(1, length, 1, 8);
    geometry.rotateX(Math.PI / 2).rotateZ(roll).translate(0, 0, length / 2);
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const along = 1 - Math.min(1, Math.max(0, position.getZ(i) / length));
      const across = 1 - Math.min(1, Math.abs(roll === 0 ? position.getX(i) : position.getY(i)) * 2);
      const value = along * along * across;
      colors[i * 3] = value;
      colors[i * 3 + 1] = value;
      colors[i * 3 + 2] = value;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    parts.push(geometry);
  }
  return mergeParts(parts);
}

/** Lead came: the dark bars that hold the panes, drawn as a grid over the glass. */
function buildCameGeometry() {
  const parts: BufferGeometry[] = [];
  for (const y of [0.16, 0.34, 0.52, 0.7, 0.86]) parts.push(new PlaneGeometry(1, 0.014).translate(0, y, 0.03));
  for (const x of [-0.26, 0, 0.26]) parts.push(new PlaneGeometry(0.014, 1).translate(x, 0.5, 0.03));
  parts.push(new PlaneGeometry(0.034, 1).translate(0, 0.5, 0.031));
  return mergeParts(parts);
}

/** Ranks of votive lights on the pavement, far below the rail. */
function buildCandles(rng: () => number) {
  const group = new Group();
  const count = 1400;
  const flame = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(rng() * 6);
    const sign = rng() < 0.5 ? 1 : -1;
    flame[i * 3] = sign * (5 + row * 4.8 + (rng() - 0.5) * 1.8);
    flame[i * 3 + 1] = FLOOR_Y + 1.4 + rng() * 0.9;
    flame[i * 3 + 2] = 12 - rng() * (12 - ROSE_Z + 6);
    const heat = 0.45 + rng() * 1.7;
    colors[i * 3] = CANDLE.r * heat;
    colors[i * 3 + 1] = CANDLE.g * heat;
    colors[i * 3 + 2] = CANDLE.b * heat;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flame, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const flames = new Points(geometry, distanceFadedPoints(0.66, 0.0125, 1));
  const glow = new Points(geometry, distanceFadedPoints(3.2, 0.02, 0.05));
  flames.frustumCulled = false;
  glow.frustumCulled = false;
  group.add(flames, glow);
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

/** Incense and dust hanging in the nave: the only thing in here that reads as air. */
function buildDust(rng: () => number) {
  const count = 420;
  const position = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    position[i * 3] = (rng() - 0.5) * 62;
    position[i * 3 + 1] = -26 + rng() * 74;
    position[i * 3 + 2] = 12 - rng() * (12 - NAVE_END_Z);
    const value = 0.010 + rng() * 0.034;
    colors[i * 3] = value;
    colors[i * 3 + 1] = value * 0.86;
    colors[i * 3 + 2] = value * 0.78;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const points = new Points(geometry, distanceFadedPoints(0.24, 0.03, 1));
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

/**
 * Point sprites clamp to a pixel however far away they are, so a long nave
 * full of candles piles up into a white smear at the vanishing point unless
 * their brightness is faded with view distance explicitly.
 */
function distanceFadedPoints(size: number, falloff: number, strength: number) {
  const material = new PointsNodeMaterial(additiveMaterialParameters({ size, sizeAttenuation: true }));
  material.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(float(strength))
    .mul(positionView.z.negate().mul(-falloff).exp());
  return material;
}

/**
 * Bake the only shading this level has. There are no lights in here: form
 * comes from a vertical gradient across the stone, strongest around the
 * arcade and falling away into the pavement and the vault.
 */
function shade(geometry: BufferGeometry, low: number, high: number) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const band = Math.min(1, Math.max(0, (position.getY(i) - FLOOR_Y) / (VAULT_CROWN_Y - FLOOR_Y)));
    const arch = 0.5 + 0.5 * Math.sin(Math.min(1, band * 1.4) * Math.PI);
    const value = (low + (high - low) * band) * arch;
    colors[i * 3] = STONE.r * value;
    colors[i * 3 + 1] = STONE.g * value;
    colors[i * 3 + 2] = STONE.b * value;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
