import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import {
  COLD_WHITE,
  CRIMSON,
  CYAN,
  EMBER,
  ICE_WHITE,
  MOLTEN,
  OBSIDIAN,
  OBSIDIAN_EDGE,
  hdr,
} from './palette';

// Every hostile in BROADSIDE is cut from the same block: obsidian plate, a
// molten seam where the plate was cut, and one crimson light. What separates
// them is silhouette — a swept dart, a spinning hoop, a twin-hulled boat, a
// barbette, a pylon, a caged core — because at this speed silhouette is all
// the player has time to read.

export type TintKind = 'fill' | 'edge' | 'core';
export type TintPart = { material: MeshBasicMaterial; base: Color; kind: TintKind };

type Bucket = { geometries: BufferGeometry[]; base: Color; kind: TintKind; additive: boolean };

function createBuilder() {
  const buckets = new Map<string, Bucket>();
  const shards: ShardSpec[] = [];

  return {
    add(kind: TintKind, base: Color, geometry: BufferGeometry, additive = false) {
      const key = `${kind}:${additive ? 'a' : 's'}:${base.getHexString()}`;
      const bucket = buckets.get(key) ?? { geometries: [], base: base.clone(), kind, additive };
      bucket.geometries.push(geometry);
      buckets.set(key, bucket);
      return geometry;
    },
    shard(direction: Vector3, color: Color, size: number) {
      shards.push({ direction: direction.clone().normalize(), color: color.clone(), size });
    },
    flush(target: Group) {
      const parts: TintPart[] = [];
      for (const bucket of buckets.values()) {
        // Polyhedron primitives arrive non-indexed; mergeGeometries refuses a
        // mixed batch, so normalise before merging.
        const mixed = bucket.geometries.some((geometry) => geometry.index === null)
          && bucket.geometries.some((geometry) => geometry.index !== null);
        const source = mixed ? bucket.geometries.map((geometry) => geometry.toNonIndexed()) : bucket.geometries;
        const merged = mergeGeometries(source);
        for (const geometry of bucket.geometries) geometry.dispose();
        if (mixed) for (const geometry of source) geometry.dispose();
        const material = bucket.additive
          ? createAdditiveBasicMaterial({ color: bucket.base.clone(), side: DoubleSide })
          : new MeshBasicMaterial({ color: bucket.base.clone() });
        target.add(new Mesh(merged, material));
        parts.push({ material, base: bucket.base.clone(), kind: bucket.kind });
      }
      buckets.clear();
      return parts;
    },
    shards,
  };
}

function place(geometry: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz));
  matrix.setPosition(x, y, z);
  return geometry.applyMatrix4(matrix);
}

function finish(group: Group, builder: ReturnType<typeof createBuilder>, accent: Color, lockRingScale: number) {
  const parts = builder.flush(group);
  group.userData.parts = parts;
  group.userData.shardSpecs = builder.shards;
  group.userData.accent = accent.clone();
  group.userData.lockRingScale = lockRingScale;
  return group;
}

function scatterShards(builder: ReturnType<typeof createBuilder>, count: number, color: Color, size: number, spread = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const tilt = Math.sin(i * 2.3) * 0.7;
    builder.shard(new Vector3(Math.cos(angle) * spread, tilt, Math.sin(angle) * spread), color, size);
  }
}

// ---- lance: swarm interceptor -------------------------------------------------
// A forward-swept dart. Nose-on it is a thin cross; broadside it is a blade.
export function createLanceMesh() {
  const group = new Group();
  const builder = createBuilder();

  const body = new ConeGeometry(0.85, 4.6, 4);
  place(body, 0, 0, -0.4, -Math.PI / 2);
  builder.add('fill', OBSIDIAN, body);

  const spine = new BoxGeometry(0.4, 0.9, 3.2);
  place(spine, 0, 0.35, 0.6);
  builder.add('fill', OBSIDIAN_EDGE, spine);

  for (const side of [-1, 1]) {
    const wing = new BoxGeometry(3.0, 0.16, 1.5);
    place(wing, side * 1.7, -0.1, 0.9, 0, side * 0.42, side * -0.32);
    builder.add('fill', OBSIDIAN_EDGE, wing);

    // The molten seam runs down the leading edge of each swept wing.
    const seam = new BoxGeometry(3.0, 0.1, 0.16);
    place(seam, side * 1.7, 0.02, 0.2, 0, side * 0.42, side * -0.32);
    builder.add('edge', MOLTEN, seam);

    const tip = new BoxGeometry(0.22, 0.5, 0.9);
    place(tip, side * 3.05, 0.1, 1.1, 0, 0, side * -0.32);
    builder.add('fill', OBSIDIAN, tip);
  }

  const intake = new TorusGeometry(0.6, 0.14, 6, 12);
  place(intake, 0, 0, 1.9);
  builder.add('edge', EMBER, intake);

  const eye = new BoxGeometry(0.34, 0.2, 0.34);
  place(eye, 0, 0.18, -1.75);
  builder.add('core', CRIMSON, eye, true);

  const exhaust = new BoxGeometry(0.5, 0.5, 0.4);
  place(exhaust, 0, 0, 2.15);
  builder.add('core', MOLTEN, exhaust, true);

  scatterShards(builder, 7, OBSIDIAN_EDGE, 0.34, 1.2);
  builder.shard(new Vector3(0, 0.4, -1), MOLTEN, 0.28);
  return finish(group, builder, MOLTEN, 1.15);
}

