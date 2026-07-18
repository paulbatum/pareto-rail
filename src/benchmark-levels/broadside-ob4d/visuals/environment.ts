import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp, scatterAlongRail } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  BREACH_TIME,
  CROSSFIRE_TIME,
  EYE_TIME,
  FLANK_TIME,
  RAKING_TIME,
  SHIELDS_TIME,
  TRENCH_TIME,
  bar,
} from '../timing';
import { createBroadsideRail, railU } from '../gameplay';
import { spawnStreak } from './effects';
import { createCapitalShip, createHullSurface, createTrench, type HullFrame } from './ships';
import {
  ALLY_CYAN,
  ALLY_HULL,
  ALLY_SHADOW,
  FOE_CRIMSON,
  FOE_HULL,
  FOE_MOLTEN,
  FOE_PLATE,
  NEBULA_DEEP,
  NEBULA_EMBER,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_ROSE,
  STARLIGHT,
  VOID,
  hdr,
} from './palette';

// The world, in five layers, outermost first:
//
//   1. the nebula — a vertex-coloured shell that is the only light source in
//      the level. Two lobes, magenta high and left, gold low and right, both
//      set ahead of the flight path so every hull you meet is backlit.
//   2. stars, sparse, so the nebula's dark side is not dead black.
//   3. the far battle line — two rows of capital ships slugging it out at a
//      distance, plus the crossfire streaking between them. This is the layer
//      that sells "you are inside something enormous".
//   4. the four ships you actually fly against, seated on rail frames so their
//      hulls follow the flight path instead of cutting through it.
//   5. debris: hull chunks and burning wreckage tumbling past the canopy.

const RAIL = createBroadsideRail();
const RAIL_LENGTH = RAIL.getLength();

export type EnvironmentUpdate = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  progress: number;
  speed: number;
  beatEnergy: number;
  /** Downbeat pulses drive the fleet salvos; the environment consumes them. */
  downbeats: number;
};

export type Environment = {
  root: Group;
  update(dt: number, context: EnvironmentUpdate): void;
  dispose(): void;
};

// ---- the nebula ------------------------------------------------------------------

const MAGENTA_LOBE = new Vector3(-0.52, 0.36, -0.78).normalize();
const GOLD_LOBE = new Vector3(0.62, -0.28, -0.74).normalize();

