import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { broadsideProgress } from '../battlefield';
import { createHullBuilder } from './hull-kit';
import { CRIMSON, CYAN, hdr, MOLTEN, mulberry32, OBSIDIAN, WHITE_HOT, ICE } from './palette';
import type { Fleet, FleetShip } from './fleet';
import type { Fx } from './fx';

// The ambient war: cruisers trading fire in every direction, swarms of small
// craft knotted through the gaps, hulls flashing where shots land, and a
// rushing dust of debris that makes the rail's speed legible. None of it is
// interactive; all of it is driven by the frame data the spine hands in.

export type BattleFrame = {
  dt: number;
  elapsed: number;
  runTime: number;
  running: boolean;
  camera: Camera;
  railSpeed: number;
  /** Ship-to-ship tracers per second, by side, across the visible fleet. */
  fireRate: { friendly: number; enemy: number };
  /** Random flak puffs per second in the airspace ahead. */
  flakRate: number;
  /** A friendly ship whose guns should ripple along the camera's flank; null when none. */
  broadside: { shipId: string; rate: number } | null;
  /** 0 normal, 1 the enemy line is burning. */
  burning: number;
};

export type SwarmCluster = {
  center: readonly [number, number, number];
  side: 'friendly' | 'enemy';
  count: number;
  radius: number;
};

const FORWARD = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

function craftGeometry(bodyColor: Color, glowColor: Color) {
  const builder = createHullBuilder(new Quaternion(), {
    ambient: new Color(1, 1, 1),
    keys: [],
  });
  // Nose along +z, like the hero enemy craft.
  builder.taperedBox(0, 0, 0, 2.2, 0.8, 7, 0.15, 0.6, bodyColor);
  builder.box(0, 0.35, -0.6, 0.6, 0.5, 2.6, bodyColor);
  builder.taperedBox(0, 0, -1.5, 8, 0.22, 2.8, 0.25, 1, bodyColor);
  builder.box(0, 0, -3.6, 1.4, 0.9, 1.2, glowColor, { glow: true });
  return builder.build();
}

