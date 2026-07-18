import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionView,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createBroadsideRail, railU } from '../gameplay';
import { BROADSIDE_BARS, bar } from '../timing';
import { CRIMSON, CYAN, hdr, ICE, MOLTEN, mulberry32, NEBULA_GOLD, NEBULA_MAGENTA, OBSIDIAN, VOID_VIOLET, type Rng } from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const shieldUniform = uniform(1); // enemy flagship shield: 1 up → 0 down
export const streakOffsetUniform = uniform(0); // accumulated travel distance
export const streakGlowUniform = uniform(0.3); // streak brightness by act

const STREAK_SPAN = 52;
const STREAK_BACK = 46;

export type Environment = {
  root: Group;
  streaks: Group;
  /** Camera-riding sky shell (nebula + stars) kept inside the far plane. */
  sky: Group;
  /** World positions of the friendly cruiser's dorsal turrets, firing side. */
  cruiserGuns: Vector3[];
  /** Direction the cruiser's broadside fires (toward the enemy line). */
  cruiserFireDirection: Vector3;
  /** Center of the enemy flagship, for shield/breakup choreography. */
  flagshipCenter: Vector3;
  flagshipGroup: Group;
  shieldMesh: Mesh;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = VOID_VIOLET.clone();
  const root = new Group();
  const rng = mulberry32(20260718);
  const curve = createBroadsideRail();

  // The sky shell rides the camera: the far plane sits at 500, so the
  // nebula and starfield live on a small dome that follows the player.
  const sky = new Group();
  sky.add(createNebula());
  sky.add(createStars(rng));
  root.add(sky);
  root.add(createCrossfire(rng, curve));
  root.add(createDebrisField(rng, curve));
  root.add(createLaunchDeck(curve));
  root.add(createFleets(rng, curve));

  const { cruiser, cruiserGuns, cruiserFireDirection } = createFriendlyCruiser(curve);
  root.add(cruiser);
  root.add(createBellyKeel(curve));

  const { flagshipGroup, flagshipCenter, shieldMesh } = createFlagship(curve);
  root.add(flagshipGroup);
  root.add(createTrench(curve));

  const streaks = createSpeedStreaks(rng);
  root.add(streaks);

  scene.add(root);
  return { root, streaks, sky, cruiserGuns, cruiserFireDirection, flagshipCenter, flagshipGroup, shieldMesh };
}

// ---- the nebula -----------------------------------------------------------------

// The whole engagement is backlit by one enormous magenta-and-gold cloud, so
// every hull in the middle distance reads as a silhouette rimmed in colored
// light. It stays below the bloom threshold: color, not glare.
function createNebula() {
  const material = new MeshBasicNodeMaterial({ side: BackSide });
  material.depthWrite = false;
  const direction = positionLocal.normalize();
  const drift = time.mul(0.004);
  const cloud = mx_noise_float(direction.mul(2.3).add(vec3(drift, 0, 0)))
    .mul(0.55)
    .add(mx_noise_float(direction.mul(5.1).add(vec3(0, drift.mul(1.7), 0))).mul(0.3))
    .add(mx_noise_float(direction.mul(11.4)).mul(0.15))
    .mul(0.5)
    .add(0.5);

  // The bright band lies along a tilted plane — a sheet of lit gas behind the
  // fleets, fading toward the poles.
  const band = float(1).sub(direction.dot(vec3(0.25, 0.93, -0.27)).abs()).pow(2.6);

  const voidColor = vec3(VOID_VIOLET.r, VOID_VIOLET.g, VOID_VIOLET.b);
  const magenta = vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b);
  const gold = vec3(NEBULA_GOLD.r, NEBULA_GOLD.g, NEBULA_GOLD.b);

  let color = mix(voidColor, magenta.mul(0.36), smoothstep(float(0.4), float(0.75), cloud).mul(band));
  color = mix(color, gold.mul(0.8), smoothstep(float(0.7), float(0.94), cloud).mul(band));
  color = color.add(magenta.mul(0.045).mul(band));
  material.colorNode = color.mul(beatUniform.mul(0.06).add(1));

  const nebula = new Mesh(new SphereGeometry(430, 48, 32), material);
  nebula.frustumCulled = false;
  nebula.renderOrder = -2;
  return nebula;
}

