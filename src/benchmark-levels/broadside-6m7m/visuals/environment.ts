import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, mix, mx_noise_float, normalWorld, positionLocal, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { mulberry32, type Rng } from '../../../engine/rng';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { BELLY_WARSHIP, createBroadsideRail, ENEMY_FLAGSHIP, FLANK_CRUISER, OUR_FLAGSHIP, TRENCH } from '../rail';
import { spawnFlash } from './effects';
import { CRIMSON, CYAN, GOLD, hdr, ICE, MAGENTA, MOLTEN, NEBULA_DEEP, SPACE, WHITE_HOT } from './palette';
import { createCapitalShip, type CapitalShip, type ShipSpec } from './ships';

// The battlefield. Everything here is scenery: the nebula and stars that
// backlight every hull, both fleets in no neat formation, the tracer duels
// between them, the swarm knots dogfighting in the gaps, the deck we launch
// from, the enemy flagship with its shield and trenchwork, and the dust that
// sells our speed. The runtime drives it through updateEnvironment.

export const beatUniform = uniform(0);
export const shieldUniform = uniform(1);
export const shieldPulseUniform = uniform(0);

type Tracer = { active: boolean; from: Vector3; to: Vector3; t: number; speed: number; color: Color; length: number };
type PendingTracer = { at: number; from: Vector3; to: Vector3; color: Color; length: number };
type Knot = { center: Vector3; radius: number; a: number; b: number; wa: number; wb: number; color: Color; scale: number };
type Dust = { u: number; offset: Vector3; size: number };
type Duel = { from: CapitalShip; to: CapitalShip };

export type Environment = {
  root: Group;
  curve: CatmullRomCurve3;
  nebula: Mesh;
  stars: Points;
  ships: CapitalShip[];
  friendShips: CapitalShip[];
  enemyShips: CapitalShip[];
  home: CapitalShip;
  flank: CapitalShip;
  belly: CapitalShip;
  flagship: CapitalShip;
  broadsideTarget: CapitalShip;
  duels: Duel[];
  shield: Mesh;
  trenchStrips: Mesh;
  deckLights: Mesh;
  tracerMesh: InstancedMesh;
  tracers: Tracer[];
  pendingTracers: PendingTracer[];
  knotMesh: InstancedMesh;
  knots: Knot[];
  dustMesh: InstancedMesh;
  dust: Dust[];
  clock: number;
  breaking: number; // seconds since the flagship started coming apart, or -1
  scatter: number; // 0..1 how far the enemy line has broken and run
  rng: Rng;
};

