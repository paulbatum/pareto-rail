import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  fract,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { scatterAlongRail } from '../../../engine/environment-kit';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  ENEMY_BELLY,
  FLAGSHIP_GEOM,
  FRIENDLY_FLANK,
  BROADSIDE_MARKERS,
  createBroadsideRail,
  railU,
} from '../gameplay';
import {
  CRIMSON,
  CYAN,
  CYAN_PALE,
  COLD_WHITE,
  ICE_SHADOW,
  ICE_WHITE,
  MOLTEN,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_VIOLET,
  OBSIDIAN,
  OBSIDIAN_EDGE,
  SPACE_BLACK,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const friendlyFireUniform = uniform(0.5); // cyan tracer exchange intensity
export const enemyFireUniform = uniform(0.5); // crimson tracer exchange intensity
export const flakUniform = uniform(0.4); // distant battle flicker
export const shieldUniform = uniform(1); // flagship shield film level
export const flagshipLifeUniform = uniform(1); // molten seams die with the ship

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
};

export type Environment = {
  root: Group;
  deckCenter: Vector3;
  flagshipFocus: Vector3;
  notifyShieldDown(): void;
  notifyDestroyed(runTime: number): void;
  reset(): void;
  update(dt: number, frame: EnvironmentFrame): void;
};

const FLAGSHIP_CENTER = new Vector3(
  FLAGSHIP_GEOM.centerX,
  FLAGSHIP_GEOM.centerY,
  (FLAGSHIP_GEOM.fromZ + FLAGSHIP_GEOM.toZ) / 2,
);

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = SPACE_BLACK.clone();
  // Thin violet haze: distant hulls sink into the nebula, targets stay clear.
  scene.fog = new FogExp2(NEBULA_VIOLET.clone().multiplyScalar(0.9), 0.0016);

  const root = new Group();
  const rng = mulberry32(20260718);
  const curve = createBroadsideRail();

  const skydome = createNebulaDome();
  root.add(skydome);
  const { stars, starsMaterial } = createStars(rng);
  root.add(stars);

  root.add(createLaunchDeck());
  const fleets = createFleets(rng);
  root.add(fleets.group);

  const flagship = createFlagshipStructure(rng);
  root.add(flagship.group);

  const beams = createTracerExchange(rng);
  root.add(beams.cyan, beams.crimson);

  const flak = createFlakField(rng);
  root.add(flak);

  const wrecks = createWreckField(rng, curve);
  root.add(wrecks.group);

  const dust = createIonDust(rng, curve);
  root.add(dust.group);

  const blasts = createBlastPool(root);

  scene.add(root);

  let shieldDown = false;
  let destroyedAtRun = -1;
  let nextBlastAt = -1;
  const blastRng = mulberry32(777);

  return {
    root,
    deckCenter: new Vector3(0, 0, 0),
    flagshipFocus: FLAGSHIP_CENTER.clone(),
    notifyShieldDown() {
      shieldDown = true;
    },
    notifyDestroyed(runTime: number) {
      destroyedAtRun = runTime;
      nextBlastAt = runTime;
    },
    reset() {
      shieldDown = false;
      destroyedAtRun = -1;
      nextBlastAt = -1;
      shieldUniform.value = 1;
      flagshipLifeUniform.value = 1;
      blasts.reset();
    },
    update(dt, frame) {
      const cameraPos = frame.camera.position;
      skydome.position.copy(cameraPos);
      stars.position.copy(cameraPos);
      starsMaterial.opacity = 0.85;

      const runTime = frame.running ? frame.runTime : 0;

      // The exchange breathes with the run: heaviest while you fly the
      // friendly cruiser's flank, near-still in the eye, back for the assault.
      const broadsidePeak = envelope(runTime, BROADSIDE_MARKERS.broadside - 1, BROADSIDE_MARKERS.eye, 1.5, 1.2);
      const eyeLull = envelope(runTime, BROADSIDE_MARKERS.eye, BROADSIDE_MARKERS.belly, 0.4, 0.6);
      const assault = envelope(runTime, BROADSIDE_MARKERS.belly, BROADSIDE_MARKERS.victory, 1.2, 2);
      const base = frame.running ? 0.55 : 0.4;
      const lull = 1 - eyeLull * 0.92;
      friendlyFireUniform.value = (base + broadsidePeak * 1.3 + assault * 0.3) * lull;
      enemyFireUniform.value = (base + broadsidePeak * 0.6 + assault * 0.6) * lull;
      flakUniform.value = (0.35 + broadsidePeak * 0.5 + assault * 0.35 + frame.beatEnergy * 0.12) * lull;

      // Shield film: solid until the generators go, then a fast collapse.
      const shieldTarget = shieldDown ? 0 : 1;
      shieldUniform.value += (shieldTarget - shieldUniform.value) * Math.min(1, dt * 5);

      // Victory: the flagship dies in a chain of secondaries.
      if (destroyedAtRun >= 0 && frame.running) {
        const since = runTime - destroyedAtRun;
        flagshipLifeUniform.value = Math.max(0, 1 - since * 0.5);
        if (runTime >= nextBlastAt && since < 5.5) {
          nextBlastAt = runTime + 0.3 + blastRng() * 0.35;
          const z = FLAGSHIP_GEOM.trench.fromZ - 40 - blastRng() * 260;
          const position = new Vector3(
            FLAGSHIP_GEOM.centerX + (blastRng() - 0.5) * 44,
            FLAGSHIP_GEOM.deckY - 6 + (blastRng() - 0.3) * 22,
            z,
          );
          blasts.spawn(position, 10 + blastRng() * 26, blastRng() < 0.3 ? COLD_WHITE : MOLTEN);
        }
      }
      blasts.update(dt);

      const u = frame.running ? railU(frame.runTime) : 0;
      wrecks.update(u, dt);
      dust.update(u, dt);
    },
  };
}

