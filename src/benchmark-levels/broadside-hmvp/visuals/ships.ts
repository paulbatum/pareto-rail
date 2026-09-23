import { Color, Euler, Vector3 } from 'three';
import { HullBatch, jitterColor, mirroredSection, type LoftStation, type SurfaceSpec } from './hull-kit';

// Leaf: capital-ship construction. Builders take a livery and dimensions and
// return a HullBatch in ship-local space (x starboard, y up, z aft; bows at
// −z). They decide shapes, not colors or placement.

export type Livery = {
  hull: Color;
  hullDark: Color;
  plating: Color;
  window: Color;
  engine: Color;
  vent: Color;
  vein: number;
};

type Rng = () => number;

const s = (albedo: Color, emissive?: Color, vein = 0): SurfaceSpec => ({ albedo, emissive, vein });

function scaleProfile(profile: Array<[number, number]>, sx: number, sy: number, dy = 0): Array<[number, number]> {
  return profile.map(([x, y]) => [x * sx, y * sy + dy]);
}

// ---- shared detail kits -------------------------------------------------------------

function engineBank(batch: HullBatch, livery: Livery, z: number, positions: Array<[number, number]>, radius: number, depth: number) {
  for (const [x, y] of positions) {
    batch.cylinder(new Vector3(x, y, z + depth / 2), radius * 1.06, radius * 0.86, depth, 14, s(livery.hullDark), new Euler(Math.PI / 2, 0, 0));
    batch.cylinder(new Vector3(x, y, z + depth + 0.3), radius * 0.8, radius * 0.8, 0.6, 14, s(livery.hullDark, livery.engine), new Euler(Math.PI / 2, 0, 0));
    batch.cylinder(new Vector3(x, y, z + depth + 0.9), radius * 0.45, radius * 0.45, 0.6, 10, s(livery.hullDark, livery.engine.clone().multiplyScalar(1.6)), new Euler(Math.PI / 2, 0, 0));
  }
}

function windowRow(batch: HullBatch, livery: Livery, rng: Rng, x: number, y: number, fromZ: number, toZ: number, spacing: number, size: number) {
  for (let z = fromZ; z > toZ; z -= spacing) {
    if (rng() < 0.22) continue;
    const lit = livery.window.clone().multiplyScalar(0.55 + rng() * 0.6);
    batch.box(new Vector3(x, y, z), new Vector3(0.5, size, spacing * 0.55), s(livery.hullDark, lit));
  }
}

function turret(batch: HullBatch, livery: Livery, base: Vector3, facing: number, size: number, barrels: number, up = 1) {
  batch.cylinder(base.clone().add(new Vector3(0, 0.4 * size * up, 0)), size * 0.9, size * 1.1, size * 0.8, 10, s(livery.hullDark));
  batch.box(base.clone().add(new Vector3(0, 1.0 * size * up, 0)), new Vector3(size * 1.5, size * 0.8, size * 1.8), s(livery.plating), new Euler(0, facing, 0));
  for (let i = 0; i < barrels; i += 1) {
    const offset = (i - (barrels - 1) / 2) * size * 0.45;
    const dir = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const side = new Vector3(dir.z, 0, -dir.x);
    const center = base.clone()
      .add(new Vector3(0, 1.05 * size * up, 0))
      .addScaledVector(dir, -size * 1.9)
      .addScaledVector(side, offset);
    batch.box(center, new Vector3(size * 0.18, size * 0.18, size * 2.6), s(livery.hullDark), new Euler(0, facing, 0));
  }
}

function greebles(batch: HullBatch, livery: Livery, rng: Rng, count: number, place: (rng: Rng) => { center: Vector3; size: Vector3 }) {
  for (let i = 0; i < count; i += 1) {
    const { center, size } = place(rng);
    batch.box(center, size, s(jitterColor(rng() < 0.5 ? livery.plating : livery.hull, rng, 0.18), undefined, livery.vein * 0.6));
  }
}

// ---- our fleet ---------------------------------------------------------------------------