function createStars(rng: Rng) {
  const count = 1500;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = 415;
    positions[i * 3] = Math.cos(angle) * r * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = Math.sin(angle) * r * radius;
    const roll = rng();
    const base = roll < 0.62 ? ICE : roll < 0.82 ? CYAN : roll < 0.94 ? NEBULA_MAGENTA : NEBULA_GOLD;
    const intensity = rng() < 0.06 ? 1.1 : 0.18 + rng() * 0.4;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 2.2,
    vertexColors: true,
    sizeAttenuation: false,
  }));
  material.depthTest = true;
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}

// ---- the crossfire -----------------------------------------------------------------

// The battle's connective tissue: streams of tracer fire crossing the middle
// distance in both directions — cyan going out, crimson coming back. Each
// tracer is a dash sliding along a fixed lane in the shader.
function createCrossfire(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const LANES = 110;
  const starts: number[] = [];
  const dirs: number[] = [];
  const dists: number[] = [];
  const phases: number[] = [];
  const speeds: number[] = [];
  const deltas: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i < LANES; i += 1) {
    const friendlyToEnemy = i % 2 === 0;
    const u = 0.04 + rng() * 0.86;
    const frame = sampleRailFrame(curve, u);
    // Lanes live above or below the flight corridor so the fire fills the
    // sky without ever crossing the reticle's working space.
    const high = rng() < 0.55;
    const y = high ? 26 + rng() * 70 : -(30 + rng() * 60);
    const zJitter = (rng() - 0.5) * 120;
    const fromSide = friendlyToEnemy ? -1 : 1;
    const from = frame.position.clone()
      .addScaledVector(frame.right, fromSide * (70 + rng() * 240))
      .addScaledVector(frame.up, y * (0.75 + rng() * 0.5))
      .addScaledVector(frame.tangent, zJitter);
    const to = frame.position.clone()
      .addScaledVector(frame.right, -fromSide * (70 + rng() * 240))
      .addScaledVector(frame.up, y * (0.75 + rng() * 0.5) + (rng() - 0.5) * 30)
      .addScaledVector(frame.tangent, zJitter + (rng() - 0.5) * 90);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    const dashLength = 5 + rng() * 7;
    const speed = 130 + rng() * 150;
    const phase = rng() * dist;
    const color = (friendlyToEnemy ? CYAN : CRIMSON).clone().multiplyScalar(0.55 + rng() * 0.5);
    for (const delta of [0, dashLength]) {
      starts.push(from.x, from.y, from.z);
      dirs.push(dir.x, dir.y, dir.z);
      dists.push(dist);
      phases.push(phase);
      speeds.push(speed);
      deltas.push(delta);
      colors.push(color.r, color.g, color.b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(starts.length), 3));
  geometry.setAttribute('aStart', new Float32BufferAttribute(starts, 3));
  geometry.setAttribute('aDir', new Float32BufferAttribute(dirs, 3));
  geometry.setAttribute('aDist', new Float32BufferAttribute(dists, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new Float32BufferAttribute(speeds, 1));
  geometry.setAttribute('aDelta', new Float32BufferAttribute(deltas, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const along = attribute<'float'>('aPhase', 'float')
    .add(time.mul(attribute<'float'>('aSpeed', 'float')))
    .mod(attribute<'float'>('aDist', 'float'));
  material.positionNode = attribute<'vec3'>('aStart', 'vec3')
    .add(attribute<'vec3'>('aDir', 'vec3').mul(along.add(attribute<'float'>('aDelta', 'float'))));
  const progress = along.div(attribute<'float'>('aDist', 'float'));
  const envelope = smoothstep(float(0), float(0.08), progress).mul(smoothstep(float(1), float(0.92), progress));
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(beatUniform.mul(0.25).add(0.85));

  const tracers = new LineSegments(geometry, material);
  tracers.frustumCulled = false;
  return tracers;
}

// ---- near-field debris -----------------------------------------------------------

// Shattered plating tumbling close to the flight path: the thing that makes
// the speed legible. Dark chunks, faction-colored rim flecks.
function createDebrisField(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const scratch = new Matrix4();
  const rotation = new Quaternion();
  for (let i = 0; i < 64; i += 1) {
    const u = 0.02 + rng() * 0.93;
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 24 + rng() * 70;
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 40);
    // Both shapes merged non-indexed so box and tetra chunks share one draw.
    const chunk = rng() < 0.5
      ? new BoxGeometry(2 + rng() * 8, 0.6 + rng() * 3, 3 + rng() * 12).toNonIndexed()
      : (() => {
          const t = new TetrahedronGeometry(2 + rng() * 4, 0);
          t.scale(1, 0.5 + rng() * 0.8, 1);
          return t;
        })();
    rotation.setFromAxisAngle(
      new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rng() * Math.PI * 2,
    );
    scratch.compose(position, rotation, new Vector3(1, 1, 1));
    fills.push(chunk.clone().applyMatrix4(scratch));
    edges.push(new EdgesGeometry(chunk).applyMatrix4(scratch));
    chunk.dispose();
  }
  const group = new Group();
  group.add(new Mesh(mergeGeometries(fills), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) })));
  const edgeMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  edgeMaterial.colorNode = vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b)
    .mul(0.22)
    .mul(positionView.z.negate().mul(-0.012).exp())
    .mul(beatUniform.mul(0.4).add(1));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of [...fills, ...edges]) geometry.dispose();
  return group;
}