const TRACER_CAPACITY = 240;
const KNOT_COUNT = 260;
const DUST_COUNT = 260;
const DUST_BEHIND = 12;
const DUST_AHEAD = 150;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchVector = new Vector3();
const scratchColor = new Color();
const FORWARD = new Vector3(0, 0, 1);

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = SPACE.clone();
  const root = new Group();
  const rng = mulberry32(6070707);
  const curve = createBroadsideRail();

  const nebula = createNebula();
  const stars = createStars(rng);
  root.add(nebula, stars);

  const ships: CapitalShip[] = [];
  const friendShips: CapitalShip[] = [];
  const enemyShips: CapitalShip[] = [];
  const placeShip = (spec: ShipSpec, position: Vector3, yaw: number, pitch = 0, roll = 0) => {
    const ship = createCapitalShip(spec);
    ship.group.position.copy(position);
    ship.group.rotation.set(pitch, yaw, roll);
    ship.group.userData.basePosition = position.clone();
    ship.group.userData.baseRotation = new Vector3(pitch, yaw, roll);
    root.add(ship.group);
    ships.push(ship);
    (spec.side === 'friend' ? friendShips : enemyShips).push(ship);
    return ship;
  };

  // Our side: the flagship we launch from, the cruiser whose flank we run, and the line.
  const home = placeShip({ side: 'friend', kind: 'homeCarrier', ...OUR_FLAGSHIP, seed: 11 }, OUR_FLAGSHIP.center, 0);
  const flank = placeShip({ side: 'friend', kind: 'cruiser', ...FLANK_CRUISER, seed: 12 }, FLANK_CRUISER.center, 0);
  placeShip({ side: 'friend', kind: 'cruiser', length: 300, width: 40, height: 28, seed: 13 }, new Vector3(150, -80, -330), 0.35, 0.05);
  placeShip({ side: 'friend', kind: 'cruiser', length: 320, width: 44, height: 30, seed: 14 }, new Vector3(-190, 90, -560), -0.25, -0.08, 0.1);
  placeShip({ side: 'friend', kind: 'cruiser', length: 280, width: 38, height: 26, seed: 15 }, new Vector3(230, 40, -760), 0.15, 0, -0.12);
  placeShip({ side: 'friend', kind: 'cruiser', length: 340, width: 46, height: 32, seed: 16 }, new Vector3(-240, -60, -1120), -0.4, 0.04);
  placeShip({ side: 'friend', kind: 'cruiser', length: 260, width: 36, height: 26, seed: 17 }, new Vector3(120, 140, -1300), 0.5, -0.1, 0.2);
  placeShip({ side: 'friend', kind: 'carrier', length: 360, width: 110, height: 40, seed: 18 }, new Vector3(-330, 20, -300), 0.2, 0, 0.05);

  // Their side: the warship we run the belly of, the flagship, carriers, the line.
  const belly = placeShip({ side: 'enemy', kind: 'cruiser', ...BELLY_WARSHIP, seed: 21 }, BELLY_WARSHIP.center, 0);
  const flagship = placeShip({ side: 'enemy', kind: 'flagship', ...ENEMY_FLAGSHIP, seed: 22 }, ENEMY_FLAGSHIP.center, 0);
  const broadsideTarget = placeShip({ side: 'enemy', kind: 'cruiser', length: 320, width: 46, height: 32, seed: 23 }, new Vector3(220, 60, -900), -0.3, 0.02, 0.15);
  placeShip({ side: 'enemy', kind: 'cruiser', length: 300, width: 42, height: 30, seed: 24 }, new Vector3(-230, -50, -480), 0.4, -0.05);
  placeShip({ side: 'enemy', kind: 'cruiser', length: 280, width: 40, height: 28, seed: 25 }, new Vector3(170, 100, -420), -0.2, 0.08, -0.2);
  placeShip({ side: 'enemy', kind: 'cruiser', length: 320, width: 44, height: 32, seed: 26 }, new Vector3(-200, 30, -1560), 0.3, 0, 0.1);
  placeShip({ side: 'enemy', kind: 'cruiser', length: 300, width: 42, height: 30, seed: 27 }, new Vector3(260, -40, -1480), -0.35, 0.06);
  placeShip({ side: 'enemy', kind: 'carrier', length: 280, width: 100, height: 36, seed: 28 }, new Vector3(-170, 45, -1180), 0.3, 0, -0.08);
  placeShip({ side: 'enemy', kind: 'carrier', length: 300, width: 110, height: 40, seed: 29 }, new Vector3(190, -70, -1240), -0.2, 0.03, 0.1);

  // Duels: every ship trades fire with its two nearest opponents.
  const duels: Duel[] = [];
  for (const ship of ships) {
    const opponents = (ship.spec.side === 'friend' ? enemyShips : friendShips)
      .map((other) => ({ other, distance: other.group.position.distanceTo(ship.group.position) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const { other } of opponents) duels.push({ from: ship, to: other });
  }

  const shield = createShield();
  shield.position.copy(ENEMY_FLAGSHIP.center);
  root.add(shield);

  const { walls, strips } = createTrench();
  root.add(walls, strips);
  const deckLights = createDeckLights();
  root.add(deckLights);

  // Tracers, swarm knots, and dust are instanced and recycled.
  const tracerMesh = new InstancedMesh(new BoxGeometry(0.22, 0.22, 1), createAdditiveBasicMaterial({ color: 0xffffff }), TRACER_CAPACITY);
  tracerMesh.count = 0;
  tracerMesh.frustumCulled = false;
  tracerMesh.userData.raildIgnoreOcclusion = true;
  root.add(tracerMesh);
  const tracers: Tracer[] = Array.from({ length: TRACER_CAPACITY }, () => ({ active: false, from: new Vector3(), to: new Vector3(), t: 0, speed: 1, color: new Color(), length: 6 }));

  const knotGeometry = new TetrahedronGeometry(0.7, 0);
  knotGeometry.scale(0.6, 0.35, 1.6);
  const knotMesh = new InstancedMesh(knotGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), KNOT_COUNT);
  knotMesh.frustumCulled = false;
  knotMesh.userData.raildIgnoreOcclusion = true;
  root.add(knotMesh);
  const knotCenters = [new Vector3(-120, 30, -400), new Vector3(140, -20, -700), new Vector3(-60, 70, -1000), new Vector3(200, 40, -1450), new Vector3(-150, -40, -1650)];
  const knots: Knot[] = Array.from({ length: KNOT_COUNT }, (_, i) => {
    const center = knotCenters[i % knotCenters.length].clone().add(new Vector3((rng() - 0.5) * 60, (rng() - 0.5) * 40, (rng() - 0.5) * 80));
    const friend = rng() < 0.5;
    return {
      center,
      radius: 8 + rng() * 34,
      a: rng() * Math.PI * 2,
      b: rng() * Math.PI * 2,
      wa: (0.5 + rng() * 1.1) * (rng() < 0.5 ? -1 : 1),
      wb: 0.3 + rng() * 0.9,
      color: friend ? hdr(CYAN, 1.3) : hdr(MOLTEN, 1.2),
      scale: 0.7 + rng() * 0.8,
    };
  });

  const dustMesh = new InstancedMesh(new BoxGeometry(0.16, 0.16, 0.7), createAdditiveBasicMaterial({ color: new Color(0.42, 0.3, 0.46) }), DUST_COUNT);
  dustMesh.frustumCulled = false;
  dustMesh.userData.raildIgnoreOcclusion = true;
  root.add(dustMesh);
  const dust: Dust[] = Array.from({ length: DUST_COUNT }, () => ({
    u: rng() * 0.12,
    offset: dustOffset(rng),
    size: 0.5 + rng() * 1.2,
  }));

  scene.add(root);
  return {
    root, curve, nebula, stars, ships, friendShips, enemyShips, home, flank, belly, flagship, broadsideTarget, duels,
    shield, trenchStrips: strips, deckLights, tracerMesh, tracers, pendingTracers: [], knotMesh, knots, dustMesh, dust,
    clock: 0, breaking: -1, scatter: 0, rng,
  };
}

