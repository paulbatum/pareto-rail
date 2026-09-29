import { BufferGeometry, Color, Euler, Quaternion, Vector3 } from 'three';
import { BELLY_MOUNTS_LOCAL, FLAGSHIP, FLAGSHIP_GENS_WORLD, FLAGSHIP_PD_WORLD, shipMatrix, TRENCH_PD_WORLD, type ShipSpec } from '../battlefield';
import { createHullBuilder, type HullBuilder } from './hull-kit';
import { mulberry32, type ShipLook } from './palette';

// Procedural capital ships. Local frame: +x starboard, +y up, -z toward the bow.
// Silhouette, not surface detail, carries the read at kilometer scale, so each
// ship is a stack of stepped plates, decks, towers, and gun batteries, with the
// sides told apart by shape as well as color: the fleet is smooth, swept, and
// layered; the enemy is spined, horned, and jagged.

export type ShipMount = { position: Vector3; direction: Vector3 };
export type ShipModel = {
  hull: BufferGeometry;
  glow: BufferGeometry | null;
  /** Broadside guns and other firing points, in ship-local space. */
  guns: ShipMount[];
  /** Engine nozzles, in ship-local space. */
  engines: Array<{ position: Vector3; radius: number }>;
  /** Hangar mouths, in ship-local space. */
  hangars: ShipMount[];
  /** Points on the outer hull for battle damage, in ship-local space. */
  surface: Vector3[];
};

type Station = { f: number; w: number; h: number };
const CRUISER_STATIONS: readonly Station[] = [
  { f: 0, w: 0.05, h: 0.32 },
  { f: 0.05, w: 0.28, h: 0.5 },
  { f: 0.13, w: 0.55, h: 0.74 },
  { f: 0.25, w: 0.82, h: 0.94 },
  { f: 0.4, w: 1, h: 1 },
  { f: 0.6, w: 1, h: 1 },
  { f: 0.78, w: 0.96, h: 1 },
  { f: 0.92, w: 0.88, h: 0.94 },
  { f: 1, w: 0.78, h: 0.86 },
];

const quaternionFromEuler = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z));

function stationAt(stations: readonly Station[], f: number) {
  for (let i = 1; i < stations.length; i += 1) {
    if (f <= stations[i].f) {
      const a = stations[i - 1];
      const b = stations[i];
      const t = (f - a.f) / Math.max(1e-6, b.f - a.f);
      return { w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
    }
  }
  const last = stations[stations.length - 1];
  return { w: last.w, h: last.h };
}

export function buildShip(spec: ShipSpec, look: ShipLook): ShipModel {
  const rotation = new Quaternion().setFromRotationMatrix(shipMatrix(spec));
  const builder = createHullBuilder(rotation, look.rig);
  const rng = mulberry32(spec.seed);
  const model: ShipModel = { hull: new BufferGeometry(), glow: null, guns: [], engines: [], hangars: [], surface: [] };
  const enemy = spec.side === 'enemy';

  switch (spec.cls) {
    case 'aegis':
      buildAegis(builder, spec, look, model, rng);
      break;
    case 'carrier':
      buildCarrier(builder, spec, look, model, rng);
      break;
    case 'flagship':
      buildFlagship(builder, spec, look, model, rng);
      break;
    case 'wreck':
      buildCruiser(builder, spec, look, model, rng, { enemy, wreck: true });
      break;
    default:
      buildCruiser(builder, spec, look, model, rng, { enemy, wreck: false });
  }

  const built = builder.build();
  model.hull = built.hull;
  model.glow = built.glow;
  return model;
}

// ---- shared pieces ----------------------------------------------------------------------

function hullSegments(
  builder: HullBuilder,
  spec: ShipSpec,
  look: ShipLook,
  stations: readonly Station[],
  options: { from?: number; to?: number; centerY?: number; jitter?: number; skipTop?: boolean } = {},
) {
  const { length, beam, height } = spec;
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (b.f <= from || a.f >= to) continue;
    const z0 = -length / 2 + a.f * length;
    const z1 = -length / 2 + b.f * length;
    const sizeX = beam * b.w;
    const sizeY = height * b.h;
    builder.taperedBox(
      0,
      options.centerY ?? 0,
      (z0 + z1) / 2,
      sizeX,
      sizeY,
      z1 - z0,
      a.w / b.w,
      a.h / b.h,
      i % 2 === 0 ? look.hull : look.hullDark.clone().lerp(look.hull, 0.55),
      { jitter: options.jitter ?? 0.1 },
    );
  }
}

/** Twin-barrel turret: housing plus two barrels along `direction` (unit, local). */
const hdrWhite = (look: ShipLook) => look.window.clone().lerp(new Color(2, 2, 2.2), 0.6);

function turret(
  builder: HullBuilder,
  look: ShipLook,
  position: Vector3,
  direction: Vector3,
  scale: number,
  barrels = 2,
) {
  const housing = look.trim;
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction);
  builder.cylinder(position.x, position.y - scale * 0.15, position.z, scale * 1.35, scale * 0.9, 'y', 8, housing, { jitter: 0.06 });
  builder.box(position.x, position.y + scale * 0.35, position.z, scale * 1.8, scale * 0.85, scale * 2.2, look.hull, { rotation: q, jitter: 0.06 });
  const spread = barrels === 1 ? [0] : barrels === 2 ? [-0.42, 0.42] : [-0.6, 0, 0.6];
  for (const offset of spread) {
    const local = new Vector3(offset * scale, scale * 0.42, -scale * 2.6).applyQuaternion(q);
    builder.box(position.x + local.x, position.y + local.y, position.z + local.z, scale * 0.3, scale * 0.3, scale * 3.6, look.gun, { rotation: q });
  }
}