function envelope(t: number, from: number, to: number, rampIn: number, rampOut: number) {
  if (t <= from - rampIn || t >= to + rampOut) return 0;
  if (t < from) return (t - (from - rampIn)) / rampIn;
  if (t > to) return 1 - (t - to) / rampOut;
  return 1;
}

// ---- nebula dome -----------------------------------------------------------------

function createNebulaDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  // Two octaves of noise paint the magenta-and-gold weather; a third carves
  // dark channels so silhouetted hulls always have contrast behind them.
  const p = positionLocal.normalize();
  const drift = time.mul(0.004);
  const bands = mx_noise_float(p.mul(2.1).add(vec3(drift, 0, 0)))
    .mul(0.6)
    .add(mx_noise_float(p.mul(5.3)).mul(0.3))
    .add(mx_noise_float(p.mul(13.0)).mul(0.12))
    .mul(0.5)
    .add(0.5);
  const gold = mx_noise_float(p.mul(3.4).add(vec3(7.3, 1.7, drift.mul(0.6)))).mul(0.5).add(0.5);
  const magenta = vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b);
  const goldC = vec3(NEBULA_GOLD.r, NEBULA_GOLD.g, NEBULA_GOLD.b);
  const violet = vec3(NEBULA_VIOLET.r, NEBULA_VIOLET.g, NEBULA_VIOLET.b);
  const black = vec3(SPACE_BLACK.r, SPACE_BLACK.g, SPACE_BLACK.b);
  let color = mix(violet, magenta, smoothstep(float(0.42), float(0.78), bands));
  color = mix(color, goldC, smoothstep(float(0.58), float(0.9), gold).mul(smoothstep(float(0.35), float(0.7), bands)).mul(0.85));
  const channels = smoothstep(float(0.3), float(0.52), bands);
  color = mix(black, color, channels);
  // Keep overall level below bloom threshold; the nebula is a backdrop.
  material.colorNode = color.mul(0.5);
  const dome = new Mesh(new SphereGeometry(2400, 40, 26), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// ---- stars ----------------------------------------------------------------------

function createStars(rng: Rng) {
  const COUNT = 1100;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i += 1) {
    const v = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(2200);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    const warm = rng();
    const intensity = 0.3 + rng() * 0.7;
    colors[i * 3] = intensity * (warm > 0.75 ? 1 : 0.85);
    colors[i * 3 + 1] = intensity * 0.88;
    colors[i * 3 + 2] = intensity * (warm > 0.75 ? 0.78 : 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starsMaterial = new PointsMaterial(additiveMaterialParameters({
    size: 2.0,
    vertexColors: true,
    sizeAttenuation: false,
    opacity: 0.85,
    fog: false,
  }));
  starsMaterial.transparent = true;
  const stars = new Points(geometry, starsMaterial);
  stars.frustumCulled = false;
  stars.userData.raildIgnoreOcclusion = true;
  return { stars, starsMaterial };
}

// ---- the launch deck -------------------------------------------------------------

function createLaunchDeck() {
  const group = new Group();
  // Your flagship: the deck is under the first two seconds of the run, its
  // bow falls away exactly where the catapult lets go.
  const hullFill = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.55) });
  const deckFill = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.85) });

  const hull = new Mesh(new BoxGeometry(46, 14, 170), hullFill);
  hull.position.set(0, -7.2, 20);
  group.add(hull);
  const deck = new Mesh(new BoxGeometry(40, 0.6, 150), deckFill);
  deck.position.set(0, -0.3, 12);
  group.add(deck);
  // Conning tower to starboard.
  const tower = new Mesh(new BoxGeometry(7, 16, 22), hullFill);
  tower.position.set(18, 7, 30);
  group.add(tower);
  const towerLight = new Mesh(new BoxGeometry(7.4, 0.5, 0.5), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.1) }));
  towerLight.position.set(18, 12, 19);
  group.add(towerLight);

  // Catapult track: paired cyan chase lamps racing toward the bow.
  const lampGeometries: BufferGeometry[] = [];
  for (let z = 70; z > -62; z -= 6) {
    for (const x of [-3.4, 3.4]) {
      lampGeometries.push(new BoxGeometry(0.7, 0.18, 1.6).applyMatrix4(new Matrix4().makeTranslation(x, 0.1, z)));
    }
  }
  const lampMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const chase = fract(positionLocal.z.mul(0.02).add(time.mul(1.6))).pow(8);
  lampMaterial.colorNode = vec3(CYAN.r, CYAN.g, CYAN.b).mul(chase.mul(2.6).add(0.55));
  const lamps = new Mesh(mergeGeometries(lampGeometries), lampMaterial);
  lamps.userData.raildIgnoreOcclusion = true;
  group.add(lamps);
  for (const geometry of lampGeometries) geometry.dispose();

  // Bow edge strip: the line you launch across.
  const bowStrip = new Mesh(new BoxGeometry(40, 0.4, 0.6), createAdditiveBasicMaterial({ color: hdr(CYAN_PALE, 1.3) }));
  bowStrip.position.set(0, 0.1, -62);
  group.add(bowStrip);
  return group;
}

