import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D } from 'three';
import { float, mix, positionGeometry, sin, smoothstep, time, uv, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { createSwarm } from '../../../engine/instanced-swarm';
import { chamferBox, createMachineMaterial, createPartBuilder, drum, hull, objectFx, type Finish, type MachineFx } from './machine-kit';

// The walker's machines, built from chamfered steel and lathed drums: the
// skiff (a wedge hull on foils), the spotter (a ducted rotor with a hanging
// sensor eye), the winch pod (a drum on a claw), the clamp buoy that holds a
// cable, and the red-hot rivet. Geometry is built once per kind and shared;
// each spawn is a light group of meshes.

export type EnemyColors = {
  paint: Color;
  steel: Color;
  darkSteel: Color;
  hazard: Color;
  rubber: Color;
  lamp: Color;
  glass: Color;
  rivetHot: Color;
  rivetShank: Color;
};

/** Per-model effect levels the event choreography writes; the materials read them per object. */
export type ModelFx = { flash: number; lamp: number; deny: number };

type Kit = {
  colors: EnemyColors;
  material: Material;
  finishes: Record<'paint' | 'hazard' | 'steel' | 'dark' | 'rubber' | 'lamp' | 'glass', Finish>;
};

let kit: Kit | null = null;

function machineKit(colors: EnemyColors): Kit {
  if (kit) return kit;
  kit = {
    colors,
    material: createMachineMaterial(objectFx(), { bare: colors.steel, hazard: colors.hazard }),
    finishes: {
      paint: { color: colors.paint, metal: 0.25, rough: 0.55, paint: true },
      hazard: { color: colors.paint, metal: 0.25, rough: 0.55, paint: true, hazard: true },
      steel: { color: colors.steel, metal: 0.8, rough: 0.4 },
      dark: { color: colors.darkSteel, metal: 0.6, rough: 0.55 },
      rubber: { color: colors.rubber, metal: 0, rough: 0.9 },
      lamp: { color: colors.lamp, metal: 0, rough: 0.3, glow: 3.2 },
      glass: { color: colors.glass, metal: 0.2, rough: 0.12 },
    },
  };
  return kit;
}

const geometries = new Map<string, BufferGeometry>();

function cached(name: string, build: () => BufferGeometry) {
  let geometry = geometries.get(name);
  if (!geometry) {
    geometry = build();
    geometries.set(name, geometry);
  }
  return geometry;
}

/** A group of shared-geometry meshes whose materials all read the same fx record. */
function model(parts: Array<{ geometry: BufferGeometry; material: Material; name?: string }>, fx: ModelFx, scale: number) {
  const group = new Group();
  const body = new Group();
  body.scale.setScalar(scale);
  group.add(body);
  for (const part of parts) {
    const mesh = new Mesh(part.geometry, part.material);
    mesh.userData.fx = fx;
    if (part.name) mesh.name = part.name;
    body.add(mesh);
  }
  group.userData.fx = fx;
  group.userData.body = body;
  return group;
}

const newFx = (): ModelFx => ({ flash: 0, lamp: 1, deny: 0 });

// ---- skiff ----------------------------------------------------------------------

function skiffGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  // The wedge hull, nose along +Z, with a hazard stripe down each flank.
  b.add(hull([
    [-1, 0.32, -1.9], [1, 0.32, -1.9], [-0.8, -0.22, -1.9], [0.8, -0.22, -1.9],
    [-0.4, 0.28, 1.4], [0.4, 0.28, 1.4], [0, 0.1, 2.05], [0, -0.24, 1.5], [0, -0.38, -0.2],
  ]), f.paint, {}, 'none');
  for (const side of [-1, 1]) b.add(chamferBox(0.06, 0.2, 2.9, 0.02), f.hazard, { at: [side * 0.72, 0.13, -0.25], rot: [0, side * 0.18, 0] }, 'none');
  // Deck: a transom band, a non-slip plate with a hatch, bollards and a grab rail each side.
  b.add(chamferBox(1.9, 0.14, 0.55), f.hazard, { at: [0, 0.38, -1.55] });
  b.add(chamferBox(1.3, 0.12, 1.6), f.dark, { at: [0, 0.36, -0.35] });
  b.add(chamferBox(0.5, 0.06, 0.5), f.steel, { at: [0, 0.44, -0.6] });
  for (const [x, z] of [[-0.62, -1.2], [0.62, -1.2], [-0.42, 1.05], [0.42, 1.05]]) b.add(drum(0.07, 0.22, 0.02, 8), f.steel, { at: [x, 0.45, z] }, 'none');
  for (const side of [-1, 1]) {
    b.add(chamferBox(0.05, 0.05, 1.5), f.steel, { at: [side * 0.62, 0.62, -0.5] });
    for (const z of [-1.15, 0.15]) b.add(chamferBox(0.04, 0.26, 0.04), f.steel, { at: [side * 0.62, 0.5, z] });
  }
  // Water intakes either side of the bow, their dark mouths facing forward.
  for (const side of [-1, 1]) {
    b.add(chamferBox(0.34, 0.24, 0.6), f.paint, { at: [side * 0.42, 0.4, 0.75] });
    b.add(chamferBox(0.26, 0.16, 0.05), f.rubber, { at: [side * 0.42, 0.4, 1.06] }, 'none');
  }
  // Sensor cabin: visor, mast with a radar dome, and the amber lamp.
  b.add(chamferBox(0.75, 0.46, 1.0), f.paint, { at: [0, 0.62, 0.05] });
  b.add(chamferBox(0.66, 0.16, 0.12), f.glass, { at: [0, 0.7, 0.57] });
  b.add(drum(0.13, 0.18, 0.03, 10), f.lamp, { at: [0.22, 0.92, 0.3] }, 'none');
  b.add(chamferBox(0.06, 0.55, 0.06), f.steel, { at: [-0.2, 1.1, -0.2] });
  b.add(new SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), f.steel, { at: [-0.2, 1.37, -0.2] }, 'none');
  // Foils: painted struts, braced, down to the wings.
  for (const x of [-0.72, 0.72]) {
    b.add(chamferBox(0.13, 0.95, 0.36), f.paint, { at: [x, -0.62, 0.7] });
    b.add(chamferBox(0.08, 0.08, 0.9), f.steel, { at: [x, -0.5, 0.1], rot: [0.9, 0, 0] });
  }
  b.add(chamferBox(0.13, 0.95, 0.3), f.paint, { at: [0, -0.62, -1.4] });
  b.add(chamferBox(2.5, 0.08, 0.46), f.dark, { at: [0, -1.08, 0.7] });
  for (const side of [-1, 1]) b.add(chamferBox(0.08, 0.28, 0.5), f.dark, { at: [side * 1.25, -0.98, 0.7] });
  b.add(chamferBox(1.4, 0.07, 0.34), f.dark, { at: [0, -1.08, -1.4] });
  // Stern jet duct.
  b.add(drum(0.3, 0.5, 0.06, 12), f.steel, { at: [0, 0.2, -2.05], rot: [Math.PI / 2, 0, 0] }, 'lathe');
  b.add(drum(0.2, 0.52, 0.02, 12), f.rubber, { at: [0, 0.2, -2.07], rot: [Math.PI / 2, 0, 0] }, 'none');
  return b.build();
}