/** A deployable-gun socket: a dark collar with a molten seam, seated where a turret will rise. */
function socket(builder: HullBuilder, look: ShipLook, at: Vector3, normal: Vector3, size: number) {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal);
  const offset = (distance: number) => at.clone().addScaledVector(normal, distance);
  // Kept shallow (under two meters) so the gun that rises from it is never hidden behind its own housing.
  builder.cylinder(at.x, at.y, at.z, size * 0.5, size * 0.1, 'y', 10, look.hullDark, { rotation: q });
  const ring = offset(size * 0.07);
  builder.cylinder(ring.x, ring.y, ring.z, size * 0.42, size * 0.03, 'y', 10, look.seam, { rotation: q, glow: true });
}

function antennaMast(builder: HullBuilder, look: ShipLook, x: number, y: number, z: number, height: number, rng: () => number) {
  builder.box(x, y + height / 2, z, 0.5, height, 0.5, look.trim);
  const bars = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < bars; i += 1) {
    const at = y + height * (0.45 + i * 0.22);
    builder.box(x, at, z, 1.5 + rng() * 5, 0.35, 0.35, look.trim);
  }
  builder.box(x, y + height, z, 0.9, 0.9, 0.9, look.accent, { glow: true });
}

/** Armor plating: staggered plates on the flanks so long walls read as built, not extruded. */
function skin(
  builder: HullBuilder,
  spec: ShipSpec,
  look: ShipLook,
  stations: readonly Station[],
  rng: () => number,
  options: { fromF: number; toF: number; density: number; belowRail?: number },
) {
  const { length, beam, height } = spec;
  const area = ((options.toF - options.fromF) * length * height) / 240;
  const count = Math.min(900, Math.round(area * options.density));
  for (let i = 0; i < count; i += 1) {
    const f = options.fromF + rng() * (options.toF - options.fromF);
    const st = stationAt(stations, f);
    const side = rng() < 0.5 ? -1 : 1;
    const h = height * st.h;
    const y = (rng() - 0.5) * h * 0.86;
    const sz = 6 + rng() * 26;
    const sy = 2.5 + rng() * Math.min(12, h * 0.16);
    const out = 0.35 + rng() * 1.1;
    const z = -length / 2 + f * length;
    const pick = rng();
    builder.box(side * (beam * st.w / 2 + out / 2), y, z, out, sy, sz, pick < 0.4 ? look.hullDark : pick < 0.75 ? look.trim : look.hull, { jitter: 0.16 });
  }
  // Horizontal panel lines, chunked so they follow the hull's taper.
  const chunks = Math.max(3, Math.round(((options.toF - options.fromF) * length) / 60));
  for (let c = 0; c < chunks; c += 1) {
    const f0 = options.fromF + ((options.toF - options.fromF) * c) / chunks;
    const f1 = options.fromF + ((options.toF - options.fromF) * (c + 1)) / chunks;
    const st = stationAt(stations, (f0 + f1) / 2);
    const z = -length / 2 + ((f0 + f1) / 2) * length;
    for (const side of [-1, 1]) {
      for (let k = -2; k <= 2; k += 1) {
        const y = (k / 2) * height * st.h * 0.4;
        builder.box(side * (beam * st.w / 2 + 0.05), y, z, 0.3, 0.32, (f1 - f0) * length * 0.94, look.hullDark);
      }
    }
  }
}

function greebles(
  builder: HullBuilder,
  look: ShipLook,
  rng: () => number,
  count: number,
  region: { x: number; z0: number; z1: number },
  topY: (z: number, x: number) => number,
  size: number,
  keepOut = 0,
) {
  for (let i = 0; i < count; i += 1) {
    const z = region.z0 + rng() * (region.z1 - region.z0);
    const x = (rng() * 2 - 1) * region.x;
    if (Math.abs(x) < keepOut) continue;
    const sx = size * (0.4 + rng() * 1.6);
    const sy = size * (0.25 + rng() * 1.1);
    const sz = size * (0.5 + rng() * 2.2);
    builder.box(x, topY(z, x) + sy / 2, z, sx, sy, sz, rng() > 0.5 ? look.hullDark : look.trim, { jitter: 0.12 });
  }
}

function flankWindows(
  builder: HullBuilder,
  spec: ShipSpec,
  stations: readonly Station[],
  rng: () => number,
  rows: number[],
  fromF: number,
  toF: number,
  spacing: number,
  color: Color,
) {
  const { length, beam, height } = spec;
  for (const side of [-1, 1]) {
    for (const rowY of rows) {
      for (let z = -length / 2 + fromF * length; z < -length / 2 + toF * length; z += spacing) {
        if (rng() < 0.16) continue;
        const f = (z + length / 2) / length;
        const st = stationAt(stations, f);
        if (Math.abs(rowY) > (height * st.h) / 2 - 1) continue;
        builder.glowPlate(
          new Vector3(side * (beam * st.w / 2 + 0.25), rowY, z),
          new Vector3(0, 0, spacing * 0.55),
          new Vector3(0, 1.0 + rng() * 0.6, 0),
          color,
        );
      }
    }
  }
}

function engineBlock(builder: HullBuilder, spec: ShipSpec, look: ShipLook, model: ShipModel, cols: number, rowsCount: number, radiusFactor: number) {
  const { length, beam, height } = spec;
  const zBack = length / 2;
  const radius = Math.min(beam / (cols * 2.6), height / (rowsCount * 2.8)) * radiusFactor * 0.95;
  builder.taperedBox(0, -height * 0.02, zBack + 4, beam * 0.72, height * 0.9, 10, 1.08, 1.08, look.hullDark, { jitter: 0.05 });
  for (let r = 0; r < rowsCount; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = (c - (cols - 1) / 2) * radius * 2.5;
      const y = (r - (rowsCount - 1) / 2) * radius * 2.5 - height * 0.02;
      builder.cylinder(x, y, zBack + 12, radius, 8, 'z', 10, look.trim, { radiusEnd: radius * 1.18, caps: false });
      builder.cylinder(x, y, zBack + 16.2, radius * 0.94, 0.5, 'z', 10, look.engine, { glow: true });
      model.engines.push({ position: new Vector3(x, y, zBack + 17), radius: radius * 0.95 });
    }
  }
}