function dustOffset(rng: Rng) {
  const angle = rng() * Math.PI * 2;
  const radius = 3 + rng() * 26;
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
}

export function disposeEnvironmentInternal(environment: Environment) {
  environment.root.removeFromParent();
  disposeObject3D(environment.root);
}

// ---- the sky ---------------------------------------------------------------------

// One inverted sphere that rides with the camera: magenta and gold clouds in
// dark lanes, brightest along a great-circle band behind the enemy line so
// their hulls read as silhouettes. Kept under the bloom threshold except for
// the hot core, so it lights the frame without whiting it out.
function createNebula() {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.depthWrite = false;
  const direction = positionLocal.normalize();
  const n1 = mx_noise_float(direction.mul(2.1).add(vec3(3.1, 0.7, 1.9)));
  const n2 = mx_noise_float(direction.mul(5.3).add(vec3(0.4, 2.2, 5.6)));
  const n3 = mx_noise_float(direction.mul(12.0).add(vec3(1.7, 4.1, 0.3)));
  const cloud = n1.mul(0.58).add(n2.mul(0.3)).add(n3.mul(0.12)).mul(0.5).add(0.5);
  const bandAxis = vec3(0.32, 0.86, -0.4).normalize();
  const band = float(1).sub(direction.dot(bandAxis).abs()).pow(1.8);
  const deep = vec3(NEBULA_DEEP.r, NEBULA_DEEP.g, NEBULA_DEEP.b);
  // Kept dim: the nebula is a backlight, not a light source. Everything here
  // stays well under the bloom threshold except the small hot core.
  const magenta = vec3(MAGENTA.r, MAGENTA.g, MAGENTA.b).mul(0.3);
  const gold = vec3(GOLD.r, GOLD.g, GOLD.b).mul(0.34);
  let color = mix(deep, magenta, smoothstep(float(0.4), float(0.78), cloud).mul(band.mul(0.85).add(0.15)));
  color = mix(color, gold, smoothstep(float(0.72), float(0.95), cloud).mul(band));
  const coreAxis = vec3(-0.18, 0.3, -0.94).normalize();
  const core = smoothstep(float(0.93), float(1.0), direction.dot(coreAxis)).mul(cloud).mul(1.2);
  color = color.add(gold.mul(core)).mul(beatUniform.mul(0.05).add(1));
  material.colorNode = color;
  const mesh = new Mesh(new SphereGeometry(2600, 48, 32), material);
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function createStars(rng: Rng) {
  const count = 2400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const radius = 2400;
    positions[i * 3] = Math.cos(angle) * r * radius;
    positions[i * 3 + 1] = Math.sin(angle) * r * radius;
    positions[i * 3 + 2] = z * radius;
    const roll = rng();
    const base = roll < 0.6 ? ICE : roll < 0.8 ? GOLD : roll < 0.93 ? MAGENTA : CYAN;
    const intensity = rng() < 0.06 ? 1.4 : 0.25 + rng() * 0.5;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 2.2, vertexColors: true, sizeAttenuation: false }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

// ---- the flagship's shield and trench ----------------------------------------------

function createShield() {
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  material.side = BackSide;
  const view = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(view).abs()).pow(2.4);
  const ripple = mx_noise_float(positionWorld.mul(0.05).add(vec3(0, 0, 0))).mul(0.5).add(0.5);
  const tint = mix(vec3(CRIMSON.r, CRIMSON.g, CRIMSON.b), vec3(MOLTEN.r, MOLTEN.g, MOLTEN.b), ripple);
  material.colorNode = tint.mul(rim.mul(0.22).add(shieldPulseUniform.mul(0.35)).add(ripple.mul(0.015))).mul(shieldUniform);
  const mesh = new Mesh(new SphereGeometry(1, 40, 24), material);
  // Radii: just outside the sponsons, just over the spine, past both ends. The
  // starboard rail (x≈65) and the trench rail (y=27) stay outside it.
  mesh.scale.set(ENEMY_FLAGSHIP.width * 0.58, ENEMY_FLAGSHIP.height * 0.52, ENEMY_FLAGSHIP.length * 0.56);
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.frustumCulled = false;
  return mesh;
}