export const SKIFF_SCALE = 1.75;

export function createSkiffMesh(colors: EnemyColors) {
  const k = machineKit(colors);
  const group = model([{ geometry: cached('skiff', () => skiffGeometry(k)), material: k.material }], newFx(), SKIFF_SCALE);
  group.userData.lockSize = 4.4;
  return group;
}

// ---- spotter (instanced) -------------------------------------------------------------

/** Where each ducted rotor sits on the spotter, left and right of the fuselage. */
export const SPOTTER_DUCTS: ReadonlyArray<readonly [number, number, number]> = [[-1.3, 0.05, -0.1], [1.3, 0.05, -0.1]];
const DUCT_RADIUS = 0.62;

function spotterGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  // Fuselage with a hazard saddle, a tail fin and skids; the eye faces the camera (+Z).
  b.add(chamferBox(0.85, 0.55, 1.4), f.paint, { at: [0, 0, -0.1] });
  b.add(chamferBox(0.9, 0.58, 0.3), f.hazard, { at: [0, 0, -0.45] });
  b.add(chamferBox(0.08, 0.5, 0.45), f.paint, { at: [0, 0.4, -0.7], rot: [-0.4, 0, 0] });
  for (const x of [-0.3, 0.3]) b.add(chamferBox(0.06, 0.06, 1.2), f.dark, { at: [x, -0.42, -0.1] });
  b.add(drum(0.3, 0.16, 0.04, 14), f.dark, { at: [0, -0.02, 0.66], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(new SphereGeometry(0.22, 12, 8), f.lamp, { at: [0, -0.02, 0.72] }, 'none');
  b.add(drum(0.07, 0.1, 0.02, 8), f.lamp, { at: [0, 0.32, 0.2] }, 'none');
  b.add(chamferBox(0.035, 0.6, 0.035), f.steel, { at: [0.25, 0.5, -0.4], rot: [0, 0, -0.25] });
  // Arms out to the two ducts; each duct a striped ring with a hub on a cross strut.
  for (const [x, y, z] of SPOTTER_DUCTS) {
    b.add(chamferBox(Math.abs(x) - 0.2, 0.14, 0.24), f.dark, { at: [x / 2, y, z] });
    b.add(new TorusGeometry(DUCT_RADIUS, 0.13, 8, 24), f.hazard, { at: [x, y, z], rot: [Math.PI / 2, 0, 0] }, 'none');
    b.add(new TorusGeometry(DUCT_RADIUS - 0.08, 0.05, 6, 24), f.dark, { at: [x, y - 0.1, z], rot: [Math.PI / 2, 0, 0] }, 'none');
    b.add(chamferBox(DUCT_RADIUS * 2, 0.05, 0.08), f.dark, { at: [x, y - 0.08, z] });
    b.add(drum(0.13, 0.26, 0.03, 10), f.steel, { at: [x, y - 0.05, z] }, 'lathe');
  }
  return b.build();
}

function bladeGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  b.add(chamferBox(DUCT_RADIUS * 1.85, 0.03, 0.16, 0.01), f.dark, { rot: [0.15, 0, 0] });
  b.add(chamferBox(0.16, 0.03, DUCT_RADIUS * 1.85, 0.01), f.dark, { rot: [0, 0, 0.15] });
  return b.build();
}