// ---- cruiser / frigate / wreck ---------------------------------------------------------------

function buildCruiser(
  builder: HullBuilder,
  spec: ShipSpec,
  look: ShipLook,
  model: ShipModel,
  rng: () => number,
  options: { enemy: boolean; wreck: boolean },
) {
  const { length, beam, height } = spec;
  const stations = CRUISER_STATIONS;
  const large = length > 300;
  const cutF = options.wreck ? 0.58 : 1;

  hullSegments(builder, spec, look, stations, { to: cutF });
  skin(builder, spec, look, stations, rng, { fromF: 0.1, toF: Math.min(0.9, cutF - 0.03), density: large ? 2.4 : 1.6 });

  // Underside: plating, a keel ridge, and running lights, so a ship passed from below is not a black slab.
  {
    const bellyY = -height / 2;
    const plateCount = Math.round((length * beam) / 90);
    for (let i = 0; i < plateCount; i += 1) {
      const f = 0.1 + rng() * (cutF - 0.16);
      const st = stationAt(stations, f);
      const w = 5 + rng() * 22;
      const d = 4 + rng() * 16;
      const h = 0.5 + rng() * 1.6;
      const x = (rng() * 2 - 1) * beam * st.w * 0.42;
      builder.box(x, bellyY - h / 2 + (height * (1 - st.h)) / 2, -length / 2 + f * length, w, h, d, rng() < 0.5 ? look.hullDark : look.trim, { jitter: 0.18 });
    }
    builder.box(0, bellyY - 1.4, -length / 2 + length * 0.5 * cutF, beam * 0.07, 2.8, length * 0.72 * cutF, look.hullDark, { jitter: 0.08 });
    for (let z = -length / 2 + length * 0.1; z < -length / 2 + length * (cutF - 0.08); z += 26 + rng() * 14) {
      builder.box(0, bellyY - 2.9, z, 0.5, 0.3, 8 + rng() * 6, look.seam, { glow: true });
      for (const side of [-1, 1]) builder.box(side * beam * 0.3, bellyY - 0.3, z + 10, 0.7, 0.5, 0.7, look.accent, { glow: true });
    }
  }

  // Dorsal decks: stepped tiers for a layered, ship-like silhouette.
  const deckTop = (f: number) => (height * stationAt(stations, f).h) / 2;
  const tiers = large ? 3 : 2;
  for (let tier = 0; tier < tiers; tier += 1) {
    const f0 = 0.2 + tier * 0.06;
    const f1 = Math.min(cutF, 0.86 - tier * 0.08);
    if (f1 <= f0) continue;
    const z0 = -length / 2 + f0 * length;
    const z1 = -length / 2 + f1 * length;
    const w = beam * (0.66 - tier * 0.15);
    const h = height * 0.11;
    const y = deckTop((f0 + f1) / 2) + h * (tier + 0.5) + tier * 0.5;
    builder.taperedBox(0, y, (z0 + z1) / 2, w, h, z1 - z0, 0.55, 1, look.hull, { jitter: 0.09 });
  }

  // Bridge tower with lit windows.
  const bridgeF = 0.66;
  if (bridgeF < cutF) {
    const bz = -length / 2 + bridgeF * length;
    const baseY = deckTop(bridgeF) + height * 0.28;
    builder.box(0, baseY, bz, beam * 0.24, height * 0.34, length * 0.06, look.hull, { jitter: 0.06 });
    builder.box(0, baseY + height * 0.26, bz, beam * 0.34, height * 0.13, length * 0.05, look.hullDark, { jitter: 0.06 });
    builder.glowPlate(new Vector3(0, baseY + height * 0.26, bz - length * 0.0252), new Vector3(beam * 0.3, 0, 0), new Vector3(0, height * 0.045, 0), look.window);
    antennaMast(builder, look, beam * 0.08, baseY + height * 0.32, bz + 3, height * 0.55, rng);
    antennaMast(builder, look, -beam * 0.1, baseY + height * 0.32, bz - 4, height * 0.34, rng);
  }

  if (options.enemy) enemySpines(builder, spec, look, rng, stations, cutF);
  else friendlySwoops(builder, spec, look, cutF);

  // Broadside batteries on both flanks (two shelves) and forward dorsal turrets.
  const turretScale = Math.max(1.6, Math.min(4.2, length / 200));
  const spacing = Math.max(16, length / (large ? 26 : 8));
  const shelfRows = large ? [height * 0.02, height * 0.3] : [height * 0.2];
  for (const side of [-1, 1] as const) {
    for (const [rowIndex, rowY] of shelfRows.entries()) {
      for (let z = -length / 2 + length * 0.2; z < -length / 2 + length * (cutF - 0.08); z += spacing) {
        const f = (z + length / 2) / length;
        const st = stationAt(stations, f);
        const x = side * (beam * st.w / 2 + turretScale * 0.6);
        const zz = z + (rowIndex === 0 ? 0 : spacing * 0.5);
        if (Math.abs(rowY) > (height * st.h) / 2) continue;
        builder.box(side * (beam * st.w / 2 + turretScale * 0.25), rowY - turretScale * 0.5, zz, turretScale * 1.6, turretScale * 0.6, turretScale * 3.4, look.hullDark, { jitter: 0.08 });
        const direction = new Vector3(side, 0.28, options.enemy ? -0.15 : 0.05).normalize();
        turret(builder, look, new Vector3(x, rowY, zz), direction, turretScale * 0.62);
        model.guns.push({ position: new Vector3(x + side * turretScale * 1.4, rowY + turretScale * 0.4, zz), direction });
      }
    }
  }
  for (let i = 0; i < (large ? 4 : 1); i += 1) {
    const f = 0.28 + i * 0.075;
    if (f > cutF - 0.06) break;
    const z = -length / 2 + f * length;
    turret(builder, look, new Vector3(0, deckTop(f) + height * 0.16 + i * 0.5, z), new Vector3(0, 0.08, -1).normalize(), turretScale * 0.85, 3);
    model.guns.push({ position: new Vector3(0, deckTop(f) + height * 0.3, z - turretScale * 2), direction: new Vector3(0, 0.08, -1).normalize() });
  }

  // Surface texture: plates, vents, and antennas.
  greebles(builder, look, rng, Math.round(length / 3.2), { x: beam * 0.4, z0: -length * 0.34, z1: length * (cutF - 0.5) }, (z) => deckTop((z + length / 2) / length) + height * 0.07, Math.max(1.2, height * 0.05));
  flankWindows(builder, spec, stations, rng, [-height * 0.12, height * 0.08, height * 0.2], 0.16, cutF - 0.03, options.enemy ? 15 : 9, look.window);

  // Edge running lights.
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + length * 0.08; z < -length / 2 + length * (cutF - 0.02); z += Math.max(14, length / 30)) {
      const f = (z + length / 2) / length;
      const st = stationAt(stations, f);
      builder.box(side * beam * st.w * 0.5, deckTop(f), z, 0.8, 0.8, 0.8, look.accent, { glow: true });
    }
  }

  if (!options.wreck) engineBlock(builder, spec, look, model, large ? 4 : 2, large ? 2 : 1, 1);
  else wreckBreak(builder, spec, look, model, rng, stations, cutF);

  if (spec.id === 'belly') {
    for (const [lx, lz] of BELLY_MOUNTS_LOCAL) socket(builder, look, new Vector3(lx, -height / 2 - 0.4, lz), new Vector3(0, -1, 0), 15);
  }

  // Hull hit points for battle damage.
  for (let i = 0; i < 22; i += 1) {
    const z = -length / 2 + (0.1 + rng() * (cutF - 0.2)) * length;
    const st = stationAt(stations, (z + length / 2) / length);
    if (i % 3 === 0) model.surface.push(new Vector3((rng() * 2 - 1) * beam * st.w * 0.4, (height * st.h) / 2 + 2, z));
    else model.surface.push(new Vector3((i % 2 ? 1 : -1) * (beam * st.w) / 2, (rng() * 2 - 1) * height * 0.3, z));
  }
}

