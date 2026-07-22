import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { PartBin, glowMesh, solidMesh } from './build';
import {
  AMBER,
  ASPHALT,
  CHROME,
  CITY_GLOW,
  CONCRETE,
  HEADLIGHT,
  NEON_PINK,
  NIGHT,
  STEEL,
  TAILLIGHT,
  hdr,
} from './palette';
import { createPursePursuitRail } from '../gameplay';
import { PURSE_TUNING } from '../tuning';

/**
 * The world: six lanes of night highway, guardrails, an amber streetlight
 * cadence overhead, concrete overpasses, civilian traffic streaming red, and a
 * city burning pink past the barriers. Construction only — the palette and the
 * strobe rules live in `palette.ts` and `index.ts`.
 */

const HALF_PI = Math.PI / 2;
const road = PURSE_TUNING.road;
const world = PURSE_TUNING.world;
const DECK = -road.cameraHeightUnits;
const HALF_DECK = (road.laneWidthUnits * road.laneCount) / 2;
const LEFT_EDGE = road.centreOffsetUnits - HALF_DECK;
const RIGHT_EDGE = road.centreOffsetUnits + HALF_DECK;

export const railCurve = createPursePursuitRail();
const rail = railCurve;
export const railLengthUnits = rail.getLength();
const railLength = railLengthUnits;

/**
 * The four materials the runtime writes every frame to keep the world lit on
 * the beat. They are shared across every instance of their fixture — one colour
 * write strobes the whole sky — but they are built *per environment*, because
 * disposing the environment disposes them and a re-mounted level must not
 * inherit a dead material.
 */
export type WorldLights = {
  /** Streetlight heads: the amber cadence overhead. */
  streetlight: MeshBasicMaterial;
  /** The sodium pool each lamp throws on the tarmac. Kept low: light, not paint. */
  pool: MeshBasicMaterial;
  /** Overpass undersides: they flare as the car shoots the gap. */
  overpass: MeshBasicMaterial;
  /** Lane dashes brighten on the downbeat — the road keeps time. */
  laneDash: MeshBasicMaterial;
};

function createWorldLights(): WorldLights {
  return {
    streetlight: createAdditiveBasicMaterial({ color: hdr(AMBER, 1.4), side: DoubleSide }),
    pool: createAdditiveBasicMaterial({ color: hdr(AMBER, 0.16), side: DoubleSide }),
    overpass: createAdditiveBasicMaterial({ color: hdr(AMBER, 0.9), side: DoubleSide }),
    laneDash: new MeshBasicMaterial({ color: hdr(HEADLIGHT, 0.5), side: DoubleSide }),
  };
}

let lights: WorldLights = createWorldLights();

export type PurseEnvironment = {
  root: Group;
  lights: WorldLights;
  update(cameraRailU: number, dt: number, camera: { position: Vector3 }): void;
  dispose(): void;
};