// ---- wasp: escort ------------------------------------------------------------
// A hoop with a caged core. It never presents a flat face, so it reads as a
// spinning ring no matter where it is on screen.
export function createWaspMesh() {
  const group = new Group();
  const builder = createBuilder();

  const ring = new TorusGeometry(2.1, 0.22, 6, 22);
  builder.add('fill', OBSIDIAN_EDGE, ring);

  const innerRing = new TorusGeometry(1.35, 0.1, 6, 18);
  place(innerRing, 0, 0, 0, Math.PI / 2);
  builder.add('edge', MOLTEN, innerRing);

  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const spoke = new BoxGeometry(0.24, 0.24, 1.9);
    place(spoke, Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0, 0, 0, angle);
    builder.add('fill', OBSIDIAN, spoke);

    const claw = new BoxGeometry(0.5, 0.18, 0.7);
    place(claw, Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, -0.5, 0, 0, angle);
    builder.add('fill', OBSIDIAN, claw);
  }

  const core = new OctahedronGeometry(0.8, 0);
  builder.add('core', CRIMSON, core, true);
  const shell = new IcosahedronGeometry(0.5, 0);
  builder.add('core', MOLTEN, shell);

  scatterShards(builder, 8, OBSIDIAN_EDGE, 0.3, 1.4);
  return finish(group, builder, CRIMSON, 1.0);
}

// ---- picket: gunboat ---------------------------------------------------------
// Two hulls and a bridge. Heavy, slow to turn, and armored enough to need two
// hits — the swarm's grown-up.
export function createPicketMesh() {
  const group = new Group();
  const builder = createBuilder();

  for (const side of [-1, 1]) {
    const hull = new BoxGeometry(1.3, 1.1, 6.0);
    place(hull, side * 2.3, 0, 0);
    builder.add('fill', OBSIDIAN, hull);

    const prow = new ConeGeometry(0.8, 1.8, 4);
    place(prow, side * 2.3, 0, -3.6, -Math.PI / 2, 0, Math.PI / 4);
    builder.add('fill', OBSIDIAN_EDGE, prow);

    const seam = new BoxGeometry(0.12, 0.16, 5.2);
    place(seam, side * 2.98, 0.15, 0.2);
    builder.add('edge', MOLTEN, seam);

    const engine = new BoxGeometry(0.8, 0.8, 0.6);
    place(engine, side * 2.3, 0, 3.2);
    builder.add('core', EMBER, engine, true);
  }

  const bridge = new BoxGeometry(3.5, 1.0, 2.6);
  place(bridge, 0, 0.2, 0.6);
  builder.add('fill', OBSIDIAN_EDGE, bridge);

  const mast = new BoxGeometry(0.5, 1.6, 0.5);
  place(mast, 0, 1.2, 1.0);
  builder.add('fill', OBSIDIAN, mast);

  const spar = new BoxGeometry(0.42, 0.42, 5.2);
  place(spar, 0, -0.1, -1.4);
  builder.add('fill', OBSIDIAN_EDGE, spar);

  const muzzle = new BoxGeometry(0.5, 0.5, 0.5);
  place(muzzle, 0, -0.1, -4.0);
  const muzzleGeometry = new Mesh(muzzle, createAdditiveBasicMaterial({ color: hdr(CRIMSON, 0.4) }));
  muzzleGeometry.name = 'muzzle';
  group.add(muzzleGeometry);
  group.userData.muzzle = muzzleGeometry.material as MeshBasicMaterial;

  const eyes = new BoxGeometry(1.9, 0.16, 0.16);
  place(eyes, 0, 0.55, -0.8);
  builder.add('core', CRIMSON, eyes, true);

  scatterShards(builder, 10, OBSIDIAN, 0.4, 1.5);
  return finish(group, builder, EMBER, 1.5);
}