// ---- capital ships ---------------------------------------------------------------

type CruiserOptions = {
  friendly: boolean;
  length: number;
  width: number;
  height: number;
  position: Vector3;
  /** Engine end sign along z: -1 puts drives at the -z end. */
  engineEnd: 1 | -1;
  detail?: number;
  lightsOnBelly?: boolean;
  /** Set false for hulls the rail flies under — a keel fin would block sightlines. */
  keelFin?: boolean;
};

function createCruiser(rng: Rng, options: CruiserOptions) {
  const group = new Group();
  const fill = new MeshBasicMaterial({
    color: options.friendly ? ICE_SHADOW.clone().multiplyScalar(0.62) : OBSIDIAN.clone(),
  });
  const trim = new MeshBasicMaterial({
    color: options.friendly ? ICE_SHADOW.clone().multiplyScalar(0.42) : OBSIDIAN_EDGE.clone().multiplyScalar(0.8),
  });

  const { length, width, height } = options;
  const hullGeometries: BufferGeometry[] = [];
  const trimGeometries: BufferGeometry[] = [];
  // Main hull, tapered bow wedge, dorsal spine blocks.
  hullGeometries.push(new BoxGeometry(width, height, length * 0.78).applyMatrix4(new Matrix4().makeTranslation(0, 0, 0)));
  hullGeometries.push(new BoxGeometry(width * 0.62, height * 0.62, length * 0.28)
    .applyMatrix4(new Matrix4().makeTranslation(0, height * 0.05, -length * 0.5 * options.engineEnd * -1)));
  const detail = options.detail ?? 7;
  for (let i = 0; i < detail; i += 1) {
    const z = (rng() - 0.5) * length * 0.7;
    const w = width * (0.16 + rng() * 0.3);
    const h = height * (0.2 + rng() * 0.4);
    const d = length * (0.05 + rng() * 0.1);
    trimGeometries.push(new BoxGeometry(w, h, d)
      .applyMatrix4(new Matrix4().makeTranslation((rng() - 0.5) * width * 0.6, height * 0.5 + h * 0.4, z)));
  }
  if (options.keelFin !== false) {
    trimGeometries.push(new BoxGeometry(width * 0.14, height * 0.9, length * 0.16)
      .applyMatrix4(new Matrix4().makeTranslation(0, -height * 0.55, length * 0.18)));
  }
  const hullMesh = new Mesh(mergeGeometries(hullGeometries), fill);
  hullMesh.name = 'cruiser-hull';
  const trimMesh = new Mesh(mergeGeometries(trimGeometries), trim);
  trimMesh.name = 'cruiser-trim';
  group.add(hullMesh, trimMesh);
  for (const geometry of [...hullGeometries, ...trimGeometries]) geometry.dispose();

  // Signal lights: cyan windows/running strips for the fleet, molten seams
  // for the enemy. TSL chase makes them alive without per-frame work.
  const lightGeometries: BufferGeometry[] = [];
  const rows = options.friendly ? 3 : 4;
  for (let row = 0; row < rows; row += 1) {
    const y = options.lightsOnBelly
      ? -height * 0.5 - 0.3
      : (rng() - 0.35) * height * 0.7;
    const x = options.friendly
      ? (row % 2 === 0 ? -1 : 1) * (width * 0.5 + 0.3)
      : (rng() - 0.5) * width * 0.8;
    const strip = options.friendly
      ? new BoxGeometry(0.5, 0.8, length * 0.62)
      : new BoxGeometry(options.lightsOnBelly ? width * 0.7 : 0.6, 0.5, length * (0.3 + rng() * 0.3));
    lightGeometries.push(strip.applyMatrix4(new Matrix4().makeTranslation(x, y, (rng() - 0.5) * length * 0.25)));
  }
  const lightMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const signal = options.friendly ? CYAN : MOLTEN;
  const flicker = fract(positionLocal.z.mul(0.013).add(time.mul(options.friendly ? 0.5 : 0.32))).pow(4);
  lightMaterial.colorNode = vec3(signal.r, signal.g, signal.b)
    .mul(flicker.mul(1.1).add(0.5))
    .mul(beatUniform.mul(0.25).add(0.85));
  const lights = new Mesh(mergeGeometries(lightGeometries), lightMaterial);
  lights.userData.raildIgnoreOcclusion = true;
  group.add(lights);
  for (const geometry of lightGeometries) geometry.dispose();

  // Engine block: the color that names the side even at silhouette range.
  const drives = new Group();
  const driveColor = options.friendly ? CYAN : MOLTEN;
  const count = Math.max(2, Math.round(width / 14));
  for (let i = 0; i < count; i += 1) {
    const x = (i / (count - 1) - 0.5) * width * 0.6;
    const drive = new Mesh(
      new SphereGeometry(Math.min(4.2, width * 0.09), 10, 8),
      createAdditiveBasicMaterial({ color: hdr(driveColor, 1.6) }),
    );
    drive.position.set(x, 0, options.engineEnd * length * 0.5);
    drive.scale.z = 1.9;
    drive.userData.raildIgnoreOcclusion = true;
    drives.add(drive);
  }
  group.add(drives);

  group.position.copy(options.position);
  return group;
}