let discMaterial: MeshBasicNodeMaterial | null = null;

/** The blur of the spinning blades: a faint disc, darker toward the tips where they sweep fastest. */
function rotorDiscMaterial() {
  if (discMaterial) return discMaterial;
  discMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const r = uv().sub(0.5).length().mul(2);
  discMaterial.colorNode = vec3(0.12, 0.12, 0.12);
  discMaterial.opacityNode = smoothstep(0.15, 0.95, r).mul(0.4).add(0.14);
  return discMaterial;
}

const discGeometry = () => cached('rotor-disc', () => new CircleGeometry(DUCT_RADIUS - 0.04, 24).rotateX(-Math.PI / 2));

/** The flock's instanced draws: bodies, spinning blades and their blur discs. Spotters flash and grey out per instance. */
export function createSpotterSwarm(colors: EnemyColors, capacity: number) {
  const k = machineKit(colors);
  const attributes = { flashAt: 'float', denyAt: 'float' } as const;
  const bodies = createSwarm({ geometry: cached('spotter', () => spotterGeometry(k)), material: k.material, capacity, attributes });
  // The body material's effects read the swarm's own per-instance attributes.
  bodies.mesh.material = createMachineMaterial(swarmFx(bodies.nodes), { bare: colors.steel, hazard: colors.hazard, stripeScale: 4 });
  const ducts = capacity * SPOTTER_DUCTS.length;
  const blades = createSwarm({ geometry: cached('blades', () => bladeGeometry(k)), material: k.material, capacity: ducts });
  const discs = createSwarm({ geometry: discGeometry(), material: rotorDiscMaterial(), capacity: ducts });
  return { bodies, blades, discs };
}