// ---- turret: hull battery ----------------------------------------------------
// A barbette bolted to a warship's belly plate. The mount is a live child group
// so the barrels physically track the player as the rail carries them past.
export function createTurretMesh() {
  const group = new Group();
  const builder = createBuilder();

  const plate = new BoxGeometry(5.2, 0.7, 5.2);
  place(plate, 0, 1.9, 0);
  builder.add('fill', OBSIDIAN, plate);

  for (const side of [-1, 1]) {
    const rib = new BoxGeometry(0.4, 1.4, 4.6);
    place(rib, side * 2.2, 1.5, 0);
    builder.add('fill', OBSIDIAN_EDGE, rib);
  }

  const collar = new TorusGeometry(2.0, 0.22, 6, 18);
  place(collar, 0, 1.4, 0, Math.PI / 2);
  builder.add('edge', MOLTEN, collar);

  const parts = builder.flush(group);

  // Rotating mount: dome, twin barrels, crimson optics.
  const mount = new Group();
  const mountBuilder = createBuilder();
  const dome = new SphereGeometry(1.8, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  place(dome, 0, 0.9, 0);
  mountBuilder.add('fill', OBSIDIAN_EDGE, dome);

  for (const side of [-1, 1]) {
    const barrel = new CylinderGeometry(0.26, 0.32, 4.4, 6);
    place(barrel, side * 0.62, 0.35, -1.9, Math.PI / 2);
    mountBuilder.add('fill', OBSIDIAN, barrel);
    const band = new TorusGeometry(0.34, 0.09, 5, 10);
    place(band, side * 0.62, 0.35, -3.0);
    mountBuilder.add('edge', EMBER, band);
  }

  const optic = new BoxGeometry(1.1, 0.24, 0.2);
  place(optic, 0, 0.95, -1.5);
  mountBuilder.add('core', CRIMSON, optic, true);
  const mountParts = mountBuilder.flush(mount);
  group.add(mount);

  // Muzzle lamps live between the barrels and get driven by the charge value.
  const muzzle = new Mesh(
    new BoxGeometry(1.7, 0.4, 0.4),
    createAdditiveBasicMaterial({ color: hdr(CRIMSON, 0.2) }),
  );
  muzzle.position.set(0, 0.35, -4.1);
  mount.add(muzzle);

  group.userData.parts = [...parts, ...mountParts];
  group.userData.shardSpecs = builder.shards;
  group.userData.mount = mount;
  group.userData.muzzle = muzzle.material as MeshBasicMaterial;
  group.userData.accent = MOLTEN.clone();
  group.userData.lockRingScale = 1.35;
  scatterShards(builder, 11, OBSIDIAN, 0.42, 1.6);
  group.userData.shardSpecs = builder.shards;
  return group;
}

// ---- flak: incoming round ----------------------------------------------------
export function createBoltMesh() {
  const group = new Group();
  const builder = createBuilder();

  const core = new OctahedronGeometry(0.4, 0);
  core.scale(0.55, 0.55, 2.6);
  builder.add('core', CRIMSON, core);

  const shell = new OctahedronGeometry(0.66, 0);
  shell.scale(0.6, 0.6, 2.1);
  builder.add('core', EMBER, shell, true);

  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const fin = new BoxGeometry(0.1, 0.7, 0.5);
    place(fin, Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0.7, 0, 0, angle);
    builder.add('edge', MOLTEN, fin);
  }

  builder.shard(new Vector3(0, 1, 0), CRIMSON, 0.2);
  builder.shard(new Vector3(0, -1, 0), CRIMSON, 0.2);
  const mesh = finish(group, builder, CRIMSON, 0.8);
  mesh.userData.isHostileShot = true;
  mesh.userData.trailColor = CRIMSON.clone().multiplyScalar(0.7);
  return mesh;
}