function createTrench() {
  const wallMaterial = new MeshBasicNodeMaterial();
  const view = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(view).abs()).pow(2);
  wallMaterial.colorNode = vec3(0.1, 0.08, 0.12).mul(float(0.6).add(normalWorld.y.mul(0.3))).add(vec3(MAGENTA.r, MAGENTA.g, MAGENTA.b).mul(rim).mul(0.3));
  const walls = new Group();
  const length = TRENCH.toZ - TRENCH.fromZ;
  const centerZ = (TRENCH.fromZ + TRENCH.toZ) / 2;
  const wallHeight = TRENCH.wallY - TRENCH.floorY;
  const wallGeometry = new BoxGeometry(6, wallHeight, length);
  for (const side of [-1, 1]) {
    const wall = new Mesh(wallGeometry, wallMaterial);
    wall.position.set(TRENCH.x + side * (TRENCH.halfWidth + 3), TRENCH.floorY + wallHeight / 2, centerZ);
    walls.add(wall);
    // Buttresses along the outer face give the walls a rhythm as they pass.
    for (let i = 0; i < 12; i += 1) {
      const buttress = new Mesh(new BoxGeometry(4, wallHeight + 2, 3), wallMaterial);
      buttress.position.set(TRENCH.x + side * (TRENCH.halfWidth + 7), TRENCH.floorY + wallHeight / 2 + 0.5, TRENCH.fromZ + (i + 0.5) * (length / 12));
      walls.add(buttress);
    }
  }
  // Girders across the top, well above the rail.
  for (let i = 0; i < 6; i += 1) {
    const girder = new Mesh(new BoxGeometry(TRENCH.halfWidth * 2 + 12, 1.2, 1.6), wallMaterial);
    girder.position.set(TRENCH.x, TRENCH.wallY + 4.5, TRENCH.fromZ + (i + 0.5) * (length / 6));
    girder.userData.raildIgnoreOcclusion = true;
    walls.add(girder);
  }
  const stripGeometry = new BoxGeometry(0.3, 0.35, length);
  const stripGroup: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (const y of [TRENCH.floorY + 3, TRENCH.floorY + 9]) {
      const strip = stripGeometry.clone();
      strip.translate(TRENCH.x + side * (TRENCH.halfWidth - 0.1), y, centerZ);
      stripGroup.push(strip);
    }
  }
  const strips = new Mesh(mergeStrips(stripGroup), createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.3) }));
  strips.userData.raildIgnoreOcclusion = true;
  return { walls, strips };
}