// ---- the launch deck ---------------------------------------------------------------

// The first second of the run: your own flagship's bow deck under the rail,
// catapult strips burning cyan, and then it is gone behind you.
function createLaunchDeck(curve: ReturnType<typeof createBroadsideRail>) {
  const group = new Group();
  const frame = sampleRailFrame(curve, 0.0001);
  const deckOrigin = frame.position.clone().addScaledVector(frame.up, -2.6);

  const deck = new Mesh(new BoxGeometry(20, 1.6, 72), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.6) }));
  deck.position.copy(deckOrigin).add(new Vector3(0, 0, -22));
  group.add(deck);

  // Ice-white deck edge rims.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(ICE, 0.5) });
  for (const side of [-1, 1]) {
    const rim = new Mesh(new BoxGeometry(0.3, 0.3, 72), rimMaterial);
    rim.position.copy(deckOrigin).add(new Vector3(side * 10, 0.9, -22));
    group.add(rim);
  }

  // Catapult strips: hot cyan lines dead ahead, aimed into the battle.
  const stripMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const chase = positionWorld.z.mul(0.35).add(time.mul(9)).sin().mul(0.5).add(0.5).pow(2);
  stripMaterial.colorNode = vec3(CYAN.r, CYAN.g, CYAN.b).mul(chase.mul(1.3).add(0.5));
  for (const x of [-1.6, 1.6]) {
    const strip = new Mesh(new BoxGeometry(0.35, 0.2, 66), stripMaterial);
    strip.position.copy(deckOrigin).add(new Vector3(x, 0.95, -22));
    group.add(strip);
  }

  // Superstructure falling away behind: the conning tower you launched past.
  const tower = new Mesh(new BoxGeometry(9, 26, 7), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) }));
  tower.position.copy(deckOrigin).add(new Vector3(-9, 8, 26));
  group.add(tower);
  const towerLightMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.9) });
  const towerLight = new Mesh(new BoxGeometry(9.4, 0.5, 0.5), towerLightMaterial);
  towerLight.position.copy(deckOrigin).add(new Vector3(-9, 16, 22.6));
  group.add(towerLight);

  return group;
}

