import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, positionView, smoothstep, uniform, vec3 } from 'three/tsl';
import type { CatmullRomCurve3 } from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { createTinkerRail, TINKER_TABLE_Y } from '../gameplay';
import {
  BRASS,
  BUTTON_RED,
  CARDBOARD,
  CREAM,
  ERASER_PINK,
  LAMP,
  PAPER,
  PENCIL_YELLOW,
  ROOM,
  SPOOL_TEAL,
  WOOD,
  WOOD_DARK,
  WOOD_LIGHT,
} from './palette';

const STEEL = new Color(0xb8b2a8);
const POT_METAL = new Color(0x9aa4a8);

// The worktable: one huge walnut surface scratched into roads, strewn with
// oversized supplies, lit by warm desk-lamp pools. The rail runs just above
// the surface; props hug it low and wide so they never block targets.

const TABLE_STEPS = 260;
const TABLE_HALF_WIDTH = 34;
const RAIL_LENGTH = createTinkerRail().getLength();
const PROP_COUNT = 110;

// Shared beat energy, written by the beat handler, read by the table shader.
export const beatUniform = uniform(0);

// Lamp pools sit at fixed rail fractions; the table shader glows there.
export const LAMP_US = [0.14, 0.45, 0.78];

export type TinkerEnvironment = {
  root: Group;
  props: ScatterField;
};

export function createEnvironmentInternal(scene: import('three').Scene): TinkerEnvironment {
  scene.background = ROOM;
  const root = new Group();
  const rng = mulberry32(20260917);
  const curve = createTinkerRail();

  root.add(makeTable(curve));
  root.add(makeScratches(curve, rng));
  root.add(makeSpillPuddle(curve));
  root.add(makeSpotlessPatch(curve));
  root.add(makeLamps(curve));
  root.add(makeDust(curve, rng));
  const props = makeProps(curve, rng);
  root.add(props.group);

  scene.add(root);
  return { root, props };
}

// ---- the table surface ------------------------------------------------------

