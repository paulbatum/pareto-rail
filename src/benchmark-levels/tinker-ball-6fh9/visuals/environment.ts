import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';
import { offsetFromRail } from '../../../engine/rail';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createTinkerRail, SPILL_ANCHOR_U } from '../gameplay';
import { bakeShaded } from './bake';
import {
  BUTTON_RED,
  CARDBOARD,
  CLIP_SILVER,
  COBALT,
  CRAFT_CYCLE,
  CREAM,
  ERASER_PINK,
  GLUE_BLACK,
  GLUE_SHEEN,
  hdr,
  LAMP_CREAM,
  MUSTARD,
  PENCIL_YELLOW,
  ROOM_DARK,
  SPOOL_PLUM,
  TEAL,
  WOOD,
  WOOD_DARK,
} from './palette';

// The worktable world: one huge wooden surface under a desk lamp, with the
// route drawn as pale scratches. Scenery grows with the run — buttons and
// pins near the start, spools and erasers mid-table, rulers and jars by the
// end — and everything static is baked into a handful of merged meshes to
// stay far under the draw-call budget.

const UP = new Vector3(0, 1, 0);
const DUST_COUNT = 110;

export type Environment = ReturnType<typeof createEnvironmentInternal>;

export function createEnvironmentInternal(scene: Scene) {
  const rng = mulberry32(20260725);
  const curve = createTinkerRail();
  const root = new Group();
  scene.add(root);

  scene.background = ROOM_DARK.clone();
  scene.fog = new FogExp2(ROOM_DARK.clone(), 0.0128);

  // ---- table -------------------------------------------------------------
  const table = new Mesh(
    new PlaneGeometry(1500, 1200),
    new MeshBasicMaterial({ color: WOOD.clone().multiplyScalar(0.6) }),
  );
  table.name = 'tinker-table';
  table.rotation.x = -Math.PI / 2;
  table.position.set(0, -0.02, -200);
  root.add(table);

  const spillCenter = offsetFromRail(curve, SPILL_ANCHOR_U, new Vector3(0, 0, 0));
  spillCenter.y = 0;
  const lampFoot = spillCenter.clone().add(new Vector3(16, 0, -6));

  // ---- baked static scenery ----------------------------------------------
  const parts: BufferGeometry[] = [];

  bakeGrain(parts, rng);
  bakeScratchRoad(parts, curve, rng);
  bakeSmallSupplies(parts, curve, rng);
  bakeMediumSupplies(parts, curve, rng);
  bakeLargeSupplies(parts, curve, rng, spillCenter);
  bakeLandmarks(parts, curve, rng, lampFoot);

  const staticMerged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const staticMesh = new Mesh(staticMerged, new MeshBasicMaterial({ vertexColors: true }));
  staticMesh.name = 'tinker-scenery';
  root.add(staticMesh);

  // ---- lamp bulb + light pools -------------------------------------------
  const bulbMaterial = createAdditiveBasicMaterial({ color: hdr(LAMP_CREAM, 1.1), opacity: 0.95 });
  const bulb = new Mesh(new SphereGeometry(2.6, 14, 10), bulbMaterial);
  bulb.position.set(lampFoot.x - 9.5, 30.5, lampFoot.z);
  bulb.scale.set(1, 0.65, 1);
  root.add(bulb);

  const pools: BufferGeometry[] = [];
  const poolSpots: Array<[number, number]> = [
    [0.02, 26], [0.2, 30], [0.42, 32], [0.66, 34],
  ];
  for (const [u, radius] of poolSpots) {
    const center = offsetFromRail(curve, u, new Vector3(0, 0, 0));
    const pool = new CircleGeometry(radius, 30);
    pool.rotateX(-Math.PI / 2);
    pool.translate(center.x, 0.01, center.z);
    pools.push(pool);
  }
  // The big pool under the lamp, centered on the spill and the clean patch.
  const lampPool = new CircleGeometry(46, 36);
  lampPool.rotateX(-Math.PI / 2);
  lampPool.translate(spillCenter.x - 4, 0.012, spillCenter.z - 2);
  pools.push(lampPool);
  const poolMesh = new Mesh(
    mergeGeometries(pools),
    createAdditiveBasicMaterial({ color: LAMP_CREAM.clone().multiplyScalar(0.035), opacity: 1 }),
  );
  for (const pool of pools) pool.dispose();
  root.add(poolMesh);

  // ---- the clean patch ---------------------------------------------------
  // The one spotless stretch of table, just past the spill: the finale coast.
  const patchCenter = offsetFromRail(curve, Math.min(1, SPILL_ANCHOR_U + 0.007), new Vector3(0, 0, 0));
  const cleanPatch = new Mesh(
    new CircleGeometry(11, 26),
    new MeshBasicMaterial({ color: WOOD.clone().multiplyScalar(1.5) }),
  );
  cleanPatch.name = 'clean-patch';
  cleanPatch.rotation.x = -Math.PI / 2;
  cleanPatch.position.set(patchCenter.x, 0.02, patchCenter.z);
  cleanPatch.scale.set(1, 1.6, 1);
  root.add(cleanPatch);
  const patchGlowMaterial = createAdditiveBasicMaterial({ color: LAMP_CREAM.clone().multiplyScalar(0.07), opacity: 1 });
  const patchGlow = new Mesh(new CircleGeometry(12.5, 26), patchGlowMaterial);
  patchGlow.rotation.x = -Math.PI / 2;
  patchGlow.position.set(patchCenter.x, 0.025, patchCenter.z);
  patchGlow.scale.set(1, 1.6, 1);
  root.add(patchGlow);

  // ---- the spill blob ----------------------------------------------------
  const spill = createSpillBlob(spillCenter, rng);
  root.add(spill.root);

  // ---- dust in the lamp light --------------------------------------------
  const dust = createDust(curve, rng);
  root.add(dust.mesh);

  return {
    root,
    curve,
    spillCenter,
    bulbMaterial,
    patchGlowMaterial,
    spill,
    dust,
    dispose() {
      scene.remove(root);
    },
  };
}