function friendlySwoops(builder: HullBuilder, spec: ShipSpec, look: ShipLook, cutF: number) {
  const { length, beam, height } = spec;
  // Swept fins aft and a dorsal keel blade: the fleet is smooth and raked.
  for (const side of [-1, 1]) {
    // Swept fins stay within a few meters of the hull side: the rail flies close along the wall.
    builder.taperedBox(side * (beam * 0.5 + 5), height * 0.14, -length / 2 + length * 0.86, beam * 0.16, height * 0.1, length * 0.24, 0.35, 0.8, look.hull, {
      rotation: quaternionFromEuler(0, side * 0.12, side * 0.05),
      jitter: 0.06,
    });
    builder.taperedBox(side * beam * 0.5, height * 0.05, -length / 2 + length * 0.42, beam * 0.04, height * 0.38, length * 0.46, 0.5, 1, look.hullDark, { jitter: 0.08 });
  }
  if (cutF >= 1) {
    builder.taperedBox(0, -height * 0.58, -length / 2 + length * 0.55, beam * 0.16, height * 0.32, length * 0.55, 0.3, 0.6, look.hullDark, { jitter: 0.06 });
  }
}

function enemySpines(
  builder: HullBuilder,
  spec: ShipSpec,
  look: ShipLook,
  rng: () => number,
  stations: readonly Station[],
  cutF: number,
) {
  const { length, beam, height } = spec;
  // Dorsal fins raked aft with molten leading edges.
  const finCount = Math.round(length / 42);
  for (let i = 0; i < finCount; i += 1) {
    const f = 0.16 + (i / finCount) * (cutF - 0.22);
    const z = -length / 2 + f * length;
    const st = stationAt(stations, f);
    const fh = height * (0.32 + rng() * 0.36);
    const x = (rng() - 0.5) * beam * 0.35;
    builder.taperedBox(x, (height * st.h) / 2 + fh * 0.42, z, 1.6, fh, length * 0.03, 1, 0.5, look.hullDark, {
      rotation: quaternionFromEuler(-0.32, 0, 0),
      jitter: 0.1,
    });
    builder.box(x, (height * st.h) / 2 + fh * 0.92, z - fh * 0.16, 0.5, 0.5, length * 0.024, look.seam, { glow: true });
  }
  // Bow horns.
  for (const side of [-1, 1]) {
    builder.taperedBox(side * beam * 0.18, height * 0.05, -length / 2 - length * 0.05, beam * 0.13, height * 0.22, length * 0.16, 0.1, 0.5, look.hull, {
      rotation: quaternionFromEuler(0, side * -0.09, 0),
      jitter: 0.08,
    });
  }
  // Molten seams: long emissive lines that run the length of the ridgelines.
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + length * 0.12; z < -length / 2 + length * (cutF - 0.1); z += 34 + rng() * 26) {
      const f = (z + length / 2) / length;
      const st = stationAt(stations, f);
      builder.box(side * beam * st.w * 0.28, (height * st.h) / 2 + 0.3, z, 0.7, 0.3, 14 + rng() * 22, look.seam, { glow: true });
    }
  }
  // Rear blades.
  for (const side of [-1, 1]) {
    builder.taperedBox(side * beam * 0.6, height * 0.1, -length / 2 + length * 0.9, beam * 0.3, height * 0.08, length * 0.2, 0.3, 1, look.hull, {
      rotation: quaternionFromEuler(0, side * 0.5, side * 0.35),
      jitter: 0.08,
    });
  }
}