// ---- the fleets ------------------------------------------------------------------

// Kilometer-class hulls in no neat formation. Every ship is a silhouette:
// near-black mass, faction rim light, engine glow, window strips.
function createCapitalShip(rng: Rng, friendly: boolean, length: number) {
  const group = new Group();
  const height = length * (0.06 + rng() * 0.022);
  const width = length * (0.07 + rng() * 0.025);
  const rim = friendly ? ICE : MOLTEN;
  const glow = friendly ? CYAN : MOLTEN;

  const fills: BufferGeometry[] = [];
  const spine = new BoxGeometry(width, height, length * 0.74);
  fills.push(spine);
  const bow = new BoxGeometry(width * 0.55, height * 0.6, length * 0.3);
  bow.translate(0, height * 0.05, -length * 0.5);
  fills.push(bow);
  const stern = new BoxGeometry(width * 0.8, height * 0.85, length * 0.16);
  stern.translate(0, 0, length * 0.42);
  fills.push(stern);
  // Tower: friendly ships carry it high amidships, enemy ships fin downward.
  const tower = new BoxGeometry(width * 0.28, height * (friendly ? 1.6 : 1.3), length * 0.1);
  tower.translate(width * 0.08, friendly ? height * 1.0 : -height * 0.9, length * (rng() * 0.2));
  fills.push(tower);

  const hullGeometry = mergeGeometries(fills);
  group.add(new Mesh(hullGeometry, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(friendly ? 0.55 : 0.32) })));

  // Rim light: the nebula catching the hull edge.
  const edgeMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const rimVec = vec3(rim.r, rim.g, rim.b);
  edgeMaterial.colorNode = rimVec
    .mul(0.4)
    .mul(positionView.z.negate().mul(-0.004).exp())
    .mul(beatUniform.mul(0.25).add(1));
  group.add(new LineSegments(new EdgesGeometry(spine), edgeMaterial));

  // Window strips along the flank.
  const stripMaterial = createAdditiveBasicMaterial({ color: hdr(glow, friendly ? 0.55 : 0.4), opacity: 0.9 });
  for (const side of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(0.6, height * 0.06, length * 0.6), stripMaterial);
    strip.position.set(side * width * 0.51, height * 0.12, 0);
    group.add(strip);
  }

  // Engine glow: a cluster of hot discs at the stern.
  const engineMaterial = createAdditiveBasicMaterial({ color: hdr(glow, 1.5), side: 2 });
  const engineCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < engineCount; i += 1) {
    const disc = new Mesh(new CircleGeometry(height * (0.16 + rng() * 0.1), 12), engineMaterial);
    disc.position.set((i - (engineCount - 1) / 2) * width * 0.28, -height * 0.08, length * 0.505);
    group.add(disc);
  }

  // Some enemy hulls burn: a molten crack across the flank.
  if (!friendly && rng() < 0.45) {
    const crackMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.1), opacity: 0.85 });
    const crack = new Mesh(new BoxGeometry(width * 1.02, height * 0.05, length * (0.12 + rng() * 0.14)), crackMaterial);
    crack.position.set(0, (rng() - 0.5) * height * 0.5, (rng() - 0.5) * length * 0.4);
    crack.rotation.z = (rng() - 0.5) * 0.5;
    group.add(crack);
  }

  return group;
}