// ---- static bakes ----------------------------------------------------------

function bakeGrain(parts: BufferGeometry[], rng: () => number) {
  const grain = new BoxGeometry(1, 0.012, 1);
  for (let i = 0; i < 46; i += 1) {
    const x = (rng() - 0.5) * 320;
    const z = -rng() * 460 + 20;
    const length = 26 + rng() * 60;
    const width = 0.5 + rng() * 1.1;
    const matrix = new Matrix4().compose(
      new Vector3(x, 0.004, z),
      new Quaternion().setFromAxisAngle(UP, (rng() - 0.5) * 0.12),
      new Vector3(width, 1, length),
    );
    bakeShaded(parts, grain, matrix, WOOD_DARK.clone().multiplyScalar(0.85 + rng() * 0.3), { topBoost: 1, sideDim: 1, bottomDim: 1 });
  }
  grain.dispose();
}

// The route itself: pale scratch grooves worn into the tabletop, so the rail
// reads as a road the ball has carved on earlier laps.
function bakeScratchRoad(parts: BufferGeometry[], curve: ReturnType<typeof createTinkerRail>, rng: () => number) {
  const samples = 200;
  const quad = new BoxGeometry(1, 0.008, 1);
  const bright = WOOD.clone().multiplyScalar(1.45);
  const previous = new Vector3();
  const current = new Vector3();
  for (let lane = 0; lane < 3; lane += 1) {
    const lateral = [-0.75, 0, 0.8][lane];
    for (let i = 0; i < samples; i += 1) {
      if (lane === 1 && i % 3 === 0) continue; // center groove is broken
      const u0 = i / samples;
      const u1 = (i + 1) / samples;
      previous.copy(offsetFromRail(curve, u0, new Vector3(lateral + (rng() - 0.5) * 0.3, 0, 0)));
      current.copy(offsetFromRail(curve, u1, new Vector3(lateral + (rng() - 0.5) * 0.3, 0, 0)));
      previous.y = 0;
      current.y = 0;
      const mid = previous.clone().add(current).multiplyScalar(0.5);
      mid.y = 0.012;
      const direction = current.clone().sub(previous);
      const length = direction.length();
      if (length < 0.001) continue;
      const rotation = new Quaternion().setFromAxisAngle(UP, Math.atan2(direction.x, direction.z));
      const matrix = new Matrix4().compose(mid, rotation, new Vector3(0.14 + rng() * 0.1, 1, length * 1.15));
      bakeShaded(parts, quad, matrix, bright.clone().multiplyScalar(0.85 + rng() * 0.3), { topBoost: 1, sideDim: 1, bottomDim: 1 });
    }
  }
  quad.dispose();
}