/** A long ice-white blade: stepped command tower, dorsal turrets, window rows, cyan engines. */
export function buildAllyCruiser(livery: Livery, rng: Rng, length: number, beam: number, height: number) {
  const batch = new HullBatch();
  const half: Array<[number, number]> = [[0.22, -0.5], [0.5, -0.12], [0.44, 0.26], [0.2, 0.5]];
  const profile = (sx: number, sy: number, dy = 0) => scaleProfile(half.map(([x, y]) => [x * beam, y * height]), sx, sy, dy);
  const L = length;
  const stations: LoftStation[] = [
    mirroredSection(L * 0.5, profile(0.78, 0.8)),
    mirroredSection(L * 0.42, profile(1, 1)),
    mirroredSection(-L * 0.05, profile(1, 1)),
    mirroredSection(-L * 0.28, profile(0.78, 0.86, -0.04 * height)),
    mirroredSection(-L * 0.44, profile(0.32, 0.52, -0.12 * height)),
    mirroredSection(-L * 0.5, profile(0.05, 0.2, -0.16 * height)),
  ];
  batch.loft(stations, (edge) => s(edge === 0 || edge >= 6 ? livery.hullDark : livery.hull));

  // Command tower: three stepped tiers with lit bridge windows.
  const towerZ = L * 0.2;
  let tierY = height * 0.5;
  for (let tier = 0; tier < 3; tier += 1) {
    const w = beam * (0.42 - tier * 0.1);
    const h = height * (0.34 - tier * 0.06);
    const d = L * (0.12 - tier * 0.025);
    batch.box(new Vector3(0, tierY + h / 2, towerZ + tier * L * 0.012), new Vector3(w, h, d), s(jitterColor(livery.hull, rng, 0.08)));
    batch.box(new Vector3(0, tierY + h * 0.7, towerZ - d / 2 + tier * L * 0.012 - 0.3), new Vector3(w * 0.8, h * 0.14, 0.6), s(livery.hullDark, livery.window));
    tierY += h;
  }
  batch.box(new Vector3(0, tierY + height * 0.25, towerZ + L * 0.02), new Vector3(1.2, height * 0.5, 1.2), s(livery.plating));

  for (let i = 0; i < 4; i += 1) {
    const z = -L * 0.32 + i * L * 0.11;
    turret(batch, livery, new Vector3(0, height * 0.5, z), 0, beam * 0.08, 3);
  }
  for (const side of [-1, 1]) {
    windowRow(batch, livery, rng, side * beam * 0.49, 0, L * 0.4, -L * 0.2, L * 0.012, height * 0.05);
    windowRow(batch, livery, rng, side * beam * 0.46, height * 0.16, L * 0.36, -L * 0.1, L * 0.016, height * 0.04);
  }
  // Ventral keel fin and a cyan running stripe down each flank: our fleet's signature.
  batch.loft([
    { z: L * 0.38, points: [[beam * 0.03, -height * 0.48], [0, -height * 0.5], [-beam * 0.03, -height * 0.48]] },
    { z: L * 0.12, points: [[beam * 0.02, -height * 0.48], [0, -height * 0.95], [-beam * 0.02, -height * 0.48]] },
    { z: -L * 0.05, points: [[beam * 0.02, -height * 0.48], [0, -height * 0.52], [-beam * 0.02, -height * 0.48]] },
  ], s(livery.hullDark), { aft: true, fore: true });
  for (const side of [-1, 1]) {
    batch.box(new Vector3(side * beam * 0.495, -height * 0.1, L * 0.05), new Vector3(0.4, height * 0.018, L * 0.7), s(livery.hullDark, livery.vent.clone().multiplyScalar(1.4)));
  }
  greebles(batch, livery, rng, 40, (r) => ({
    center: new Vector3((r() - 0.5) * beam * 0.35, height * 0.5 + 0.5, (r() - 0.5) * L * 0.7),
    size: new Vector3(beam * (0.04 + r() * 0.1), 0.6 + r() * height * 0.06, L * (0.01 + r() * 0.04)),
  }));
  engineBank(batch, livery, L * 0.5, [[-beam * 0.2, -height * 0.1], [beam * 0.2, -height * 0.1], [0, height * 0.12], [0, -height * 0.3]], beam * 0.1, L * 0.03);
  return batch;
}