function createFleets(rng: Rng) {
  const group = new Group();

  // The friendly cruiser whose flank you run at bars 11–16 — its wall is the
  // level's geometry, so it is placed from the same constants gameplay uses.
  const flank = createCruiser(rng, {
    friendly: true,
    length: FRIENDLY_FLANK.fromZ - FRIENDLY_FLANK.toZ,
    width: 62,
    height: FRIENDLY_FLANK.topY - FRIENDLY_FLANK.bottomY,
    position: new Vector3(
      FRIENDLY_FLANK.faceX + 31,
      (FRIENDLY_FLANK.topY + FRIENDLY_FLANK.bottomY) / 2,
      (FRIENDLY_FLANK.fromZ + FRIENDLY_FLANK.toZ) / 2,
    ),
    engineEnd: -1,
  });
  group.add(flank);

  // The enemy cruiser whose keel you rake at bars 18–22.
  const belly = createCruiser(rng, {
    friendly: false,
    length: ENEMY_BELLY.fromZ - ENEMY_BELLY.toZ,
    width: ENEMY_BELLY.halfWidth * 2,
    height: 48,
    position: new Vector3(
      ENEMY_BELLY.centerX,
      ENEMY_BELLY.bellyY + 24,
      (ENEMY_BELLY.fromZ + ENEMY_BELLY.toZ) / 2,
    ),
    engineEnd: 1,
    lightsOnBelly: true,
    keelFin: false,
  });
  group.add(belly);

  // The rest of both lines: no neat formation, hulls at every attitude.
  const placements: Array<{ friendly: boolean; p: Vector3; l: number; w: number; h: number; ry: number; rz: number }> = [
    { friendly: true, p: new Vector3(-190, 30, -330), l: 420, w: 54, h: 40, ry: 0.14, rz: 0.05 },
    { friendly: true, p: new Vector3(-90, 150, -780), l: 500, w: 60, h: 44, ry: -0.08, rz: 0.12 },
    { friendly: true, p: new Vector3(230, -90, -520), l: 380, w: 48, h: 36, ry: 0.2, rz: -0.1 },
    { friendly: false, p: new Vector3(240, 70, -1050), l: 520, w: 64, h: 48, ry: -0.16, rz: 0.08 },
    { friendly: false, p: new Vector3(-260, -40, -1380), l: 560, w: 66, h: 50, ry: 0.1, rz: -0.06 },
    { friendly: false, p: new Vector3(-140, 110, -1720), l: 420, w: 70, h: 54, ry: 0.05, rz: 0.1 },
    { friendly: true, p: new Vector3(190, 120, -1500), l: 440, w: 52, h: 40, ry: -0.12, rz: 0.04 },
  ];
  for (const spec of placements) {
    const ship = createCruiser(rng, {
      friendly: spec.friendly,
      length: spec.l,
      width: spec.w,
      height: spec.h,
      position: spec.p,
      engineEnd: rng() < 0.5 ? 1 : -1,
      detail: 5,
    });
    ship.rotation.y = spec.ry;
    ship.rotation.z = spec.rz;
    group.add(ship);
  }

  // Far silhouettes: the battle goes on past the fog.
  const farFill = new MeshBasicMaterial({ color: new Color(0.03, 0.025, 0.045) });
  for (let i = 0; i < 6; i += 1) {
    const far = new Mesh(new BoxGeometry(30 + rng() * 40, 14 + rng() * 12, 260 + rng() * 220), farFill);
    far.position.set((rng() - 0.5) * 1300, (rng() - 0.4) * 500, -300 - rng() * 1500);
    far.rotation.y = (rng() - 0.5) * 0.6;
    group.add(far);
  }

  return { group };
}