function wreckBreak(
  builder: HullBuilder,
  spec: ShipSpec,
  look: ShipLook,
  model: ShipModel,
  rng: () => number,
  stations: readonly Station[],
  cutF: number,
) {
  const { length, beam, height } = spec;
  const cutZ = -length / 2 + cutF * length;
  const st = stationAt(stations, cutF);
  // Molten cut face and torn frame ribs.
  builder.glowPlate(new Vector3(0, 0, cutZ + 0.2), new Vector3(beam * st.w * 0.92, 0, 0), new Vector3(0, height * st.h * 0.92, 0), look.seam.clone().multiplyScalar(0.62));
  for (let i = 0; i < 9; i += 1) {
    builder.box((rng() - 0.5) * beam * st.w, (rng() - 0.5) * height * st.h, cutZ + 2 + rng() * 10, 1 + rng() * 2, 2 + rng() * 6, 1 + rng() * 10, look.hullDark, {
      rotation: quaternionFromEuler(rng() - 0.5, rng() - 0.5, rng() - 0.5),
    });
  }
  // The tail section, adrift and tumbling away.
  const tailStations = stations.filter((station) => station.f >= cutF);
  const q = quaternionFromEuler(0.25, 0.18, 0.4);
  for (let i = 1; i < tailStations.length; i += 1) {
    const a = tailStations[i - 1];
    const b = tailStations[i];
    const z0 = -length / 2 + a.f * length + length * 0.18;
    const z1 = -length / 2 + b.f * length + length * 0.18;
    builder.taperedBox(beam * 0.5, height * 0.4, (z0 + z1) / 2, beam * b.w, height * b.h, z1 - z0, a.w / b.w, a.h / b.h, look.hullDark, { rotation: q, jitter: 0.1 });
  }
  for (let i = 0; i < 26; i += 1) {
    builder.box((rng() - 0.5) * beam * 1.4, (rng() - 0.5) * height * 1.6, cutZ + rng() * length * 0.34, 1 + rng() * 3, 0.5 + rng() * 2, 1 + rng() * 4, look.hullDark, {
      rotation: quaternionFromEuler(rng() * 3, rng() * 3, rng() * 3),
    });
  }
  model.engines.length = 0;
}

// ---- carrier ----------------------------------------------------------------------------------

function buildCarrier(builder: HullBuilder, spec: ShipSpec, look: ShipLook, model: ShipModel, rng: () => number) {
  const { length, beam, height } = spec;
  // Blunt wedge hull with a flat flight deck: wide, low, and layered.
  builder.taperedBox(0, 0, 0, beam * 0.62, height, length, 0.4, 0.82, look.hull, { jitter: 0.08, backScaleX: 0.9 });
  builder.taperedBox(0, height * 0.32, -length * 0.02, beam, height * 0.22, length * 0.88, 0.55, 1, look.hullDark, { jitter: 0.08 });
  builder.taperedBox(0, height * 0.5, -length * 0.02, beam * 0.9, height * 0.12, length * 0.8, 0.6, 1, look.hull, { jitter: 0.08 });
  // Hangar mouths along the bow face and the lane-side flank.
  for (let row = 0; row < 2; row += 1) {
    for (let i = 0; i < 6; i += 1) {
      const x = (i - 2.5) * (beam * 0.11);
      const y = height * (0.24 - row * 0.3);
      builder.glowPlate(new Vector3(x, y, -length / 2 - 0.4), new Vector3(beam * 0.075, 0, 0), new Vector3(0, height * 0.16, 0), look.seam.clone().multiplyScalar(0.9));
      model.hangars.push({ position: new Vector3(x, y, -length / 2 - 3), direction: new Vector3(0, 0, -1) });
    }
  }
  for (let i = 0; i < 10; i += 1) {
    const z = -length * 0.36 + i * length * 0.075;
    builder.glowPlate(new Vector3(-beam / 2 - 0.4, height * 0.28, z), new Vector3(0, 0, length * 0.038), new Vector3(0, height * 0.22, 0), look.seam.clone().multiplyScalar(0.8));
    model.hangars.push({ position: new Vector3(-beam / 2 - 3, height * 0.28, z), direction: new Vector3(-1, 0, 0) });
  }
  // Island tower, spines, and deck clutter.
  builder.box(beam * 0.34, height * 0.95, length * 0.16, beam * 0.1, height * 1.4, length * 0.07, look.hull, { jitter: 0.06 });
  builder.box(beam * 0.34, height * 1.7, length * 0.16, beam * 0.16, height * 0.3, length * 0.08, look.hullDark, { jitter: 0.06 });
  builder.glowPlate(new Vector3(beam * 0.34, height * 1.7, length * 0.16 - length * 0.041), new Vector3(beam * 0.14, 0, 0), new Vector3(0, height * 0.1, 0), look.window);
  for (let i = 0; i < 30; i += 1) {
    const z = -length * 0.4 + rng() * length * 0.8;
    const x = (rng() - 0.5) * beam * 0.8;
    const h = height * (0.3 + rng() * 0.9);
    builder.taperedBox(x, height * 0.56 + h * 0.5, z, 1.4, h, length * 0.02, 1, 0.3, look.hullDark, { rotation: quaternionFromEuler(-0.28, 0, 0), jitter: 0.1 });
  }
  greebles(builder, look, rng, 90, { x: beam * 0.42, z0: -length * 0.42, z1: length * 0.4 }, () => height * 0.56, 3.5);
  for (let i = 0; i < 12; i += 1) {
    const z = -length * 0.44 + i * length * 0.075;
    for (const side of [-1, 1]) builder.box(side * beam * 0.5, height * 0.56, z, 0.8, 0.8, 0.8, look.seam, { glow: true });
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i += 1) {
      const z = -length * 0.3 + i * length * 0.11;
      const direction = new Vector3(side, 0.2, 0).normalize();
      turret(builder, look, new Vector3(side * beam * 0.44, height * 0.66, z), direction, 2.5);
      model.guns.push({ position: new Vector3(side * beam * 0.46, height * 0.7, z), direction });
    }
  }
  // Flight-deck plating, launch lanes, and underside armor: a carrier is seen from above and below often.
  for (let i = 0; i < 260; i += 1) {
    const w = 4 + rng() * 20;
    const d = 3 + rng() * 14;
    const h = 0.3 + rng() * 1.2;
    builder.box((rng() * 2 - 1) * beam * 0.43, height * 0.56 + h / 2, (rng() * 2 - 1) * length * 0.42, w, h, d, rng() < 0.5 ? look.hullDark : look.trim, { jitter: 0.16 });
  }
  for (const lane of [-0.32, -0.16, 0, 0.16, 0.32]) {
    for (let z = -length * 0.44; z < length * 0.44; z += 34 + rng() * 22) {
      builder.box(lane * beam, height * 0.565, z, 0.9, 0.2, 10 + rng() * 10, look.seam, { glow: true });
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 90; i += 1) {
      const sz = 6 + rng() * 26;
      builder.box(side * (beam * 0.31 + 0.5), (rng() - 0.5) * height * 0.8, (rng() * 2 - 1) * length * 0.44, 1 + rng(), 2 + rng() * 9, sz, rng() < 0.5 ? look.hullDark : look.trim, { jitter: 0.16 });
    }
  }
  for (let i = 0; i < 120; i += 1) {
    builder.box((rng() * 2 - 1) * beam * 0.28, -height / 2 - 0.4, (rng() * 2 - 1) * length * 0.44, 5 + rng() * 20, 0.8 + rng() * 1.4, 4 + rng() * 14, rng() < 0.5 ? look.hullDark : look.trim, { jitter: 0.18 });
  }
  engineBlock(builder, spec, look, model, 5, 2, 0.9);
  for (let i = 0; i < 20; i += 1) {
    model.surface.push(new Vector3((rng() - 0.5) * beam * 0.8, height * 0.62, (rng() - 0.5) * length * 0.8));
  }
}