// The route doubles back on itself, so lateral clearance from one rail point
// does not guarantee clearance from the whole road. Placement rejects spots
// too close to any sample of the route polyline.
let routeSamples: Vector3[] | null = null;

function routeClearanceAt(curve: ReturnType<typeof createTinkerRail>, spot: Vector3): number {
  if (!routeSamples) {
    routeSamples = [];
    for (let i = 0; i <= 160; i += 1) {
      const sample = curve.getPointAt(i / 160);
      sample.y = 0;
      routeSamples.push(sample);
    }
  }
  let best = Infinity;
  for (const sample of routeSamples) {
    const dx = sample.x - spot.x;
    const dz = sample.z - spot.z;
    const distance = dx * dx + dz * dz;
    if (distance < best) best = distance;
  }
  return Math.sqrt(best);
}

function scatterSpot(
  curve: ReturnType<typeof createTinkerRail>,
  rng: () => number,
  uMin: number,
  uMax: number,
  minLateral: number,
  maxLateral: number,
): Vector3 {
  const clearance = Math.min(minLateral, 12);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const u = uMin + rng() * (uMax - uMin);
    const side = rng() < 0.5 ? -1 : 1;
    const lateral = side * (minLateral + rng() * (maxLateral - minLateral));
    const spot = offsetFromRail(curve, u, new Vector3(lateral, 0, (rng() - 0.5) * 8));
    spot.y = 0;
    if (routeClearanceAt(curve, spot) >= clearance) return spot;
  }
  // Give up gracefully: park it far off to the side of the route start.
  const fallback = offsetFromRail(curve, rng() * 0.2, new Vector3((rng() < 0.5 ? -1 : 1) * (maxLateral + 10), 0, 0));
  fallback.y = 0;
  return fallback;
}

function yaw(rng: () => number): Quaternion {
  return new Quaternion().setFromAxisAngle(UP, rng() * Math.PI * 2);
}

function craft(rng: () => number): Color {
  return CRAFT_CYCLE[Math.floor(rng() * CRAFT_CYCLE.length)].clone();
}

// Marble scale: buttons, beads, pins, and paperclips litter the opening third.
function bakeSmallSupplies(parts: BufferGeometry[], curve: ReturnType<typeof createTinkerRail>, rng: () => number) {
  const button = new CylinderGeometry(1, 0.94, 0.3, 14);
  const bead = new SphereGeometry(0.5, 10, 8);
  const pinShaft = new CylinderGeometry(0.045, 0.02, 1, 6);
  const pinHead = new SphereGeometry(0.16, 8, 6);
  const clip = new TorusGeometry(0.5, 0.06, 6, 14, Math.PI * 1.6);

  for (let i = 0; i < 26; i += 1) {
    const spot = scatterSpot(curve, rng, 0.0, 0.4, 4.5, 42);
    const radius = 0.6 + rng() * 0.5;
    const matrix = new Matrix4().compose(spot.setY(0.15 * radius), yaw(rng), new Vector3(radius, radius, radius));
    bakeShaded(parts, button, matrix, craft(rng));
  }
  for (let i = 0; i < 18; i += 1) {
    const spot = scatterSpot(curve, rng, 0.0, 0.42, 4.2, 40);
    const radius = 0.45 + rng() * 0.4;
    bakeShaded(parts, bead, new Matrix4().compose(spot.setY(radius * 0.5), yaw(rng), new Vector3(radius, radius, radius)), craft(rng), { topBoost: 1.45 });
  }
  for (let i = 0; i < 14; i += 1) {
    const spot = scatterSpot(curve, rng, 0.0, 0.4, 4, 38);
    const length = 2.4 + rng() * 1.6;
    const rotation = yaw(rng).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    bakeShaded(parts, pinShaft, new Matrix4().compose(spot.clone().setY(0.1), rotation, new Vector3(length * 0.5, length, length * 0.5)), CLIP_SILVER);
    bakeShaded(parts, pinHead, new Matrix4().compose(spot.clone().add(new Vector3(0, 0.16, 0)), yaw(rng), new Vector3(1, 1, 1).multiplyScalar(length * 0.16)), craft(rng), { topBoost: 1.4 });
  }
  for (let i = 0; i < 12; i += 1) {
    const spot = scatterSpot(curve, rng, 0.02, 0.44, 3.5, 36);
    const size = 1.4 + rng() * 1.2;
    const rotation = yaw(rng).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
    bakeShaded(parts, clip, new Matrix4().compose(spot.setY(0.1), rotation, new Vector3(size, size, size)), CLIP_SILVER.clone().multiplyScalar(0.85 + rng() * 0.35));
  }
  button.dispose();
  bead.dispose();
  pinShaft.dispose();
  pinHead.dispose();
  clip.dispose();
}