/** Our flagship: a broad carrier with a long flight deck and a starboard island. */
export function buildAllyCarrier(livery: Livery, rng: Rng, length: number, beam: number) {
  const batch = new HullBatch();
  const L = length;
  const deck = 0;
  const half = (w: number, keel: number): Array<[number, number]> => [[w * 0.3, keel], [w * 0.5, keel * 0.45], [w * 0.52, -4], [w * 0.5, deck]];
  const stations: LoftStation[] = [
    mirroredSection(L * 0.5, half(beam * 0.9, -70)),
    mirroredSection(L * 0.4, half(beam, -90)),
    mirroredSection(-L * 0.3, half(beam, -90)),
    mirroredSection(-L * 0.44, half(beam * 0.86, -64)),
    mirroredSection(-L * 0.5, half(beam * 0.72, -30)),
  ];
  batch.loft(stations, (edge) => s(edge === 3 ? livery.plating : livery.hull));

  // Deck plating strips (slightly raised so they read at grazing angles).
  for (let i = 0; i < 26; i += 1) {
    const z = L * 0.45 - i * L * 0.034;
    batch.box(new Vector3(0, deck + 0.05, z), new Vector3(beam * 0.84, 0.1, L * 0.028), s(jitterColor(livery.hullDark, rng, 0.25)));
  }
  // Deck edge coaming.
  for (const side of [-1, 1]) batch.box(new Vector3(side * beam * 0.47, deck + 0.8, 0), new Vector3(1.2, 1.6, L * 0.9), s(livery.hull));

  // Island tower, starboard, forward — the catapult throws you past it.
  const islandZ = -140;
  batch.box(new Vector3(beam * 0.4, 14, islandZ), new Vector3(12, 28, 70), s(livery.hull));
  batch.box(new Vector3(beam * 0.4, 32, islandZ + 6), new Vector3(9, 10, 44), s(livery.hull));
  batch.box(new Vector3(beam * 0.4 - 4.6, 31, islandZ + 6), new Vector3(0.5, 2.2, 38), s(livery.hullDark, livery.window));
  batch.box(new Vector3(beam * 0.4, 44, islandZ + 10), new Vector3(1.4, 18, 1.4), s(livery.plating));
  batch.box(new Vector3(beam * 0.4, 50, islandZ + 10), new Vector3(8, 0.6, 0.6), s(livery.plating));
  windowRow(batch, livery, rng, beam * 0.4 - 6.1, 20, islandZ + 30, islandZ - 30, 4, 1.4);

  // Hangar mouth at the bow, lit from within.
  batch.box(new Vector3(0, -22, -L * 0.5 + 1), new Vector3(beam * 0.5, 14, 2), s(livery.hullDark, livery.window.clone().multiplyScalar(0.5)));
  for (const side of [-1, 1]) {
    windowRow(batch, livery, rng, side * beam * 0.5, -18, L * 0.45, -L * 0.45, 6, 1.6);
    windowRow(batch, livery, rng, side * beam * 0.49, -40, L * 0.4, -L * 0.4, 9, 1.4);
    for (let i = 0; i < 6; i += 1) turret(batch, livery, new Vector3(side * beam * 0.52, -8, -L * 0.3 + i * L * 0.12), side * Math.PI / 2, 4, 2, 1);
  }
  greebles(batch, livery, rng, 30, (r) => ({
    center: new Vector3((r() < 0.5 ? -1 : 1) * beam * (0.46 + r() * 0.05), -r() * 70, (r() - 0.5) * L * 0.8),
    size: new Vector3(2 + r() * 3, 2 + r() * 8, 6 + r() * 30),
  }));
  engineBank(batch, livery, L * 0.5, [[-24, -40], [24, -40], [-24, -16], [24, -16], [0, -28]], 10, 16);
  return batch;
}

/**
 * VALIANT: the broadside cruiser. Its cross-section is a gun deck that
 * overhangs the starboard flank, so a camera tucked under it sees the
 * batteries fire overhead. `batteries` are ship-local gun-house centers.
 */