// ---- the enemy flagship ----------------------------------------------------------

function createFlagshipStructure(rng: Rng) {
  const group = new Group();
  const geom = FLAGSHIP_GEOM;
  const length = geom.fromZ - geom.toZ;
  const centerZ = (geom.fromZ + geom.toZ) / 2;
  const width = (geom.centerX - geom.faceX) * 2;
  const height = geom.deckY - geom.bellyY;

  const fill = new MeshBasicMaterial({ color: OBSIDIAN.clone() });
  const trim = new MeshBasicMaterial({ color: OBSIDIAN_EDGE.clone().multiplyScalar(0.85) });

  // Main mass, split around the trench span so the trench is a real cut.
  const hullGeometries: BufferGeometry[] = [];
  const midY = (geom.deckY + geom.bellyY) / 2;
  // Bow section (before the trench).
  const bowLength = geom.fromZ - geom.trench.fromZ;
  hullGeometries.push(new BoxGeometry(width, height, bowLength)
    .applyMatrix4(new Matrix4().makeTranslation(geom.centerX, midY, geom.fromZ - bowLength / 2)));
  // Prow wedge reaching toward the player's approach.
  hullGeometries.push(new BoxGeometry(width * 0.6, height * 0.55, 110)
    .applyMatrix4(new Matrix4().makeTranslation(geom.centerX, midY - 4, geom.fromZ + 42)));
  // Trench-span shoulders: hull either side of the cut, full height.
  const trenchLength = geom.trench.fromZ - geom.trench.toZ;
  const shoulderWidth = (width - geom.trench.halfWidth * 2) / 2;
  for (const side of [-1, 1]) {
    hullGeometries.push(new BoxGeometry(shoulderWidth, height, trenchLength)
      .applyMatrix4(new Matrix4().makeTranslation(
        geom.centerX + side * (geom.trench.halfWidth + shoulderWidth / 2),
        midY,
        geom.trench.fromZ - trenchLength / 2,
      )));
  }
  // Trench floor slab.
  hullGeometries.push(new BoxGeometry(geom.trench.halfWidth * 2, geom.trench.floorY - geom.bellyY, trenchLength)
    .applyMatrix4(new Matrix4().makeTranslation(geom.centerX, (geom.trench.floorY + geom.bellyY) / 2, geom.trench.fromZ - trenchLength / 2)));
  // Stern section.
  const sternLength = geom.trench.toZ - geom.toZ;
  hullGeometries.push(new BoxGeometry(width, height, sternLength)
    .applyMatrix4(new Matrix4().makeTranslation(geom.centerX, midY, geom.trench.toZ - sternLength / 2)));
  const hullMesh = new Mesh(mergeGeometries(hullGeometries), fill);
  hullMesh.name = 'flagship-hull';
  group.add(hullMesh);
  for (const geometry of hullGeometries) geometry.dispose();

  // Superstructure and hull greebles.
  const trimGeometries: BufferGeometry[] = [];
  // Superstructure keeps to the starboard half of the deck: the rail crosses
  // the spine from port, and towers on that side would eat the sightlines to
  // the come-around fight.
  for (let i = 0; i < 16; i += 1) {
    const z = geom.fromZ - rng() * (bowLength - 30) - 10;
    const w = 5 + rng() * 12;
    const h = 3 + rng() * 7;
    trimGeometries.push(new BoxGeometry(w, h, 8 + rng() * 22)
      .applyMatrix4(new Matrix4().makeTranslation(geom.centerX + 4 + rng() * width * 0.32, geom.deckY + h / 2, z)));
  }
  // Command tower over the stern.
  trimGeometries.push(new BoxGeometry(16, 30, 22)
    .applyMatrix4(new Matrix4().makeTranslation(geom.centerX, geom.deckY + 15, geom.trench.toZ - 50)));
  // Face plating ribs along the phase-one pass.
  for (let z = geom.fromZ - 16; z > geom.trench.fromZ; z -= 34) {
    trimGeometries.push(new BoxGeometry(2.6, height * 0.86, 5)
      .applyMatrix4(new Matrix4().makeTranslation(geom.faceX - 1.2, midY, z)));
  }
  // Trench wall greebles.
  for (let i = 0; i < 22; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = geom.trench.fromZ - 8 - rng() * (trenchLength - 20);
    trimGeometries.push(new BoxGeometry(1.6, 2 + rng() * 5, 4 + rng() * 9)
      .applyMatrix4(new Matrix4().makeTranslation(geom.centerX + side * (geom.trench.halfWidth - 0.9), geom.trench.floorY + 2 + rng() * 16, z)));
  }
  const trimMesh = new Mesh(mergeGeometries(trimGeometries), trim);
  trimMesh.name = 'flagship-trim';
  group.add(trimMesh);
  for (const geometry of trimGeometries) geometry.dispose();

  // Molten seams: the ship's power made visible. They die when the core goes.
  const seamGeometries: BufferGeometry[] = [];
  for (const y of [midY + 6, midY - 8]) {
    seamGeometries.push(new BoxGeometry(0.5, 0.7, length * 0.9)
      .applyMatrix4(new Matrix4().makeTranslation(geom.faceX - 0.4, y, centerZ)));
  }
  // Trench wall light lines: the corridor the second pass reads by.
  for (const side of [-1, 1]) {
    for (const y of [geom.trench.floorY + 3, geom.trench.floorY + 12]) {
      seamGeometries.push(new BoxGeometry(0.5, 0.6, trenchLength)
        .applyMatrix4(new Matrix4().makeTranslation(geom.centerX + side * (geom.trench.halfWidth - 0.4), y, geom.trench.fromZ - trenchLength / 2)));
    }
  }
  const seamMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const seamChase = fract(positionLocal.z.mul(0.016).add(time.mul(0.7))).pow(6);
  seamMaterial.colorNode = vec3(MOLTEN.r, MOLTEN.g, MOLTEN.b)
    .mul(seamChase.mul(1.6).add(0.55))
    .mul(flagshipLifeUniform)
    .mul(beatUniform.mul(0.3).add(0.85));
  const seams = new Mesh(mergeGeometries(seamGeometries), seamMaterial);
  seams.userData.raildIgnoreOcclusion = true;
  group.add(seams);
  for (const geometry of seamGeometries) geometry.dispose();

  // The shield: a magenta film stretched over the forward hull. It reads from
  // the whole approach, and its collapse is phase one's payoff.
  const shieldMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
  const shimmer = mx_noise_float(positionLocal.mul(0.012).add(vec3(0, 0, time.mul(0.5)))).mul(0.5).add(0.6);
  shieldMaterial.colorNode = vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b)
    .mul(shimmer)
    .mul(shieldUniform)
    .mul(0.13);
  const shield = new Mesh(new SphereGeometry(1, 24, 16), shieldMaterial);
  shield.scale.set(width * 0.85, height * 1.1, bowLength * 0.62);
  shield.position.set(geom.centerX, midY, geom.fromZ - bowLength * 0.4);
  shield.userData.raildIgnoreOcclusion = true;
  group.add(shield);

  // Engine array at the stern: molten, dying with the ship.
  for (let i = 0; i < 3; i += 1) {
    const drive = new Mesh(new SphereGeometry(6.5, 10, 8), createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.4) }));
    drive.position.set(geom.centerX + (i - 1) * 20, midY, geom.toZ - 4);
    drive.scale.z = 2.1;
    drive.userData.raildIgnoreOcclusion = true;
    group.add(drive);
  }

  return { group };
}