// ---- Aegis: the friendly flagship whose deck we launch from ---------------------------------------

function buildAegis(builder: HullBuilder, spec: ShipSpec, look: ShipLook, model: ShipModel, rng: () => number) {
  const { length, beam, height } = spec;
  const topY = height / 2;
  // Hull body under the flight deck, then the deck slab itself.
  builder.taperedBox(0, -height * 0.1, 0, beam * 0.82, height * 0.8, length, 0.6, 0.85, look.hullDark, { jitter: 0.08 });
  builder.taperedBox(0, topY - 3, 0, beam, 6, length, 0.62, 1, look.hullDark, { jitter: 0.04 });
  builder.box(0, topY + 0.2, 0, beam * 0.985, 0.6, length * 0.985, look.hullDark, { jitter: 0.05, skip: 32 | 16 });

  // Runway: centerline dashes, edge lights, catapult tracks.
  const deckY = topY + 0.75;
  for (let z = -length / 2 + 6; z < length * 0.45; z += 14) {
    builder.box(0, deckY, z, 1.0, 0.15, 6, hdrWhite(look), { glow: true });
    builder.box(-beam * 0.16, deckY, z + 4, 0.55, 0.12, 3, look.accent, { glow: true });
    builder.box(beam * 0.16, deckY, z + 4, 0.55, 0.12, 3, look.accent, { glow: true });
  }
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + 4; z < length * 0.48; z += 10) {
      builder.box(side * beam * 0.485, deckY + 0.2, z, 1.0, 0.5, 1.0, look.accent, { glow: true });
      builder.box(side * beam * 0.44, deckY + 0.1, z, 0.6, 0.1, 4.5, look.trim, { glow: false });
    }
  }
  for (const track of [-beam * 0.07, beam * 0.07]) {
    builder.box(track, deckY - 0.1, -length * 0.25, 0.9, 0.2, length * 0.5, look.trim);
  }
  // Deck plating: cross seams and lamp posts give the launch its speed.
  for (let z = -length / 2 + 2; z < length * 0.48; z += 11) {
    builder.box(0, deckY - 0.02, z, beam * 0.97, 0.1, 0.22, look.trim);
  }
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + 14; z < length * 0.46; z += 28) {
      builder.box(side * beam * 0.345, deckY + 2.5, z, 0.5, 5, 0.5, look.trim);
      builder.box(side * beam * 0.345, deckY + 5.2, z, 1.1, 0.7, 1.1, look.accent, { glow: true });
      builder.box(side * beam * 0.23, deckY - 0.02, z, 6, 0.12, 0.9, look.window, { glow: true });
    }
  }
  // Deck-edge hangar doors, gantries, and flak pods.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i += 1) {
      const z = -length / 2 + 40 + i * 44;
      builder.box(side * beam * 0.42, deckY + 3, z, beam * 0.09, 6, 30, look.hullDark, { jitter: 0.08 });
      builder.glowPlate(new Vector3(side * beam * 0.42 - side * beam * 0.046, deckY + 3, z), new Vector3(0, 0, 24), new Vector3(0, 3.2, 0), look.window.clone().multiplyScalar(0.55));
    }
    for (let i = 0; i < 7; i += 1) {
      const z = -length / 2 + 26 + i * 58;
      turret(builder, look, new Vector3(side * beam * 0.49, deckY + 1.5, z), new Vector3(side * 0.5, 0.75, -0.6).normalize(), 2.4, 2);
      model.guns.push({ position: new Vector3(side * beam * 0.49, deckY + 4, z), direction: new Vector3(side * 0.5, 0.75, -0.6).normalize() });
    }
    for (let i = 0; i < 4; i += 1) {
      const z = -length / 2 + 90 + i * 120;
      builder.box(side * beam * 0.3, deckY + 18, z, 1.2, 36, 1.2, look.trim);
      builder.box(side * beam * 0.3, deckY + 36, z, 8, 0.8, 0.8, look.trim);
      builder.box(side * beam * 0.3, deckY + 37, z, 1, 1, 1, look.accent, { glow: true });
    }
  }
  // Island: the tall command superstructure aft on the starboard edge.
  const iz = length * 0.2;
  builder.box(beam * 0.36, deckY + 34, iz, beam * 0.13, 68, 74, look.hull, { jitter: 0.06 });
  builder.box(beam * 0.36, deckY + 78, iz, beam * 0.16, 22, 56, look.hullDark, { jitter: 0.06 });
  builder.glowPlate(new Vector3(beam * 0.36, deckY + 78, iz - 28.4), new Vector3(beam * 0.14, 0, 0), new Vector3(0, 7, 0), look.window);
  for (let i = 0; i < 6; i += 1) {
    builder.glowPlate(new Vector3(beam * 0.36, deckY + 22 + i * 7, iz - 37.4), new Vector3(beam * 0.1, 0, 0), new Vector3(0, 1.4, 0), look.window.clone().multiplyScalar(0.7));
  }
  antennaMast(builder, look, beam * 0.36, deckY + 89, iz, 46, rng);
  antennaMast(builder, look, beam * 0.32, deckY + 89, iz + 20, 28, rng);
  // Stern engines.
  engineBlock(builder, spec, look, model, 6, 2, 1);
  greebles(builder, look, rng, 60, { x: beam * 0.34, z0: -length * 0.2, z1: length * 0.45 }, () => deckY, 3);
  for (let i = 0; i < 20; i += 1) model.surface.push(new Vector3((rng() - 0.5) * beam * 0.7, topY + 4, (rng() - 0.5) * length * 0.7));
}