// Tennis-ball scale: spools, erasers, paint pots, and wooden blocks mid-lap.
function bakeMediumSupplies(parts: BufferGeometry[], curve: ReturnType<typeof createTinkerRail>, rng: () => number) {
  const waist = new CylinderGeometry(0.68, 0.68, 0.72, 12);
  const flange = new CylinderGeometry(1, 1, 0.16, 14);
  const eraserBody = new BoxGeometry(1, 0.34, 0.5);
  const potBody = new CylinderGeometry(0.9, 1, 1.3, 12);
  const potTop = new CylinderGeometry(0.78, 0.78, 0.14, 12);
  const block = new BoxGeometry(1, 1, 1);

  for (let i = 0; i < 12; i += 1) {
    const spot = scatterSpot(curve, rng, 0.3, 0.68, 13, 42);
    const scale = 1.6 + rng() * 1.2;
    const rotation = yaw(rng);
    const threadColor = craft(rng);
    bakeShaded(parts, waist, new Matrix4().compose(spot.clone().setY(scale * 0.5), rotation, new Vector3(scale, scale * 0.72, scale)), threadColor);
    bakeShaded(parts, flange, new Matrix4().compose(spot.clone().setY(scale * 0.1), rotation, new Vector3(scale, scale * 0.5, scale)), CREAM.clone().multiplyScalar(0.9));
    bakeShaded(parts, flange, new Matrix4().compose(spot.clone().setY(scale * 0.92), rotation, new Vector3(scale, scale * 0.5, scale)), CREAM.clone().multiplyScalar(0.95));
  }
  for (let i = 0; i < 10; i += 1) {
    const spot = scatterSpot(curve, rng, 0.32, 0.7, 9, 38);
    const scale = 2.2 + rng() * 1.4;
    bakeShaded(parts, eraserBody, new Matrix4().compose(spot.setY(scale * 0.17), yaw(rng), new Vector3(scale, scale, scale)), rng() < 0.6 ? ERASER_PINK.clone() : CREAM.clone());
  }
  for (let i = 0; i < 8; i += 1) {
    const spot = scatterSpot(curve, rng, 0.34, 0.7, 13, 38);
    const scale = 1.5 + rng() * 0.9;
    const rotation = yaw(rng);
    const paint = craft(rng);
    bakeShaded(parts, potBody, new Matrix4().compose(spot.clone().setY(scale * 0.65), rotation, new Vector3(scale, scale, scale)), CREAM.clone().multiplyScalar(0.82));
    bakeShaded(parts, potTop, new Matrix4().compose(spot.clone().setY(scale * 1.34), rotation, new Vector3(scale, scale, scale)), paint.multiplyScalar(1.25), { topBoost: 1.5 });
  }
  for (let i = 0; i < 10; i += 1) {
    const spot = scatterSpot(curve, rng, 0.3, 0.72, 13, 44);
    const scale = 1.7 + rng() * 1.3;
    bakeShaded(parts, block, new Matrix4().compose(spot.setY(scale * 0.5), yaw(rng), new Vector3(scale, scale, scale)), craft(rng));
  }
  waist.dispose();
  flange.dispose();
  eraserBody.dispose();
  potBody.dispose();
  potTop.dispose();
  block.dispose();
}