export function buildValiant(livery: Livery, rng: Rng, sternZ: number, bowZ: number, batteries: Vector3[]) {
  const batch = new HullBatch();
  const half: Array<[number, number]> = [[12, -40], [24, -30], [30, -8], [52, 9], [55, 19], [42, 30], [16, 36]];
  const L = sternZ - bowZ;
  const at = (f: number) => sternZ - f * L;
  const stations: LoftStation[] = [
    mirroredSection(at(0), scaleProfile(half, 0.8, 0.84)),
    mirroredSection(at(0.05), scaleProfile(half, 1, 1)),
    mirroredSection(at(0.8), scaleProfile(half, 1, 1)),
    mirroredSection(at(0.92), scaleProfile(half, 0.62, 0.8, -3)),
    mirroredSection(at(1), scaleProfile(half, 0.06, 0.28, -10)),
  ];
  batch.loft(stations, (edge) => {
    // Starboard edge j mirrors port edge 12 − j.
    if (edge === 3 || edge === 4 || edge === 8 || edge === 9) return s(livery.plating);
    if (edge === 2 || edge === 10) return s(livery.hullDark);
    return s(livery.hull);
  });

  // Longitudinal armor belts under the overhang catch the rim light as they stream past.
  for (const side of [-1, 1]) {
    for (const [x, y, h] of [[27, -20, 3], [29, -10, 2.2], [41, 1, 2]] as const) {
      batch.box(new Vector3(side * x, y, (sternZ + bowZ) / 2), new Vector3(1.6, h, L * 0.78), s(livery.hullDark));
    }
    windowRow(batch, livery, rng, side * 25.2, -24, at(0.06), at(0.86), 5.5, 1.2);
    windowRow(batch, livery, rng, side * 29.5, -14, at(0.07), at(0.84), 7.5, 1.0);
    windowRow(batch, livery, rng, side * 55.2, 15, at(0.06), at(0.84), 6, 1.4);
    // Ribbed frames every 19 units — the speedometer of the flank run — with
    // dark armor bands between them so the wall streams past in stripes.
    for (let z = at(0.04), k = 0; z > at(0.86); z -= 19, k += 1) {
      batch.box(new Vector3(side * 25.4, -22, z), new Vector3(2.4, 15, 2.6), s(k % 2 === 0 ? livery.plating : livery.hullDark));
      batch.box(new Vector3(side * 38, -0.5, z), new Vector3(15, 1.8, 2.2), s(livery.hullDark), new Euler(0, 0, side * 0.68));
      if (k % 3 === 0) batch.box(new Vector3(side * 25.2, -12, z - 9.5), new Vector3(0.6, 3, 5), s(livery.hullDark, livery.vent));
    }
  }

  // The batteries: armored gun houses with triple barrels run out to starboard.
  for (const local of batteries) {
    const upper = local.y > 10;
    batch.box(local.clone(), new Vector3(10, upper ? 6 : 5, 13), s(livery.plating));
    batch.box(local.clone().add(new Vector3(-2, upper ? 3.4 : -3, 0)), new Vector3(6, 1.2, 9), s(livery.hullDark));
    for (const dz of [-3.4, 0, 3.4]) {
      batch.box(local.clone().add(new Vector3(9, 0.6, dz)), new Vector3(10, 0.9, 0.9), s(livery.hullDark));
    }
    batch.box(local.clone().add(new Vector3(-4.6, 1.2, 0)), new Vector3(0.5, 0.9, 9), s(livery.hullDark, livery.window.clone().multiplyScalar(0.7)));
  }

  // Command tower and deck turrets.
  const towerZ = at(0.3);
  batch.box(new Vector3(0, 46, towerZ), new Vector3(30, 20, 70), s(livery.hull));
  batch.box(new Vector3(0, 60, towerZ + 8), new Vector3(20, 10, 40), s(livery.hull));
  batch.box(new Vector3(0, 60, towerZ - 12.2), new Vector3(16, 1.8, 0.5), s(livery.hullDark, livery.window));
  batch.box(new Vector3(0, 76, towerZ + 10), new Vector3(1.4, 24, 1.4), s(livery.plating));
  for (let i = 0; i < 5; i += 1) turret(batch, livery, new Vector3(0, 36, at(0.12 + i * 0.15)), 0, 5, 3);
  greebles(batch, livery, rng, 60, (r) => ({
    center: new Vector3((r() - 0.5) * 50, 36 + r(), at(0.05 + r() * 0.8)),
    size: new Vector3(2 + r() * 8, 0.8 + r() * 3, 4 + r() * 20),
  }));
  engineBank(batch, livery, sternZ, [[-18, -6], [18, -6], [0, 14], [-10, -26], [10, -26]], 8, 14);
  return batch;
}

// ---- the enemy -----------------------------------------------------------------------------

