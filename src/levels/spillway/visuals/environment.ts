import { Color, Group, MathUtils, Scene, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { mulberry32 } from '../../../engine/rng';
import { walkerTrack, type WalkerPose } from '../rail';
import { BOSS_LOOP, DAM, GORGE_MOUTH_S, LIP_A, RAIL_KNOTS, SPINE, SUN_DIRECTION, TAILWATER, WATER_LEVEL, chuteFloor, damLocal, damPoint, headingVector, rightVector, spineAt } from '../route';
import { bar } from '../timing';
import { fbm2, lakeShore, nearestSpine, terrainSample, wallSkyVisibility } from '../world';
import { createDam, type DamModel } from './dam';
import { createBoulderGeometry, createFoliageMaterial, createInstancedField, createPineGeometry, createSnagGeometry, type Placement } from './flora';
import { createGorge, type LedgeSpot } from './gorge';
import { CONCRETE, FOLIAGE, GRANITE, PLACEHOLDER_YELLOW, SKY, STEEL, WATER } from './palette';
import { disposeNoiseVolume } from './noise';
import { createGraniteMaterial } from './rock';
import { createSky, type SkyRig } from './sky';
import { createSpray, type Spray } from './spray';
import { createFarRange, createTerrain } from './terrain';
import { createWalkerPlaceholder, type WalkerPlaceholder } from './walker-placeholder';
import { JET_REVEAL, createLake, createRiver, createRiverMaterial, createSpillwayWater, jetPoint, type Obstacle } from './water';

// The world of the run, assembled: sky and sun, the gorge, the terrain, the
// water, the dam and everything growing or lying on them. Placement and the
// breach choreography live here; the leaves only build what they are given.

export const BREACH_BAR = 58;
/** Height of the bleached band the drawn-down reservoir leaves on rock and concrete. */
const BATHTUB_HEIGHT = 9;
/** Seconds after the breach at which the flood crests the sill; it then accelerates down the chute. */
const FLOOD_DELAY = 0.45;

/** Haze by bar: clear on the upper pool, spray-laden in the gorge, mist lying on the reservoir, clean in the valley. */
const HAZE_KEYS: Array<[bar: number, density: number, falloff: number]> = [
  [0, 0.0003, 60], [8, 0.0006, 45], [20, 0.0012, 30], [23, 0.001, 36], [34, 0.001, 36],
  [37, 0.0009, 16], [42, 0.0006, 20], [45, 0.0005, 24], [58, 0.0006, 30], [62, 0.0004, 50], [66, 0.0003, 70],
];

export type Environment = {
  root: Group;
  sky: SkyRig;
  dam: DamModel;
  spray: Spray;
  walker: WalkerPlaceholder;
  /** Arc length of the spillway chute, gates to lip. */
  chuteLength: number;
  update(frame: { runTime: number; dt: number; camera: PerspectiveCamera }): void;
  dispose(): void;
};

type RiverBoulder = Obstacle & { s: number };

export function createEnvironment(scene: Scene, renderer: WebGPURenderer): Environment {
  const root = new Group();
  root.name = 'spillway-world';
  const rng = mulberry32(20260918);

  const sky = createSky(renderer, scene, { sunDirection: SUN_DIRECTION, sunIntensity: 4, shadowHalfSize: 220, shadowLead: 120 });

  // ---- rock ----
  const bathtub = { level: WATER_LEVEL, height: BATHTUB_HEIGHT, color: GRANITE.bleached };
  const granite = createGraniteMaterial({ colors: GRANITE, bathtub });
  granite.name = 'granite';
  const ground = createGraniteMaterial({
    colors: GRANITE,
    ground: { meadow: FOLIAGE.meadow, forestFloor: FOLIAGE.forestFloor, canopy: FOLIAGE.pine[2] },
    meadowBelow: TAILWATER + 25,
    joints: 'steep',
    bathtub,
  });
  ground.name = 'ground';
  const gorgeEnd = SPINE.findIndex((sample) => sample.s > GORGE_MOUTH_S + 200);
  const gorge = createGorge({ from: 0, to: gorgeEnd, ringStride: 2, chunkRings: 60, material: granite });
  root.add(gorge.group);

  const bounds = SPINE.reduce((box, sample) => ({
    minX: Math.min(box.minX, sample.x), maxX: Math.max(box.maxX, sample.x), minZ: Math.min(box.minZ, sample.z), maxZ: Math.max(box.maxZ, sample.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const margin = 1100;
  root.add(createTerrain({
    min: { x: bounds.minX - margin, z: bounds.minZ - margin },
    max: { x: bounds.maxX + margin, z: bounds.maxZ + margin },
    tileSize: 400,
    cells: [[300, 7], [700, 18], [Infinity, 40]],
    material: ground,
  }));
  const farRange = createFarRange({ radius: 2500, peak: new Color(0x7f93a8), base: SKY.haze, seed: 3.7 });
  root.add(farRange);

  // ---- boulders ----
  const riverBoulders: RiverBoulder[] = [];
  const bankBoulders: Placement[] = [];
  for (let s = 260; s < GORGE_MOUTH_S - 30; s += 6 + rng() * 14) {
    const sample = spineAt(s);
    if (rng() > sample.rapids * 0.9) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const lateral = side * (6 + rng() * Math.max(1, sample.halfWidth - 8));
    const radius = 1.1 + rng() * (1.4 + 1.6 * Math.abs(lateral) / sample.halfWidth);
    const position = new Vector3(sample.x, sample.y - radius * 0.3, sample.z).addScaledVector(rightVector(sample.heading), lateral);
    riverBoulders.push({ position, radius, s });
  }
  for (let s = -120; s < GORGE_MOUTH_S; s += 5 + rng() * 10) {
    const sample = spineAt(s);
    const side = rng() < 0.5 ? -1 : 1;
    const radius = 1.4 + rng() * 3.2;
    const lateral = side * (sample.halfWidth - 0.5 + rng() * 3.5);
    bankBoulders.push({ position: new Vector3(sample.x, sample.y + 0.3 - radius * 0.35, sample.z).addScaledVector(rightVector(sample.heading), lateral), scale: radius, yaw: rng() * 6.28 });
  }
  const boulderPlacements: Placement[] = [...riverBoulders.map((b) => ({ position: b.position, scale: b.radius, yaw: rng() * 6.28 })), ...bankBoulders];
  // One mesh: the granite shader is expensive to compile, and every InstancedMesh compiles its own.
  root.add(createInstancedField({
    geometry: createBoulderGeometry(17.3),
    material: granite,
    placements: boulderPlacements,
    groupOf: () => 0,
    castShadow: true,
    attributes: { waterY: (p) => waterLevelAt(p.position), sky: () => 0.55 },
  }));

  // ---- water ----
  const cascadeFrom = SPINE.find((sample) => sample.s > 900 && sample.y < -14)?.s ?? 0;
  const cascadeTo = SPINE.find((sample) => sample.s > cascadeFrom && sample.y < -37.5)?.s ?? cascadeFrom;
  const waterColors = { deep: WATER.deep, shallow: WATER.shallow, foam: WATER.foam };
  const riverWater = createRiverMaterial(waterColors);
  root.add(createRiver({ material: riverWater.material, obstacles: riverBoulders, cascades: [[cascadeFrom - 8, cascadeTo]] }));
  const lake = createLake({ colors: waterColors, from: damLocal(spineAt(GORGE_MOUTH_S - 20).x, spineAt(GORGE_MOUTH_S - 20).z).a - 60, halfWidth: 340 });
  root.add(lake.mesh);
  const spillwayWater = createSpillwayWater(waterColors, riverWater);
  root.add(spillwayWater.group);

  // ---- dam ----
  const dam = createDam({ concrete: CONCRETE.base, stain: CONCRETE.stain, wet: CONCRETE.wet, bleached: CONCRETE.bleached, gate: STEEL.gate, rust: STEEL.rust, rail: STEEL.rail }, BATHTUB_HEIGHT);
  root.add(dam.group);

  // ---- trees ----
  const foliage = createFoliageMaterial();
  // One pine geometry; the per-instance tint picks among the palette's greens and varies the shade.
  const pineGeometry = createPineGeometry(rng, FOLIAGE.pine[0], FOLIAGE.trunk);
  const pines: Placement[] = [];
  const tint = () => {
    const green = FOLIAGE.pine[Math.floor(rng() * FOLIAGE.pine.length)];
    const shade = 0.8 + rng() * 0.35;
    return new Color(green.r / FOLIAGE.pine[0].r, green.g / FOLIAGE.pine[0].g, green.b / FOLIAGE.pine[0].b).multiplyScalar(shade);
  };
  for (const spot of gorge.ledges) placeLedgePine(spot);
  function placeLedgePine(spot: LedgeSpot) {
    if (spot.kind === 'ledge') {
      if (rng() < 0.3) pines.push({ position: spot.position.clone(), scale: 0.4 + rng() * 0.45, yaw: rng() * 6.28, tint: tint(), lean: (rng() - 0.5) * 0.3 });
      return;
    }
    const sample = spineAt(spot.s);
    const outward = rightVector(sample.heading).multiplyScalar(spot.side);
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const position = spot.position.clone().addScaledVector(outward, -2 + rng() * 26).addScaledVector(headingVector(sample.heading), (rng() - 0.5) * 8);
      position.y += 1.2 + rng() * 1.4;
      pines.push({ position, scale: 0.6 + rng() * 0.7, yaw: rng() * 6.28, tint: tint() });
    }
  }
  scatterForest(pines, bounds, rng, tint);
  root.add(createInstancedField({ geometry: pineGeometry, material: foliage, placements: pines, groupOf: routeBand, castShadow: true }));

  const mouthA = damLocal(spineAt(GORGE_MOUTH_S).x, spineAt(GORGE_MOUTH_S).z).a;
  const lakeKnots = RAIL_KNOTS.filter((knot) => damLocal(knot.x, knot.z).a > mouthA - 40 && damLocal(knot.x, knot.z).a < 0);
  const railDistance = (position: Vector3) => Math.min(...lakeKnots.map((knot) => Math.hypot(knot.x - position.x, knot.z - position.z)));
  const snags: Placement[] = [];
  for (let i = 0; i < 600 && snags.length < 110; i += 1) {
    const a = MathUtils.lerp(mouthA + 20, BOSS_LOOP.a - 40, rng());
    const shore = lakeShore(a);
    const l = (rng() * 2 - 1) * (shore - 16);
    const position = damPoint(a, l, -4 - rng() * 3);
    // Clear of the rail: its line down the lake and the boss loop in front of the dam.
    if (railDistance(position) < 40 + rng() * 30) continue;
    if (Math.hypot(a - BOSS_LOOP.a, l - BOSS_LOOP.l) < BOSS_LOOP.radius + 52) continue;
    snags.push({ position, scale: 0.55 + rng() * 0.6, yaw: rng() * 6.28, lean: (rng() - 0.5) * 0.4 });
  }
  // The drowned forest left standing on the mud flats the drawdown has exposed.
  for (let i = 0; i < 5000 && snags.length < 260; i += 1) {
    const a = MathUtils.lerp(mouthA - 40, BOSS_LOOP.a + 60, rng());
    const side = rng() < 0.5 ? -1 : 1;
    const l = side * (lakeShore(a, side) + rng() * 40);
    const position = damPoint(a, l, 0);
    const ground = terrainSample(position.x, position.z).height;
    if (ground < WATER_LEVEL + 0.3 || ground > WATER_LEVEL + BATHTUB_HEIGHT - 1) continue;
    position.y = ground - 0.3;
    snags.push({ position, scale: rng() < 0.6 ? 0.2 + rng() * 0.15 : 0.45 + rng() * 0.4, yaw: rng() * 6.28, lean: (rng() - 0.5) * 0.5 });
  }
  root.add(createInstancedField({ geometry: createSnagGeometry(rng, FOLIAGE.snag), material: foliage, placements: snags, groupOf: routeBand, castShadow: true }));

  // ---- spray and the walker stand-in ----
  const spray = createSpray(renderer, { sprayCapacity: 24000, mistCapacity: 700 });
  root.add(...spray.objects);
  const walker = createWalkerPlaceholder(PLACEHOLDER_YELLOW);
  root.add(walker.group);
  scene.add(root);

  // ---- per-frame ----
  const pose: WalkerPose = walkerTrack(0);
  const scratch = new Vector3();
  const line = new Vector3();
  const direction = new Vector3();
  const cascadeFoot = spineAt(cascadeTo + 4);
  const cascadeFootPoint = new Vector3(cascadeFoot.x, cascadeFoot.y + 0.4, cascadeFoot.z);
  const cascadeLine = rightVector(cascadeFoot.heading).multiplyScalar(cascadeFoot.halfWidth * 0.9);
  const downstream = DAM.axis;
  const chuteLine = DAM.right.clone().multiplyScalar(DAM.chuteHalfWidth * 0.9);
  const lipPoint = damPoint(LIP_A, 0, jetPoint(0).y);
  const landing = (() => {
    let t = 0;
    while (jetPoint(t).y > TAILWATER - WATER_LEVEL && t < 10) t += 0.05;
    return damPoint(jetPoint(t).a, 0, TAILWATER - WATER_LEVEL + 0.5);
  })();
  let hazeFloor = 0;
  let lastBreach = -1;
  let lastRunTime = 0;

  return {
    root,
    sky,
    dam,
    spray,
    walker,
    chuteLength: spillwayWater.chuteLength,
    update({ runTime, dt, camera }) {
      if (runTime < lastRunTime - 0.5) spray.reset();
      lastRunTime = runTime;
      sky.follow(camera);
      farRange.position.set(camera.position.x, -90, camera.position.z);

      // Haze follows the section, and its floor follows the water under the camera.
      const here = nearestSpine(camera.position.x, camera.position.z).sample;
      const water = here.kind === 'lake' && damLocal(camera.position.x, camera.position.z).a > 30 ? TAILWATER : here.y;
      hazeFloor = dt > 0 ? MathUtils.lerp(hazeFloor, water, 1 - Math.exp(-dt * 2)) : water;
      const [density, falloff] = hazeAt(runTime);
      sky.haze.uniforms.density.value = density;
      sky.haze.uniforms.falloffHeight.value = falloff;
      sky.haze.uniforms.floorHeight.value = hazeFloor;
      const walls = here.kind === 'river' && here.s < GORGE_MOUTH_S ? here.wall : 0;
      spray.light.value = MathUtils.lerp(spray.light.value, 0.45 + 0.55 * wallSkyVisibility(here, 30, walls), dt > 0 ? 1 - Math.exp(-dt * 1.5) : 1);

      // The walker stand-in and its splashes.
      walkerTrack(runTime, pose);
      walker.update(pose);
      for (const foot of walker.landed) {
        spray.spray({ at: foot.setY(waterLevelAt(foot) + 0.5), count: 110, speed: 10, spread: 0.7, life: 1.6, size: 1.6, radius: 2.5 });
        spray.mist({ at: foot, count: 2, size: 26, life: 6, radius: 4 });
      }

      // The breach: gates burst on the bar, the lake slides, the flood runs the chute and leaps the lip.
      const breach = runTime - bar(BREACH_BAR);
      dam.updateBreach(runTime > 0 ? breach : -1);
      // Fully drawn down by the time the camera reaches the gates: the flood tongue is shaped to meet it.
      lake.breach.value = MathUtils.smoothstep(breach, 0, bar(1));
      const floodTime = breach - FLOOD_DELAY;
      const front = floodTime > 0 ? 9 * floodTime + 12 * floodTime * floodTime : -100;
      spillwayWater.floodFront.value = front;
      const jetDrawn = MathUtils.clamp((front - spillwayWater.chuteLength) / JET_REVEAL, 0, 1);
      spillwayWater.surge.value = MathUtils.smoothstep(front - spillwayWater.chuteLength, 30, 160);
      if (runTime > 0) {
        for (let i = 0; i < DAM.gateCount; i += 1) {
          const burst = [2, 1, 3, 0, 4].indexOf(i) * 0.14;
          if (lastBreach < burst && breach >= burst) {
            damPoint(0, (i - (DAM.gateCount - 1) / 2) * (DAM.gateWidth + DAM.pierWidth), -2, scratch);
            spray.spray({ at: scratch, count: 1100, direction: direction.copy(downstream).setY(0.5), speed: 20, spread: 0.3, life: 1.8, size: 1.3, line: line.copy(DAM.right).multiplyScalar(7), radius: 1.5 });
            spray.mist({ at: scratch, count: 3, size: 30, life: 6, radius: 8 });
          }
        }
      }
      lastBreach = runTime > 0 ? breach : -1;
      if (dt <= 0) return;

      // Water bursting through each torn-open bay: sheets thrown out over the sill, arcing down onto the ogee.
      if (runTime > 0 && breach > 0 && breach < 3.5) {
        for (let i = 0; i < DAM.gateCount; i += 1) {
          const t = breach - [2, 1, 3, 0, 4].indexOf(i) * 0.14;
          if (t < 0 || t > 3) continue;
          const strength = Math.min(1, t * 4) * (1 - MathUtils.smoothstep(t, 1.8, 3));
          damPoint(-1, (i - (DAM.gateCount - 1) / 2) * (DAM.gateWidth + DAM.pierWidth), DAM.sillHeight + 8 * (1 - t / 3), scratch);
          spray.spray({ at: scratch, count: dt * 4200 * strength, direction: direction.copy(downstream).setY(0.22), speed: 26, spread: 0.07, life: 1.5, size: 1.1, line: line.copy(DAM.right).multiplyScalar(DAM.gateWidth * 0.45), radius: 0.6, color: 0xe8f0ee });
        }
      }
      if (front > 0 && front < spillwayWater.chuteLength) {
        const a = frontAxial(front);
        damPoint(a, 0, chuteFloor(a) + 3, scratch);
        spray.spray({ at: scratch, count: dt * 1600, direction: direction.copy(downstream).negate().setY(1.4), speed: 9, spread: 0.6, life: 1.4, size: 2, line: chuteLine });
      }
      // Riding the flood: spray peeling off both training walls ahead of the camera.
      if (here.kind === 'chute' && front > 0) {
        const cameraA = damLocal(camera.position.x, camera.position.z).a;
        for (const side of [-1, 1]) {
          const a = cameraA + 12 + Math.random() * 50;
          if (a > LIP_A) continue;
          const halfWidth = MathUtils.clamp(DAM.spillwayHalfWidth - (a / 40) * (DAM.spillwayHalfWidth - DAM.chuteHalfWidth), DAM.chuteHalfWidth, DAM.spillwayHalfWidth);
          damPoint(a, side * (halfWidth - 1.5), chuteFloor(a) + 4, scratch);
          spray.spray({ at: scratch, count: dt * 900, direction: direction.copy(DAM.right).multiplyScalar(-side * 0.6).add(downstream).setY(1.2), speed: 11, spread: 0.35, life: 1.1, size: 0.7, line: line.copy(downstream).multiplyScalar(6) });
        }
      }
      if (front > spillwayWater.chuteLength) {
        spray.spray({ at: lipPoint, count: dt * 2400, direction: direction.copy(downstream).setY(0.55), speed: 24, spread: 0.18, life: 1.9, size: 1.1, line: chuteLine });
        if (jetDrawn >= 1) {
          spray.spray({ at: landing, count: dt * 1300, direction: direction.set(0, 1, 0).addScaledVector(downstream, 0.4), speed: 14, spread: 0.8, life: 2.4, size: 3.2, line: chuteLine });
          spray.mist({ at: landing, count: dt * 8, size: 60, life: 9, radius: 30 });
        }
      }

      // Rapids: spray off the boulders and standing waves ahead of the camera.
      const cameraS = here.kind === 'river' ? here.s : -Infinity;
      if (cameraS > -Infinity) {
        for (const boulder of riverBoulders) {
          if (boulder.s < cameraS + 15 || boulder.s > cameraS + 200) continue;
          spray.spray({ at: scratch.copy(boulder.position).setY(waterLevelAt(boulder.position) + 0.3), count: dt * 45 * boulder.radius, speed: 5, spread: 0.6, life: 1, size: 0.9, radius: boulder.radius * 0.8 });
        }
        for (let k = 0; k < 3; k += 1) {
          const sample = spineAt(cameraS + 25 + Math.random() * 190);
          if (sample.kind !== 'river' || sample.rapids < 0.3) continue;
          const across = rightVector(sample.heading, line).multiplyScalar(sample.halfWidth * (Math.random() * 1.6 - 0.8));
          scratch.set(sample.x, sample.y + 0.4, sample.z).add(across);
          spray.spray({ at: scratch, count: dt * 120 * sample.rapids, direction: direction.copy(headingVector(sample.heading)).setY(1.6), speed: 4.5, spread: 0.5, life: 1, size: 1, line: rightVector(sample.heading, across).multiplyScalar(3) });
        }
        if (cascadeFootPoint.distanceTo(camera.position) < 420) {
          spray.spray({ at: cascadeFootPoint, count: dt * 900, direction: direction.copy(headingVector(cascadeFoot.heading)).setY(1.8), speed: 9, spread: 0.6, life: 1.6, size: 0.6, line: cascadeLine });
          // A plume rising from the plunge pool: it shows where the river drops out of sight before you reach the lip.
          spray.mist({ at: cascadeFootPoint, count: dt * 11, size: 40, life: 7, radius: 10, line: cascadeLine, direction: direction.set(0, 1, 0), speed: 3, spread: 0.3 });
        }
        if (here.rapids > 0.2) {
          const sample = spineAt(cameraS + 60 + Math.random() * 200);
          spray.mist({ at: scratch.set(sample.x, sample.y + 3, sample.z), count: dt * 1.5 * here.rapids, size: 22, life: 7, radius: sample.halfWidth * 0.7 });
        }
      }
      // Mist lying on the reservoir until the breach stirs it.
      if (here.kind === 'lake' && breach < 1) {
        camera.getWorldDirection(direction).setY(0).normalize();
        const distance = 60 + Math.random() * 380;
        scratch.copy(camera.position).addScaledVector(direction, distance).addScaledVector(line.set(-direction.z, 0, direction.x), (Math.random() - 0.5) * distance * 1.2);
        scratch.y = WATER_LEVEL + 2 + Math.random() * 4;
        if (Math.abs(damLocal(scratch.x, scratch.z).a) > 12 || damLocal(scratch.x, scratch.z).a < 0) spray.mist({ at: scratch, count: dt * 5, size: 55, life: 14, radius: 20 });
      }
      spray.update(dt);
    },
    dispose() {
      sky.dispose();
      spray.dispose();
      disposeNoiseVolume();
      root.removeFromParent();
    },
  };
}

/** Instanced placements are grouped into bands along the route: a handful of meshes, each culled as a whole. */
const ROUTE_BAND = 1500;
const routeBand = (placement: Placement) => Math.floor(nearestSpine(placement.position.x, placement.position.z).sample.s / ROUTE_BAND);

function hazeAt(runTime: number): [number, number] {
  const b = runTime / bar(1);
  for (let i = 1; i < HAZE_KEYS.length; i += 1) {
    const [b1, d1, f1] = HAZE_KEYS[i];
    if (b <= b1) {
      const [b0, d0, f0] = HAZE_KEYS[i - 1];
      const t = MathUtils.smoothstep(b, b0, b1);
      return [MathUtils.lerp(d0, d1, t), MathUtils.lerp(f0, f1, t)];
    }
  }
  const last = HAZE_KEYS[HAZE_KEYS.length - 1];
  return [last[1], last[2]];
}

function waterLevelAt(position: Vector3) {
  return terrainSample(position.x, position.z).waterY;
}

/** Axial position of the flood front `front` units of arc down the chute. */
function frontAxial(front: number) {
  // The chute averages a 35° slope below the ogee; near enough for placing spray.
  return front < 20 ? front - 6 : 14 + (front - 20) * 0.82;
}

/** Pines on the terrain: forest where a slow noise says so, thinning on steep ground and near the water. */
function scatterForest(pines: Placement[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, rng: () => number, tint: () => Color) {
  const spacing = 17;
  const reach = 520;
  for (let x = bounds.minX - reach; x < bounds.maxX + reach; x += spacing) {
    for (let z = bounds.minZ - reach; z < bounds.maxZ + reach; z += spacing) {
      const px = x + (rng() - 0.5) * spacing;
      const pz = z + (rng() - 0.5) * spacing;
      const forest = fbm2(px / 260, pz / 260, 3);
      if (forest < -0.05 + rng() * 0.3) continue;
      const hit = nearestSpine(px, pz);
      if (hit.distance > reach) continue;
      const { a, l } = damLocal(px, pz);
      if (a > -60 && a < LIP_A + 60 && Math.abs(l) < DAM.halfSpan + 20) continue;
      const sample = terrainSample(px, pz);
      if (sample.buried || sample.height < sample.waterY + 2.5) continue;
      const h = sample.height;
      const slope = Math.abs(terrainSample(px + 4, pz).height - h) + Math.abs(terrainSample(px, pz + 4).height - h);
      if (slope > 5.5) continue;
      pines.push({ position: new Vector3(px, h - 0.4, pz), scale: 0.65 + rng() * 0.75 + Math.max(0, forest) * 0.4, yaw: rng() * 6.28, tint: tint() });
    }
  }
}