function swarmFx(nodes: { flashAt: MachineFx['flash']; denyAt: MachineFx['flash']; time: MachineFx['flash'] }): MachineFx {
  const flash = nodes.time.sub(nodes.flashAt).max(0).mul(-7).exp();
  const deny = nodes.time.sub(nodes.denyAt).max(0).mul(-3).exp();
  return { flash, lamp: mix(float(1), float(0.2), deny), deny };
}

/** A lone spotter for model snapshots: the swarm geometry on ordinary meshes. */
export function createSpotterModel(colors: EnemyColors) {
  const k = machineKit(colors);
  const group = model([{ geometry: cached('spotter', () => spotterGeometry(k)), material: k.material }], newFx(), 1);
  const body = group.userData.body as Group;
  for (const [x, y, z] of SPOTTER_DUCTS) {
    const blades = new Mesh(cached('blades', () => bladeGeometry(k)), k.material);
    const disc = new Mesh(discGeometry(), rotorDiscMaterial());
    blades.position.set(x, y + 0.02, z);
    disc.position.set(x, y + 0.03, z);
    blades.rotation.y = x;
    body.add(blades, disc);
  }
  return group;
}

// ---- winch pod -------------------------------------------------------------------------

function podBodyGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  // The drum lies along the wall (Z); the claw bites the rock on -X, the gun faces the gorge on +X.
  const alongZ: [number, number, number] = [Math.PI / 2, 0, 0];
  b.add(drum(1.05, 1.9, 0.14, 20), f.paint, { rot: alongZ }, 'lathe');
  b.add(drum(1.1, 0.5, 0.04, 20), f.hazard, { rot: alongZ }, 'none');
  for (const z of [-0.72, 0.72]) b.add(drum(1.13, 0.12, 0.03, 20), f.steel, { at: [0, 0, z], rot: alongZ }, 'none');
  for (const z of [-1.02, 1.02]) b.add(drum(0.55, 0.2, 0.06, 14), f.dark, { at: [0, 0, z], rot: alongZ }, 'lathe');
  // Winch housing, spool and the shackle the cable runs down to.
  b.add(chamferBox(0.95, 0.6, 1.3), f.dark, { at: [0, 1.15, 0] });
  b.add(drum(0.3, 1.0, 0.05, 12), f.steel, { at: [0, 1.6, 0], rot: alongZ }, 'lathe');
  b.add(new TorusGeometry(0.2, 0.06, 6, 12), f.steel, { at: [0, 1.98, 0] }, 'none');
  b.add(drum(0.1, 0.16, 0.02, 8), f.lamp, { at: [0.35, 1.52, 0.55] }, 'none');
  b.add(drum(0.1, 0.16, 0.02, 8), f.lamp, { at: [0.35, 1.52, -0.55] }, 'none');
  // The claw's mounting block stays when the claw tears away.
  b.add(chamferBox(0.6, 0.9, 0.9), f.dark, { at: [-1.2, 0, 0] });
  // The rivet gun and the lamp above it.
  b.add(chamferBox(0.55, 0.55, 0.7), f.hazard, { at: [1.1, -0.1, 0] });
  b.add(drum(0.2, 0.9, 0.04, 12), f.dark, { at: [1.55, -0.1, 0], rot: [0, 0, Math.PI / 2] }, 'lathe');
  b.add(drum(0.26, 0.14, 0.03, 12), f.steel, { at: [1.98, -0.1, 0], rot: [0, 0, Math.PI / 2] }, 'none');
  b.add(drum(0.16, 0.14, 0.03, 10), f.lamp, { at: [1.02, 0.52, 0], rot: [0, 0, Math.PI / 2] }, 'none');
  return b.build();
}

function podClawGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  // A ram and three hooked fingers biting the rock on -X.
  b.add(drum(0.12, 0.8, 0.02, 8), f.steel, { at: [-1.1, 0.55, 0], rot: [0, 0, Math.PI / 2] }, 'none');
  for (const [z, lift] of [[-0.45, 0.25], [0, -0.1], [0.45, 0.25]] as const) {
    b.add(hull([
      [-1.45, 0.2 + lift * 0.3, z - 0.12], [-1.45, -0.2 + lift * 0.3, z - 0.12], [-1.45, 0.2 + lift * 0.3, z + 0.12], [-1.45, -0.2 + lift * 0.3, z + 0.12],
      [-2.05, 0.42 + lift, z - 0.08], [-2.05, 0.2 + lift, z + 0.08], [-2.35, 0.05 + lift, z],
    ]), f.steel, {}, 'none');
  }
  return b.build();
}

export const POD_SCALE = 1.45;

export function createPodMesh(colors: EnemyColors) {
  const k = machineKit(colors);
  const group = model([
    { geometry: cached('pod', () => podBodyGeometry(k)), material: k.material },
    { geometry: cached('pod-claw', () => podClawGeometry(k)), material: k.material, name: 'claw' },
  ], newFx(), POD_SCALE);
  group.userData.lockSize = 4.6;
  group.userData.claw = group.getObjectByName('claw');
  return group;
}

/** The winch line from the pod up to the rim, and the trolley it runs from. */
export function createWinchLine(colors: EnemyColors) {
  const k = machineKit(colors);
  const line = new Group();
  const cable = new Mesh(cached('winch-cable', () => new CylinderGeometry(0.11, 0.11, 1, 6).translate(0, 0.5, 0)), winchCableMaterial(colors));
  const trolley = new Mesh(cached('winch-trolley', () => {
    const b = createPartBuilder();
    b.add(chamferBox(1.2, 0.6, 1.6), k.finishes.hazard);
    b.add(drum(0.35, 0.4, 0.05, 12), k.finishes.steel, { at: [0, -0.4, 0], rot: [0, 0, Math.PI / 2] }, 'lathe');
    return b.build();
  }), k.material);
  trolley.userData.fx = newFx();
  line.add(cable, trolley);
  line.userData.cable = cable;
  line.userData.trolley = trolley;
  line.userData.raildIgnoreOcclusion = true;
  return line;
}

let winchMaterial: MeshStandardNodeMaterial | null = null;

function winchCableMaterial(colors: EnemyColors) {
  winchMaterial ??= new MeshStandardNodeMaterial({ color: colors.darkSteel, metalness: 0.7, roughness: 0.45 });
  return winchMaterial;
}

// ---- clamp buoy --------------------------------------------------------------------------