function makeTable(curve: CatmullRomCurve3): Mesh {
  const positions: number[] = [];
  const railUs: number[] = [];
  const indexes: number[] = [];

  for (let i = 0; i < TABLE_STEPS; i += 1) {
    const u = i / (TABLE_STEPS - 1);
    const frame = sampleRailFrame(curve, u);
    const position = frame.position;
    const right = frame.right;
    positions.push(
      position.x - right.x * TABLE_HALF_WIDTH, TINKER_TABLE_Y, position.z - right.z * TABLE_HALF_WIDTH,
      position.x + right.x * TABLE_HALF_WIDTH, TINKER_TABLE_Y, position.z + right.z * TABLE_HALF_WIDTH,
    );
    railUs.push(u, u);
    if (i > 0) {
      const base = (i - 1) * 2;
      indexes.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('railU', new Float32BufferAttribute(railUs, 1));
  geometry.setIndex(indexes);

  const material = new MeshBasicNodeMaterial();
  const railU = attribute<'float'>('railU', 'float');
  // Wood grain: fine stripes across the rail plus a slower plank tone.
  const grain = railU.mul(340).sin().mul(0.5).add(0.5).pow(2).mul(0.16);
  const plank = railU.mul(26).sin().mul(0.5).add(0.5).mul(0.1);
  // Lamp pools: gaussian bumps at the lamp positions.
  let poolNode = railU.sub(LAMP_US[0]).mul(26).pow(2).negate().exp();
  for (let i = 1; i < LAMP_US.length; i += 1) {
    poolNode = poolNode.add(railU.sub(LAMP_US[i]).mul(26).pow(2).negate().exp());
  }
  const warmth = poolNode.mul(0.55).add(0.28);
  const viewDistance = positionView.z.negate();
  const baseColor = vec3(WOOD.r, WOOD.g, WOOD.b)
    .mul(float(1).sub(grain).sub(plank))
    .add(vec3(LAMP.r, LAMP.g, LAMP.b).mul(warmth.mul(0.22)))
    .mul(beatUniform.mul(0.06).add(1));
  material.colorNode = baseColor
    .mul(viewDistance.mul(-0.008).exp())
    .mul(smoothstep(float(1.2), float(7), viewDistance));

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- scratches: the roads ----------------------------------------------------

function makeScratches(curve: CatmullRomCurve3, rng: () => number): LineSegments {
  const positions: number[] = [];
  const colors: number[] = [];
  const COUNT = 150;

  for (let i = 0; i < COUNT; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const along = frame.tangent.clone();
    along.y = 0;
    along.normalize();
    const lateral = new Vector3(-along.z, 0, along.x);
    const base = frame.position
      .clone()
      .addScaledVector(frame.right, (rng() - 0.5) * 44)
      .addScaledVector(along, (rng() - 0.5) * 30);
    base.y = TINKER_TABLE_Y + 0.012;
    const length = 2.5 + rng() * 7;
    const drift = (rng() - 0.5) * 1.6;
    const a = base.clone().addScaledVector(along, -length / 2).addScaledVector(lateral, drift * 0.5);
    const b = base.clone().addScaledVector(along, length / 2).addScaledVector(lateral, -drift * 0.5);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const light = rng() < 0.4;
    const color = light ? WOOD_LIGHT : WOOD_DARK;
    const intensity = light ? 0.85 : 0.6;
    for (let k = 0; k < 2; k += 1) {
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

// ---- the Spill: a dark puddle waiting at the table's end ---------------------

function makeSpillPuddle(curve: CatmullRomCurve3): Mesh {
  const puddle = new Mesh(
    new SphereGeometry(1, 24, 12),
    new MeshBasicMaterial({ color: 0x120c08 }),
  );
  puddle.scale.set(26, 0.35, 16);
  const frame = sampleRailFrame(curve, 0.985);
  puddle.position.set(frame.position.x, TINKER_TABLE_Y + 0.05, frame.position.z);
  puddle.userData.raildIgnoreOcclusion = true;
  puddle.frustumCulled = false;
  return puddle;
}

// The spotless patch the ball coasts across after the Spill breaks: a pale
// clean disc, hidden until the finale reveals it.
function makeSpotlessPatch(curve: CatmullRomCurve3): Mesh {
  const patch = new Mesh(
    new SphereGeometry(1, 20, 8),
    new MeshBasicMaterial({
      color: PAPER,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  patch.scale.set(7, 0.12, 4.5);
  const frame = sampleRailFrame(curve, 0.998);
  patch.position.set(frame.position.x, TINKER_TABLE_Y + 0.06, frame.position.z);
  patch.userData.isSpotlessPatch = true;
  patch.userData.raildIgnoreOcclusion = true;
  patch.frustumCulled = false;
  return patch;
}

// ---- desk lamps --------------------------------------------------------------

function makeLamps(curve: CatmullRomCurve3): Group {
  const group = new Group();
  LAMP_US.forEach((lampU, index) => {
    const frame = sampleRailFrame(curve, lampU);
    const side = index % 2 === 0 ? 1 : -1;
    const base = frame.position
      .clone()
      .addScaledVector(frame.right, side * 20)
      .add(new Vector3(0, 11, 0));

    // Shade: a warm brass cone.
    const shade = new Mesh(
      new CylinderGeometry(1.1, 2.6, 1.8, 16, 1, true),
      new MeshBasicMaterial({ color: BRASS.clone().multiplyScalar(0.7), side: DoubleSide }),
    );
    shade.position.copy(base);
    // Bulb: the hot core.
    const bulb = new Mesh(
      new SphereGeometry(0.55, 12, 10),
      new MeshBasicMaterial({ color: hdrColor(LAMP, 1.9) }),
    );
    bulb.position.copy(base).add(new Vector3(0, -0.8, 0));
    // Halo: a soft additive shell.
    const halo = new Mesh(
      new SphereGeometry(1.6, 12, 10),
      new MeshBasicMaterial({
        color: hdrColor(LAMP, 0.4),
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.copy(bulb.position);
    shade.userData.raildIgnoreOcclusion = true;
    bulb.userData.raildIgnoreOcclusion = true;
    halo.userData.raildIgnoreOcclusion = true;
    group.add(shade, bulb, halo);
  });
  return group;
}

// ---- dust motes in the lamplight ----------------------------------------------

function makeDust(curve: CatmullRomCurve3, rng: () => number): Points {
  const COUNT = 420;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 2 + rng() * 22;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius * 0.5 + 2.5)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 26);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const intensity = 0.1 + rng() * (rng() < 0.08 ? 1.1 : 0.25);
    colors[i * 3] = LAMP.r * intensity;
    colors[i * 3 + 1] = LAMP.g * intensity;
    colors[i * 3 + 2] = LAMP.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 0.14,
    vertexColors: true,
    sizeAttenuation: true,
  }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- scattered supplies --------------------------------------------------------

type PropKind =
  | 'button' | 'pin' | 'bead' | 'paperclip'
  | 'spool' | 'eraser' | 'paint' | 'block'
  | 'ruler' | 'jar' | 'cardboard';

function kindForU(u: number, roll: number): PropKind {
  // Props match the act that plays where they sit: marble clutter early,
  // tennis-ball supplies mid-table, melon-scale structures at the end.
  if (u < 0.3) return (['button', 'pin', 'bead', 'paperclip'] as const)[Math.floor(roll * 4) % 4];
  if (u < 0.58) return (['spool', 'eraser', 'paint', 'block'] as const)[Math.floor(roll * 4) % 4];
  return (['ruler', 'jar', 'cardboard', 'block'] as const)[Math.floor(roll * 4) % 4];
}

function propHalfHeight(kind: PropKind): number {
  switch (kind) {
    case 'button': return 0.09;
    case 'pin': return 0.15;
    case 'bead': return 0.28;
    case 'paperclip': return 0.06;
    case 'spool': return 0.45;
    case 'eraser': return 0.18;
    case 'paint': return 0.22;
    case 'block': return 0.29;
    case 'ruler': return 0.06;
    case 'jar': return 0.58;
    case 'cardboard': return 0.06;
  }
}

// Prop shapes are shared: every prop of a kind reuses one cached geometry
// (and a small set of cached materials), varying only by transform.
const propGeometryCache = new Map<string, BufferGeometry>();
function cachedPropGeometry(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = propGeometryCache.get(key);
  if (!geometry) {
    geometry = make();
    propGeometryCache.set(key, geometry);
  }
  return geometry;
}
const propMaterialCache = new Map<Color, MeshBasicMaterial>();
function cachedPropMaterial(color: Color): MeshBasicMaterial {
  let material = propMaterialCache.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color });
    propMaterialCache.set(color, material);
  }
  return material;
}

function makeProp(kind: PropKind, rng: () => number): Mesh | Group {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];
  switch (kind) {
    case 'button': {
      const button = new Mesh(
        cachedPropGeometry('button', () => new CylinderGeometry(0.62, 0.62, 0.16, 14)),
        cachedPropMaterial(pick([BUTTON_RED, SPOOL_TEAL])),
      );
      button.scale.setScalar(0.8 + rng() * 0.5);
      button.rotation.y = rng() * Math.PI;
      return button;
    }
    case 'pin': {
      const pin = new Group();
      const head = new Mesh(
        cachedPropGeometry('pinHead', () => new SphereGeometry(0.12, 8, 6)),
        cachedPropMaterial(BUTTON_RED),
      );
      head.position.y = 0.5;
      const needle = new Mesh(
        cachedPropGeometry('pinNeedle', () => new CylinderGeometry(0.02, 0.02, 1, 6)),
        cachedPropMaterial(STEEL),
      );
      needle.position.y = -0.1;
      pin.add(head, needle);
      pin.rotation.z = Math.PI / 2 + (rng() - 0.5) * 0.4;
      return pin;
    }
    case 'bead': {
      const bead = new Mesh(
        cachedPropGeometry('bead', () => new SphereGeometry(0.26, 10, 8)),
        cachedPropMaterial(pick([BRASS, ERASER_PINK])),
      );
      bead.scale.setScalar(0.85 + rng() * 0.5);
      return bead;
    }
    case 'paperclip': {
      const clip = new Group();
      const wire = cachedPropMaterial(STEEL);
      for (const [key, stretch, radius] of [['clipA', 1, 0.42], ['clipB', 0.66, 0.3], ['clipC', 0.36, 0.18]] as const) {
        const loop = new Mesh(
          cachedPropGeometry(key, () => new TorusGeometry(radius, 0.028, 6, 14)),
          wire,
        );
        loop.scale.set(1, stretch, 1);
        loop.rotation.x = Math.PI / 2;
        loop.position.y = 0.03;
        clip.add(loop);
      }
      clip.rotation.y = rng() * Math.PI * 2;
      return clip;
    }
    case 'spool': {
      const spool = new Group();
      const body = new Mesh(
        cachedPropGeometry('spoolBody', () => new CylinderGeometry(0.3, 0.3, 0.5, 12)),
        cachedPropMaterial(pick([CARDBOARD, SPOOL_TEAL])),
      );
      const flangeGeometry = cachedPropGeometry('spoolFlange', () => new CylinderGeometry(0.42, 0.42, 0.08, 12));
      const flangeMaterial = cachedPropMaterial(PAPER);
      const top = new Mesh(flangeGeometry, flangeMaterial);
      top.position.y = 0.29;
      const bottom = new Mesh(flangeGeometry, flangeMaterial);
      bottom.position.y = -0.29;
      spool.add(body, top, bottom);
      spool.rotation.z = Math.PI / 2;
      spool.rotation.y = rng() * Math.PI * 2;
      return spool;
    }
    case 'eraser': {
      const eraser = new Mesh(
        cachedPropGeometry('eraser', () => new BoxGeometry(0.8, 0.34, 0.5)),
        cachedPropMaterial(pick([ERASER_PINK, CREAM])),
      );
      eraser.rotation.y = rng() * Math.PI * 2;
      return eraser;
    }
    case 'paint': {
      const pot = new Group();
      const body = new Mesh(
        cachedPropGeometry('paintPot', () => new CylinderGeometry(0.3, 0.26, 0.42, 12)),
        cachedPropMaterial(POT_METAL),
      );
      const paint = new Mesh(
        cachedPropGeometry('paintTop', () => new CylinderGeometry(0.26, 0.26, 0.05, 12)),
        cachedPropMaterial(pick([BUTTON_RED, SPOOL_TEAL])),
      );
      paint.position.y = 0.22;
      pot.add(body, paint);
      pot.rotation.y = rng() * Math.PI * 2;
      return pot;
    }
    case 'block': {
      const block = new Mesh(
        cachedPropGeometry('block', () => new BoxGeometry(0.55, 0.55, 0.55)),
        cachedPropMaterial(pick([BUTTON_RED, SPOOL_TEAL, PENCIL_YELLOW])),
      );
      block.rotation.y = rng() * Math.PI * 2;
      return block;
    }
    case 'ruler': {
      const ruler = new Mesh(
        cachedPropGeometry('ruler', () => new BoxGeometry(2.6, 0.1, 0.4)),
        cachedPropMaterial(PENCIL_YELLOW.clone().lerp(WOOD, 0.3)),
      );
      ruler.rotation.y = rng() * Math.PI * 2;
      return ruler;
    }
    case 'jar': {
      const jar = new Group();
      const glass = new Mesh(
        cachedPropGeometry('jarGlass', () => new CylinderGeometry(0.45, 0.4, 1.0, 12)),
        cachedPropMaterial(CREAM.clone().multiplyScalar(0.8)),
      );
      const lid = new Mesh(
        cachedPropGeometry('jarLid', () => new CylinderGeometry(0.47, 0.47, 0.16, 12)),
        cachedPropMaterial(BRASS),
      );
      lid.position.y = 0.58;
      jar.add(glass, lid);
      jar.rotation.y = rng() * Math.PI * 2;
      return jar;
    }
    case 'cardboard': {
      const sheet = new Mesh(
        cachedPropGeometry('cardboard', () => new BoxGeometry(2.2, 0.08, 1.6)),
        cachedPropMaterial(CARDBOARD),
      );
      sheet.scale.set(0.8 + rng() * 0.6, 1, 0.8 + rng() * 0.6);
      sheet.rotation.y = rng() * Math.PI * 2;
      return sheet;
    }
  }
}

function makeProps(curve: CatmullRomCurve3, rng: () => number): ScatterField {
  return scatterAlongRail(curve, {
    count: PROP_COUNT,
    seed: 20260917,
    rng,
    window: { behind: 40, ahead: RAIL_LENGTH },
    alignToRail: false,
    make(index, makeRng) {
      // The kind is keyed to where the prop will sit so the clutter tracks
      // the acts; place() below derives the same slot from the index alone.
      const u = (index + 0.5) / PROP_COUNT;
      const kind = kindForU(u, makeRng());
      const prop = makeProp(kind, makeRng);
      prop.userData.propKind = kind;
      return prop;
    },
    place(index) {
      const u = (index + 0.5) / PROP_COUNT;
      const side = index % 2 === 0 ? -1 : 1;
      const distance = 8.5 + ((index * 37) % 100) / 100 * 20;
      return { u, offset: new Vector3(side * distance, 0, (((index * 53) % 100) / 100 - 0.5) * 6) };
    },
    onUpdate(item) {
      // Seat on the table plane regardless of rail height variation.
      const half = propHalfHeight(item.object.userData.propKind as PropKind);
      item.object.position.y = TINKER_TABLE_Y + half;
    },
  });
}

function hdrColor(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