function createFleets(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const group = new Group();
  // [u along rail, side (-1 friendly … 1 enemy), lateral distance, vertical, yaw, length]
  const placements: Array<[number, number, number, number, number, number]> = [
    [0.06, -1, 195, -55, 0.12, 320],
    [0.13, 1, 240, 70, -0.2, 380],
    [0.22, -1, 280, 40, 0.22, 360],
    [0.3, 1, 190, -70, 0.1, 300],
    [0.38, -1, 180, -35, -0.1, 400],
    [0.47, 1, 290, 100, 0.2, 420],
    [0.56, -1, 230, 85, -0.22, 340],
    [0.62, 1, 210, -85, 0.15, 320],
    [0.74, -1, 300, -50, 0.24, 380],
    [0.85, 1, 260, 65, -0.18, 360],
  ];
  for (const [u, side, distance, vertical, yaw, length] of placements) {
    const friendly = side < 0;
    const frame = sampleRailFrame(curve, u);
    const ship = createCapitalShip(rng, friendly, length);
    ship.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * distance)
      .addScaledVector(frame.up, vertical)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 120);
    ship.rotation.y = yaw + (friendly ? 0.06 : Math.PI - 0.06);
    ship.rotation.z = (rng() - 0.5) * 0.12;
    group.add(ship);
  }
  return group;
}

// ---- the friendly cruiser (broadside run) ------------------------------------------

// Bars 10–16: the long run down her starboard flank. She rides just below
// and to the right of the rail — close enough to fill the frame edge — and
// her dorsal turrets are exported so the runtime can fire the salvos.
function createFriendlyCruiser(curve: ReturnType<typeof createBroadsideRail>) {
  const cruiser = new Group();
  const uStart = railU(bar(BROADSIDE_BARS.broadside - 0.6));
  const uEnd = railU(bar(BROADSIDE_BARS.eye + 0.4));
  const startFrame = sampleRailFrame(curve, uStart);
  const endFrame = sampleRailFrame(curve, uEnd);

  const from = startFrame.position.clone()
    .addScaledVector(startFrame.right, 46)
    .addScaledVector(startFrame.up, -13);
  const to = endFrame.position.clone()
    .addScaledVector(endFrame.right, 46)
    .addScaledVector(endFrame.up, -13);
  const center = from.clone().add(to).multiplyScalar(0.5);
  const length = from.distanceTo(to) + 130;

  const hull = new Group();
  hull.position.copy(center);
  hull.lookAt(to);

  const body = new BoxGeometry(30, 16, length);
  hull.add(new Mesh(body, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.75) })));
  const rimMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  rimMaterial.colorNode = vec3(ICE.r, ICE.g, ICE.b)
    .mul(0.5)
    .mul(positionView.z.negate().mul(-0.006).exp())
    .mul(beatUniform.mul(0.35).add(1));
  hull.add(new LineSegments(new EdgesGeometry(body), rimMaterial));

  // Flank windows facing the rail: three cyan strips.
  const stripMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.6), opacity: 0.9 });
  for (const y of [-3, 1.2, 4.6]) {
    const strip = new Mesh(new BoxGeometry(0.5, 0.55, length * 0.82), stripMaterial);
    strip.position.set(-15.3, y, 0);
    hull.add(strip);
  }

  // Dorsal turrets: blocky twin-gun mounts. Their world positions feed the
  // salvo beams that go off overhead on the downbeats.
  const cruiserGuns: Vector3[] = [];
  const turretMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.95) });
  const barrelMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.8) });
  for (let i = 0; i < 4; i += 1) {
    const z = -length * 0.34 + (i * length * 0.68) / 3;
    const mount = new Mesh(new BoxGeometry(9, 4, 10), turretMaterial);
    mount.position.set(-4, 10, z);
    hull.add(mount);
    for (const bx of [-2.2, 2.2]) {
      const barrel = new Mesh(new BoxGeometry(0.8, 0.8, 13), barrelMaterial);
      barrel.position.set(-4 + bx, 11.4, z - 9);
      barrel.rotation.x = -0.12;
      hull.add(barrel);
    }
    const gunWorld = new Vector3(-4, 12, z - 12);
    hull.updateMatrixWorld(true);
    cruiserGuns.push(hull.localToWorld(gunWorld.clone()));
  }

  cruiser.add(hull);
  hull.updateMatrixWorld(true);
  const fireDirection = new Vector3().subVectors(to, from).normalize();
  // The broadside fires up and to port — across the rail, over the player.
  const right = new Vector3().crossVectors(fireDirection, new Vector3(0, 1, 0)).normalize();
  const cruiserFireDirection = right.multiplyScalar(-1).add(new Vector3(0, 0.75, 0)).normalize();

  return { cruiser, cruiserGuns, cruiserFireDirection };
}

