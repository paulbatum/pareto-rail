import {
  Color,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { mulberry32 } from '../../../engine/rng';
import {
  CARRIER,
  FLAGSHIP,
  FLAGSHIP_CENTER,
  GENERATOR_MOUNTS,
  CORE_MOUNTS,
  KEEL,
  KEEL_TURRETS,
  POINT_DEFENSE_MOUNTS,
  SHIELD_RADII,
  VALIANT,
  VALIANT_BATTERIES,
  toLocal,
  toWorld,
  type Placement,
} from '../setpieces';
import { frameAtTime } from '../flight';
import { bar } from '../timing';
import {
  createDustField,
  createFlashSystem,
  createGlowDiscGeometry,
  createSwarmSystem,
  createTracerSystem,
  type SwarmKnot,
} from './battle';
import { HullBatch, mirroredSection } from './hull-kit';
import {
  createDeckLightMaterial,
  createHullMaterial,
  createNebulaNode,
  createShieldMaterial,
  type HullPalette,
} from './materials';
import {
  CRIMSON,
  CYAN,
  DEEP_SPACE,
  HAZE,
  HULL_WHITE,
  HULL_WHITE_DARK,
  ICE_WHITE,
  MOLTEN,
  MOLTEN_HOT,
  NEBULA_DUST,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_ROSE,
  OBSIDIAN,
  OBSIDIAN_EDGE,
  hdr,
} from './palette';
import {
  buildAllyCarrier,
  buildAllyCruiser,
  buildEnemyCarrier,
  buildEnemyCruiser,
  buildFlagshipSection,
  buildKeel,
  buildValiant,
  type Livery,
} from './ships';

// THE BATTLE. Placement is authored here: which hulls stand where, how the
// two lines tangle, where the swarms knot. The set pieces come from
// ../setpieces (so gameplay mounts agree); the background fleets are laid out
// in two ragged lines — ours behind and to port, theirs ahead and to
// starboard — crossing in the middle where the rail threads between them.

export type Side = 'ally' | 'enemy';

export type ShipRecord = {
  name: string;
  side: Side;
  mesh: Mesh;
  place: Placement;
  length: number;
  beam: number;
  height: number;
  /** Background ships drift and, after the flagship falls, enemies scatter. */
  drift: Vector3;
  scatter: Vector3;
  scatterSpin: Vector3;
  baseQuaternion: Quaternion;
  basePosition: Vector3;
};

export const ALLY_LIVERY: Livery = {
  hull: HULL_WHITE.clone(),
  hullDark: HULL_WHITE_DARK.clone(),
  plating: new Color(0.62, 0.66, 0.72),
  window: hdr(new Color(0.6, 0.95, 1.0), 1.4),
  engine: hdr(CYAN, 2.2),
  vent: hdr(CYAN, 1.2),
  vein: 0,
};

export const ENEMY_LIVERY: Livery = {
  hull: OBSIDIAN.clone(),
  hullDark: new Color(0.012, 0.01, 0.014),
  plating: OBSIDIAN_EDGE.clone(),
  window: hdr(MOLTEN, 1.2),
  engine: hdr(MOLTEN, 2.4),
  vent: hdr(MOLTEN, 1.25),
  vein: 1,
};

const ALLY_HULL: HullPalette = {
  rimLow: NEBULA_MAGENTA.clone().multiplyScalar(1.1),
  rimHigh: NEBULA_GOLD.clone().multiplyScalar(1.15),
  sheen: new Color(1.0, 0.62, 0.8),
  ambient: 0.26,
  topLight: 0.46,
  rim: 1.8,
  veinColor: MOLTEN.clone(),
  hazeNear: new Color(0.16, 0.05, 0.12),
  hazeFar: HAZE.clone(),
};

const ENEMY_HULL: HullPalette = {
  rimLow: NEBULA_MAGENTA.clone().multiplyScalar(1.3),
  rimHigh: NEBULA_GOLD.clone().multiplyScalar(1.35),
  sheen: new Color(0.9, 0.35, 0.6),
  ambient: 0.32,
  topLight: 0.5,
  rim: 1.7,
  veinColor: hdr(MOLTEN, 1.1),
  hazeNear: new Color(0.16, 0.05, 0.12),
  hazeFar: HAZE.clone(),
};

type ShipType = 'ally-cruiser' | 'ally-carrier' | 'enemy-cruiser' | 'enemy-carrier';

// Background fleets: [type, x, y, z, yawDegrees, length]. Yaw 0 faces −z;
// positive yaw turns to port. Ours face the enemy (roughly −z, +x); theirs
// face back. No neat formation.
const FLEET: Array<[ShipType, number, number, number, number, number, string]> = [
  ['ally-carrier', -760, -170, 380, -8, 900, 'ARGENT'],
  ['ally-cruiser', -300, -95, -140, -22, 820, 'LANCE'],
  ['ally-cruiser', 260, -120, -520, -34, 980, 'HALBERD'],
  ['ally-cruiser', -520, -70, -1320, -14, 1150, 'BASTION'],
  ['ally-cruiser', -320, 70, -2150, -42, 820, 'SABRE'],
  ['ally-cruiser', -120, -250, -2760, -58, 900, 'CORONA'],
  ['ally-cruiser', 110, 150, -3350, -20, 720, 'VIGIL'],
  ['ally-cruiser', -900, 120, -700, -18, 760, 'AEGIS'],
  ['enemy-cruiser', 700, -60, -1750, 158, 1000, 'MAW'],
  ['enemy-cruiser', 980, 90, -2380, 150, 1120, 'SCOURGE'],
  ['enemy-carrier', 1300, -120, -3050, 140, 1300, 'BROOD'],
  ['enemy-carrier', 420, 260, -5000, 172, 1200, 'HIVE'],
  ['enemy-cruiser', 1250, 70, -3950, 176, 900, 'RAZOR'],
  ['enemy-cruiser', 180, -230, -4700, 196, 900, 'GNASH'],
  ['enemy-cruiser', 1650, 220, -1950, 150, 1000, 'THORN'],
  ['enemy-cruiser', -240, 170, -3700, 118, 780, 'VULTURE'],
  ['enemy-cruiser', 980, -260, -900, 168, 760, 'FANG'],
];

export type Environment = {
  root: Group;
  ships: ShipRecord[];
  allies: ShipRecord[];
  enemies: ShipRecord[];
  valiant: ShipRecord;
  keel: ShipRecord;
  carrier: ShipRecord;
  flagship: {
    group: Group;
    sections: Array<{ mesh: Mesh; basePosition: Vector3; center: Vector3; drift: Vector3; spin: Vector3 }>;
    shield: Mesh;
  };
  gapPair: [ShipRecord, ShipRecord];
  tracers: ReturnType<typeof createTracerSystem>;
  flashes: ReturnType<typeof createFlashSystem>;
  glows: ReturnType<typeof createFlashSystem>;
  swarm: ReturnType<typeof createSwarmSystem>;
  dust: ReturnType<typeof createDustField>;
  deckLights: Mesh;
  wreckage: Array<{ mesh: Mesh; spin: Vector3; drift: Vector3; base: Vector3; baseQuaternion: Quaternion }>;
};

function placeFromYaw(x: number, y: number, z: number, yawDeg: number): Placement {
  const yaw = MathUtils.degToRad(yawDeg);
  const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3(0, 1, 0);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, forward.clone().negate()));
  return { position: new Vector3(x, y, z), quaternion, right, up, forward };
}