// Melon scale: rulers, jars, cardboard, and long pencils near the spill.
function bakeLargeSupplies(
  parts: BufferGeometry[],
  curve: ReturnType<typeof createTinkerRail>,
  rng: () => number,
  spillCenter: Vector3,
) {
  const rulerBody = new BoxGeometry(1, 0.045, 0.115);
  const pencilBody = new CylinderGeometry(0.045, 0.045, 0.8, 6);
  const pencilTip = new ConeGeometry(0.045, 0.08, 6);
  const jarBody = new CylinderGeometry(1, 1, 2.1, 14);
  const jarLid = new CylinderGeometry(1.06, 1.06, 0.3, 14);
  const card = new BoxGeometry(1, 0.05, 0.72);

  for (let i = 0; i < 8; i += 1) {
    const spot = scatterSpot(curve, rng, 0.62, 0.95, 7, 40);
    if (spot.distanceTo(spillCenter) < 22) continue;
    const length = 11 + rng() * 7;
    bakeShaded(parts, rulerBody, new Matrix4().compose(spot.setY(0.26), yaw(rng), new Vector3(length, 8, length * 0.14)), rng() < 0.5 ? MUSTARD.clone() : CREAM.clone());
  }
  for (let i = 0; i < 9; i += 1) {
    const spot = scatterSpot(curve, rng, 0.55, 0.96, 5.5, 38);
    if (spot.distanceTo(spillCenter) < 20) continue;
    const length = 9 + rng() * 5;
    const rotation = yaw(rng).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    bakeShaded(parts, pencilBody, new Matrix4().compose(spot.clone().setY(0.4), rotation, new Vector3(length * 0.12, length, length * 0.12)), PENCIL_YELLOW.clone().multiplyScalar(0.85 + rng() * 0.3));
  }
  for (let i = 0; i < 6; i += 1) {
    const spot = scatterSpot(curve, rng, 0.6, 0.94, 17, 44);
    if (spot.distanceTo(spillCenter) < 24) continue;
    const scale = 2.6 + rng() * 1.6;
    const rotation = yaw(rng);
    bakeShaded(parts, jarBody, new Matrix4().compose(spot.clone().setY(scale * 1.05), rotation, new Vector3(scale, scale, scale)), new Color(0.55, 0.62, 0.62), { topBoost: 1.35, sideDim: 0.85 });
    bakeShaded(parts, jarLid, new Matrix4().compose(spot.clone().setY(scale * 2.25), rotation, new Vector3(scale, scale, scale)), rng() < 0.5 ? BUTTON_RED.clone() : TEAL.clone());
  }
  for (let i = 0; i < 8; i += 1) {
    const spot = scatterSpot(curve, rng, 0.58, 0.96, 9, 40);
    if (spot.distanceTo(spillCenter) < 18) continue;
    const scale = 5 + rng() * 5;
    bakeShaded(parts, card, new Matrix4().compose(spot.setY(0.3 + rng() * 0.5), yaw(rng).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (rng() - 0.5) * 0.5)), new Vector3(scale, 6, scale)), CARDBOARD.clone().multiplyScalar(0.85 + rng() * 0.3));
  }
  rulerBody.dispose();
  pencilBody.dispose();
  pencilTip.dispose();
  jarBody.dispose();
  jarLid.dispose();
  card.dispose();
}