/** An obsidian claw: diamond hull, serrated dorsal fins, twin forward mandibles, molten veins. */
export function buildEnemyCruiser(livery: Livery, rng: Rng, length: number, beam: number, height: number) {
  const batch = new HullBatch();
  const L = length;
  const half: Array<[number, number]> = [[0.1, -0.55], [0.5, -0.06], [0.34, 0.3], [0.05, 0.56]];
  const profile = (sx: number, sy: number, dy = 0) => scaleProfile(half.map(([x, y]) => [x * beam, y * height]), sx, sy, dy);
  const hullSurface = s(livery.hull, undefined, livery.vein);
  batch.loft([
    mirroredSection(L * 0.5, profile(0.7, 0.72)),
    mirroredSection(L * 0.38, profile(1.05, 1)),
    mirroredSection(L * 0.05, profile(0.92, 1.05)),
    mirroredSection(-L * 0.22, profile(0.7, 0.8)),
    mirroredSection(-L * 0.3, profile(0.5, 0.6)),
  ], hullSurface);

  // Mandibles: two prongs reaching forward past the blunt prow.
  for (const side of [-1, 1]) {
    const prong: Array<[number, number]> = [[0.05, -0.2], [0.13, 0], [0.05, 0.18]];
    const toStation = (z: number, sx: number, sy: number, cx: number) => ({
      z,
      points: [
        ...prong.map(([x, y]) => [cx + x * beam * sx, y * height * sy] as [number, number]),
        ...[...prong].reverse().map(([x, y]) => [cx - x * beam * sx, y * height * sy] as [number, number]),
      ],
    });
    const cx = side * beam * 0.26;
    batch.loft([
      toStation(-L * 0.2, 1.4, 1.4, cx),
      toStation(-L * 0.36, 1, 1, cx * 1.05),
      toStation(-L * 0.5, 0.12, 0.2, cx * 0.8),
    ], s(livery.hullDark, undefined, livery.vein));
  }

  // Serrated dorsal fins.
  const fins = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < fins; i += 1) {
    const z = L * 0.3 - (i / fins) * L * 0.55;
    const h = height * (0.25 + rng() * 0.35);
    const d = L * (0.03 + rng() * 0.03);
    batch.loft([
      { z: z + d, points: [[0.8, height * 0.5], [0, height * 0.5 + h * 0.2], [-0.8, height * 0.5]] },
      { z: z - d * 0.4, points: [[0.5, height * 0.52], [0, height * 0.5 + h], [-0.5, height * 0.52]] },
    ], s(livery.hullDark, undefined, livery.vein));
  }
  // Molten vents down the flanks.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i += 1) {
      const z = L * 0.3 - i * L * 0.07;
      batch.box(new Vector3(side * beam * 0.47, -height * 0.02, z), new Vector3(0.6, height * 0.05, L * 0.03), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.6 + rng() * 0.6)));
    }
    for (let i = 0; i < 3; i += 1) turret(batch, livery, new Vector3(side * beam * 0.36, height * 0.32, L * 0.15 - i * L * 0.14), side * Math.PI / 2, beam * 0.06, 2);
  }
  greebles(batch, livery, rng, 26, (r) => ({
    center: new Vector3((r() - 0.5) * beam * 0.5, -height * 0.4 + r() * height * 0.2, (r() - 0.5) * L * 0.6),
    size: new Vector3(beam * (0.05 + r() * 0.1), 1 + r() * 3, L * (0.02 + r() * 0.05)),
  }));
  engineBank(batch, livery, L * 0.5, [[-beam * 0.18, 0], [beam * 0.18, 0], [0, -height * 0.18]], beam * 0.09, L * 0.02);
  return batch;
}

/** An enemy carrier: a slab with glowing hangar mouths down both flanks — the swarm's nest. */
export function buildEnemyCarrier(livery: Livery, rng: Rng, length: number, beam: number, height: number) {
  const batch = new HullBatch();
  const L = length;
  const half: Array<[number, number]> = [[0.3, -0.5], [0.5, -0.2], [0.5, 0.25], [0.28, 0.5]];
  const profile = (sx: number, sy: number) => scaleProfile(half.map(([x, y]) => [x * beam, y * height]), sx, sy);
  batch.loft([
    mirroredSection(L * 0.5, profile(0.9, 0.85)),
    mirroredSection(L * 0.3, profile(1, 1)),
    mirroredSection(-L * 0.3, profile(1, 1)),
    mirroredSection(-L * 0.46, profile(0.6, 0.7)),
    mirroredSection(-L * 0.5, profile(0.3, 0.4)),
  ], s(livery.hull, undefined, livery.vein));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const z = L * 0.22 - i * L * 0.14;
      batch.box(new Vector3(side * beam * 0.5, 0, z), new Vector3(1, height * 0.26, L * 0.1), s(livery.hullDark, livery.vent.clone().multiplyScalar(1.3)));
      batch.box(new Vector3(side * beam * 0.52, height * 0.16, z), new Vector3(3, 1.4, L * 0.11), s(livery.plating));
    }
  }
  // Command spire, raked back like a dorsal blade.
  batch.loft([
    { z: L * 0.3, points: [[3, height * 0.5], [0, height * 0.5 + 2], [-3, height * 0.5]] },
    { z: L * 0.12, points: [[2, height * 0.5], [0, height * 1.25], [-2, height * 0.5]] },
  ], s(livery.hullDark, undefined, livery.vein));
  greebles(batch, livery, rng, 30, (r) => ({
    center: new Vector3((r() - 0.5) * beam * 0.8, height * 0.5 + 0.5, (r() - 0.5) * L * 0.8),
    size: new Vector3(3 + r() * beam * 0.1, 1 + r() * 4, 6 + r() * L * 0.05),
  }));
  engineBank(batch, livery, L * 0.5, [[-beam * 0.25, 0], [beam * 0.25, 0], [0, 0]], beam * 0.1, 12);
  return batch;
}