// ---- the tracer exchange ---------------------------------------------------------

// Capital fire crossing the battlespace: long line segments with chase pulses
// racing along them. Friendly volleys are cyan and travel one way; enemy
// return fire is crimson and travels the other.
function makeBeamSet(rng: Rng, color: Color, intensity: typeof friendlyFireUniform, lanes: Array<[Vector3, Vector3]>) {
  const positions: number[] = [];
  const lt: number[] = [];
  const seed: number[] = [];
  for (const [from, to] of lanes) {
    const s = rng() * 10;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    lt.push(0, 1);
    seed.push(s, s);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('lt', new Float32BufferAttribute(lt, 1));
  geometry.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const t = attribute<'float'>('lt', 'float');
  const s = attribute<'float'>('seed', 'float');
  // Three staggered pulses per lane so the line reads as a firing rhythm, not
  // a solid rope; a faint base keeps the lane visible between volleys.
  const pulse = fract(t.mul(2.6).sub(time.mul(0.55)).add(s)).pow(18)
    .add(fract(t.mul(2.6).sub(time.mul(0.55)).add(s).add(0.37)).pow(18).mul(0.7));
  material.colorNode = vec3(color.r, color.g, color.b)
    .mul(pulse.mul(2.4).add(0.05))
    .mul(intensity);
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  return lines;
}

function createTracerExchange(rng: Rng) {
  const cyanLanes: Array<[Vector3, Vector3]> = [
    // The flank cruiser's broadside, firing over the player's canopy.
    [new Vector3(96, 44, -540), new Vector3(-420, 130, -980)],
    [new Vector3(100, 40, -640), new Vector3(-380, 90, -1180)],
    [new Vector3(96, 46, -740), new Vector3(-460, 150, -1300)],
    [new Vector3(102, 38, -840), new Vector3(-340, 60, -1420)],
    // The rest of the line.
    [new Vector3(-190, 44, -420), new Vector3(240, 84, -1030)],
    [new Vector3(-86, 160, -860), new Vector3(-250, -20, -1360)],
    [new Vector3(236, -80, -600), new Vector3(60, 10, -1550)],
    [new Vector3(190, 128, -1560), new Vector3(-130, 110, -1740)],
  ];
  const crimsonLanes: Array<[Vector3, Vector3]> = [
    [new Vector3(250, 78, -1090), new Vector3(-180, 40, -400)],
    [new Vector3(-260, -32, -1420), new Vector3(230, -80, -560)],
    [new Vector3(-20, 26, -1180), new Vector3(90, 50, -620)],
    [new Vector3(-150, 116, -1760), new Vector3(180, 130, -1520)],
    [new Vector3(60, 6, -1500), new Vector3(-190, 40, -500)],
    [new Vector3(-140, 100, -1700), new Vector3(-100, 150, -800)],
  ];
  return {
    cyan: makeBeamSet(rng, CYAN, friendlyFireUniform, cyanLanes),
    crimson: makeBeamSet(rng, CRIMSON, enemyFireUniform, crimsonLanes),
  };
}

// ---- flak field ------------------------------------------------------------------

// Distant impacts flickering across the battle volume: single points that
// bloom and die on staggered clocks.
function createFlakField(rng: Rng) {
  const COUNT = 130;
  const positions: number[] = [];
  const phases: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    positions.push((rng() - 0.5) * 900, (rng() - 0.4) * 380, -200 - rng() * 1650);
    phases.push(rng() * 20);
    const warm = rng() < 0.45;
    const c = warm ? MOLTEN : rng() < 0.5 ? CYAN : COLD_WHITE;
    colors.push(c.r, c.g, c.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 5,
    vertexColors: true,
    sizeAttenuation: true,
    fog: false,
  }));
  material.transparent = true;
  // PointsMaterial has no node slots; flicker rides on opacity via the shared
  // uniform each frame instead. The per-point phase shapes size variety only.
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  points.onBeforeRender = () => {
    material.opacity = Math.min(1, 0.25 + flakUniform.value * 0.5);
  };
  return points;
}