export function createPurseEnvironment(scene: Scene): PurseEnvironment {
  lights = createWorldLights();
  scene.background = NIGHT.clone();
  scene.fog = new Fog(world.fog.colour, world.fog.nearUnits, world.fog.farUnits);

  const root = new Group();
  const sky = createSkyGlow();
  const fields: ScatterField[] = [];

  root.add(sky);
  root.add(createDeck(), createLaneDashes(), createGuardrail(-1), createGuardrail(1));

  const streetlights = createStreetlightField();
  const overpasses = createOverpassField();
  const skyline = createSkylineField();
  const traffic = createTrafficField();
  fields.push(streetlights, overpasses, skyline, traffic);
  for (const field of fields) root.add(field.group);

  scene.add(root);

  return {
    root,
    lights,
    update(cameraRailU, dt, camera) {
      sky.position.copy(camera.position);
      for (const field of fields) field.update(cameraRailU, dt);
    },
    dispose() {
      for (const field of fields) field.dispose();
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}

// --- the road ---------------------------------------------------------------

function railPoint(u: number, right: number, up: number) {
  const frame = sampleRailFrame(rail, u);
  return frame.position.clone().addScaledVector(frame.right, right).addScaledVector(frame.up, up);
}

/** One long swept ribbon: tarmac, both shoulders, and the kerb lines. */
function createDeck() {
  const samples = Math.ceil(railLength / road.ribbonStepUnits);
  const strips: Array<{ from: number; to: number; y: number; colour: Color }> = [
    { from: LEFT_EDGE, to: RIGHT_EDGE, y: DECK, colour: ASPHALT },
    { from: LEFT_EDGE - road.shoulderWidthUnits, to: LEFT_EDGE, y: DECK + 0.04, colour: hdr(CONCRETE, 0.8) },
    { from: RIGHT_EDGE, to: RIGHT_EDGE + road.shoulderWidthUnits, y: DECK + 0.04, colour: hdr(CONCRETE, 0.8) },
  ];

  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (const strip of strips) {
    for (let i = 0; i <= samples; i += 1) {
      const u = i / samples;
      const base = positions.length / 3;
      const left = railPoint(u, strip.from, strip.y);
      const right = railPoint(u, strip.to, strip.y);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      // The tarmac darkens away from the crown so the surface has some read.
      for (let v = 0; v < 2; v += 1) colours.push(strip.colour.r, strip.colour.g, strip.colour.b);
      if (i < samples) indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide }));
  mesh.frustumCulled = false;
  mesh.name = 'deck';
  return mesh;
}

/** Five broken lane lines plus solid edge lines. This is the speedometer. */
function createLaneDashes() {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = Math.floor(railLength / road.dashSpacingUnits);
  const half = road.dashWidthUnits * 0.5;
  const lanes: number[] = [];
  for (let i = 1; i < road.laneCount; i += 1) lanes.push(LEFT_EDGE + i * road.laneWidthUnits);

  const push = (u0: number, u1: number, centre: number) => {
    const base = positions.length / 3;
    const p0 = railPoint(u0, centre - half, DECK + 0.02);
    const p1 = railPoint(u0, centre + half, DECK + 0.02);
    const p2 = railPoint(u1, centre - half, DECK + 0.02);
    const p3 = railPoint(u1, centre + half, DECK + 0.02);
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };

  for (let i = 0; i < count; i += 1) {
    const u0 = (i * road.dashSpacingUnits) / railLength;
    const u1 = Math.min(1, (i * road.dashSpacingUnits + road.dashLengthUnits) / railLength);
    for (const centre of lanes) push(u0, u1, centre);
    // Continuous edge lines, drawn as back-to-back dashes.
    const uEdge = Math.min(1, (i * road.dashSpacingUnits + road.dashSpacingUnits) / railLength);
    push(u0, uEdge, LEFT_EDGE + 0.3);
    push(u0, uEdge, RIGHT_EDGE - 0.3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, lights.laneDash);
  mesh.frustumCulled = false;
  mesh.name = 'lane-dashes';
  return mesh;
}

/** W-beam barrier with posts, baked into one mesh per side. */
function createGuardrail(side: -1 | 1) {
  const offset = side < 0 ? LEFT_EDGE - road.shoulderWidthUnits - 0.4 : RIGHT_EDGE + road.shoulderWidthUnits + 0.4;
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const height = world.guardrail.heightUnits;
  const beams: Array<{ low: number; high: number; colour: Color }> = [
    { low: DECK + height * 0.42, high: DECK + height * 0.82, colour: hdr(STEEL, 1.5) },
    { low: DECK + height * 0.86, high: DECK + height, colour: hdr(CHROME, 0.22) },
  ];
  const samples = Math.ceil(railLength / 11);
  for (const beam of beams) {
    for (let i = 0; i <= samples; i += 1) {
      const u = i / samples;
      const base = positions.length / 3;
      const low = railPoint(u, offset, beam.low);
      const high = railPoint(u, offset, beam.high);
      positions.push(low.x, low.y, low.z, high.x, high.y, high.z);
      for (let v = 0; v < 2; v += 1) colours.push(beam.colour.r, beam.colour.g, beam.colour.b);
      if (i < samples) indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const postCount = Math.floor(railLength / world.guardrail.postSpacingUnits);
  const postColour = hdr(STEEL, 0.85);
  for (let i = 0; i < postCount; i += 1) {
    const u = (i * world.guardrail.postSpacingUnits) / railLength;
    const base = positions.length / 3;
    const low = railPoint(u, offset + 0.06, DECK);
    const high = railPoint(u, offset + 0.06, DECK + height * 0.86);
    const low2 = railPoint(u + 0.14 / railLength, offset + 0.06, DECK);
    const high2 = railPoint(u + 0.14 / railLength, offset + 0.06, DECK + height * 0.86);
    positions.push(low.x, low.y, low.z, high.x, high.y, high.z, low2.x, low2.y, low2.z, high2.x, high2.y, high2.z);
    for (let v = 0; v < 4; v += 1) colours.push(postColour.r, postColour.g, postColour.b);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide }));
  mesh.frustumCulled = false;
  mesh.name = `guardrail-${side}`;
  return mesh;
}

// --- scenery fields ---------------------------------------------------------

function createStreetlightField() {
  const span = world.streetlight.visibleAheadUnits + world.streetlight.visibleBehindUnits;
  const count = (Math.ceil(span / world.streetlight.spacingUnits) + 2) * 2;
  return scatterAlongRail(rail, {
    count,
    seed: 7,
    window: { behind: world.streetlight.visibleBehindUnits, ahead: world.streetlight.visibleAheadUnits },
    place(index) {
      const slot = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      return {
        u: (slot * world.streetlight.spacingUnits) / railLength,
        offset: new Vector3(side * world.streetlight.offsetUnits, 0, 0),
      };
    },
    make(index) {
      return createStreetlight(index % 2 === 0 ? -1 : 1);
    },
  });
}

/** A gooseneck sodium lamp: pole outside the barrier, head over the lanes. */
function createStreetlight(side: -1 | 1) {
  const group = new Group();
  const bin = new PartBin();
  const height = world.streetlight.poleHeightUnits;
  const arm = world.streetlight.armLengthUnits;
  bin.add(new CylinderGeometry(0.13, 0.19, height, 6), hdr(STEEL, 0.9), { at: [0, DECK + height * 0.5, 0] });
  bin.add(new CylinderGeometry(0.1, 0.1, arm, 5), hdr(STEEL, 0.9), {
    at: [-side * arm * 0.5, DECK + height - 0.25, 0],
    rotate: [0, 0, HALF_PI],
  });
  bin.add(new BoxGeometry(0.9, 0.16, 0.5), hdr(STEEL, 1.1), { at: [-side * arm, DECK + height - 0.34, 0] });
  const post = solidMesh(bin.merge());
  post.name = 'streetlight';

  const head = new Mesh(new PlaneGeometry(0.72, 0.34), lights.streetlight);
  head.position.set(-side * arm, DECK + height - 0.46, 0);
  head.rotation.x = -HALF_PI;
  head.userData.raildIgnoreOcclusion = true;

  // The cone of light the lamp throws down onto the tarmac.
  const pool = new Mesh(new CircleGeometry(4.4, 18), lights.pool);
  pool.position.set(-side * arm, DECK + 0.09, 0);
  pool.rotation.x = -HALF_PI;
  pool.userData.raildIgnoreOcclusion = true;

  group.add(post, head, pool);
  return group;
}

function createOverpassField() {
  const span = world.overpass.visibleAheadUnits + world.overpass.visibleBehindUnits;
  const count = Math.ceil(span / world.overpass.spacingUnits) + 2;
  return scatterAlongRail(rail, {
    count,
    seed: 31,
    window: { behind: world.overpass.visibleBehindUnits, ahead: world.overpass.visibleAheadUnits },
    place(index) {
      return {
        u: ((index + 0.5) * world.overpass.spacingUnits) / railLength,
        offset: new Vector3(road.centreOffsetUnits, 0, 0),
      };
    },
    make() {
      return createOverpass();
    },
  });
}

function createOverpass() {
  const group = new Group();
  const clearance = world.overpass.clearanceUnits;
  const depth = world.overpass.depthUnits;
  const width = HALF_DECK * 2 + road.shoulderWidthUnits * 2 + 12;
  const bin = new PartBin();
  bin.add(new BoxGeometry(width, 2.2, depth), hdr(CONCRETE, 1.05), { at: [0, DECK + clearance + 1.1, 0] });
  bin.add(new BoxGeometry(width, 0.7, depth * 0.4), hdr(CONCRETE, 1.5), { at: [0, DECK + clearance + 2.5, 0] });
  for (const side of [-1, 1]) {
    bin.add(new BoxGeometry(3.2, clearance, depth * 0.9), hdr(CONCRETE, 0.7), {
      at: [side * (width * 0.5 - 2.2), DECK + clearance * 0.5, 0],
    });
    // The abutment the ramp jumpers use.
    bin.add(new BoxGeometry(3.4, 1.6, depth * 1.9), hdr(CONCRETE, 0.9), {
      at: [side * (width * 0.5 - 5.6), DECK + 0.8, 0],
      rotate: [0.16 * side, 0, 0],
    });
  }
  const slab = solidMesh(bin.merge());
  slab.name = 'overpass';

  const lamp = new Mesh(new PlaneGeometry(width * 0.86, depth * 0.5), lights.overpass);
  lamp.position.set(0, DECK + clearance - 0.04, 0);
  lamp.rotation.x = HALF_PI;
  lamp.userData.raildIgnoreOcclusion = true;

  group.add(slab, lamp);
  return group;
}

function createSkylineField() {
  const span = world.skyline.visibleAheadUnits + world.skyline.visibleBehindUnits;
  const count = (Math.ceil(span / world.skyline.spacingUnits) + 2) * 2;
  const rng = mulberry32(world.skyline.seed);
  const specs = Array.from({ length: count }, () => ({
    width: lerpRange(world.skyline.widthRangeUnits, rng()),
    height: lerpRange(world.skyline.heightRangeUnits, rng()),
    depth: lerpRange(world.skyline.widthRangeUnits, rng()) * 0.8,
    setback: rng() * 46,
    seed: Math.floor(rng() * 1e6),
  }));

  return scatterAlongRail(rail, {
    count,
    seed: world.skyline.seed,
    window: { behind: world.skyline.visibleBehindUnits, ahead: world.skyline.visibleAheadUnits },
    place(index) {
      const slot = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      const spec = specs[index];
      return {
        u: (slot * world.skyline.spacingUnits) / railLength,
        offset: new Vector3(
          side * (world.skyline.offsetUnits + spec.setback + spec.width * 0.5),
          DECK + spec.height * 0.5 - 6,
          0,
        ),
      };
    },
    make(index) {
      return createTower(specs[index], index % 2 === 0 ? -1 : 1);
    },
  });
}

type TowerSpec = { width: number; height: number; depth: number; setback: number; seed: number };

/** A slab tower with lit windows. Body and windows merge into one mesh. */
function createTower(spec: TowerSpec, side: -1 | 1) {
  const bin = new PartBin();
  bin.add(new BoxGeometry(spec.width, spec.height, spec.depth), hdr(CONCRETE, 0.34));
  const rng = mulberry32(spec.seed);
  const columns = Math.max(2, Math.floor(spec.depth / 5.5));
  const rows = Math.max(3, Math.floor(spec.height / 6.5));
  const faceX = -side * (spec.width * 0.5 + 0.05);
  for (let row = 1; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = rng();
      if (roll > 0.46) continue;
      const colour = roll < 0.1 ? hdr(NEON_PINK, 0.6) : hdr(AMBER, 0.45);
      bin.add(new PlaneGeometry(3.1, 1.5), colour, {
        at: [
          faceX,
          -spec.height * 0.5 + row * 6.5,
          -spec.depth * 0.5 + (column + 0.5) * (spec.depth / columns),
        ],
        rotate: [0, HALF_PI, 0],
      });
    }
  }
  // A rooftop hazard beacon, because a pop video needs them.
  bin.add(new PlaneGeometry(1.1, 1.1), hdr(TAILLIGHT, 1.1), {
    at: [0, spec.height * 0.5 + 0.6, 0],
    rotate: [HALF_PI, 0, 0],
  });
  const mesh = solidMesh(bin.merge());
  mesh.name = 'tower';
  mesh.userData.raildIgnoreOcclusion = true;
  const group = new Group();
  group.add(mesh);
  return group;
}

function createTrafficField() {
  const lanes = world.traffic.laneOffsetsUnits;
  const rng = mulberry32(world.traffic.seed);
  const speeds = Array.from({ length: world.traffic.count }, () =>
    lerpRange(world.traffic.speedRangeUnitsPerSecond, rng()));
  return scatterAlongRail(rail, {
    count: world.traffic.count,
    seed: world.traffic.seed,
    window: { behind: world.traffic.recycleBehindUnits, ahead: world.traffic.recycleAheadUnits },
    place(index) {
      return {
        u: (index + 0.37 * (index % 3)) / world.traffic.count,
        offset: new Vector3(lanes[index % lanes.length] ?? 0, DECK + 0.42, 0),
      };
    },
    make(index) {
      const car = createCar(index);
      car.userData.speedUnitsPerSecond = speeds[index];
      return car;
    },
    onUpdate(item, dt) {
      item.u += (Number(item.object.userData.speedUnitsPerSecond ?? 0) * dt) / railLength;
    },
  });
}

/**
 * Civilian traffic: two draws each, and all you really see is the tail lights.
 * They are modelled as slammed coupes on purpose — their roof line has to stay
 * below a rider's shoulders or the thing you are trying to shoot disappears
 * behind a parked-looking box at the worst possible moment.
 */
function createCar(index: number) {
  const group = new Group();
  const long = index % 4 === 0;
  const length = long ? 6.0 : 4.6;
  const bin = new PartBin();
  bin.add(new BoxGeometry(2.0, 0.62, length), hdr(STEEL, 0.6), { at: [0, -0.06, 0] });
  bin.add(new BoxGeometry(1.7, 0.44, length * 0.46), hdr(STEEL, 0.9), { at: [0, 0.36, long ? 0.6 : 0.2] });
  const body = solidMesh(bin.merge());
  body.name = 'traffic-car';

  const lights = new PartBin();
  for (const side of [-0.66, 0.66]) {
    lights.add(new PlaneGeometry(0.5, 0.18), hdr(TAILLIGHT, 2.6), { at: [side, 0.02, length * 0.5 + 0.02] });
  }
  lights.add(new PlaneGeometry(1.9, 0.055), hdr(TAILLIGHT, 1.5), { at: [0, 0.16, length * 0.5 + 0.02] });
  // Headlight spill on the tarmac ahead of them.
  lights.add(new PlaneGeometry(2.6, 6), hdr(HEADLIGHT, 0.1), {
    at: [0, -0.4, -length * 0.5 - 3.6],
    rotate: [-HALF_PI, 0, 0],
  });
  const glow = glowMesh(lights.merge());
  glow.userData.raildIgnoreOcclusion = true;

  group.add(body, glow);
  return group;
}

// --- sky --------------------------------------------------------------------

/**
 * A camera-following dome with a vertical gradient: black overhead falling into
 * the pink sodium haze the city throws up past the barriers. Fog is off for it
 * so the glow survives all the way to the horizon.
 */
function createSkyGlow() {
  const radius = world.fog.farUnits * 2.2;
  const segments = 28;
  const rings = [
    { y: -0.22, colour: hdr(CITY_GLOW, 0.55) },
    { y: 0.02, colour: hdr(CITY_GLOW, 0.9) },
    { y: 0.1, colour: hdr(NEON_PINK, 0.22) },
    { y: 0.34, colour: new Color(0.02, 0.015, 0.05) },
    { y: 1.0, colour: NIGHT.clone() },
  ];
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rings.length; r += 1) {
    for (let s = 0; s <= segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, rings[r].y * radius, Math.sin(angle) * radius);
      colours.push(rings[r].colour.r, rings[r].colour.g, rings[r].colour.b);
    }
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide, fog: false, depthWrite: false }),
  );
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

function lerpRange(range: readonly [number, number] | readonly number[], t: number) {
  return (range[0] ?? 0) + ((range[1] ?? 0) - (range[0] ?? 0)) * t;
}