function mergeStrips(geometries: BufferGeometry[]) {
  // Tiny merge for same-layout box geometries without pulling in the addon here.
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    if (index) for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset);
    offset += position.count;
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

// Runway lights down the flight deck: cyan dashes either side of the catapult.
function createDeckLights() {
  const geometries: BufferGeometry[] = [];
  const deckY = OUR_FLAGSHIP.center.y + OUR_FLAGSHIP.height / 2 + 0.25;
  for (let z = 70; z >= -168; z -= 7) {
    for (const x of [-5.5, 5.5]) {
      const dash = new BoxGeometry(0.5, 0.18, 2.6);
      dash.translate(x, deckY, z);
      geometries.push(dash);
    }
  }
  const catapult = new BoxGeometry(1.2, 0.1, 240);
  catapult.translate(0, deckY - 0.1, -50);
  geometries.push(catapult);
  const mesh = new Mesh(mergeStrips(geometries), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.2) }));
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

// ---- gunfire ---------------------------------------------------------------------

/** Queue a burst of tracers from one world point to another, staggered in time. */
export function queueTracers(environment: Environment, from: Vector3, to: Vector3, count: number, color: Color, spacing = 0.06, length = 7) {
  for (let i = 0; i < count; i += 1) {
    const jitter = new Vector3((environment.rng() - 0.5) * 6, (environment.rng() - 0.5) * 6, (environment.rng() - 0.5) * 6);
    environment.pendingTracers.push({ at: environment.clock + i * spacing, from: from.clone().add(jitter.multiplyScalar(0.3)), to: to.clone().add(jitter), color, length });
  }
}

function shipWorldPoint(ship: CapitalShip, local: Vector3) {
  return ship.group.localToWorld(local.clone());
}

/** One ship's broadside: every gun on the facing flank lights off at the target. */
export function fireBroadside(environment: Environment, ship: CapitalShip, target: CapitalShip, gunsToFire = 8, spacing = 0.05) {
  const targetPoint = target.group.position.clone();
  const toTarget = ship.group.worldToLocal(targetPoint.clone());
  const facing = ship.guns.filter((gun) => Math.sign(gun.x) === Math.sign(toTarget.x));
  const guns = (facing.length ? facing : ship.guns).slice(0, gunsToFire);
  const color = ship.spec.side === 'friend' ? hdr(CYAN, 2.2) : hdr(CRIMSON, 2.0);
  guns.forEach((gun, index) => {
    const from = shipWorldPoint(ship, gun);
    const to = targetPoint.clone().add(new Vector3((environment.rng() - 0.5) * target.spec.width, (environment.rng() - 0.5) * target.spec.height, (environment.rng() - 0.5) * target.spec.length * 0.6));
    environment.pendingTracers.push({ at: environment.clock + index * spacing, from, to, color, length: ship.spec.kind === 'flagship' ? 12 : 8 });
    spawnFlash(from, ship.spec.side === 'friend' ? hdr(CYAN, 1.4) : hdr(CRIMSON, 1.3), 3.5, 0.22);
  });
}

/** A few duels exchange fire; the beat calls this so the battle keeps time. */
export function fireDuels(environment: Environment, count: number, intensity = 1) {
  for (let i = 0; i < count; i += 1) {
    const duel = environment.duels[Math.floor(environment.rng() * environment.duels.length)];
    if (!duel) continue;
    // A ship that has broken and run stops shooting.
    if (duel.from.spec.side === 'enemy' && environment.scatter > 0.4) continue;
    const gun = duel.from.guns[Math.floor(environment.rng() * duel.from.guns.length)];
    const from = shipWorldPoint(duel.from, gun);
    const to = duel.to.group.position.clone().add(new Vector3((environment.rng() - 0.5) * duel.to.spec.width, (environment.rng() - 0.5) * duel.to.spec.height, (environment.rng() - 0.5) * duel.to.spec.length * 0.7));
    const color = duel.from.spec.side === 'friend' ? hdr(CYAN, 2.0) : hdr(CRIMSON, 1.9);
    queueTracers(environment, from, to, 1 + Math.floor(environment.rng() * 3 * intensity), color, 0.07, 7);
  }
}