export function createBattle(options: {
  scene: Group;
  fx: Fx;
  fleet: Fleet;
  curve: CatmullRomCurve3;
  clusters: readonly SwarmCluster[];
}) {
  const { scene, fx, fleet, curve, clusters } = options;
  const group = new Group();
  scene.add(group);
  const rng = mulberry32(7741);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const colorScratch = new Color();
  const zAxis = new Vector3(0, 0, 1);
  const disposables: Array<{ dispose(): void }> = [];

  // ---- rushing dust: streaks in the camera's frame ----
  const DUST = 340;
  const dustMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
  const dust = new InstancedMesh(new BoxGeometry(1, 1, 1), dustMaterial, DUST);
  dust.frustumCulled = false;
  dust.userData.raildIgnoreOcclusion = true;
  group.add(dust);
  disposables.push(dust.geometry, dustMaterial, dust);
  const dustState = Array.from({ length: DUST }, () => ({
    x: 0,
    y: 0,
    z: 0,
    tint: 0.5 + rng() * 0.5,
    warm: rng(),
  }));
  const DUST_NEAR = 14;
  const DUST_FAR = 190;
  function seedDust(item: (typeof dustState)[number], initial: boolean) {
    const radius = 5 + Math.sqrt(rng()) * 58;
    const angle = rng() * Math.PI * 2;
    item.x = Math.cos(angle) * radius;
    item.y = Math.sin(angle) * radius * 0.7;
    item.z = initial ? -DUST_NEAR - rng() * (DUST_FAR - DUST_NEAR) : -DUST_FAR - rng() * 30;
  }
  dustState.forEach((item) => seedDust(item, true));

  // ---- debris chunks scattered along the rail: dark shards that flash by ----
  const CHUNKS = 260;
  const chunkMaterial = new MeshBasicMaterial({ color: 0xffffff, fog: true });
  const chunks = new InstancedMesh(new OctahedronGeometry(1, 0), chunkMaterial, CHUNKS);
  chunks.frustumCulled = false;
  chunks.userData.raildIgnoreOcclusion = true; // small drifting shards: speed cues, not scenery
  group.add(chunks);
  disposables.push(chunks.geometry, chunkMaterial, chunks);
  const chunkData: Array<{ position: Vector3; scale: Vector3; axis: Vector3; spin: number; color: Color; phase: number }> = [];
  {
    const color = new Color();
    for (let i = 0; i < CHUNKS; i += 1) {
      const u = 0.02 + rng() * 0.96;
      const frame = sampleRailFrame(curve, u);
      const radius = 9 + rng() ** 0.7 * 110;
      const angle = rng() * Math.PI * 2;
      const position = frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius * 0.8);
      const size = 0.8 + rng() ** 2.4 * 7;
      chunkData.push({
        position,
        scale: new Vector3(size * (0.6 + rng()), size * (0.4 + rng() * 0.7), size * (0.7 + rng())),
        axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        spin: (rng() - 0.5) * 0.9,
        color: color.setRGB(0.06 + rng() * 0.08, 0.05 + rng() * 0.06, 0.08 + rng() * 0.09).clone(),
        phase: rng() * 6,
      });
    }
  }

  // ---- ambient swarms ----
  const friendlyCraft = craftGeometry(ICE.clone().multiplyScalar(0.3), hdr(CYAN, 3));
  const enemyCraft = craftGeometry(OBSIDIAN.clone().multiplyScalar(0.5), hdr(MOLTEN, 3.2));
  const craftMaterial = new MeshBasicMaterial({ vertexColors: true, fog: true });
  const glowMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false });
  const swarms: Array<{
    hull: InstancedMesh;
    glow: InstancedMesh | null;
    craft: Array<{ center: Vector3; amp: Vector3; freq: Vector3; phase: Vector3; roll: number }>;
  }> = [];
  for (const side of ['friendly', 'enemy'] as const) {
    const geometry = side === 'friendly' ? friendlyCraft : enemyCraft;
    const total = clusters.filter((cluster) => cluster.side === side).reduce((sum, cluster) => sum + cluster.count, 0);
    if (total === 0) continue;
    const hull = new InstancedMesh(geometry.hull, craftMaterial, total);
    const glow = geometry.glow ? new InstancedMesh(geometry.glow, glowMaterial, total) : null;
    hull.frustumCulled = false;
    if (glow) glow.frustumCulled = false;
    hull.userData.raildIgnoreOcclusion = true;
    if (glow) glow.userData.raildIgnoreOcclusion = true;
    group.add(hull);
    if (glow) group.add(glow);
    const craft: (typeof swarms)[number]['craft'] = [];
    for (const cluster of clusters.filter((candidate) => candidate.side === side)) {
      for (let i = 0; i < cluster.count; i += 1) {
        craft.push({
          center: new Vector3(...cluster.center),
          amp: new Vector3(cluster.radius * (0.5 + rng() * 0.6), cluster.radius * (0.25 + rng() * 0.3), cluster.radius * (0.5 + rng() * 0.6)),
          freq: new Vector3(0.22 + rng() * 0.32, 0.3 + rng() * 0.4, 0.2 + rng() * 0.3),
          phase: new Vector3(rng() * 6.28, rng() * 6.28, rng() * 6.28),
          roll: (rng() - 0.5) * 0.6,
        });
      }
    }
    swarms.push({ hull, glow, craft });
    disposables.push(hull, ...(glow ? [glow] : []));
  }
  disposables.push(friendlyCraft.hull, enemyCraft.hull, craftMaterial, glowMaterial);
  if (friendlyCraft.glow) disposables.push(friendlyCraft.glow);
  if (enemyCraft.glow) disposables.push(enemyCraft.glow);

  // ---- launch wingmen: four fighters fly off the deck ahead of you and peel away over the bow ----
  const WINGMEN = 4;
  const wingHull = new InstancedMesh(friendlyCraft.hull, craftMaterial, WINGMEN);
  const wingGlow = friendlyCraft.glow ? new InstancedMesh(friendlyCraft.glow, glowMaterial, WINGMEN) : null;
  for (const mesh of [wingHull, wingGlow]) {
    if (!mesh) continue;
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    parkWingmen(mesh);
    group.add(mesh);
    disposables.push(mesh);
  }
  const railLength = curve.getLength();
  const wingDummy = new Group();

  /** Idle wingmen stay drawn as zero-scale slots so their pipelines compile before the run starts. */
  function parkWingmen(mesh: InstancedMesh) {
    mesh.setMatrixAt(0, matrix.makeScale(0, 0, 0));
    mesh.count = 1;
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function updateWingmen(frame: BattleFrame) {
    const active = frame.running && frame.runTime < 9.5;
    if (!active) {
      parkWingmen(wingHull);
      if (wingGlow) parkWingmen(wingGlow);
      return;
    }
    const t = frame.runTime;
    const u = broadsideProgress(t);
    const peel = Math.min(1, Math.max(0, (t - 3.6) / 3.4));
    const peelEase = peel * peel;
    for (let i = 0; i < WINGMEN; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const slot = i < 2 ? 0 : 1;
      const ahead = 34 + slot * 18 + Math.min(1, t / 3.8) * 34 + peelEase * 90;
      const railFrame = sampleRailFrame(curve, Math.min(1, u + ahead / railLength));
      const lateral = side * (12 + slot * 8 + peelEase * 110);
      const vertical = 2.5 + slot * 4 + peelEase * 46;
      wingDummy.position.copy(railFrame.position).addScaledVector(railFrame.right, lateral).addScaledVector(railFrame.up, vertical);
      tmpA.copy(railFrame.tangent).addScaledVector(railFrame.right, side * peel * 0.9).addScaledVector(railFrame.up, peel * 0.35);
      wingDummy.lookAt(tmpB.copy(wingDummy.position).add(tmpA));
      wingDummy.rotateZ(side * peelEase * 1.2);
      wingDummy.scale.setScalar(1.35);
      wingDummy.updateMatrix();
      wingHull.setMatrixAt(i, wingDummy.matrix);
      wingGlow?.setMatrixAt(i, wingDummy.matrix);
    }
    wingHull.count = WINGMEN;
    wingHull.instanceMatrix.needsUpdate = true;
    if (wingGlow) {
      wingGlow.count = WINGMEN;
      wingGlow.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- fire control ----
  let fireDebt = { friendly: 0, enemy: 0 };
  let flakDebt = 0;
  let broadsideDebt = 0;
  const pending: Array<() => void> = [];
  const friendlyShips = fleet.ships.filter((ship) => ship.spec.side === 'friendly');
  const enemyShips = fleet.ships.filter((ship) => ship.spec.side === 'enemy');
  const bolt = { friendly: hdr(CYAN, 3.4), enemy: hdr(CRIMSON, 3.4) };
  const flare = { friendly: hdr(CYAN, 2.2), enemy: hdr(MOLTEN, 2.4) };

  function visibleShips(ships: FleetShip[], cameraPosition: Vector3, maxDistance: number) {
    return ships.filter((ship) => {
      const d = tmpA.copy(ship.group.position).sub(cameraPosition);
      const distance = d.length();
      return distance < maxDistance && distance > 20 && d.dot(FORWARD) > -0.25 * distance;
    });
  }

  /** A hit flash. `warm` when enemy fire (or fire) struck; cyan when the fleet's fire did. */
  function impact(point: Vector3, warm: boolean, big: boolean, scale = 1) {
    const color = warm ? flare.enemy : flare.friendly;
    const hull = warm ? hdr(MOLTEN, 3) : hdr(CYAN, 3);
    fx.flash(point, WHITE_HOT.clone().multiplyScalar(2.2 * Math.min(1, scale + 0.3)), (big ? 11 : 4.5) * scale, big ? 0.55 : 0.25, big ? 2.8 : 1.6, 1.6, 0.08);
    fx.flash(point, color, (big ? 20 : 8) * scale, big ? 0.9 : 0.45, 2.4, 1.6, 0.09);
    if (big) {
      fx.ring(point, hull, 5 * scale, 0.7, 4);
      fx.burst(point, color, Math.round(12 * scale), 30, 0.9, 3, 0.4);
    } else {
      fx.burst(point, color, 4, 16, 0.5, 1.6, 0.25);
    }
  }

  function fireBolt(from: Vector3, toShip: FleetShip, side: 'friendly' | 'enemy', cameraPosition: Vector3, target?: Vector3) {
    const point = target ?? toShip.worldSurface[Math.floor(rng() * toShip.worldSurface.length)];
    if (!point) return;
    const distance = from.distanceTo(point);
    const travel = Math.min(3.4, Math.max(0.55, distance / 620));
    const near = from.distanceTo(cameraPosition);
    const width = 0.5 + Math.min(1.2, near * 0.0009);
    const length = 14 + Math.min(40, distance * 0.05);
    fx.flash(from, flare[side], 2.6 + Math.min(4, near * 0.004), 0.2, 1.8);
    const dest = point.clone();
    const warm = side === 'enemy';
    fx.bolt(from, dest, bolt[side], travel, length, width, () => impact(dest, warm, rng() < 0.16));
  }

  function fireRandom(side: 'friendly' | 'enemy', cameraPosition: Vector3) {
    const shooters = visibleShips(side === 'friendly' ? friendlyShips : enemyShips, cameraPosition, 2700);
    const targets = visibleShips(side === 'friendly' ? enemyShips : friendlyShips, cameraPosition, 3200);
    if (shooters.length === 0 || targets.length === 0) return;
    const shooter = shooters[Math.floor(rng() * shooters.length)];
    const gun = shooter.worldGuns[Math.floor(rng() * shooter.worldGuns.length)];
    if (!gun) return;
    const target = targets[Math.floor(rng() * targets.length)];
    fireBolt(gun.position, target, side, cameraPosition);
  }

  function flak(cameraPosition: Vector3) {
    const distance = 60 + rng() * 260;
    const spread = distance * 0.55;
    const point = tmpB.copy(cameraPosition)
      .addScaledVector(FORWARD, distance)
      .add(tmpC.set((rng() - 0.5) * spread * 2, (rng() - 0.5) * spread * 1.1, (rng() - 0.5) * spread * 2));
    fx.flash(point, hdr(MOLTEN, 2.4), 3 + rng() * 5, 0.5 + rng() * 0.3, 2.6);
    fx.flash(point, hdr(CRIMSON, 1.6), 7 + rng() * 8, 0.8, 2, 2);
    fx.burst(point, hdr(MOLTEN, 2.4), 7, 22, 0.7, 2, 0.22);
  }

  /** The friendly cruiser's guns ripple along the flank ahead of the camera. */
  function broadsideVolley(shipId: string, guns: number, cameraPosition: Vector3) {
    const ship = fleet.ships.find((candidate) => candidate.spec.id === shipId);
    if (!ship) return;
    const facing = ship.worldGuns
      .map((gun) => ({ gun, distance: gun.position.distanceTo(cameraPosition), ahead: tmpA.copy(gun.position).sub(cameraPosition).dot(FORWARD) }))
      .filter((entry) => entry.ahead > 20 && entry.ahead < 380 && entry.gun.direction.x > 0.2)
      .sort((a, b) => a.ahead - b.ahead);
    if (facing.length === 0) return;
    const targets = enemyShips.filter((enemyShip) => enemyShip.group.position.x > ship.group.position.x);
    for (let i = 0; i < guns; i += 1) {
      const entry = facing[Math.floor(rng() * Math.min(facing.length, 14))];
      const target = targets[Math.floor(rng() * targets.length)];
      if (!entry || !target) continue;
      pending.push(() => {
        fx.flash(entry.gun.position, hdr(WHITE_HOT, 2.6), 5.5, 0.22, 2, 1.4);
        fx.ring(entry.gun.position, hdr(CYAN, 2.4), 3, 0.5, 8);
        fireBolt(entry.gun.position, target, 'friendly', cameraPosition);
      });
    }
  }

  // The enemy shells the same flank: crimson shots striking the cruiser wall near the camera.
  function wallStrike(shipId: string, cameraPosition: Vector3) {
    const ship = fleet.ships.find((candidate) => candidate.spec.id === shipId);
    if (!ship) return;
    const shooters = enemyShips.filter((enemyShip) => enemyShip.worldGuns.length > 0 && enemyShip.group.position.x > 100);
    const shooter = shooters[Math.floor(rng() * shooters.length)];
    if (!shooter) return;
    const gun = shooter.worldGuns[Math.floor(rng() * shooter.worldGuns.length)];
    const wallX = ship.spec.center[0] + ship.spec.beam / 2 + 1;
    const ahead = 40 + rng() * 260;
    const point = new Vector3(wallX, ship.spec.center[1] + (rng() - 0.5) * ship.spec.height * 0.7, cameraPosition.z - ahead);
    fireBolt(gun.position, ship, 'enemy', cameraPosition, point);
  }

  function update(frame: BattleFrame) {
    const { dt, elapsed } = frame;
    const camera = frame.camera;
    camera.getWorldDirection(FORWARD);
    const cameraPosition = camera.position;

    // Fire control
    fireDebt.friendly += frame.fireRate.friendly * dt;
    fireDebt.enemy += frame.fireRate.enemy * dt;
    while (fireDebt.friendly >= 1) {
      fireDebt.friendly -= 1;
      fireRandom('friendly', cameraPosition);
    }
    while (fireDebt.enemy >= 1) {
      fireDebt.enemy -= 1;
      fireRandom('enemy', cameraPosition);
    }
    flakDebt += frame.flakRate * dt;
    while (flakDebt >= 1) {
      flakDebt -= 1;
      flak(cameraPosition);
    }
    if (frame.broadside) {
      broadsideDebt += frame.broadside.rate * dt;
      while (broadsideDebt >= 1) {
        broadsideDebt -= 1;
        broadsideVolley(frame.broadside.shipId, 1, cameraPosition);
        if (rng() < 0.45) wallStrike(frame.broadside.shipId, cameraPosition);
      }
    }
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      pending[i]();
      pending.splice(i, 1);
    }

    // Burning enemy line: fires spring from the wrecks.
    if (frame.burning > 0) {
      for (const ship of enemyShips) {
        if (rng() < dt * 1.8 * frame.burning) {
          const local = ship.model.surface[Math.floor(rng() * ship.model.surface.length)];
          if (!local) continue;
          impact(ship.group.localToWorld(local.clone()), true, rng() < 0.35, 0.55);
        }
      }
    }

    // Dust
    const speed = Math.max(4, frame.railSpeed);
    const streak = Math.min(5.5, 0.35 + speed * 0.028);
    let count = 0;
    for (const item of dustState) {
      item.z += speed * dt;
      if (item.z > -DUST_NEAR * 0.4) seedDust(item, false);
      tmpA.set(item.x, item.y, item.z).applyQuaternion(camera.quaternion).add(cameraPosition);
      const distanceFade = Math.min(1, (-item.z - DUST_NEAR * 0.4) / 30) * Math.min(1, (DUST_FAR - -item.z) / 60);
      scale.set(0.06 + item.tint * 0.05, 0.06 + item.tint * 0.05, streak);
      matrix.compose(tmpA, camera.quaternion, scale);
      dust.setMatrixAt(count, matrix);
      const warm = item.warm;
      dust.setColorAt(count, colorScratch.setRGB(0.95, 0.68 + warm * 0.25, 0.5 + warm * 0.4).multiplyScalar(0.55 * item.tint * distanceFade));
      count += 1;
    }
    dust.count = count;
    dust.instanceMatrix.needsUpdate = true;
    if (dust.instanceColor) dust.instanceColor.needsUpdate = true;

    // Chunks
    for (let i = 0; i < chunkData.length; i += 1) {
      const chunk = chunkData[i];
      quaternion.setFromAxisAngle(chunk.axis, chunk.phase + elapsed * chunk.spin);
      matrix.compose(chunk.position, quaternion, chunk.scale);
      chunks.setMatrixAt(i, matrix);
      chunks.setColorAt(i, chunk.color);
    }
    chunks.instanceMatrix.needsUpdate = true;
    if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true;

    updateWingmen(frame);

    // Swarms: lissajous dogfights, flown nose-first along their own velocity.
    for (const swarm of swarms) {
      swarm.craft.forEach((craft, index) => {
        const t = elapsed;
        const position = tmpA.set(
          craft.center.x + Math.sin(t * craft.freq.x + craft.phase.x) * craft.amp.x,
          craft.center.y + Math.sin(t * craft.freq.y + craft.phase.y) * craft.amp.y,
          craft.center.z + Math.sin(t * craft.freq.z + craft.phase.z) * craft.amp.z,
        );
        const velocity = tmpB.set(
          Math.cos(t * craft.freq.x + craft.phase.x) * craft.amp.x * craft.freq.x,
          Math.cos(t * craft.freq.y + craft.phase.y) * craft.amp.y * craft.freq.y,
          Math.cos(t * craft.freq.z + craft.phase.z) * craft.amp.z * craft.freq.z,
        );
        if (velocity.lengthSq() < 1e-6) velocity.set(0, 0, 1);
        velocity.normalize();
        quaternion.setFromUnitVectors(zAxis, velocity);
        const roll = new Quaternion().setFromAxisAngle(velocity, craft.roll + Math.sin(t * 0.7 + index) * 0.5);
        quaternion.premultiply(roll);
        scale.setScalar(0.8);
        matrix.compose(position, quaternion, scale);
        swarm.hull.setMatrixAt(index, matrix);
        swarm.glow?.setMatrixAt(index, matrix);
      });
      swarm.hull.instanceMatrix.needsUpdate = true;
      if (swarm.glow) swarm.glow.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    group.removeFromParent();
    for (const item of disposables) item.dispose();
  }

  /** A synchronized salvo (used on the beat): `guns` firing at once along the friendly flank. */
  function broadsideBurst(shipId: string, guns: number, cameraPosition: Vector3, camera: Camera) {
    camera.getWorldDirection(FORWARD);
    broadsideVolley(shipId, guns, cameraPosition);
  }

  return { group, update, dispose, impact, fireBolt, broadsideBurst };
}
