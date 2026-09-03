import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, positionWorld, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, disposeObject3D } from '../../../engine/visual-kit';
import { ballProfileAt, createTinkerRail, TABLE_Y } from '../gameplay';
import { SPILL_RADIUS, spillState } from '../spill';
import {
  GLUE,
  GLUE_SHEEN,
  HAZE,
  LAMP_WARM,
  ROOM_DARK,
  WOOD,
  WOOD_CLEAN,
  WOOD_DARK,
  WOOD_SCRATCH,
  hdr,
  mulberry32,
  type Rng,
} from './palette';
import { BAKED_MATERIAL, bakeSupplyGeometry, randomSupplyTint, SUPPLY_SPEC, type SupplyFinish, type SupplyType } from './supplies';

// The worktable. One enormous plank of lamp-lit wood, a scratch road under the
// rail that widens as the ball grows, three regions of clutter sized to each
// act, a desk lamp far ahead that the whole run rolls toward, dust in its
// light, and the Spill's puddle once the boss is on the table.

export const LAMP_POSITION = new Vector3(118, 118, -540);
const LAMP_TARGET = new Vector3(-10, 0, -330);
const TABLE_CENTER_Z = -330;
const DOME_RADIUS = 430;
const lampDirectionUniform = uniform(new Vector3(0.14, 0.18, -0.97));

export type Environment = {
  root: Group;
  bulbMaterial: MeshBasicMaterial;
  shadowDirection: Vector3;
  update(dt: number, context: { camera: Camera; elapsed: number; running: boolean; runTime: number }): void;
  dispose(): void;
};

export type EnvironmentOptions = {
  /** Called while the Spill is alive to feed the suction stream. */
  onSuck(type: SupplyType, tint: Color, from: Vector3, center: Vector3, scale: number): void;
};

export function roadHalfWidth(u: number) {
  return Math.min(30, Math.max(2.4, ballProfileAt(u).radius * 5.5)) / 2;
}