// ---- wreck field -----------------------------------------------------------------

function createWreckField(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const dark = new MeshBasicMaterial({ color: OBSIDIAN_EDGE.clone().multiplyScalar(0.6) });
  const pale = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.45) });
  const eyeFrom = railU(BROADSIDE_MARKERS.eye) - 0.05;
  const eyeTo = railU(BROADSIDE_MARKERS.belly) + 0.03;
  const field = scatterAlongRail(curve, {
    count: 26,
    seed: 20260719,
    rng,
    window: { behind: 60, ahead: 260 },
    alignToRail: false,
    make(_index, makeRng) {
      const chunk = new Group();
      const body = new Mesh(
        new BoxGeometry(1 + makeRng() * 5, 0.5 + makeRng() * 2.4, 1 + makeRng() * 4),
        makeRng() < 0.5 ? dark : pale,
      );
      chunk.add(body);
      if (makeRng() < 0.5) {
        const ember = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.8) }));
        ember.position.set(0.5, 0.3, 0);
        ember.userData.raildIgnoreOcclusion = true;
        chunk.add(ember);
      }
      chunk.rotation.set(makeRng() * 3, makeRng() * 3, makeRng() * 3);
      chunk.userData.raildIgnoreOcclusion = true;
      return chunk;
    },
    place(_index, placeRng) {
      // Wreckage thickens in the eye of the battle, but drifts everywhere.
      const inEye = placeRng() < 0.62;
      const u = inEye ? eyeFrom + placeRng() * (eyeTo - eyeFrom) : placeRng();
      const angle = placeRng() * Math.PI * 2;
      const radius = 26 + placeRng() * 70;
      return {
        u,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, 0),
      };
    },
    onUpdate(item, dt) {
      item.object.rotation.x += dt * 0.25;
      item.object.rotation.z += dt * 0.18;
    },
  });
  return field;
}