// ---- the enemy keel (belly run) -----------------------------------------------------

// Bars 18–24: an enemy warship's belly slides by sixteen meters overhead —
// an inverted horizon of plating, hanging structure, and molten seams.
function createBellyKeel(curve: ReturnType<typeof createBroadsideRail>) {
  const group = new Group();
  const uStart = railU(bar(BROADSIDE_BARS.belly - 0.6));
  const uEnd = railU(bar(BROADSIDE_BARS.flagship + 0.3));
  const fills: BufferGeometry[] = [];
  const scratch = new Matrix4();
  const basis = new Matrix4();
  const rotation = new Quaternion();
  const SEGMENTS = 16;
  const rng = mulberry32(41);

  for (let i = 0; i < SEGMENTS; i += 1) {
    const u = uStart + ((uEnd - uStart) * i) / (SEGMENTS - 1);
    const frame = sampleRailFrame(curve, u);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    rotation.setFromRotationMatrix(basis);

    const plate = new BoxGeometry(64 + rng() * 14, 3.4, 24);
    const position = frame.position.clone().addScaledVector(frame.up, 17.5 + Math.sin(i * 1.7) * 0.8);
    scratch.compose(position, rotation, new Vector3(1, 1, 1));
    fills.push(plate.applyMatrix4(scratch));

    // Hanging greebles: intakes, fins, castle blocks — none below +11.
    if (i % 2 === 0) {
      const greeble = new BoxGeometry(3 + rng() * 6, 2.5 + rng() * 3, 4 + rng() * 8);
      const gPosition = frame.position.clone()
        .addScaledVector(frame.up, 13.8 + rng() * 1.6)
        .addScaledVector(frame.right, (rng() - 0.5) * 44);
      scratch.compose(gPosition, rotation, new Vector3(1, 1, 1));
      fills.push(greeble.applyMatrix4(scratch));
    }
  }
  group.add(new Mesh(mergeGeometries(fills), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.38) })));
  for (const geometry of fills) geometry.dispose();

  // Molten seams running the keel line — the wounded ship glowing overhead.
  const seamMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const travel = positionWorld.z.mul(0.08).add(time.mul(3.2)).sin().mul(0.5).add(0.5).pow(3);
  seamMaterial.colorNode = vec3(MOLTEN.r, MOLTEN.g, MOLTEN.b)
    .mul(travel.mul(1.1).add(0.4))
    .mul(positionView.z.negate().mul(-0.008).exp())
    .mul(beatUniform.mul(0.5).add(1));
  for (const side of [-16, 0, 16]) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const u = uStart + ((uEnd - uStart) * i) / 40;
      const frame = sampleRailFrame(curve, u);
      points.push(frame.position.clone().addScaledVector(frame.up, 15.7).addScaledVector(frame.right, side));
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    const seam = new LineSegments(geometry, seamMaterial);
    // setFromPoints makes a line strip when used with Line; for segments we
    // need pairs, so rebuild as pairs.
    seam.geometry.dispose();
    const pairPoints: Vector3[] = [];
    for (let i = 0; i < points.length - 1; i += 1) pairPoints.push(points[i], points[i + 1]);
    seam.geometry = new BufferGeometry().setFromPoints(pairPoints);
    group.add(seam);
  }

  return group;
}

// ---- the enemy flagship + shield + trench -------------------------------------------