// ---- generator: flagship shield node -----------------------------------------
// A pylon standing off the flagship's spine with a containment ring around a
// hot node. The ring is a live child so it can spin up as the node takes
// damage; the node is what you are actually shooting.
export function createGeneratorMesh() {
  const group = new Group();
  const builder = createBuilder();

  const pylon = new BoxGeometry(1.6, 11, 1.6);
  place(pylon, 0, -6.2, 0);
  builder.add('fill', OBSIDIAN, pylon);

  const flange = new BoxGeometry(5.4, 1.0, 5.4);
  place(flange, 0, -11.6, 0);
  builder.add('fill', OBSIDIAN_EDGE, flange);

  for (const side of [-1, 1]) {
    const brace = new BoxGeometry(0.32, 5.4, 0.32);
    place(brace, side * 1.5, -8.6, 0, 0, 0, side * 0.28);
    builder.add('fill', OBSIDIAN_EDGE, brace);
    const conduit = new BoxGeometry(0.16, 9.4, 0.16);
    place(conduit, side * 0.9, -6.2, 0.9);
    builder.add('edge', MOLTEN, conduit);
  }

  const cap = new CylinderGeometry(1.9, 2.3, 1.2, 8);
  place(cap, 0, -1.4, 0);
  builder.add('fill', OBSIDIAN_EDGE, cap);

  const parts = builder.flush(group);

  const ring = new Group();
  const ringBuilder = createBuilder();
  const hoop = new TorusGeometry(3.0, 0.24, 6, 26);
  ringBuilder.add('edge', CRIMSON, hoop);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const tooth = new BoxGeometry(0.5, 0.5, 0.9);
    place(tooth, Math.cos(angle) * 3.0, Math.sin(angle) * 3.0, 0, 0, 0, angle);
    ringBuilder.add('fill', OBSIDIAN, tooth);
  }
  const ringParts = ringBuilder.flush(ring);
  ring.rotation.x = Math.PI / 2.6;
  group.add(ring);

  const node = new Group();
  const nodeBuilder = createBuilder();
  nodeBuilder.add('core', MOLTEN, new IcosahedronGeometry(1.5, 0));
  nodeBuilder.add('core', COLD_WHITE, new IcosahedronGeometry(0.8, 0), true);
  const nodeParts = nodeBuilder.flush(node);
  group.add(node);

  const halo = new Mesh(
    new RingGeometry(1.8, 2.5, 24),
    createAdditiveBasicMaterial({ color: hdr(CRIMSON, 0.6), side: DoubleSide }),
  );
  group.add(halo);

  scatterShards(builder, 14, OBSIDIAN_EDGE, 0.55, 1.8);
  for (let i = 0; i < 5; i += 1) builder.shard(new Vector3(Math.sin(i), 1, Math.cos(i)), MOLTEN, 0.4);

  group.userData.parts = [...parts, ...ringParts, ...nodeParts];
  group.userData.shardSpecs = builder.shards;
  group.userData.ring = ring;
  group.userData.node = node;
  group.userData.halo = halo.material as MeshBasicMaterial;
  group.userData.accent = MOLTEN.clone();
  group.userData.lockRingScale = 1.8;
  group.userData.isGenerator = true;
  return group;
}