function makeRecord(name: string, side: Side, geometry: BufferGeometry, place: Placement, length: number, beam: number, height: number, material: ReturnType<typeof createHullMaterial>): ShipRecord {
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(place.position);
  mesh.quaternion.copy(place.quaternion);
  mesh.matrixAutoUpdate = true;
  mesh.name = `ship:${name}`;
  return {
    name,
    side,
    mesh,
    place,
    length,
    beam,
    height,
    drift: new Vector3(),
    scatter: new Vector3(),
    scatterSpin: new Vector3(),
    baseQuaternion: place.quaternion.clone(),
    basePosition: place.position.clone(),
  };
}

export function createBattleEnvironment(scene: Scene): Environment {
  const rng = mulberry32(0xb40ad51d);
  const root = new Group();
  root.name = 'broadside-battle';

  scene.backgroundNode = createNebulaNode({
    deep: DEEP_SPACE,
    magenta: NEBULA_MAGENTA,
    rose: NEBULA_ROSE,
    gold: NEBULA_GOLD,
    dust: NEBULA_DUST,
  });

  const allyMaterial = createHullMaterial(ALLY_HULL);
  const enemyMaterial = createHullMaterial(ENEMY_HULL, { burn: true });
  const flagshipMaterial = createHullMaterial(ENEMY_HULL, { burn: true });

  const ships: ShipRecord[] = [];

  // ---- set pieces --------------------------------------------------------------
  const carrierBatch = buildAllyCarrier(ALLY_LIVERY, rng, CARRIER.length, CARRIER.beam);
  const carrier = makeRecord('RESOLUTE', 'ally', carrierBatch.build(), CARRIER.place, CARRIER.length, CARRIER.beam, 90, allyMaterial);
  ships.push(carrier);

  const valiantBatch = buildValiant(ALLY_LIVERY, rng, VALIANT.sternZ, VALIANT.bowZ, VALIANT_BATTERIES.map((b) => b.local));
  const valiant = makeRecord('VALIANT', 'ally', valiantBatch.build(), VALIANT.place, VALIANT.length, 110, 80, allyMaterial);
  ships.push(valiant);

  const keelBatch = buildKeel(ENEMY_LIVERY, rng, KEEL.sternZ, KEEL.bowZ, KEEL.bellyY, KEEL_TURRETS.map((t) => t.local));
  const keel = makeRecord('KEEL', 'enemy', keelBatch.build(), KEEL.place, KEEL.sternZ - KEEL.bowZ, 110, 80, enemyMaterial);
  ships.push(keel);

  // ---- the corkscrew gap: an ally and an enemy passing broadside to broadside ----
  // Centered where the rail runs straightest between the two corkscrews; the
  // rail swings starboard after bar 6, so both hulls stay short of that swing.
  const gapFrame = frameAtTime(bar(5.1));
  const gapForward = gapFrame.forward.clone().setY(0).normalize();
  const gapYaw = MathUtils.radToDeg(Math.atan2(-gapForward.x, -gapForward.z));
  const allyGap = gapFrame.position.clone().addScaledVector(gapFrame.right, -92).addScaledVector(gapFrame.up, -6).addScaledVector(gapForward, 10);
  const enemyGap = gapFrame.position.clone().addScaledVector(gapFrame.right, 100).addScaledVector(gapFrame.up, 8).addScaledVector(gapForward, 10);
  const gapAlly = makeRecord('PARAGON', 'ally', buildAllyCruiser(ALLY_LIVERY, rng, 380, 58, 42).build(), placeFromYaw(allyGap.x, allyGap.y, allyGap.z, gapYaw), 380, 58, 42, allyMaterial);
  const gapEnemy = makeRecord('RIPPER', 'enemy', buildEnemyCruiser(ENEMY_LIVERY, rng, 380, 60, 48).build(), placeFromYaw(enemyGap.x, enemyGap.y, enemyGap.z, gapYaw + 180), 380, 60, 48, enemyMaterial);
  ships.push(gapAlly, gapEnemy);

  // ---- background fleets ----------------------------------------------------------
  for (const [type, x, y, z, yaw, length, name] of FLEET) {
    const place = placeFromYaw(x, y, z, yaw + (rng() - 0.5) * 6);
    let batch: HullBatch;
    let beam = length * 0.09;
    let height = length * 0.07;
    if (type === 'ally-cruiser') batch = buildAllyCruiser(ALLY_LIVERY, rng, length, beam, height);
    else if (type === 'ally-carrier') {
      beam = length * 0.1;
      height = 90;
      batch = buildAllyCarrier(ALLY_LIVERY, rng, length, beam);
    } else if (type === 'enemy-cruiser') batch = buildEnemyCruiser(ENEMY_LIVERY, rng, length, beam, height);
    else {
      beam = length * 0.14;
      height = length * 0.08;
      batch = buildEnemyCarrier(ENEMY_LIVERY, rng, length, beam, height);
    }
    const side: Side = type.startsWith('ally') ? 'ally' : 'enemy';
    const record = makeRecord(name, side, batch.build(), place, length, beam, height, side === 'ally' ? allyMaterial : enemyMaterial);
    record.drift.copy(place.forward).multiplyScalar(1.5 + rng() * 2.5);
    ships.push(record);
  }

  // ---- the enemy flagship -----------------------------------------------------------
  const flagshipGroup = new Group();
  flagshipGroup.position.copy(FLAGSHIP.place.position);
  flagshipGroup.quaternion.copy(FLAGSHIP.place.quaternion);
  const sections = FLAGSHIP.sections.map((section) => {
    const batch = buildFlagshipSection(ENEMY_LIVERY, rng, {
      fromZ: section.fromZ,
      toZ: section.toZ,
      sternZ: FLAGSHIP.sternZ,
      bowZ: FLAGSHIP.bowZ,
      trench: FLAGSHIP.trench,
      beam: FLAGSHIP.beam,
      keelY: FLAGSHIP.keelY,
      generatorMounts: GENERATOR_MOUNTS.map((g) => g.local),
      coreMounts: CORE_MOUNTS.map((c) => c.local),
      pointDefense: POINT_DEFENSE_MOUNTS.map((p) => toLocal(FLAGSHIP.place, p)),
    });
    const geometry = batch.build();
    const center = new Vector3(0, -70, (section.fromZ + section.toZ) / 2);
    geometry.translate(-center.x, -center.y, -center.z);
    const mesh = new Mesh(geometry, flagshipMaterial);
    mesh.position.copy(center);
    mesh.name = `flagship:${section.name}`;
    flagshipGroup.add(mesh);
    return { mesh, basePosition: center.clone(), center, drift: new Vector3(), spin: new Vector3() };
  });
  sections[0].drift.set(-3, -4, 16);
  sections[0].spin.set(0.05, 0.02, -0.09);
  sections[1].drift.set(4, -7, 0);
  sections[1].spin.set(-0.02, 0.03, 0.06);
  sections[2].drift.set(-2, 3, -18);
  sections[2].spin.set(-0.07, -0.02, 0.04);

  const shield = new Mesh(new SphereGeometry(1, 72, 40), createShieldMaterial(hdr(new Color(1.0, 0.3, 0.12), 1.4), hdr(MOLTEN_HOT, 2.2)));
  shield.scale.copy(SHIELD_RADII);
  shield.position.copy(FLAGSHIP_CENTER);
  shield.quaternion.copy(FLAGSHIP.place.quaternion);
  shield.userData.raildIgnoreOcclusion = true;
  shield.renderOrder = 2;

  // ---- flight-deck launch lights -----------------------------------------------------
  const deckLightBatch = new HullBatch();
  for (let z = CARRIER.length / 2 - 30; z > -CARRIER.length / 2 + 4; z -= 9) {
    for (const x of [-7, 7]) {
      // Chevrons point toward the bow.
      deckLightBatch.loft([
        { z: z + 2.6, points: [[x + (x > 0 ? 1.6 : -1.6), 0.25], [x, 0.25], [x, 0.3]] },
        { z, points: [[x + (x > 0 ? 0.3 : -0.3), 0.25], [x - (x > 0 ? 0.9 : -0.9), 0.25], [x - (x > 0 ? 0.9 : -0.9), 0.3]] },
      ], { albedo: new Color(1, 1, 1) }, { aft: false, fore: false });
      deckLightBatch.box(new Vector3(x, 0.22, z), new Vector3(1.8, 0.12, 2.6), { albedo: new Color(1, 1, 1) });
    }
    deckLightBatch.box(new Vector3(0, 0.2, z), new Vector3(0.5, 0.1, 4), { albedo: new Color(1, 1, 1) });
  }
  const deckLights = new Mesh(deckLightBatch.build(), createDeckLightMaterial(hdr(CYAN, 2.2)));
  deckLights.position.copy(CARRIER.place.position);
  deckLights.quaternion.copy(CARRIER.place.quaternion);
  deckLights.userData.raildIgnoreOcclusion = true;

  // ---- wreckage in the eye -------------------------------------------------------------
  const wreckage: Environment['wreckage'] = [];
  const wreckMaterialAlly = allyMaterial;
  for (let i = 0; i < 12; i += 1) {
    const t = bar(13.9 + (i / 12) * 2.6);
    const frame = frameAtTime(t);
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = side * (78 + rng() * 90);
    const vertical = (rng() - 0.35) * 90;
    const position = frame.position.clone().addScaledVector(frame.right, lateral).addScaledVector(frame.up, vertical).addScaledVector(frame.forward, rng() * 40);
    const batch = new HullBatch();
    const size = 8 + rng() * 22;
    const ally = rng() < 0.55;
    const livery = ally ? ALLY_LIVERY : ENEMY_LIVERY;
    const jag = () => (rng() - 0.5) * size * 0.5;
    batch.loft([
      mirroredSection(size, [[size * 0.3 + jag(), -size * 0.3], [size * 0.5, jag() * 0.4], [size * 0.25, size * 0.3 + jag()]]),
      mirroredSection(-size * 0.2, [[size * 0.35, -size * 0.35 + jag()], [size * 0.55 + jag(), 0], [size * 0.3, size * 0.32]]),
      mirroredSection(-size, [[size * 0.1 + jag() * 0.3, -size * 0.2], [size * 0.3 + jag(), jag() * 0.4], [size * 0.12, size * 0.1]]),
    ], { albedo: livery.hull, vein: livery.vein, emissive: rng() < 0.4 ? hdr(MOLTEN, 0.5) : undefined });
    for (let k = 0; k < 3; k += 1) batch.box(new Vector3(jag(), jag(), jag()), new Vector3(size * 0.2, size * 0.1, size * 0.4), { albedo: livery.plating });
    const mesh = new Mesh(batch.build(), ally ? wreckMaterialAlly : enemyMaterial);
    mesh.name = `wreck:${i}`;
    mesh.position.copy(position);
    const baseQuaternion = new Quaternion().setFromAxisAngle(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), rng() * Math.PI * 2);
    mesh.quaternion.copy(baseQuaternion);
    wreckage.push({
      mesh,
      spin: new Vector3((rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3),
      drift: new Vector3((rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3),
      base: position.clone(),
      baseQuaternion,
    });
    root.add(mesh);
  }
  // A broken ally cruiser drifts through the eye: two short hull halves tumbling apart.
  {
    const frame = frameAtTime(bar(15));
    const at = frame.position.clone().addScaledVector(frame.right, 210).addScaledVector(frame.up, -120).addScaledVector(frame.forward, 60);
    const halfLength = 260;
    for (const [index, offset] of [[0, 1], [1, -1]] as const) {
      const batch = buildAllyCruiser(ALLY_LIVERY, rng, halfLength * 2, 58, 42);
      const mesh = new Mesh(batch.build(), allyMaterial);
      mesh.name = `wreck:cruiser-${index}`;
      const position = at.clone().addScaledVector(frame.forward, offset * 150).addScaledVector(frame.up, offset * 12);
      mesh.position.copy(position);
      const baseQuaternion = placeFromYaw(0, 0, 0, MathUtils.radToDeg(Math.atan2(-frame.forward.x, -frame.forward.z)) + 70 + index * 40).quaternion
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), offset * 0.35));
      mesh.quaternion.copy(baseQuaternion);
      wreckage.push({ mesh, spin: new Vector3(0.01 * offset, 0.02, 0.015 * offset), drift: new Vector3(offset * 1.5, -0.5, 0), base: position.clone(), baseQuaternion });
      root.add(mesh);
    }
  }

  // ---- ambient battle systems -------------------------------------------------------------
  const tracers = createTracerSystem(420);
  const flashes = createFlashSystem(220, createGlowDiscGeometry(18, 0.3));
  const glows = createFlashSystem(90, createGlowDiscGeometry(24, 0.18));

  const knots: SwarmKnot[] = [];
  const knot = (center: Vector3, radius: Vector3, count: number, side: Side, speed = 1) => {
    knots.push({
      center,
      radius,
      count,
      side,
      speed,
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(rng() - 0.5, rng() * 0.4, rng() - 0.5).normalize(), rng() * Math.PI),
    });
  };
  // Dogfights tangled through the gaps, near and far.
  const railKnot = (barValue: number, lateral: number, vertical: number, ahead: number, radius: number, count: number, side: Side) => {
    const frame = frameAtTime(bar(barValue));
    knot(frame.position.clone().addScaledVector(frame.right, lateral).addScaledVector(frame.up, vertical).addScaledVector(frame.forward, ahead), new Vector3(radius, radius * 0.5, radius * 0.8), count, side);
  };
  railKnot(3, 220, 60, 300, 120, 14, 'enemy');
  railKnot(3, 160, 40, 280, 110, 10, 'ally');
  railKnot(6, -260, 90, 250, 140, 12, 'ally');
  railKnot(6, -240, 70, 260, 130, 12, 'enemy');
  railKnot(9, 380, 120, 400, 180, 18, 'enemy');
  railKnot(9, 360, 100, 380, 170, 12, 'ally');
  railKnot(12, 420, -80, 350, 200, 16, 'enemy');
  railKnot(12, 400, -60, 360, 190, 10, 'ally');
  railKnot(15, 300, 150, 200, 220, 16, 'enemy');
  railKnot(15, -250, -120, 260, 200, 14, 'ally');
  railKnot(18, 330, 80, 420, 200, 14, 'enemy');
  railKnot(22, -260, 160, 380, 220, 18, 'enemy');
  railKnot(22, -280, 150, 400, 200, 10, 'ally');
  railKnot(28, 300, 180, 500, 260, 20, 'enemy');
  railKnot(28, -320, 120, 460, 240, 14, 'ally');
  // Streams pouring off the enemy carriers' hangars.
  for (const [name, count] of [['BROOD', 22], ['HIVE', 22]] as const) {
    const record = ships.find((ship) => ship.name === name);
    if (!record) continue;
    for (const side of [-1, 1]) {
      const mouth = toWorld(record.place, side * record.beam * 0.7, 0, 0);
      knot(mouth, new Vector3(record.beam * 1.4, 70, record.length * 0.35), count / 2, 'enemy', 0.8);
    }
  }
  const swarm = createSwarmSystem(knots, {
    allyHull: new Color(0.55, 0.6, 0.7),
    enemyHull: new Color(0.03, 0.02, 0.03),
    allyEngine: hdr(CYAN, 2.6),
    enemyEngine: hdr(MOLTEN, 2.8),
  }, rng);

  const dust = createDustField(260, new Color(0.7, 0.75, 0.9), rng);

  for (const ship of ships) root.add(ship.mesh);
  root.add(flagshipGroup, shield, deckLights, tracers.mesh, flashes.mesh, glows.mesh, swarm.group, dust.lines);
  scene.add(root);

  const allies = ships.filter((ship) => ship.side === 'ally');
  const enemies = ships.filter((ship) => ship.side === 'enemy');
  return {
    root,
    ships,
    allies,
    enemies,
    valiant,
    keel,
    carrier,
    flagship: { group: flagshipGroup, sections, shield },
    gapPair: [gapAlly, gapEnemy],
    tracers,
    flashes,
    glows,
    swarm,
    dust,
    deckLights,
    wreckage,
  };
}

/** A random point on a ship's hull surface region, in world space. */
export function randomHullPoint(ship: ShipRecord, rng: () => number, target = new Vector3()) {
  const x = (rng() - 0.5) * ship.beam * 0.9;
  const y = (rng() - 0.5) * ship.height * 0.8;
  const z = (rng() - 0.5) * ship.length * 0.8;
  return target.copy(ship.mesh.position)
    .addScaledVector(ship.place.right, x)
    .addScaledVector(ship.place.up, y)
    .addScaledVector(ship.place.forward, -z);
}