// Landmarks: the mug on the mid-lap arc, book stacks off in the gloom, a
// pencil cup, and the desk lamp leaning in over the spill.
function bakeLandmarks(
  parts: BufferGeometry[],
  curve: ReturnType<typeof createTinkerRail>,
  rng: () => number,
  lampFoot: Vector3,
) {
  const cylinder = new CylinderGeometry(1, 1, 1, 20);
  const box = new BoxGeometry(1, 1, 1);
  const handle = new TorusGeometry(1, 0.22, 8, 16, Math.PI * 1.2);
  const cone = new ConeGeometry(1, 1, 20, 1, true);

  // The mug: the act-2 arc swings around it.
  const mugSpot = offsetFromRail(curve, 0.52, new Vector3(26, 0, 0));
  mugSpot.y = 0;
  bakeShaded(parts, cylinder, new Matrix4().compose(mugSpot.clone().setY(9), new Quaternion(), new Vector3(7, 18, 7)), TEAL.clone().multiplyScalar(0.85));
  bakeShaded(parts, handle, new Matrix4().compose(mugSpot.clone().add(new Vector3(7.6, 9, 0)), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.5), new Vector3(3.4, 3.4, 3.4)), TEAL.clone().multiplyScalar(0.7));

  // Book stacks looming at the table edges.
  for (const [u, lateral] of [[0.16, -52], [0.78, 55]] as const) {
    const spot = offsetFromRail(curve, u, new Vector3(lateral, 0, 0));
    spot.y = 0;
    let y = 0;
    for (let i = 0; i < 4; i += 1) {
      const height = 3 + rng() * 1.4;
      const width = 30 - i * 3.5;
      bakeShaded(parts, box, new Matrix4().compose(
        spot.clone().setY(y + height / 2),
        new Quaternion().setFromAxisAngle(UP, (rng() - 0.5) * 0.3),
        new Vector3(width, height, width * 0.7),
      ), [SPOOL_PLUM, COBALT, BUTTON_RED, MUSTARD][i].clone().multiplyScalar(0.55));
      y += height;
    }
  }

  // Pencil cup near the start, far off-road.
  const cupSpot = offsetFromRail(curve, 0.07, new Vector3(-44, 0, 0));
  cupSpot.y = 0;
  bakeShaded(parts, cylinder, new Matrix4().compose(cupSpot.clone().setY(5.5), new Quaternion(), new Vector3(4, 11, 4)), COBALT.clone().multiplyScalar(0.7));
  for (let i = 0; i < 5; i += 1) {
    const lean = (rng() - 0.5) * 0.35;
    bakeShaded(parts, cylinder, new Matrix4().compose(
      cupSpot.clone().add(new Vector3((rng() - 0.5) * 3, 13, (rng() - 0.5) * 3)),
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0.4).normalize(), lean),
      new Vector3(0.55, 15, 0.55),
    ), PENCIL_YELLOW.clone().multiplyScalar(0.75 + rng() * 0.3));
  }

  // The desk lamp: base to the lamp side, arm leaning in over the spill.
  bakeShaded(parts, cylinder, new Matrix4().compose(lampFoot.clone().setY(0.9), new Quaternion(), new Vector3(6.5, 1.8, 6.5)), new Color(0.6, 0.28, 0.2));
  const armRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.32);
  bakeShaded(parts, cylinder, new Matrix4().compose(lampFoot.clone().add(new Vector3(-2.4, 14, 0)), armRotation, new Vector3(0.8, 28, 0.8)), new Color(0.55, 0.26, 0.18));
  const shadeSpot = lampFoot.clone().add(new Vector3(-9.5, 31.5, 0));
  const shadeRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 2.6);
  bakeShaded(parts, cone, new Matrix4().compose(shadeSpot, shadeRotation, new Vector3(7.5, 8, 7.5)), new Color(0.72, 0.34, 0.22), { topBoost: 1.15, bottomDim: 0.9 });

  cylinder.dispose();
  box.dispose();
  handle.dispose();
  cone.dispose();
}

// ---- the spill blob --------------------------------------------------------