function clampGeometry({ finishes: f }: Kit) {
  const b = createPartBuilder();
  b.add(drum(1.0, 1.2, 0.16, 18), f.hazard, {}, 'lathe');
  b.add(drum(0.72, 0.3, 0.08, 16), f.dark, { at: [0, 0.72, 0] }, 'lathe');
  b.add(new TorusGeometry(1.02, 0.13, 6, 20), f.rubber, { at: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(drum(0.7, 0.7, 0.1, 14), f.dark, { at: [0, -0.9, 0] }, 'lathe');
  // Mast and the hydraulic jaw that holds the cable (running along X) at 2.3.
  b.add(chamferBox(0.3, 1.5, 0.3), f.paint, { at: [0, 1.5, 0] });
  b.add(chamferBox(0.6, 0.2, 0.62), f.dark, { at: [0, 2.52, 0] });
  b.add(chamferBox(0.6, 0.2, 0.62), f.dark, { at: [0, 2.08, 0] });
  b.add(chamferBox(0.16, 0.62, 0.62), f.dark, { at: [0, 2.3, -0.24] });
  b.add(drum(0.09, 0.55, 0.02, 8), f.steel, { at: [0, 2.3, 0.4] }, 'none');
  b.add(drum(0.12, 0.18, 0.03, 10), f.lamp, { at: [0, 2.72, 0] }, 'none');
  return b.build();
}

export function createClampMesh(colors: EnemyColors) {
  const k = machineKit(colors);
  const group = model([{ geometry: cached('clamp', () => clampGeometry(k)), material: k.material }], newFx(), 1.3);
  group.userData.lockSize = 3.4;
  group.userData.lockOffset = 1.5;
  return group;
}

// ---- rivet ---------------------------------------------------------------------------------

function rivetGeometry() {
  const b = createPartBuilder();
  const iron = { color: new Color(1, 1, 1) };
  // Head along +Z, a collar, and a grooved shank trailing back.
  b.add(new SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), iron, { at: [0, 0, 0.1] }, 'none');
  b.add(drum(0.46, 0.12, 0.03, 14), iron, { at: [0, 0, 0.06], rot: [Math.PI / 2, 0, 0] }, 'none');
  b.add(drum(0.17, 1.2, 0.04, 10), iron, { at: [0, 0, -0.6], rot: [Math.PI / 2, 0, 0] }, 'none');
  for (const z of [-0.45, -0.75, -1.05]) b.add(drum(0.21, 0.07, 0.02, 10), iron, { at: [0, 0, z], rot: [Math.PI / 2, 0, 0] }, 'none');
  return b.build();
}

let rivetMaterial: MeshStandardNodeMaterial | null = null;

/** Iron glowing from yellow-hot at the head to dull red at the tail, flickering. */
function hotIronMaterial(colors: EnemyColors) {
  if (rivetMaterial) return rivetMaterial;
  rivetMaterial = new MeshStandardNodeMaterial({ metalness: 0.4, roughness: 0.6 });
  const heat = smoothstep(-1.3, 0.5, positionGeometry.z);
  const hot = vec3(colors.rivetHot.r, colors.rivetHot.g, colors.rivetHot.b);
  const dull = vec3(colors.rivetShank.r, colors.rivetShank.g, colors.rivetShank.b);
  const flicker = sin(time.mul(31).add(positionGeometry.z.mul(9))).mul(0.12).add(1);
  rivetMaterial.colorNode = vec3(0.12, 0.06, 0.04);
  rivetMaterial.emissiveNode = mix(dull, hot, heat.mul(heat)).mul(flicker);
  return rivetMaterial;
}

export function createRivetMesh(colors: EnemyColors) {
  const group = new Group();
  const spinner = new Group();
  spinner.add(new Mesh(cached('rivet', rivetGeometry), hotIronMaterial(colors)));
  spinner.scale.setScalar(1.6);
  group.add(spinner);
  group.userData.spinner = spinner;
  group.userData.lockSize = 2.4;
  group.userData.isHostileShot = true;
  return group;
}

// ---- the player's flare --------------------------------------------------------------------

let flareParts: { core: BufferGeometry; glow: BufferGeometry; coreMaterial: MeshBasicMaterial; glowMaterial: MeshBasicMaterial } | null = null;

export function createFlareMesh(core: Color, glow: Color) {
  flareParts ??= {
    core: new OctahedronGeometry(0.2, 0).scale(0.8, 0.8, 2.6),
    glow: new OctahedronGeometry(0.34, 1).scale(1, 1, 1.8),
    coreMaterial: new MeshBasicMaterial({ color: core }),
    glowMaterial: new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
  };
  const group = new Group();
  group.add(new Mesh(flareParts.core, flareParts.coreMaterial), new Mesh(flareParts.glow, flareParts.glowMaterial));
  return group;
}

/** Every mesh a run spawns, built once on the attract screen so their shaders compile early. */
export function enemyWarmUpObjects(colors: EnemyColors): Object3D[] {
  return [createSkiffMesh(colors), createPodMesh(colors), createClampMesh(colors), createRivetMesh(colors), createSpotterModel(colors), createWinchLine(colors)];
}