/**
 * THE KEEL: the enemy warship whose belly the rail runs along. A flat,
 * paneled underside with molten vents, a spine rib, and turret mounts.
 */
export function buildKeel(livery: Livery, rng: Rng, sternZ: number, bowZ: number, bellyY: number, mounts: Vector3[]) {
  const batch = new HullBatch();
  const half: Array<[number, number]> = [[0, bellyY], [46, bellyY], [56, bellyY + 14], [50, 6], [32, 26], [6, 36]];
  const L = sternZ - bowZ;
  const at = (f: number) => sternZ - f * L;
  batch.loft([
    mirroredSection(at(0), scaleProfile(half, 0.72, 0.7, 12)),
    mirroredSection(at(0.07), scaleProfile(half, 1, 1)),
    mirroredSection(at(0.78), scaleProfile(half, 1, 1)),
    mirroredSection(at(0.93), scaleProfile(half, 0.5, 0.72, 8)),
    mirroredSection(at(1), scaleProfile(half, 0.08, 0.3, 14)),
  ], s(livery.hull, undefined, livery.vein));

  // Belly: plates, a spine rib, and rows of molten vents.
  for (let z = at(0.08); z > at(0.8); z -= 24) {
    for (const x of [-34, -17, 17, 34]) {
      if (rng() < 0.25) continue;
      batch.box(new Vector3(x + (rng() - 0.5) * 4, bellyY - 0.35, z - rng() * 6), new Vector3(10 + rng() * 6, 0.7, 12 + rng() * 8), s(jitterColor(livery.plating, rng, 0.3), undefined, livery.vein * 0.5));
    }
    batch.box(new Vector3(-8, bellyY - 0.3, z), new Vector3(1.2, 0.6, 14), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.8 + rng() * 0.8)));
    batch.box(new Vector3(26, bellyY - 0.3, z - 10), new Vector3(1.2, 0.6, 12), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.6 + rng() * 0.6)));
  }
  batch.box(new Vector3(-2, bellyY - 1.2, (at(0.06) + at(0.86)) / 2), new Vector3(3, 2.4, L * 0.78), s(livery.hullDark));
  // Hangar bays glowing from within.
  for (const z of [at(0.25), at(0.5), at(0.7)]) {
    batch.box(new Vector3(-30, bellyY - 0.2, z), new Vector3(14, 0.4, 26), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.45)));
  }
  // Turret sockets.
  for (const mount of mounts) {
    batch.cylinder(new Vector3(mount.x, bellyY - 0.4, mount.z), 4.2, 4.8, 0.8, 12, s(livery.plating));
  }
  // Dorsal batteries and spines (seen from the eye and the flagship approach).
  for (let i = 0; i < 6; i += 1) turret(batch, livery, new Vector3(i % 2 === 0 ? -14 : 14, 36, at(0.15 + i * 0.12)), 0, 5, 3);
  for (let i = 0; i < 5; i += 1) {
    const z = at(0.2 + i * 0.13);
    batch.loft([
      { z: z + 14, points: [[1.5, 36], [0, 40], [-1.5, 36]] },
      { z: z - 6, points: [[1, 36], [0, 64 + rng() * 20], [-1, 36]] },
    ], s(livery.hullDark, undefined, livery.vein));
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i += 1) {
      batch.box(new Vector3(side * 52.5, -8, at(0.1 + i * 0.07)), new Vector3(0.6, 3, 16), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.7)));
    }
  }
  engineBank(batch, livery, sternZ, [[-20, 0], [20, 0], [0, 16]], 10, 12);
  return batch;
}

export type FlagshipSectionSpec = {
  fromZ: number;
  toZ: number;
  sternZ: number;
  bowZ: number;
  trench: { halfWidth: number; floorY: number; fromZ: number; toZ: number };
  beam: number;
  keelY: number;
  generatorMounts: Vector3[];
  coreMounts: Vector3[];
  pointDefense: Vector3[];
};

/** Dorsal deck height along the flagship: level over the trench, falling away to the ram bow. */
export function flagshipDeckAt(z: number, spec: Pick<FlagshipSectionSpec, 'trench' | 'bowZ'>) {
  const dropStart = spec.trench.toZ - 18;
  if (z >= dropStart) return 0;
  const t = Math.min(1, (dropStart - z) / (dropStart - spec.bowZ));
  return -8 - t * 58;
}