// ---- the enemy flagship: dorsal trench, shield-generator wall, citadel ------------------------------

function buildFlagship(builder: HullBuilder, spec: ShipSpec, look: ShipLook, model: ShipModel, rng: () => number) {
  const { length, beam, height } = spec;
  const half = beam / 2;
  const trench = FLAGSHIP.trenchHalfWidth;
  const top = height / 2;
  const floorY = FLAGSHIP.trenchFloorY - spec.center[1];
  const stations: readonly Station[] = [
    { f: 0, w: 0.16, h: 0.4 },
    { f: 0.06, w: 0.5, h: 0.72 },
    { f: 0.16, w: 0.86, h: 0.95 },
    { f: 0.32, w: 1, h: 1 },
    { f: 0.7, w: 1, h: 1 },
    { f: 0.88, w: 0.94, h: 0.96 },
    { f: 1, w: 0.82, h: 0.9 },
  ];
  skin(builder, spec, look, stations, rng, { fromF: 0.1, toF: 0.86, density: 2.2 });
  // Two half-hulls either side of the trench.
  for (const side of [-1, 1]) {
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1];
      const b = stations[i];
      const z0 = -length / 2 + a.f * length;
      const z1 = -length / 2 + b.f * length;
      const outer = half * b.w;
      const width = outer - trench;
      if (width <= 0) continue;
      builder.taperedBox(side * (trench + width / 2), 0, (z0 + z1) / 2, width, height * b.h, z1 - z0, Math.max(0.02, (half * a.w - trench) / Math.max(1, width)), a.h / b.h, i % 2 ? look.hull : look.hullDark.clone().lerp(look.hull, 0.5), { jitter: 0.1 });
    }
  }
  // Trench floor, ribbed walls, glowing conduits, and gantries spanning the gap.
  const trenchZ0 = -length / 2 + length * 0.05;
  const trenchZ1 = length * 0.42;
  builder.box(0, floorY - 4, (trenchZ0 + trenchZ1) / 2, trench * 2.02, 8, trenchZ1 - trenchZ0, look.hullDark, { jitter: 0.06 });
  for (let z = trenchZ0 + 6; z < trenchZ1; z += 9 + rng() * 9) {
    for (const side of [-1, 1]) {
      // Buttress ribs of uneven depth and height, so the trench reads as machinery and not a colonnade.
      const wide = 2 + rng() * 4;
      const reach = 1 + rng() * 3.2;
      const tall = rng() < 0.55 ? top - floorY : (top - floorY) * (0.35 + rng() * 0.5);
      builder.box(side * (trench - reach / 2), floorY + tall / 2, z, reach, tall, wide, rng() < 0.5 ? look.hullDark : look.hull, { jitter: 0.16 });
      if (rng() < 0.3) builder.glowPlate(new Vector3(side * (trench - reach - 0.05), floorY + 6 + rng() * (top - floorY - 12), z), new Vector3(0, 0, wide * 0.8), new Vector3(0, 1.2, 0), look.seam.clone().multiplyScalar(0.9));
    }
  }
  // Long conduits along the walls with molten cores.
  for (const side of [-1, 1]) {
    for (const height of [0.22, 0.5, 0.78]) {
      const y = floorY + (top - floorY) * height;
      builder.box(side * (trench - 0.9), y, (trenchZ0 + trenchZ1) / 2, 1.8, 2.2, trenchZ1 - trenchZ0, look.hullDark, { jitter: 0.08 });
      for (let z = trenchZ0 + 20; z < trenchZ1 - 20; z += 46 + rng() * 40) {
        builder.box(side * (trench - 1.85), y, z, 0.25, 0.7, 14 + rng() * 22, look.seam, { glow: true });
      }
    }
  }
  for (const lane of [-trench * 0.55, 0, trench * 0.55]) {
    builder.box(lane, floorY + 0.5, (trenchZ0 + trenchZ1) / 2, 1.6, 0.6, trenchZ1 - trenchZ0, look.seam.clone().multiplyScalar(lane === 0 ? 0.9 : 0.6), { glow: true });
  }
  // Gantries span the trench only toward the bow, where the rail flies beneath them.
  for (let z = trenchZ0 + 24; z < -60; z += 48) {
    builder.box(0, top - 5, z, trench * 2.1, 2.2, 3, look.trim, { jitter: 0.1 });
    builder.box(0, top - 6.3, z, trench * 1.9, 0.5, 0.6, look.accent, { glow: true });
  }
  // The port wall the rail flies along: armored ribs, gen sockets, and window bands.
  for (let z = -length / 2 + 40; z < length * 0.34; z += 26) {
    builder.box(-half - 2, (rng() - 0.5) * height * 0.5, z, 5, 5 + rng() * 22, 14 + rng() * 8, look.hullDark, { jitter: 0.14 });
  }
  for (const row of [-height * 0.32, -height * 0.04, height * 0.24]) {
    for (let z = -length / 2 + 30; z < length * 0.36; z += 11) {
      if (rng() < 0.22) continue;
      builder.glowPlate(new Vector3(-half - 0.3, row + rng() * 4, z), new Vector3(0, 0, 5), new Vector3(0, 1.2, 0), look.window);
      builder.glowPlate(new Vector3(half + 0.3, row + rng() * 4, z), new Vector3(0, 0, 5), new Vector3(0, 1.2, 0), look.window);
    }
  }
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + 60; z < length * 0.34; z += 70) {
      builder.box(side * (half + 4), top * 0.4, z, 8, 3, 34, look.seam.clone().multiplyScalar(0.7), { glow: true });
    }
  }
  // Dorsal spines and molten ridge seams along the outer decks.
  for (const side of [-1, 1]) {
    for (let z = -length / 2 + 50; z < length * 0.38; z += 36) {
      const fh = 10 + rng() * 26;
      builder.taperedBox(side * (trench + 18 + rng() * (half - trench - 30)), top + fh * 0.4, z, 2.4, fh, 12, 1, 0.4, look.hullDark, { rotation: quaternionFromEuler(-0.32, 0, 0), jitter: 0.1 });
    }
    for (let z = -length / 2 + 40; z < length * 0.4; z += 60) {
      builder.box(side * (trench + 10), top + 0.4, z, 0.8, 0.4, 30, look.seam, { glow: true });
    }
  }
  // Citadel: a stepped tower aft, ringed with spires.
  const cz = length * 0.34;
  builder.box(0, top + 44, cz, beam * 0.5, 88, 120, look.hull, { jitter: 0.06 });
  builder.box(0, top + 108, cz + 6, beam * 0.34, 44, 90, look.hullDark, { jitter: 0.06 });
  builder.box(0, top + 150, cz + 12, beam * 0.16, 42, 50, look.hull, { jitter: 0.06 });
  builder.glowPlate(new Vector3(0, top + 108, cz + 6 - 45.2), new Vector3(beam * 0.3, 0, 0), new Vector3(0, 6, 0), look.window);
  for (const side of [-1, 1]) {
    builder.taperedBox(side * beam * 0.32, top + 60, cz + 30, 10, 160, 22, 0.12, 0.3, look.hullDark, { jitter: 0.08 });
    builder.box(side * beam * 0.32, top + 140, cz + 30, 1.4, 1.4, 1.4, look.seam, { glow: true });
  }
  // Bow prongs.
  for (const side of [-1, 1]) {
    builder.taperedBox(side * beam * 0.2, -height * 0.05, -length / 2 - length * 0.06, beam * 0.12, height * 0.34, length * 0.18, 0.08, 0.5, look.hull, { rotation: quaternionFromEuler(0, side * -0.05, 0), jitter: 0.08 });
  }
  // Point-defense and heavy batteries on the outer decks.
  for (const side of [-1, 1] as const) {
    for (let z = -length / 2 + 90; z < length * 0.3; z += 52) {
      const direction = new Vector3(side * 0.6, 0.6, -0.3).normalize();
      turret(builder, look, new Vector3(side * (trench + 34 + rng() * 16), top + 2, z), direction, 3.2, 3);
      model.guns.push({ position: new Vector3(side * (trench + 40), top + 8, z), direction });
    }
  }
  // Fighter bays on the port wall aft of the generators: where the escorts pour out.
  for (const z of [150, 215, 280]) {
    for (const y of [-22, 6]) {
      builder.glowPlate(new Vector3(-half - 0.5, y, z), new Vector3(0, 0, 40), new Vector3(0, 14, 0), look.seam.clone().multiplyScalar(0.8));
      model.hangars.push({ position: new Vector3(-half - 4, y, z), direction: new Vector3(-1, 0, 0) });
    }
  }
  // Sockets for the shield generators and point-defense guns on the port wall, and the trench guns.
  const toLocal = shipMatrix(spec).invert();
  const wallNormal = new Vector3(-1, 0, 0);
  for (const world of FLAGSHIP_GENS_WORLD) {
    const local = world.clone().applyMatrix4(toLocal);
    socket(builder, look, new Vector3(-half - 1.2, local.y, local.z), wallNormal, 20);
  }
  for (const world of FLAGSHIP_PD_WORLD) {
    const local = world.clone().applyMatrix4(toLocal);
    socket(builder, look, new Vector3(-half - 1.2, local.y, local.z), wallNormal, 12);
  }
  for (const world of TRENCH_PD_WORLD) {
    const local = world.clone().applyMatrix4(toLocal);
    const side = local.x > 0 ? 1 : -1;
    socket(builder, look, new Vector3(side * (trench + 0.4), local.y, local.z), new Vector3(-side, 0, 0), 11);
  }
  engineBlock(builder, spec, look, model, 6, 3, 1.1);
  greebles(builder, look, rng, 300, { x: half * 0.85, z0: -length * 0.42, z1: length * 0.3 }, () => top, 4, trench + 4);
  for (let i = 0; i < 40; i += 1) {
    const side = i % 2 ? 1 : -1;
    model.surface.push(new Vector3(side * (trench + 10 + rng() * (half - trench - 12)), top + 3, -length * 0.4 + rng() * length * 0.75));
  }
}