function createFlagship(curve: ReturnType<typeof createBroadsideRail>) {
  const flagshipGroup = new Group();
  const uMid = railU(bar(26.5));
  const midFrame = sampleRailFrame(curve, uMid);
  const uAhead = railU(bar(29));
  const aheadFrame = sampleRailFrame(curve, uAhead);

  const center = midFrame.position.clone()
    .addScaledVector(midFrame.right, -66)
    .addScaledVector(midFrame.up, -4);
  const axis = new Vector3().subVectors(aheadFrame.position, midFrame.position).normalize();

  const hull = new Group();
  hull.position.copy(center);
  hull.lookAt(center.clone().add(axis));

  // Layered obsidian mass: spine, armor shoulders, bow ram, command fin.
  const fills: BufferGeometry[] = [];
  const spine = new BoxGeometry(44, 22, 360);
  fills.push(spine);
  const shoulderTop = new BoxGeometry(58, 9, 220);
  shoulderTop.translate(0, 12, 20);
  fills.push(shoulderTop);
  const ram = new BoxGeometry(20, 12, 90);
  ram.translate(0, -2, -210);
  fills.push(ram);
  const fin = new BoxGeometry(9, 42, 60);
  fin.translate(6, 22, 110);
  fills.push(fin);
  const hullGeometry = mergeGeometries(fills);
  hull.add(new Mesh(hullGeometry, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.42) })));

  const rimMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  rimMaterial.colorNode = vec3(MOLTEN.r, MOLTEN.g, MOLTEN.b)
    .mul(0.5)
    .mul(positionView.z.negate().mul(-0.005).exp())
    .mul(beatUniform.mul(0.3).add(1));
  hull.add(new LineSegments(new EdgesGeometry(spine), rimMaterial));
  hull.add(new LineSegments(new EdgesGeometry(shoulderTop), rimMaterial));

  // Molten trench seams along the flank facing the rail.
  // Kept dim: a 300 m additive strip this close would wash the whole frame.
  const seamMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.16), opacity: 0.55 });
  for (const [y, len] of [[2, 300], [-6, 250]] as const) {
    const seam = new Mesh(new BoxGeometry(0.5, 0.55, len), seamMaterial);
    seam.position.set(22.4, y, 10);
    hull.add(seam);
  }
  // Crimson gun lamps scattered on the facing flank.
  const lampMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.4) });
  for (let i = 0; i < 7; i += 1) {
    const lamp = new Mesh(new BoxGeometry(0.8, 0.8, 0.8), lampMaterial);
    lamp.position.set(22.3, -8 + (i % 3) * 7, -150 + i * 48);
    hull.add(lamp);
  }

  flagshipGroup.add(hull);

  // The shield: a taut additive envelope hugging the hull. It cannot occlude
  // (additive, depthWrite off) and it dies with the fourth generator.
  const shieldMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(4.6);
  const shimmer = positionWorld.y.mul(0.35).add(time.mul(2.4)).sin().mul(0.12).add(0.88);
  // Only glows once the run is actually on approach — from across the battle
  // it is a faint film, not a landmark.
  const near = smoothstep(float(420), float(220), positionView.z.negate());
  shieldMaterial.colorNode = vec3(0.085, 0.022, 0.07)
    .mul(fresnel)
    .mul(shimmer)
    .mul(shieldUniform)
    .mul(near.mul(0.85).add(0.15))
    .mul(beatUniform.mul(0.2).add(0.75));
  const shieldMesh = new Mesh(new SphereGeometry(1, 40, 28), shieldMaterial);
  shieldMesh.scale.set(33, 26, 178);
  shieldMesh.position.copy(center);
  shieldMesh.quaternion.copy(hull.quaternion);
  flagshipGroup.add(shieldMesh);

  return { flagshipGroup, flagshipCenter: center.clone(), shieldMesh };
}