// ---- ion dust --------------------------------------------------------------------

// Close-range motes that give the camera something to rush past everywhere,
// selling speed even in open space.
function createIonDust(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const geometry = new BoxGeometry(0.07, 0.07, 0.7);
  const material = createAdditiveBasicMaterial({ color: hdr(CYAN_PALE, 0.35) });
  const field = scatterAlongRail(curve, {
    count: 90,
    seed: 20260720,
    rng,
    window: { behind: 14, ahead: 90 },
    make() {
      const mote = new Mesh(geometry, material);
      mote.userData.raildIgnoreOcclusion = true;
      return mote;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = 5 + placeRng() * 22;
      return {
        u: placeRng(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      };
    },
  });
  return field;
}

// ---- blast pool (flagship death) -------------------------------------------------

function createBlastPool(root: Group) {
  type Blast = { mesh: Mesh; material: MeshBasicMaterial; age: number; life: number; toScale: number; color: Color };
  const pool: Blast[] = [];
  const geometry = new SphereGeometry(1, 14, 10);
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);
    pool.push({ mesh, material, age: 0, life: -1, toScale: 1, color: new Color() });
  }
  return {
    spawn(position: Vector3, toScale: number, color: Color) {
      const blast = pool.find((b) => b.life < 0);
      if (!blast) return;
      blast.mesh.position.copy(position);
      blast.mesh.visible = true;
      blast.age = 0;
      blast.life = 0.9;
      blast.toScale = toScale;
      blast.color.copy(color);
    },
    update(dt: number) {
      for (const blast of pool) {
        if (blast.life < 0) continue;
        blast.age += dt;
        if (blast.age >= blast.life) {
          blast.life = -1;
          blast.mesh.visible = false;
          continue;
        }
        const progress = blast.age / blast.life;
        blast.mesh.scale.setScalar(0.5 + (1 - (1 - progress) ** 2) * blast.toScale);
        blast.material.color.copy(blast.color).multiplyScalar((1 - progress) ** 1.6 * 1.5);
      }
    },
    reset() {
      for (const blast of pool) {
        blast.life = -1;
        blast.mesh.visible = false;
      }
    },
  };
}