export function createEnvironmentInternal(scene: Scene, options: EnvironmentOptions): Environment {
  scene.background = ROOM_DARK.clone();
  scene.fog = new FogExp2(HAZE.clone(), 0.0048);
  const root = new Group();
  const rng = mulberry32(20260903);
  const curve = createTinkerRail();

  // Lighting: the lamp is a warm key from ahead-right; the room fills from a
  // dim warm sky and a dark floor bounce.
  const hemisphere = new HemisphereLight(new Color(0.95, 0.78, 0.6), new Color(0.16, 0.08, 0.04), 0.42);
  root.add(hemisphere);
  const lamp = new DirectionalLight(LAMP_WARM, 1.35);
  lamp.position.copy(LAMP_POSITION);
  lamp.target.position.copy(LAMP_TARGET);
  root.add(lamp, lamp.target);
  const shadowDirection = LAMP_TARGET.clone().sub(LAMP_POSITION);
  shadowDirection.y = 0;
  shadowDirection.normalize();

  root.add(createTable());
  root.add(createRoad(curve));
  const { clutter, shadows } = createClutter(rng, curve, shadowDirection);
  root.add(clutter, shadows);
  root.add(createCoffeeRing(curve));
  const { lampGroup, bulbMaterial } = createLamp();
  root.add(lampGroup);
  const dome = createDome();
  root.add(dome);
  root.add(createDust(rng, curve));
  const spill = createSpillVisuals();
  root.add(spill.group);

  scene.add(root);

  let suckTimer = 0;
  const suckTypes: SupplyType[] = ['button', 'bead', 'spool', 'eraser', 'block', 'pencil', 'card', 'peg', 'pot', 'clip'];

  return {
    root,
    bulbMaterial,
    shadowDirection,
    update(dt, context) {
      dome.position.copy(context.camera.position);
      lampDirectionUniform.value.copy(LAMP_POSITION).sub(context.camera.position).normalize();
      spill.update(dt, context.elapsed);
      if (spillState.spawned && spillState.alive && !spillState.frozen && context.running) {
        suckTimer -= dt;
        if (suckTimer <= 0) {
          suckTimer = 0.38 + rng() * 0.3;
          const type = suckTypes[Math.floor(rng() * suckTypes.length)];
          const angle = rng() * Math.PI * 2;
          const distance = SPILL_RADIUS * spillState.spread * (1.4 + rng() * 0.7);
          const from = spillState.center.clone().add(new Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
          options.onSuck(type, randomSupplyTint(type, rng), from, spillState.center.clone(), 2.4 + rng() * 1.4);
        }
      }
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
      root.clear();
    },
  };
}

// ---- the table -------------------------------------------------------------------

function createTable() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.64, metalness: 0.0 });
  const p = positionWorld;
  const grain = mx_noise_float(vec3(p.x.mul(0.05), p.z.mul(0.62), 2.3)).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(p.x.mul(0.34), p.z.mul(3.4), 7.1)).mul(0.5).add(0.5);
  const knots = mx_noise_float(vec3(p.x.mul(0.018), p.z.mul(0.018), 4.4)).mul(0.5).add(0.5);
  const wood = mix(vec3(WOOD_DARK.r, WOOD_DARK.g, WOOD_DARK.b), vec3(WOOD.r, WOOD.g, WOOD.b), grain.mul(0.7).add(knots.mul(0.3)))
    .mul(fine.mul(0.28).add(0.84));
  const toLamp = p.xz.sub(vec2(LAMP_POSITION.x, LAMP_POSITION.z));
  const pool = toLamp.dot(toLamp).mul(-1 / (360 * 360)).exp();
  material.colorNode = wood.mul(pool.mul(0.5).add(0.42));

  const table = new Mesh(new PlaneGeometry(1800, 1800, 1, 1), material);
  table.rotation.x = -Math.PI / 2;
  table.position.set(0, TABLE_Y, TABLE_CENTER_Z);
  table.userData.raildIgnoreOcclusion = true;
  return table;
}

// The scratch road: a pale, finely striated band scratched into the wood
// under the rail, widening with the ball.
function createRoad(curve: CatmullRomCurve3) {
  const samples = 420;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let along = 0;
  let previous: Vector3 | null = null;
  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const frame = sampleRailFrame(curve, u);
    const half = roadHalfWidth(u);
    const center = frame.position.clone();
    center.y = TABLE_Y;
    if (previous) along += center.distanceTo(previous);
    previous = center;
    const right = frame.right.clone();
    right.y = 0;
    right.normalize();
    for (const side of [-1, 1]) {
      const point = center.clone().addScaledVector(right, side * half);
      positions.push(point.x, TABLE_Y + 0.06, point.z);
      normals.push(0, 1, 0);
      uvs.push(side * 0.5 + 0.5, along);
    }
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0, transparent: true, depthWrite: false });
  const across = uv().x;
  const alongNode = uv().y;
  const wobble = mx_noise_float(vec3(alongNode.mul(0.08), across.mul(3), 1.5)).mul(2.2);
  const streaks = across.mul(70).add(wobble).sin().mul(0.5).add(0.5).pow(3);
  const scuffs = mx_noise_float(vec3(alongNode.mul(0.35), across.mul(6), 9.2)).mul(0.5).add(0.5);
  material.colorNode = vec3(WOOD_SCRATCH.r, WOOD_SCRATCH.g, WOOD_SCRATCH.b).mul(streaks.mul(0.35).add(0.78)).mul(scuffs.mul(0.25).add(0.85));
  material.opacityNode = smoothstep(float(0), float(0.16), across).mul(smoothstep(float(1), float(0.84), across)).mul(0.62);
  const road = new Mesh(geometry, material);
  road.renderOrder = 1;
  road.frustumCulled = false;
  road.userData.raildIgnoreOcclusion = true;
  return road;
}