// ---- per-frame ----------------------------------------------------------------------

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  dt: number;
  railU: number;
  running: boolean;
  beat: number;
  shield: number; // 1 = up, 0 = down
  shieldPulse: number;
  victory: number; // seconds since the flagship died, or -1
};

export function updateEnvironment(environment: Environment, frame: EnvironmentFrame) {
  const { dt, camera } = frame;
  environment.clock += dt;
  environment.nebula.position.copy(camera.position);
  environment.stars.position.copy(camera.position);
  beatUniform.value = frame.beat;
  shieldUniform.value = frame.shield;
  shieldPulseUniform.value = frame.shieldPulse;

  // Engines breathe with the beat; a broken enemy line flares its drives and runs.
  for (const ship of environment.ships) {
    const enemy = ship.spec.side === 'enemy';
    const flare = enemy ? 1 + environment.scatter * 1.6 : 1;
    ship.engineMaterial.color.copy(enemy ? MOLTEN : CYAN).multiplyScalar((enemy ? 1.3 : 1.45) * (1 + frame.beat * 0.2) * flare);
    if (enemy && ship !== environment.flagship && environment.scatter > 0) {
      const base = ship.group.userData.basePosition as Vector3;
      const rotation = ship.group.userData.baseRotation as Vector3;
      const away = new Vector3(Math.sign(base.x) || 1, 0.25, -1).normalize();
      ship.group.position.copy(base).addScaledVector(away, environment.scatter * environment.scatter * 260);
      ship.group.rotation.set(rotation.x + environment.scatter * 0.25, rotation.y + environment.scatter * 0.5 * Math.sign(base.x), rotation.z + environment.scatter * 0.4);
    }
  }

  updateFlagshipBreak(environment, frame);
  updateTracers(environment, dt);
  updateKnots(environment);
  updateDust(environment, frame.railU);
}

function updateFlagshipBreak(environment: Environment, frame: EnvironmentFrame) {
  if (frame.victory < 0) {
    if (environment.breaking >= 0) {
      // Run restarted: put the flagship back together.
      for (const segment of environment.flagship.segments) {
        segment.position.set(0, 0, 0);
        segment.rotation.set(0, 0, 0);
      }
      environment.flagship.stripMaterial.color.copy(hdr(MOLTEN, 1.35));
      environment.breaking = -1;
      environment.scatter = 0;
    }
    return;
  }
  environment.breaking = frame.victory;
  const since = frame.victory;
  environment.scatter = MathUtils.clamp((since - 1.5) / 9, 0, 1);
  // Chain detonations walk the hull, then the three segments shear apart and tumble.
  if (environment.rng() < Math.min(0.9, frame.dt * (since < 5 ? 9 : 2.5))) {
    const local = new Vector3((environment.rng() - 0.5) * ENEMY_FLAGSHIP.width, (environment.rng() - 0.5) * ENEMY_FLAGSHIP.height, (environment.rng() - 0.5) * ENEMY_FLAGSHIP.length);
    const world = environment.flagship.group.localToWorld(local);
    spawnFlash(world, environment.rng() < 0.3 ? hdr(WHITE_HOT, 1.6) : hdr(MOLTEN, 1.5), 8 + environment.rng() * 16, 0.5 + environment.rng() * 0.5);
  }
  const shear = MathUtils.clamp((since - 1.2) / 8, 0, 1);
  const eased = shear * shear;
  environment.flagship.segments.forEach((segment, index) => {
    const direction = index === 0 ? new Vector3(-0.35, 0.5, -1) : index === 2 ? new Vector3(0.4, -0.35, 1) : new Vector3(0, -0.6, 0);
    segment.position.copy(direction.normalize().multiplyScalar(eased * 90));
    segment.rotation.set(eased * 0.35 * (index - 1), eased * 0.2, eased * 0.5 * (index === 1 ? 1 : -0.6));
  });
  const flicker = since < 2.5 ? (Math.sin(since * 60) > 0 ? 2.2 : 0.4) : Math.max(0, 1 - (since - 2.5) / 3);
  environment.flagship.stripMaterial.color.copy(MOLTEN).multiplyScalar(1.35 * flicker);
}