// The trench run: the rail drops between two walls of enemy structure for
// the final dive. Walls stay 13m out with all greebles outboard, so the
// cores in the middle are never occluded.
function createTrench(curve: ReturnType<typeof createBroadsideRail>) {
  const group = new Group();
  const uStart = railU(bar(BROADSIDE_BARS.trench - 0.35));
  const uEnd = railU(bar(34.4));
  const fills: BufferGeometry[] = [];
  const scratch = new Matrix4();
  const basis = new Matrix4();
  const rotation = new Quaternion();
  const rng = mulberry32(97);
  const SEGMENTS = 14;

  for (let i = 0; i < SEGMENTS; i += 1) {
    const u = uStart + ((uEnd - uStart) * i) / (SEGMENTS - 1);
    const frame = sampleRailFrame(curve, u);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    rotation.setFromRotationMatrix(basis);
    for (const side of [-1, 1]) {
      const wall = new BoxGeometry(4, 12 + rng() * 5, 26);
      const position = frame.position.clone()
        .addScaledVector(frame.right, side * (14.5 + rng() * 1.5))
        .addScaledVector(frame.up, 2.5);
      scratch.compose(position, rotation, new Vector3(1, 1, 1));
      fills.push(wall.applyMatrix4(scratch));
      if (i % 3 === side + 1) {
        const pipe = new BoxGeometry(2, 2, 22);
        const pipePosition = position.clone().addScaledVector(frame.right, side * 3.4).addScaledVector(frame.up, -4);
        scratch.compose(pipePosition, rotation, new Vector3(1, 1, 1));
        fills.push(pipe.applyMatrix4(scratch));
      }
    }
    // Trench floor.
    const floor = new BoxGeometry(30, 2.5, 26);
    const floorPosition = frame.position.clone().addScaledVector(frame.up, -7);
    scratch.compose(floorPosition, rotation, new Vector3(1, 1, 1));
    fills.push(floor.applyMatrix4(scratch));
  }
  group.add(new Mesh(mergeGeometries(fills), new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.42) })));
  for (const geometry of fills) geometry.dispose();

  // Wall conduits: molten channels racing the diver. Solid glow boxes so the
  // trench reads at speed even with bloom at zero.
  const stripMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const race = positionWorld.z.mul(0.22).add(time.mul(7)).sin().mul(0.5).add(0.5).pow(2);
  stripMaterial.colorNode = vec3(MOLTEN.r, MOLTEN.g, MOLTEN.b)
    .mul(race.mul(1.6).add(0.55))
    .mul(beatUniform.mul(0.5).add(1));
  const stripFills: BufferGeometry[] = [];
  const stripScratch = new Matrix4();
  const stripBasis = new Matrix4();
  const stripRotation = new Quaternion();
  const STRIP_SEGMENTS = 24;
  for (const side of [-12.1, 12.1]) {
    for (const y of [-1, 6]) {
      for (let i = 0; i < STRIP_SEGMENTS; i += 1) {
        const u = uStart + ((uEnd - uStart) * (i + 0.5)) / STRIP_SEGMENTS;
        const frame = sampleRailFrame(curve, u);
        stripBasis.makeBasis(frame.right, frame.up, frame.tangent);
        stripRotation.setFromRotationMatrix(stripBasis);
        const position = frame.position.clone()
          .addScaledVector(frame.right, side)
          .addScaledVector(frame.up, y);
        stripScratch.compose(position, stripRotation, new Vector3(1, 1, 1));
        stripFills.push(new BoxGeometry(0.3, 0.3, 6.4).applyMatrix4(stripScratch));
      }
    }
  }
  group.add(new Mesh(mergeGeometries(stripFills), stripMaterial));
  for (const geometry of stripFills) geometry.dispose();

  return group;
}

// ---- speed streaks -------------------------------------------------------------------

// A sleeve of dust streaks around the camera; scroll rate is felt airspeed.
function createSpeedStreaks(rng: Rng) {
  const COUNT = 220;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 9;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 2.5 + rng() * 5;
    const color = (rng() < 0.6 ? ICE : rng() < 0.85 ? CYAN : NEBULA_MAGENTA).clone().multiplyScalar(0.16 + rng() * 0.4);
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('z0', 'float')
    .add(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 10), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

export { AdditiveBlending };