// A coffee ring stain beside the road in the tennis-ball act: a table has a life.
function createCoffeeRing(curve: CatmullRomCurve3) {
  const frame = sampleRailFrame(curve, 0.3);
  const ring = new Mesh(
    new RingGeometry(34, 41, 64),
    new MeshBasicMaterial({ color: new Color(0.2, 0.1, 0.04), transparent: true, opacity: 0.22, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(frame.position).addScaledVector(frame.right, 58);
  ring.position.y = TABLE_Y + 0.02;
  ring.renderOrder = 1;
  ring.userData.raildIgnoreOcclusion = true;
  return ring;
}

// ---- clutter ------------------------------------------------------------------------

type ClutterSpec = {
  type: SupplyType;
  count: number;
  range: [number, number];
  scale: [number, number];
  /** Lateral distance beyond the road edge. */
  lateral: [number, number];
  alongRoad?: boolean;
};

const CLUTTER: ClutterSpec[] = [
  // Marble: everything on the table is a landmark.
  { type: 'button', count: 70, range: [0.0, 0.17], scale: [2.0, 3.4], lateral: [1.0, 26] },
  { type: 'bead', count: 55, range: [0.0, 0.17], scale: [1.2, 2.2], lateral: [10, 30] },
  { type: 'pin', count: 34, range: [0.0, 0.17], scale: [2.0, 2.9], lateral: [2.5, 28], alongRoad: true },
  { type: 'clip', count: 26, range: [0.0, 0.17], scale: [1.8, 2.6], lateral: [1.5, 26] },
  // Tennis ball: heavier hardware.
  { type: 'spool', count: 12, range: [0.16, 0.43], scale: [4.0, 5.2], lateral: [22, 48] },
  { type: 'eraser', count: 9, range: [0.16, 0.43], scale: [2.6, 3.4], lateral: [20, 44] },
  { type: 'pot', count: 9, range: [0.16, 0.43], scale: [3.2, 3.8], lateral: [22, 50] },
  { type: 'block', count: 11, range: [0.16, 0.43], scale: [3.2, 4.0], lateral: [20, 48] },
  { type: 'button', count: 40, range: [0.16, 0.43], scale: [2.0, 2.8], lateral: [1.5, 32] },
  { type: 'bead', count: 35, range: [0.16, 0.43], scale: [1.2, 2.0], lateral: [20, 44] },
  { type: 'pin', count: 14, range: [0.16, 0.43], scale: [2.2, 2.8], lateral: [3, 30], alongRoad: true },
  // Melon: long things and tall things; the table looks small.
  { type: 'ruler', count: 9, range: [0.42, 0.93], scale: [10, 14], lateral: [3, 34], alongRoad: true },
  { type: 'jar', count: 6, range: [0.42, 0.93], scale: [8.5, 10], lateral: [42, 74] },
  { type: 'card', count: 10, range: [0.42, 0.93], scale: [6, 9], lateral: [3, 40] },
  { type: 'pencil', count: 14, range: [0.42, 0.93], scale: [4.5, 6], lateral: [3, 36], alongRoad: true },
  { type: 'block', count: 8, range: [0.42, 0.93], scale: [4.5, 5.5], lateral: [40, 70] },
  { type: 'pot', count: 6, range: [0.42, 0.93], scale: [4.5, 5.5], lateral: [42, 72] },
  { type: 'spool', count: 6, range: [0.42, 0.93], scale: [5.5, 6.5], lateral: [42, 72] },
  { type: 'button', count: 60, range: [0.42, 0.93], scale: [1.8, 2.8], lateral: [1.5, 44] },
  { type: 'bead', count: 40, range: [0.42, 0.93], scale: [1.2, 2.2], lateral: [1.5, 44] },
  { type: 'clip', count: 20, range: [0.42, 0.93], scale: [2.0, 2.8], lateral: [2, 40] },
];

function createClutter(rng: Rng, curve: CatmullRomCurve3, shadowDirection: Vector3) {
  const buckets: Record<SupplyFinish, BufferGeometry[]> = { matte: [], gloss: [], metal: [] };
  const shadowGeometries: BufferGeometry[] = [];
  const shadowDisc = new CircleGeometry(1, 14).toNonIndexed();
  shadowDisc.rotateX(-Math.PI / 2);
  shadowDisc.deleteAttribute('uv');

  for (const spec of CLUTTER) {
    for (let i = 0; i < spec.count; i += 1) {
      const u = spec.range[0] + rng() * (spec.range[1] - spec.range[0]);
      const frame = sampleRailFrame(curve, u);
      const half = roadHalfWidth(u);
      const side = rng() < 0.5 ? -1 : 1;
      const scale = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);
      const info = SUPPLY_SPEC[spec.type];
      const lateral = half + spec.lateral[0] + rng() * (spec.lateral[1] - spec.lateral[0]) + info.radius * scale * 0.6;
      const right = frame.right.clone();
      right.y = 0;
      right.normalize();
      const position = frame.position.clone().addScaledVector(right, side * lateral).addScaledVector(frame.tangent, (rng() - 0.5) * 10);
      position.y = TABLE_Y + info.rest * scale;
      const tangentYaw = Math.atan2(-frame.tangent.z, frame.tangent.x);
      const yaw = spec.alongRoad ? tangentYaw + (rng() - 0.5) * 0.6 + (rng() < 0.5 ? Math.PI : 0) : rng() * Math.PI * 2;
      const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      const matrix = new Matrix4().compose(position, quaternion, new Vector3(scale, scale, scale));
      buckets[info.finish].push(bakeSupplyGeometry(spec.type, randomSupplyTint(spec.type, rng), matrix));

      // Fake lamp shadow: an ellipse under the piece, pushed away from the lamp.
      const height = info.rest * scale * 2;
      const elongated = spec.type === 'pin' || spec.type === 'pencil' || spec.type === 'ruler' || spec.type === 'clip';
      const rx = info.radius * scale * (elongated ? 1.0 : 0.95);
      const rz = info.radius * scale * (elongated ? 0.3 : 0.95);
      const shadowPosition = position.clone().addScaledVector(shadowDirection, Math.min(height * 0.6, 6));
      shadowPosition.y = TABLE_Y + 0.035;
      const shadowMatrix = new Matrix4().compose(shadowPosition, quaternion, new Vector3(rx, 1, rz));
      shadowGeometries.push(shadowDisc.clone().applyMatrix4(shadowMatrix));
    }
  }

  const clutter = new Group();
  for (const finish of Object.keys(buckets) as SupplyFinish[]) {
    const geometries = buckets[finish];
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    const mesh = new Mesh(merged, BAKED_MATERIAL[finish]);
    mesh.frustumCulled = false;
    clutter.add(mesh);
  }

  const shadowMerged = mergeGeometries(shadowGeometries, false);
  for (const geometry of shadowGeometries) geometry.dispose();
  shadowDisc.dispose();
  const shadows = new Mesh(
    shadowMerged,
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadows.renderOrder = 1;
  shadows.frustumCulled = false;
  shadows.userData.raildIgnoreOcclusion = true;
  return { clutter, shadows };
}

// ---- the desk lamp -------------------------------------------------------------------

function createLamp() {
  const lampGroup = new Group();
  lampGroup.position.copy(LAMP_POSITION);
  const toTarget = LAMP_TARGET.clone().sub(LAMP_POSITION).normalize();
  lampGroup.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), toTarget);

  const shadeMaterial = new MeshStandardMaterial({ color: new Color(0.1, 0.17, 0.13), roughness: 0.45, metalness: 0.55, side: DoubleSide });
  const shade = new Mesh(new CylinderGeometry(7, 22, 18, 28, 1, true), shadeMaterial);
  shade.position.y = -9;
  lampGroup.add(shade);
  const collar = new Mesh(new CylinderGeometry(7.4, 7.4, 6, 20), shadeMaterial);
  collar.position.y = 3;
  lampGroup.add(collar);

  const bulbMaterial = new MeshBasicMaterial({ color: hdr(LAMP_WARM, 1.25), side: DoubleSide });
  const bulb = new Mesh(new CircleGeometry(6.5, 28), bulbMaterial);
  bulb.rotation.x = Math.PI / 2;
  bulb.position.y = -12;
  lampGroup.add(bulb);

  // Arm rising out of view, and a soft cone of light down to the table.
  const armMaterial = new MeshStandardMaterial({ color: new Color(0.12, 0.13, 0.12), roughness: 0.5, metalness: 0.5 });
  const arm = new Mesh(new CylinderGeometry(1.6, 1.6, 90, 10), armMaterial);
  arm.position.set(0, 42, 12);
  arm.rotation.x = 0.35;
  lampGroup.add(arm);
  const beamMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(LAMP_WARM, 0.014), side: DoubleSide }));
  beamMaterial.fog = false;
  const beam = new Mesh(new CylinderGeometry(9, 110, 100, 28, 1, true), beamMaterial);
  beam.position.y = -62;
  beam.userData.raildIgnoreOcclusion = true;
  lampGroup.add(beam);
  lampGroup.userData.raildIgnoreOcclusion = true;
  return { lampGroup, bulbMaterial };
}