function createNebula() {
  const geometry = new SphereGeometry(2600, 48, 32);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const direction = new Vector3();
  const color = new Color();
  const magenta = new Color();
  const gold = new Color();

  for (let i = 0; i < position.count; i += 1) {
    direction.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const toMagenta = Math.max(0, direction.dot(MAGENTA_LOBE));
    const toGold = Math.max(0, direction.dot(GOLD_LOBE));

    // Cloud structure: a couple of octaves of cheap trigonometric banding, so
    // the lobes have filaments and voids rather than reading as two blobs.
    const filament = 0.62
      + 0.24 * Math.sin(direction.x * 5.1 + direction.y * 3.3)
      + 0.16 * Math.sin(direction.y * 9.4 - direction.z * 7.1)
      + 0.1 * Math.sin(direction.z * 17.3 + direction.x * 13.7);

    color.copy(VOID).lerp(NEBULA_DEEP, MathUtils.clamp(filament * 0.8, 0, 1));
    magenta.copy(NEBULA_ROSE).lerp(NEBULA_MAGENTA, toMagenta ** 2);
    gold.copy(NEBULA_EMBER).lerp(NEBULA_GOLD, toGold ** 2);
    color.lerp(magenta, MathUtils.clamp(toMagenta ** 2.6 * filament * 1.25, 0, 0.92));
    color.lerp(gold, MathUtils.clamp(toGold ** 3.1 * filament * 1.05, 0, 0.85));

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function createStars(seed: number) {
  const rng = mulberry32(seed);
  const COUNT = 900;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const tint = new Color();
  for (let i = 0; i < COUNT; i += 1) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const radius = 1800 + rng() * 400;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
    positions[i * 3 + 2] = Math.cos(phi) * radius;
    tint.copy(STARLIGHT).multiplyScalar(0.25 + rng() * 0.85);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const points = new Points(geometry, new PointsMaterial({
    size: 2.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  points.frustumCulled = false;
  points.renderOrder = -9;
  return points;
}

// ---- helpers ---------------------------------------------------------------------

function framesBetween(fromTime: number, toTime: number, count: number): HullFrame[] {
  const frames: HullFrame[] = [];
  const fromU = railU(fromTime);
  const toU = railU(toTime);
  for (let i = 0; i <= count; i += 1) {
    frames.push(sampleRailFrame(RAIL, MathUtils.clamp(fromU + ((toU - fromU) * i) / count, 0, 1)));
  }
  return frames;
}

/** Names every mesh in a set piece so occlusion reports identify it by name. */
function label(object: Group, name: string) {
  object.traverse((child) => {
    child.name = name;
  });
  return object;
}

function seatAt(time: number, right: number, up: number, forward = 0) {
  const frame = sampleRailFrame(RAIL, MathUtils.clamp(railU(time), 0, 1));
  return {
    position: frame.position.clone()
      .addScaledVector(frame.right, right)
      .addScaledVector(frame.up, up)
      .addScaledVector(frame.tangent, forward),
    frame,
  };
}

// ---- the environment -------------------------------------------------------------

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  root.frustumCulled = false;
  scene.add(root);

  scene.fog = new Fog(NEBULA_DEEP.clone().multiplyScalar(0.6).getHex(), 90, 900);
  const atmosphere = createAtmosphereRamp(scene, [
    // The gap between the fleets is open and deep; the trench is close and
    // choked, so the fog wall walks in as the level narrows around you.
    { progress: 0, fog: hdr(NEBULA_DEEP, 0.55), near: 110, far: 1000 },
    { progress: railU(FLANK_TIME), fog: hdr(NEBULA_DEEP, 0.7), near: 90, far: 900 },
    { progress: railU(EYE_TIME), fog: hdr(NEBULA_ROSE, 0.28), near: 70, far: 780 },
    { progress: railU(TRENCH_TIME), fog: hdr(NEBULA_EMBER, 0.4), near: 30, far: 420 },
    { progress: 1, fog: hdr(NEBULA_MAGENTA, 0.3), near: 140, far: 1400 },
  ]);

  // 1 + 2: backdrop, parented to a follower group so it never gets closer.
  const sky = new Group();
  sky.frustumCulled = false;
  const nebula = createNebula();
  const stars = createStars(90210);
  sky.add(nebula, stars);
  root.add(sky);

  // 3: the far battle line. Two rows of hulls, ours to port, theirs to
  // starboard, staggered in depth so the engagement has thickness.
  const distantFleet = new Group();
  const distantRng = mulberry32(4477);
  const distantEngines: MeshBasicMaterial[] = [];
  const distantMuzzles: Array<{ material: MeshBasicMaterial; point: Vector3; direction: Vector3; ally: boolean }> = [];
  for (let i = 0; i < 22; i += 1) {
    const ally = i % 2 === 0;
    const time = (i / 21) * bar(31);
    const side = (ally ? -1 : 1) * (420 + distantRng() * 520);
    const up = (distantRng() - 0.5) * 340;
    const forward = (distantRng() - 0.5) * 380;
    const { position, frame } = seatAt(time, side, up, forward);
    const scale = 0.7 + distantRng() * 1.1;
    const ship = createCapitalShip({
      length: 260 * scale,
      beam: 40 * scale,
      height: 34 * scale,
      hullColor: ally ? ALLY_SHADOW.clone().multiplyScalar(0.5) : FOE_HULL,
      plateColor: ally ? ALLY_SHADOW : FOE_PLATE,
      rimKey: NEBULA_MAGENTA,
      rimFill: NEBULA_GOLD,
      accent: ally ? ALLY_CYAN : FOE_MOLTEN,
      engines: ally ? 3 : 2,
      towers: 4,
      batteries: 5,
      seams: !ally,
      seed: 700 + i,
      glow: 0.55,
    });
    ship.group.position.copy(position);
    // Both lines face roughly across the gap at each other, with slack: a
    // fleet action is not a parade, so nothing shares an exact heading.
    ship.group.lookAt(position.clone()
      .addScaledVector(frame.tangent, (distantRng() - 0.3) * 300)
      .addScaledVector(frame.right, ally ? 220 : -220)
      .addScaledVector(frame.up, (distantRng() - 0.5) * 90));
    ship.group.rotateZ((distantRng() - 0.5) * 0.5);
    distantFleet.add(ship.group);
    distantEngines.push(...ship.engines);
    for (const [index, material] of ship.muzzles.entries()) {
      distantMuzzles.push({
        material,
        point: position.clone().addScaledVector(frame.tangent, (index - 2) * 22 * scale),
        direction: frame.right.clone().multiplyScalar(ally ? 1 : -1),
        ally,
      });
    }
  }
  root.add(label(distantFleet, 'distant-fleet'));

  // 4: the ships you fly against.
  const heroes = new Group();

  // Your own flagship: you leave from its bow catapult, so it is behind and
  // below at t=0 and never seen again except over your shoulder.
  const ownFlagship = createCapitalShip({
    length: 520,
    beam: 78,
    height: 52,
    hullColor: ALLY_SHADOW.clone().multiplyScalar(0.75),
    plateColor: ALLY_SHADOW,
    rimKey: NEBULA_MAGENTA,
    rimFill: NEBULA_GOLD,
    accent: ALLY_CYAN,
    engines: 5,
    towers: 6,
    batteries: 7,
    seed: 1201,
  });
  {
    const { position, frame } = seatAt(0, 0, -38, -244);
    ownFlagship.group.position.copy(position);
    ownFlagship.group.lookAt(position.clone().addScaledVector(frame.tangent, 100));
    heroes.add(label(ownFlagship.group, 'own-flagship'));
  }

  // The friendly cruiser you run alongside. Its starboard broadside points
  // over your canopy at the enemy line, and fires on the downbeat.
  const cruiser = createHullSurface(framesBetween(bar(9.4), bar(15.6), 40), {
    offsetX: -74,
    offsetY: -5,
    halfWidth: 26,
    halfHeight: 21,
    hullColor: ALLY_SHADOW.clone().multiplyScalar(0.62),
    plateColor: ALLY_SHADOW,
    rimKey: NEBULA_MAGENTA,
    rimFill: NEBULA_GOLD,
    accent: ALLY_CYAN,
    towerDensity: 0.22,
    batteries: 9,
    batterySide: 1,
    seed: 3301,
  });
  heroes.add(label(cruiser.group, 'cruiser'));

  // The enemy warship whose belly you rake. Directly overhead and close, so
  // its keel plating is the ceiling of the raking act.
  const warship = createHullSurface(framesBetween(bar(14.6), bar(20.4), 40), {
    offsetX: 4,
    offsetY: 50,
    halfWidth: 36,
    halfHeight: 22,
    hullColor: FOE_HULL,
    plateColor: FOE_PLATE,
    rimKey: NEBULA_MAGENTA,
    rimFill: NEBULA_GOLD,
    accent: FOE_MOLTEN,
    towerDensity: 0.16,
    seams: true,
    seed: 5501,
  });
  heroes.add(label(warship.group, 'warship'));

  // The enemy flagship. You strafe its dorsal surface for the shield pass,
  // climb over its bow shoulder, and dive into the canyon cut down its spine.
  const flagshipDeck = createHullSurface(framesBetween(bar(20.2), bar(27.0), 50), {
    offsetX: 0,
    offsetY: -44,
    halfWidth: 62,
    halfHeight: 23,
    // Towers stay outboard of x=±34 and stop short of head height, so the lane
    // you strafe stays clear and the emitters mounted in it stay visible.
    towerKeepOut: 34,
    towerMaxHeight: 1.15,
    hullColor: FOE_HULL,
    plateColor: FOE_PLATE,
    rimKey: NEBULA_MAGENTA,
    rimFill: NEBULA_GOLD,
    accent: FOE_MOLTEN,
    towerDensity: 0.5,
    seams: true,
    seed: 7701,
  });
  heroes.add(label(flagshipDeck.group, 'flagship-deck'));

  const trench = createTrench(framesBetween(bar(27.7), bar(32.6), 56), {
    offsetX: 0,
    offsetY: 0,
    // The mouth is wide and the throat is tight: the narrowing is the dive.
    halfWidth: (t) => MathUtils.lerp(80, 30, MathUtils.clamp(t / 0.28, 0, 1) ** 0.7),
    wallHeight: 78,
    floorDepth: 22,
    hullColor: FOE_HULL,
    plateColor: FOE_PLATE,
    rimKey: NEBULA_MAGENTA,
    rimFill: NEBULA_GOLD,
    accent: FOE_MOLTEN,
    ribEvery: 4,
    seed: 9901,
  });
  heroes.add(label(trench.group, 'trench'));
  root.add(heroes);

  // 5: debris, recycled down the rail the whole way.
  const debrisRng = mulberry32(2024);
  const debrisHull = new MeshBasicMaterial({ color: FOE_HULL.clone().multiplyScalar(1.6) });
  const debrisRim = createAdditiveBasicMaterial({ color: hdr(NEBULA_GOLD, 0.8) });
  const debris = scatterAlongRail(RAIL, {
    count: 54,
    seed: 13,
    window: { behind: 60, ahead: 620 },
    alignToRail: false,
    place: (_index, rng) => ({
      u: rng(),
      offset: new Vector3(
        (rng() < 0.5 ? -1 : 1) * (70 + rng() * 150),
        (rng() < 0.5 ? -1 : 1) * (45 + rng() * 110),
        0,
      ),
    }),
    make: (_index, rng) => {
      const group = new Group();
      const scale = 0.7 + rng() * 3.4;
      const body = new Mesh(new SphereGeometry(scale, 4, 3), debrisHull);
      body.scale.set(1.9, 0.5, 1);
      group.add(body);
      const rim = new Mesh(new SphereGeometry(scale * 0.5, 4, 2), debrisRim);
      rim.scale.set(2.6, 0.1, 0.5);
      rim.position.y = scale * 0.4;
      group.add(rim);
      group.rotation.set(rng() * 6.3, rng() * 6.3, rng() * 6.3);
      group.userData.spin = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.7);
      return group;
    },
    onUpdate: (item, dt) => {
      const spin = item.object.userData.spin as Vector3;
      item.object.rotation.x += spin.x * dt;
      item.object.rotation.y += spin.y * dt;
      item.object.rotation.z += spin.z * dt;
    },
  });
  root.add(label(debris.group, 'debris'));

  // ---- crossfire ---------------------------------------------------------------
  // Rounds crossing the gap between the fleets, continuously. This is the
  // single cheapest thing in the level and the one that does the most work:
  // without it the two lines look parked, and with it they look engaged.
  const crossfireRng = mulberry32(606);
  let crossfireCooldown = 0;
  let salvoQueue: Array<{ at: number; ally: boolean; count: number }> = [];

  function launchStreak(camera: PerspectiveCamera, ally: boolean, spread: number) {
    const forward = camera.getWorldDirection(new Vector3());
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    // Start well out on the firing side and cross to the other, passing
    // through the volume ahead of the camera rather than through the camera.
    const originSide = ally ? -1 : 1;
    const depth = 130 + crossfireRng() * 520;
    const height = (crossfireRng() - 0.5) * 320 + (ally ? 40 : -20);
    const from = camera.position.clone()
      .addScaledVector(forward, depth)
      .addScaledVector(right, originSide * (200 + crossfireRng() * 260))
      .addScaledVector(up, height);
    const to = camera.position.clone()
      .addScaledVector(forward, depth + (crossfireRng() - 0.5) * 300)
      .addScaledVector(right, -originSide * (200 + crossfireRng() * 300))
      .addScaledVector(up, height + (crossfireRng() - 0.5) * spread);
    const direction = to.sub(from).normalize();
    spawnStreak(
      from,
      direction,
      520 + crossfireRng() * 380,
      26 + crossfireRng() * 46,
      ally ? hdr(ALLY_CYAN, 1.5) : hdr(FOE_CRIMSON, 1.4),
      0.55 + crossfireRng() * 0.5,
      0.7 + crossfireRng() * 1.4,
    );
  }

  /** A capital ship's broadside: a rank of parallel rounds leaving together. */
  function launchSalvo(camera: PerspectiveCamera, ally: boolean, count: number) {
    for (let i = 0; i < count; i += 1) launchStreak(camera, ally, 40);
  }

  let previousDownbeats = 0;
  let muzzleFlash = 0;
  let elapsedNow = 0;

  function update(dt: number, context: EnvironmentUpdate) {
    elapsedNow = context.elapsed;
    sky.position.copy(context.camera.position);
    atmosphere(context.progress);
    debris.update(context.progress, dt);

    // Fleet salvos land on downbeats. The friendly cruiser's battery fires on
    // every downbeat of the flank act — that is the "broadside overhead"
    // moment — and the distant lines trade salvos the rest of the run.
    const newDownbeats = context.downbeats - previousDownbeats;
    previousDownbeats = context.downbeats;
    if (newDownbeats > 0) {
      const inFlank = context.running && context.runTime >= FLANK_TIME - 0.4 && context.runTime < RAKING_TIME;
      muzzleFlash = 1;
      salvoQueue.push({ at: elapsedNow + 0.02, ally: true, count: inFlank ? 7 : 3 });
      salvoQueue.push({ at: elapsedNow + 0.34, ally: false, count: 3 });
      if (inFlank) {
        // The cruiser's own guns, right beside you.
        for (const [index, point] of cruiser.muzzlePoints.entries()) {
          const direction = cruiser.muzzleDirections[index];
          spawnStreak(
            new Vector3(point.x, point.y, point.z),
            new Vector3(direction.x, direction.y, direction.z + 0.12),
            760,
            70,
            hdr(ALLY_CYAN, 2.0),
            0.62,
            1.6,
          );
        }
      }
    }
    if (salvoQueue.length) {
      const due = salvoQueue.filter((entry) => entry.at <= elapsedNow);
      if (due.length) {
        for (const entry of due) launchSalvo(context.camera, entry.ally, entry.count);
        salvoQueue = salvoQueue.filter((entry) => entry.at > elapsedNow);
      }
    }

    // Between salvos, single rounds keep the sky busy. The trench is the one
    // place this stops: inside the hull you cannot see the battle any more.
    const inTrench = context.running && context.runTime >= TRENCH_TIME - 0.6;
    crossfireCooldown -= dt;
    if (!inTrench && crossfireCooldown <= 0) {
      crossfireCooldown = 0.05 + crossfireRng() * 0.1;
      launchStreak(context.camera, crossfireRng() < 0.5, 200);
    }

    // Muzzle glow on the ships themselves, decaying off the downbeat.
    muzzleFlash = Math.max(0, muzzleFlash - dt * 4.5);
    const flash = muzzleFlash ** 1.6;
    for (const material of cruiser.muzzles) material.opacity = flash * 0.95;
    for (const entry of distantMuzzles) entry.material.opacity = flash * 0.5;

    // Engines breathe with the score so the fleet never looks static.
    const throttle = 1.6 + context.beatEnergy * 0.5;
    for (const material of distantEngines) {
      material.color.copy(ALLY_CYAN).multiplyScalar(throttle * 0.5);
    }
    for (const material of ownFlagship.engines) {
      material.color.copy(ALLY_CYAN).multiplyScalar(2.0 + context.beatEnergy * 1.4);
    }

    // Rim strips brighten fractionally on the beat: the nebula behind the
    // fleet flickering as ordnance goes off inside it.
    const rimPulse = 1 + context.beatEnergy * 0.16;
    for (const material of [...cruiser.rimMaterials, ...warship.rimMaterials, ...flagshipDeck.rimMaterials]) {
      material.opacity = Math.min(1, 0.85 * rimPulse);
    }
  }

  function dispose() {
    debris.dispose();
    root.removeFromParent();
    disposeObject3D(root);
    debrisHull.dispose();
    debrisRim.dispose();
    scene.fog = null;
  }

  return { root, update, dispose };
}

export { RAIL as BROADSIDE_RAIL, RAIL_LENGTH };
export { BREACH_TIME, CROSSFIRE_TIME, EYE_TIME, SHIELDS_TIME };