function updateTracers(environment: Environment, dt: number) {
  const { pendingTracers, tracers, tracerMesh } = environment;
  for (let i = pendingTracers.length - 1; i >= 0; i -= 1) {
    const pending = pendingTracers[i];
    if (pending.at > environment.clock) continue;
    pendingTracers.splice(i, 1);
    const slot = tracers.find((tracer) => !tracer.active);
    if (!slot) continue;
    slot.active = true;
    slot.from.copy(pending.from);
    slot.to.copy(pending.to);
    slot.t = 0;
    slot.speed = 220 + environment.rng() * 120;
    slot.color.copy(pending.color);
    slot.length = pending.length;
  }
  let count = 0;
  for (const tracer of tracers) {
    if (!tracer.active) continue;
    const distance = tracer.from.distanceTo(tracer.to);
    tracer.t += (tracer.speed * dt) / Math.max(1, distance);
    if (tracer.t >= 1) {
      tracer.active = false;
      spawnFlash(tracer.to, tracer.color.clone().multiplyScalar(0.7), 2.5 + environment.rng() * 3, 0.35);
      continue;
    }
    scratchVector.copy(tracer.from).lerp(tracer.to, tracer.t);
    const direction = tracer.to.clone().sub(tracer.from).normalize();
    scratchQuaternion.setFromUnitVectors(FORWARD, direction);
    scratchScale.set(1, 1, tracer.length);
    scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
    tracerMesh.setMatrixAt(count, scratchMatrix);
    tracerMesh.setColorAt(count, tracer.color);
    count += 1;
  }
  tracerMesh.count = count;
  tracerMesh.instanceMatrix.needsUpdate = true;
  if (tracerMesh.instanceColor) tracerMesh.instanceColor.needsUpdate = true;
}

function updateKnots(environment: Environment) {
  const { knots, knotMesh, clock } = environment;
  knots.forEach((knot, index) => {
    const a = knot.a + clock * knot.wa;
    const b = knot.b + clock * knot.wb;
    scratchVector.set(
      knot.center.x + Math.cos(a) * knot.radius,
      knot.center.y + Math.sin(b) * knot.radius * 0.45,
      knot.center.z + Math.sin(a) * knot.radius * 0.8,
    );
    // Nose along the velocity.
    const velocity = new Vector3(-Math.sin(a) * knot.wa * knot.radius, Math.cos(b) * knot.wb * knot.radius * 0.45, Math.cos(a) * knot.wa * knot.radius * 0.8);
    if (velocity.lengthSq() > 0.0001) scratchQuaternion.setFromUnitVectors(FORWARD, velocity.normalize());
    scratchScale.setScalar(knot.scale);
    scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
    knotMesh.setMatrixAt(index, scratchMatrix);
    knotMesh.setColorAt(index, knot.color);
  });
  knotMesh.instanceMatrix.needsUpdate = true;
  if (knotMesh.instanceColor) knotMesh.instanceColor.needsUpdate = true;
}

function updateDust(environment: Environment, cameraU: number) {
  const { dust, dustMesh, curve, rng } = environment;
  const length = curve.getLength();
  const behindU = DUST_BEHIND / length;
  const aheadU = DUST_AHEAD / length;
  const minU = cameraU - behindU;
  const maxU = cameraU + aheadU;
  dust.forEach((mote, index) => {
    if (mote.u < minU || mote.u > maxU + aheadU) {
      mote.u = minU + rng() * (aheadU + behindU);
      mote.offset.copy(dustOffset(rng));
    }
    const frame = sampleRailFrame(curve, MathUtils.clamp(mote.u, 0, 1));
    scratchVector.copy(frame.position).addScaledVector(frame.right, mote.offset.x).addScaledVector(frame.up, mote.offset.y);
    scratchQuaternion.setFromUnitVectors(FORWARD, frame.tangent);
    scratchScale.set(mote.size, mote.size, mote.size * 1.5);
    scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
    dustMesh.setMatrixAt(index, scratchMatrix);
    scratchColor.set(0.42, 0.3, 0.46).multiplyScalar(0.18 + mote.size * 0.16);
    dustMesh.setColorAt(index, scratchColor);
  });
  dustMesh.instanceMatrix.needsUpdate = true;
  if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
}

export function setObjectVisible(object: Object3D, visible: boolean) {
  object.visible = visible;
}