function createSpillBlob(center: Vector3, rng: () => number) {
  const root = new Group();
  root.position.copy(center);

  const blobParts: BufferGeometry[] = [];
  const lobes: Array<[number, number, number, number]> = [
    [0, 0, 0, 6.2],
    [-4.6, 0, 2.4, 3.8],
    [4.4, 0, -2.2, 4.2],
    [2.2, 0, 4.4, 3.2],
    [-3.4, 0, -4, 3.4],
  ];
  const lobe = new SphereGeometry(1, 16, 12);
  for (const [x, , z, radius] of lobes) {
    const matrix = new Matrix4().compose(
      new Vector3(x, radius * 0.26, z),
      new Quaternion().setFromAxisAngle(UP, rng() * Math.PI),
      new Vector3(radius, radius * 0.38, radius),
    );
    bakeShaded(blobParts, lobe, matrix, GLUE_BLACK.clone().multiplyScalar(1.3), { topBoost: 1.8, sideDim: 1, bottomDim: 0.8 });
  }
  // Half-swallowed supplies around the rim.
  const swallowed = new BoxGeometry(1, 1, 1);
  const disc = new CylinderGeometry(1, 1, 0.3, 12);
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    const radius = 6.1 + rng() * 0.7;
    const spot = new Vector3(Math.cos(angle) * radius, 0.25 + rng() * 0.3, Math.sin(angle) * radius);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(Math.sin(angle), 0, Math.cos(angle)), 0.5 + rng() * 0.6);
    const scale = 0.8 + rng() * 0.6;
    if (i % 2 === 0) bakeShaded(blobParts, swallowed, new Matrix4().compose(spot, tilt, new Vector3(scale, scale * 0.7, scale)), craft(rng).multiplyScalar(0.75));
    else bakeShaded(blobParts, disc, new Matrix4().compose(spot, tilt, new Vector3(scale, scale, scale)), craft(rng).multiplyScalar(0.75));
  }
  lobe.dispose();
  swallowed.dispose();
  disc.dispose();

  const blobMerged = mergeGeometries(blobParts);
  for (const part of blobParts) part.dispose();
  const blobMesh = new Mesh(blobMerged, new MeshBasicMaterial({ vertexColors: true }));
  blobMesh.name = 'spill-blob';
  root.add(blobMesh);

  const sheenMaterial = createAdditiveBasicMaterial({ color: GLUE_SHEEN.clone().multiplyScalar(0.28), opacity: 1 });
  const sheen = new Mesh(new SphereGeometry(4.4, 12, 9), sheenMaterial);
  sheen.position.set(-1.6, 1.4, 1.2);
  sheen.scale.set(1, 0.32, 1);
  root.add(sheen);

  let collapse = 0;
  let collapsing = false;

  return {
    root,
    sheenMaterial,
    beginCollapse() {
      collapsing = true;
    },
    reset() {
      collapsing = false;
      collapse = 0;
      root.scale.setScalar(1);
      root.position.y = 0;
      root.visible = true;
    },
    update(dt: number, beatEnergy: number, elapsed: number) {
      if (collapsing && collapse < 1) {
        collapse = Math.min(1, collapse + dt * 0.55);
        const sink = 1 - collapse;
        root.scale.set(0.4 + sink * 0.6, Math.max(0.03, sink * sink), 0.4 + sink * 0.6);
        if (collapse >= 1) root.visible = false;
      } else if (!collapsing) {
        // Breathing menace, swelling slightly on the beat.
        const breathe = 1 + Math.sin(elapsed * 1.1) * 0.02 + beatEnergy * 0.03;
        root.scale.set(breathe, 1 + beatEnergy * 0.06, breathe);
      }
      sheenMaterial.opacity = 0.75 + beatEnergy * 0.25;
    },
  };
}

// ---- dust motes ------------------------------------------------------------

function createDust(curve: ReturnType<typeof createTinkerRail>, rng: () => number) {
  const mesh = new InstancedMesh(
    new PlaneGeometry(0.09, 0.09),
    createAdditiveBasicMaterial({ color: LAMP_CREAM.clone().multiplyScalar(0.35), opacity: 1 }),
    DUST_COUNT,
  );
  mesh.frustumCulled = false;
  const seeds: Array<{ base: Vector3; phase: number; speed: number; span: number }> = [];
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const u = rng();
    const side = rng() < 0.5 ? -1 : 1;
    const base = offsetFromRail(curve, u, new Vector3(side * (3 + rng() * 12), 0, (rng() - 0.5) * 12));
    base.y = 1 + rng() * 8;
    seeds.push({ base, phase: rng() * Math.PI * 2, speed: 0.14 + rng() * 0.3, span: 0.6 + rng() * 1.8 });
  }
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  return {
    mesh,
    update(elapsed: number, cameraQuaternion: Quaternion, cameraPosition: Vector3) {
      for (let i = 0; i < seeds.length; i += 1) {
        const seed = seeds[i];
        position.copy(seed.base);
        position.x += Math.sin(elapsed * seed.speed + seed.phase) * seed.span;
        position.y += Math.sin(elapsed * seed.speed * 0.7 + seed.phase * 2.1) * seed.span * 0.5;
        position.z += Math.cos(elapsed * seed.speed * 0.9 + seed.phase) * seed.span * 0.4;
        // A mote passing right through the camera would bloom into a wall of
        // light; shrink anything closer than a few units.
        const near = Math.min(1, Math.max(0, (position.distanceTo(cameraPosition) - 1.5) / 3.5));
        scale.setScalar(Math.max(0.001, near));
        matrix.compose(position, cameraQuaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = DUST_COUNT;
    },
  };
}