// ---- core: trench power core --------------------------------------------------
// Armor petals over a caged core, plus a shield facet that only shows while the
// flagship's shield is still holding — the visual half of the release block.
export function createCoreMesh() {
  const group = new Group();
  const builder = createBuilder();

  const housing = new CylinderGeometry(3.6, 4.2, 1.6, 8);
  place(housing, 0, 0, 2.0, Math.PI / 2);
  builder.add('fill', OBSIDIAN, housing);

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const strut = new BoxGeometry(0.3, 0.3, 2.6);
    place(strut, Math.cos(angle) * 2.6, Math.sin(angle) * 2.6, 0.9, 0, 0, angle);
    builder.add('fill', OBSIDIAN_EDGE, strut);
  }

  const rim = new TorusGeometry(3.5, 0.3, 6, 26);
  place(rim, 0, 0, 1.3);
  builder.add('edge', MOLTEN, rim);
  const parts = builder.flush(group);

  // Armor petals: six wedges that hinge outward when the shell is broken.
  const armor = new Group();
  const armorParts: TintPart[] = [];
  const petals: Group[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const hinge = new Group();
    hinge.rotation.z = angle;
    const petalBuilder = createBuilder();
    const plate = new BoxGeometry(2.0, 1.7, 0.7);
    place(plate, 0, 1.9, 0);
    petalBuilder.add('fill', OBSIDIAN_EDGE, plate);
    const lip = new BoxGeometry(2.1, 0.22, 0.24);
    place(lip, 0, 2.7, 0.3);
    petalBuilder.add('edge', EMBER, lip);
    armorParts.push(...petalBuilder.flush(hinge));
    armor.add(hinge);
    petals.push(hinge);
  }
  group.add(armor);

  const coreGroup = new Group();
  const coreBuilder = createBuilder();
  coreBuilder.add('core', MOLTEN, new IcosahedronGeometry(1.7, 0));
  coreBuilder.add('core', COLD_WHITE, new IcosahedronGeometry(0.95, 0), true);
  const coreParts = coreBuilder.flush(coreGroup);
  group.add(coreGroup);

  const glow = new Mesh(
    new RingGeometry(2.0, 3.4, 6),
    createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.5), side: DoubleSide }),
  );
  glow.position.z = 0.4;
  group.add(glow);

  // Shield facet: a hexagonal violet frame standing off the core while the
  // flagship's shield is up. It is an annulus and a ring, never a filled disc,
  // so it says "blocked" without hiding the thing you are trying to shoot.
  const shieldPlate = new Group();
  const shieldMaterial = createAdditiveBasicMaterial({ color: new Color(0.75, 0.15, 1.0), opacity: 0.6, side: DoubleSide });
  const shieldRim = new Mesh(new RingGeometry(3.6, 4.9, 6), shieldMaterial);
  const shieldInner = new Mesh(new RingGeometry(2.0, 2.2, 6), shieldMaterial);
  shieldInner.rotation.z = Math.PI / 6;
  shieldPlate.add(shieldRim, shieldInner);
  shieldPlate.position.z = -1.8;
  group.add(shieldPlate);

  scatterShards(builder, 16, OBSIDIAN_EDGE, 0.6, 2.0);
  for (let i = 0; i < 6; i += 1) builder.shard(new Vector3(Math.sin(i * 1.7), Math.cos(i * 1.7), 0.4), MOLTEN, 0.5);

  group.userData.parts = [...parts, ...armorParts, ...coreParts];
  group.userData.shardSpecs = builder.shards;
  group.userData.armorPetals = petals;
  group.userData.coreGroup = coreGroup;
  group.userData.glow = glow.material as MeshBasicMaterial;
  group.userData.shieldPlate = shieldPlate;
  group.userData.shieldMaterial = shieldMaterial;
  group.userData.accent = MOLTEN.clone();
  group.userData.lockRingScale = 2.0;
  group.userData.isCore = true;
  return group;
}

// Player ordnance and friendly light: the coldest thing on screen, and the one
// mesh created often enough to be worth sharing. Geometry and materials are
// module-scoped constants so a sixty-shot run allocates nothing per volley.
const tracerCoreGeometry = new OctahedronGeometry(0.3, 0);
tracerCoreGeometry.scale(0.4, 0.4, 3.0);
const tracerShellGeometry = new OctahedronGeometry(0.5, 0);
tracerShellGeometry.scale(0.55, 0.55, 2.5);
const tracerHaloGeometry = new RingGeometry(0.42, 0.7, 12);
const tracerCoreMaterial = new MeshBasicMaterial({ color: hdr(COLD_WHITE, 2.8) });
const tracerShellMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 1.1), opacity: 0.6 });
const tracerHaloMaterial = createAdditiveBasicMaterial({ color: hdr(ICE_WHITE, 0.7), side: DoubleSide });

export function createTracerMesh() {
  const group = new Group();
  group.add(new Mesh(tracerCoreGeometry, tracerCoreMaterial));
  group.add(new Mesh(tracerShellGeometry, tracerShellMaterial));
  const halo = new Mesh(tracerHaloGeometry, tracerHaloMaterial);
  halo.position.z = 0.9;
  group.add(halo);
  return group;
}

// Lock brackets are built on every lock, so their geometry is shared too; only
// the bracket's own tinted material belongs to the bracket.
const bracketArmGeometry = new BoxGeometry(0.42, 0.05, 0.02);
const bracketLegGeometry = new BoxGeometry(0.05, 0.42, 0.02);
const bracketRingGeometry = new RingGeometry(0.52, 0.545, 32);

/** Four corner brackets closing on the target: a fire-control solution. */
export function createLockBracket(color: Color) {
  const group = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide });
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const corner = new Group();
    const arm = new Mesh(bracketArmGeometry, material);
    arm.position.set(-0.19, 0, 0);
    const leg = new Mesh(bracketLegGeometry, material);
    leg.position.set(0, -0.19, 0);
    corner.add(arm, leg);
    corner.position.set(Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0);
    corner.rotation.z = (i / 4) * Math.PI * 2;
    group.add(corner);
  }
  group.add(new Mesh(bracketRingGeometry, material));
  group.userData.material = material;
  return group;
}

/** Brackets share their geometry with every other bracket; only the tint is theirs. */
export function disposeLockBracket(group: Group) {
  (group.userData.material as MeshBasicMaterial | undefined)?.dispose();
}