function flagshipWidthAt(z: number, spec: FlagshipSectionSpec) {
  const fromBow = (z - spec.bowZ) / (spec.sternZ - spec.bowZ);
  if (fromBow < 0.42) return 0.06 + 0.94 * Math.sin((fromBow / 0.42) * Math.PI / 2) ** 1.4;
  if (fromBow > 0.97) return 0.93;
  return 1;
}

/**
 * One section of the enemy flagship. The dorsal trench is cut into the loft
 * itself; generators sit on starboard shoulder sponsons, cores on trench-floor
 * cradles. Sections are separate meshes so the ship can break apart.
 */
export function buildFlagshipSection(livery: Livery, rng: Rng, spec: FlagshipSectionSpec) {
  const batch = new HullBatch();
  const B = spec.beam / 2;
  const keel = spec.keelY;
  const tw = spec.trench.halfWidth;
  const floor = spec.trench.floorY;

  const stationAt = (z: number) => {
    const w = flagshipWidthAt(z, spec);
    const deck = flagshipDeckAt(z, spec);
    const trenchOpen = z <= spec.trench.fromZ + 0.01 && z >= spec.trench.toZ - 0.01;
    const trenchFloor = trenchOpen ? floor : deck;
    const trenchHalf = trenchOpen ? tw : Math.min(tw, B * w * 0.4);
    const keelY = keel * (0.4 + 0.6 * w);
    const half: Array<[number, number]> = [
      [B * 0.34 * w, keelY],
      [B * 0.86 * w, keelY * 0.66],
      [B * w, -40],
      [B * 0.95 * w, -9],
      [B * 0.6 * w, deck],
      [trenchHalf, deck],
      [trenchHalf, trenchFloor],
      [0, trenchFloor],
    ];
    return mirroredSection(z, half);
  };

  const stationZs = new Set<number>([spec.fromZ, spec.toZ]);
  const candidates = [spec.sternZ, spec.sternZ - 30, spec.trench.fromZ, spec.trench.toZ, spec.trench.toZ - 0.5, spec.trench.toZ - 18];
  for (let z = spec.sternZ; z > spec.bowZ; z -= 70) candidates.push(z);
  for (const z of candidates) if (z < spec.fromZ && z > spec.toZ) stationZs.add(z);
  const zs = [...stationZs].sort((a, b) => b - a);
  const stations = zs.map(stationAt);
  const surfaceFor = (edge: number) => {
    // Edges 4–10 are the deck and trench; 3 and 11 the shoulders.
    if (edge >= 4 && edge <= 10) return s(livery.hullDark, undefined, livery.vein * 0.7);
    if (edge === 3 || edge === 11) return s(livery.plating, undefined, livery.vein);
    return s(livery.hull, undefined, livery.vein);
  };
  batch.loft(stations, surfaceFor, { aft: true, fore: true });

  const inSection = (z: number) => z <= spec.fromZ && z > spec.toZ;

  // Trench: wall pipes, conduits, buttresses, overhead girders, floor lights.
  const tFrom = Math.min(spec.fromZ, spec.trench.fromZ);
  const tTo = Math.max(spec.toZ, spec.trench.toZ);
  if (tFrom > tTo) {
    const mid = (tFrom + tTo) / 2;
    const len = tFrom - tTo;
    for (const side of [-1, 1]) {
      batch.cylinder(new Vector3(side * (tw - 1.6), -9, mid), 1.4, 1.4, len, 8, s(livery.plating), new Euler(Math.PI / 2, 0, 0));
      batch.cylinder(new Vector3(side * (tw - 1.2), -22, mid), 1, 1, len, 8, s(livery.hullDark), new Euler(Math.PI / 2, 0, 0));
      batch.box(new Vector3(side * (tw - 0.3), -15.5, mid), new Vector3(0.4, 0.8, len), s(livery.hullDark, livery.vent.clone().multiplyScalar(1.1)));
      for (let z = tFrom - 14; z > tTo; z -= 34) {
        batch.box(new Vector3(side * (tw - 2.2), -15, z), new Vector3(4.4, 30, 5), s(jitterColor(livery.plating, rng, 0.2), undefined, livery.vein));
        batch.box(new Vector3(side * (tw - 0.6), -4, z - 17), new Vector3(1.2, 2.2, 7), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.9)));
      }
    }
    // Cantilevered rim brackets: trenchwork overhead that never crosses the slot.
    for (let z = tFrom - 40; z > tTo + 10; z -= 43) {
      for (const side of [-1, 1]) {
        batch.box(new Vector3(side * (tw - 3.2), -1.2, z), new Vector3(6.4, 2.4, 3.2), s(livery.plating));
        batch.box(new Vector3(side * (tw - 5.8), -2.6, z), new Vector3(1.2, 0.5, 2.4), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.8)));
      }
    }
    for (let z = tFrom - 6; z > tTo; z -= 12) {
      batch.box(new Vector3(0, floor + 0.2, z), new Vector3(3.2, 0.4, 3.2), s(livery.hullDark, livery.vent.clone().multiplyScalar(z % 24 < 12 ? 0.9 : 0.35)));
      if (rng() < 0.6) batch.box(new Vector3((rng() - 0.5) * tw * 1.4, floor + 0.5, z), new Vector3(3 + rng() * 5, 1, 4 + rng() * 6), s(jitterColor(livery.plating, rng, 0.3)));
    }
  }

  // Core cradles: rings and struts around each exposed power core.
  for (const core of spec.coreMounts) {
    if (!inSection(core.z)) continue;
    batch.cylinder(new Vector3(core.x, floor + 0.8, core.z), 7, 8, 1.6, 16, s(livery.plating));
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      batch.box(new Vector3(core.x + Math.cos(a) * 6.5, floor + 5, core.z + Math.sin(a) * 6.5), new Vector3(1.2, 9, 1.2), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.5)), new Euler(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3));
    }
  }

  // Generator sponsons on the starboard shoulder.
  for (const gen of spec.generatorMounts) {
    if (!inSection(gen.z)) continue;
    // The sponson stops short of the emitter so the generator stands proud of the hull.
    batch.box(new Vector3(B - 3, gen.y, gen.z), new Vector3(14, 14, 30), s(livery.plating, undefined, livery.vein));
    batch.box(new Vector3(B + 2, gen.y - 8.5, gen.z), new Vector3(4, 2.4, 22), s(livery.hullDark, livery.vent));
  }
  // Point-defense blisters.
  for (const pd of spec.pointDefense) {
    if (!inSection(pd.z)) continue;
    batch.cylinder(new Vector3(pd.x - 2, pd.y, pd.z), 3.4, 4, 4, 10, s(livery.hullDark), new Euler(0, 0, Math.PI / 2));
    batch.box(new Vector3(pd.x + 3, pd.y, pd.z), new Vector3(7, 0.8, 0.8), s(livery.hullDark));
  }

  // Deck superstructure flanking the trench: spires, gun decks, vents.
  for (let z = spec.fromZ - 20; z > spec.toZ + 20; z -= 44 + rng() * 40) {
    if (z > spec.sternZ - 260) continue;
    const deck = flagshipDeckAt(z, spec);
    for (const side of [-1, 1]) {
      if (rng() < 0.3) continue;
      const x = side * (tw + 14 + rng() * (B * 0.4));
      const h = 6 + rng() * 26;
      batch.box(new Vector3(x, deck + h / 2, z), new Vector3(8 + rng() * 14, h, 12 + rng() * 26), s(jitterColor(livery.hull, rng, 0.25), undefined, livery.vein));
      if (rng() < 0.5) {
        batch.loft([
          { z: z + 6, points: [[1.6, deck + h], [0, deck + h + 2], [-1.6, deck + h]].map(([px, py]) => [px + x, py] as [number, number]) },
          { z: z - 2, points: [[0.8, deck + h], [0, deck + h + 18 + rng() * 30], [-0.8, deck + h]].map(([px, py]) => [px + x, py] as [number, number]) },
        ], s(livery.hullDark, undefined, livery.vein));
      }
      if (rng() < 0.5) batch.box(new Vector3(x, deck + h * 0.6, z - 6.5), new Vector3(6, 0.7, 0.4), s(livery.hullDark, livery.vent));
    }
  }
  // Flank vents and hangar mouths.
  for (const side of [-1, 1]) {
    for (let z = spec.fromZ - 16; z > spec.toZ + 10; z -= 30) {
      const w = flagshipWidthAt(z, spec);
      if (w < 0.5) continue;
      if (side > 0 && spec.generatorMounts.some((g) => Math.abs(g.z - z) < 24)) continue;
      batch.box(new Vector3(side * B * 0.99 * w, -26, z), new Vector3(0.8, 2.2, 18), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.5 + rng() * 0.9)));
      if (rng() < 0.3) batch.box(new Vector3(side * B * 0.93 * w, -84, z), new Vector3(1, 16, 22), s(livery.hullDark, livery.vent.clone().multiplyScalar(0.35)));
    }
  }
  // Stern: a wall of engine bells.
  if (spec.fromZ >= spec.sternZ - 0.01) {
    engineBank(batch, livery, spec.sternZ, [[-70, -60], [70, -60], [-36, -100], [36, -100], [-80, -120], [80, -120], [0, -60]], 20, 24);
  }
  return batch;
}