// ---- the room ----------------------------------------------------------------------------

function createDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  material.fog = false;
  const direction = positionLocal.normalize();
  const up = direction.y;
  const horizon = mix(vec3(HAZE.r, HAZE.g, HAZE.b), vec3(ROOM_DARK.r, ROOM_DARK.g, ROOM_DARK.b), smoothstep(float(-0.04), float(0.42), up));
  const glow = direction.dot(lampDirectionUniform).max(0).pow(220).mul(0.28);
  material.colorNode = horizon.add(vec3(LAMP_WARM.r, LAMP_WARM.g, LAMP_WARM.b).mul(glow));
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 28, 14), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

function createDust(rng: Rng, curve: CatmullRomCurve3) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const frame = sampleRailFrame(curve, rng());
    const point = frame.position.clone()
      .addScaledVector(frame.right, (rng() - 0.5) * 130)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 40);
    point.y = TABLE_Y + 0.5 + rng() ** 1.6 * 46;
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const intensity = rng() < 0.07 ? 1.4 : 0.12 + rng() * 0.32;
    colors[i * 3] = LAMP_WARM.r * intensity;
    colors[i * 3 + 1] = LAMP_WARM.g * intensity;
    colors[i * 3 + 2] = LAMP_WARM.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 0.42, vertexColors: true, sizeAttenuation: true }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

// ---- the Spill's puddle ----------------------------------------------------------------------

function createPuddleGeometry() {
  const segments = 72;
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const radius = 1 + 0.14 * Math.sin(3 * angle + 1) + 0.09 * Math.sin(7 * angle + 2) + 0.05 * Math.sin(11 * angle + 0.5);
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    normals.push(0, 1, 0);
    indices.push(0, ((i + 1) % segments) + 1, i + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function createSpillVisuals() {
  const group = new Group();
  group.visible = false;
  const glue = new MeshStandardMaterial({ color: GLUE.clone(), roughness: 0.4, metalness: 0.3, emissive: GLUE_SHEEN.clone().multiplyScalar(0.04) });
  const puddle = new Mesh(createPuddleGeometry(), glue);
  puddle.position.y = TABLE_Y + 0.08;
  puddle.renderOrder = 2;
  group.add(puddle);

  const mounds: Mesh[] = [];
  const stalks: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const mound = new Mesh(new SphereGeometry(1, 20, 12), glue);
    mound.scale.set(5.5, 2.4, 5.5);
    group.add(mound);
    mounds.push(mound);
    const stalk = new Mesh(new CylinderGeometry(0.9, 2.3, 1, 12, 1, true), glue);
    group.add(stalk);
    stalks.push(stalk);
  }
  const drips: Mesh[] = [];
  for (let i = 0; i < 12; i += 1) {
    const drip = new Mesh(new SphereGeometry(0.55, 10, 8), glue);
    group.add(drip);
    drips.push(drip);
  }

  const patchMaterial = new MeshStandardMaterial({
    color: WOOD_CLEAN.clone(),
    roughness: 0.32,
    metalness: 0,
    emissive: WOOD_CLEAN.clone().multiplyScalar(0.12),
    transparent: true,
    opacity: 0,
  });
  const patch = new Mesh(new CircleGeometry(1, 48), patchMaterial);
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = TABLE_Y + 0.05;
  patch.renderOrder = 1;
  patch.visible = false;
  patch.userData.raildIgnoreOcclusion = true;
  group.add(patch);
  group.userData.raildIgnoreOcclusion = true;

  let grow = 0;

  return {
    group,
    update(dt: number, elapsed: number) {
      if (!spillState.spawned) {
        group.visible = false;
        grow = 0;
        patch.visible = false;
        patchMaterial.opacity = 0;
        return;
      }
      group.visible = true;
      const snapped = spillState.snappedAt >= 0;
      const sinceSnap = snapped ? spillState.runTime - spillState.snappedAt : 0;
      // Grow in over 1.2 s; after the snap, pull in hard over 0.9 s.
      grow = snapped ? Math.max(0, 1 - (sinceSnap / 0.9) ** 2) : Math.min(1, grow + dt / 1.2);
      const radius = SPILL_RADIUS * spillState.spread * grow;
      puddle.position.set(spillState.center.x, TABLE_Y + 0.08, spillState.center.z);
      puddle.scale.set(radius, 1, radius);
      puddle.rotation.y = elapsed * 0.05;
      glue.emissive.copy(GLUE_SHEEN).multiplyScalar(0.035 + Math.sin(elapsed * 2.2) * 0.015 + (snapped ? 0.4 * grow : 0));

      for (let i = 0; i < 3; i += 1) {
        const alive = spillState.coreAlive[i];
        const core = spillState.corePositions[i];
        const mound = mounds[i];
        const stalk = stalks[i];
        mound.visible = alive && grow > 0.01;
        stalk.visible = mound.visible;
        if (!mound.visible) continue;
        const k = grow * (0.7 + 0.3 * spillState.spread);
        mound.position.set(core.x, TABLE_Y, core.z);
        mound.scale.set(5.5 * k, 2.4 * k, 5.5 * k);
        const height = Math.max(0.5, core.y - 0.6);
        stalk.position.set(core.x, TABLE_Y + height / 2, core.z);
        stalk.scale.set(k, height, k);
      }

      drips.forEach((drip, index) => {
        const angle = (index / drips.length) * Math.PI * 2 + elapsed * 0.03;
        const rise = Math.max(0, Math.sin(elapsed * 1.6 + index * 1.3));
        drip.visible = grow > 0.05;
        drip.position.set(
          spillState.center.x + Math.cos(angle) * radius * 0.82,
          TABLE_Y + 0.2 + rise * 1.6 * grow,
          spillState.center.z + Math.sin(angle) * radius * 0.82,
        );
        drip.scale.set(grow, grow * (1 + rise * 0.8), grow);
      });

      if (snapped) {
        patch.visible = true;
        patch.position.set(spillState.center.x, TABLE_Y + 0.05, spillState.center.z);
        patch.scale.setScalar(SPILL_RADIUS * spillState.spread * 1.15);
        patchMaterial.opacity = Math.min(1, sinceSnap / 0.8);
      }
    },
  };
}
