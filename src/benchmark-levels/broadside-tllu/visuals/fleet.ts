import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  PlaneGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { createGlowMaterial } from './fx';
import type { Camera } from 'three';
import { abs, dot, exp, float, mix, mx_noise_float, normalize, normalView, positionLocal, positionView, smoothstep, sin, uniform, vec3 } from 'three/tsl';
import { FLAGSHIP, SHIPS, shipMatrix, type ShipSpec } from '../battlefield';
import { CYAN, ENEMY_LOOK, FRIENDLY_LOOK, hdr, MOLTEN, SHIELD_AMBER, SHIELD_ROSE } from './palette';
import { buildShip, type ShipModel } from './ships';

export type FleetShip = {
  spec: ShipSpec;
  group: Group;
  model: ShipModel;
  worldGuns: Array<{ position: Vector3; direction: Vector3 }>;
  worldSurface: Vector3[];
  worldHangars: Vector3[];
  /** Broken halves for the flagship, animated on destruction. */
  halves?: { fore: Group; aft: Group };
  base: { position: Vector3; quaternion: Quaternion };
  drift: Vector3;
  tumble: Vector3;
};

// Shield shader knobs, written by the runtime.
export const shieldStrengthUniform = uniform(1);
export const shieldHitPositionUniform = uniform(new Vector3(0, 0, 0));
export const shieldHitAgeUniform = uniform(9);
export const shieldFlickerUniform = uniform(0);

export type Fleet = ReturnType<typeof createFleet>;

/** Split a triangle-list geometry by the local z of each triangle's centroid. */
function splitByZ(geometry: BufferGeometry, z: number): [BufferGeometry, BufferGeometry] {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const index = geometry.getIndex();
  const halves = [{ positions: [] as number[], colors: [] as number[] }, { positions: [] as number[], colors: [] as number[] }];
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let t = 0; t < triangleCount; t += 1) {
    const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
    const centroid = (position.getZ(ids[0]) + position.getZ(ids[1]) + position.getZ(ids[2])) / 3;
    const target = halves[centroid < z ? 0 : 1];
    for (const id of ids) {
      target.positions.push(position.getX(id), position.getY(id), position.getZ(id));
      target.colors.push(color.getX(id), color.getY(id), color.getZ(id));
    }
  }
  return halves.map((half) => {
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(half.positions, 3));
    result.setAttribute('color', new Float32BufferAttribute(half.colors, 3));
    const indices = Array.from({ length: half.positions.length / 3 }, (_, i) => i);
    result.setIndex(new Uint32BufferAttribute(indices, 1));
    result.computeBoundingSphere();
    return result;
  }) as [BufferGeometry, BufferGeometry];
}

function createShieldMaterial() {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;
  material.fog = false;

  const facing = abs(dot(normalize(normalView), normalize(positionView.negate())));
  const rim = float(1).sub(facing).pow(2.4);
  // Triangular energy lattice from three phase-shifted sines over the local surface.
  const u = positionLocal.z.mul(0.11);
  const v = positionLocal.y.mul(0.11).add(positionLocal.x.mul(0.05));
  const h = sin(u).add(sin(u.mul(0.5).add(v.mul(0.866)))).add(sin(u.mul(0.5).sub(v.mul(0.866))));
  const lattice = smoothstep(float(1.7), float(2.75), abs(h));
  const shimmer = mx_noise_float(positionLocal.mul(0.03)).mul(0.5).add(0.5);
  const distance = positionLocal.sub(shieldHitPositionUniform).length();
  const ring = exp(distance.sub(shieldHitAgeUniform.mul(210)).div(16).pow(2).negate()).mul(exp(shieldHitAgeUniform.mul(-2.4)));
  const energy = rim.mul(0.32).add(lattice.mul(shimmer.mul(0.22).add(0.07))).add(ring.mul(0.55)).add(0.018);
  const rose = vec3(SHIELD_ROSE.r, SHIELD_ROSE.g, SHIELD_ROSE.b);
  const amber = vec3(SHIELD_AMBER.r, SHIELD_AMBER.g, SHIELD_AMBER.b);
  material.colorNode = mix(rose, amber, shimmer).mul(energy).mul(shieldStrengthUniform).mul(float(1).sub(shieldFlickerUniform.mul(0.5)));
  material.opacityNode = energy.mul(0.9).min(0.7).mul(shieldStrengthUniform);
  return material;
}

export function createFleet(shipsToBuild: readonly ShipSpec[] = SHIPS) {
  const root = new Group();
  const hullMaterial = new MeshBasicMaterial({ vertexColors: true });
  const glowMaterial = new MeshBasicMaterial({ vertexColors: true });
  const ships: FleetShip[] = [];
  const disposables: Array<{ dispose(): void }> = [hullMaterial, glowMaterial];

  const engineGeometry = new PlaneGeometry(2, 2);
  const engineMaterial = createGlowMaterial();
  const engineCount = shipsToBuild.length * 24;
  const engineGlow = new InstancedMesh(engineGeometry, engineMaterial, engineCount);
  engineGlow.frustumCulled = false;
  engineGlow.userData.raildIgnoreOcclusion = true;
  engineGlow.count = 1;
  const engineData: Array<{ position: Vector3; radius: number; color: Color; phase: number; ship: FleetShip }> = [];

  for (const spec of shipsToBuild) {
    const look = spec.side === 'friendly' ? FRIENDLY_LOOK : ENEMY_LOOK;
    const model = buildShip(spec, look);
    const matrix = shipMatrix(spec);
    const group = new Group();
    group.matrixAutoUpdate = true;
    const position = new Vector3();
    const quaternion = new Quaternion();
    matrix.decompose(position, quaternion, new Vector3());
    group.position.copy(position);
    group.quaternion.copy(quaternion);

    const worldGuns = model.guns.map((gun) => ({
      position: gun.position.clone().applyMatrix4(matrix),
      direction: gun.direction.clone().applyQuaternion(quaternion),
    }));
    const worldSurface = model.surface.map((point) => point.clone().applyMatrix4(matrix));
    const worldHangars = model.hangars.map((hangar) => hangar.position.clone().applyMatrix4(matrix));
    const ship: FleetShip = {
      spec,
      group,
      model,
      worldGuns,
      worldSurface,
      worldHangars,
      base: { position: position.clone(), quaternion: quaternion.clone() },
      drift: new Vector3(),
      tumble: new Vector3(),
    };

    if (spec.cls === 'flagship') {
      const splitZ = 60;
      const [foreHull, aftHull] = splitByZ(model.hull, splitZ);
      const fore = new Group();
      const aft = new Group();
      const foreMesh = new Mesh(foreHull, hullMaterial);
      foreMesh.name = `ship-${spec.id}-fore`;
      const aftMesh = new Mesh(aftHull, hullMaterial);
      aftMesh.name = `ship-${spec.id}-aft`;
      fore.add(foreMesh);
      aft.add(aftMesh);
      if (model.glow) {
        const [foreGlow, aftGlow] = splitByZ(model.glow, splitZ);
        fore.add(new Mesh(foreGlow, glowMaterial));
        aft.add(new Mesh(aftGlow, glowMaterial));
        disposables.push(foreGlow, aftGlow);
      }
      disposables.push(foreHull, aftHull);
      group.add(fore, aft);
      ship.halves = { fore, aft };
    } else {
      const hullMesh = new Mesh(model.hull, hullMaterial);
      hullMesh.name = `ship-${spec.id}`;
      group.add(hullMesh);
      if (model.glow) {
        const glowMesh = new Mesh(model.glow, glowMaterial);
        glowMesh.name = `ship-${spec.id}-glow`;
        group.add(glowMesh);
      }
      disposables.push(model.hull);
    }
    if (model.glow) disposables.push(model.glow);
    root.add(group);
    ships.push(ship);

    const color = spec.side === 'friendly' ? hdr(CYAN, 1.5) : hdr(MOLTEN, 1.7);
    for (const engine of model.engines) {
      engineData.push({ position: engine.position.clone().applyMatrix4(matrix), radius: engine.radius, color, phase: engineData.length * 0.73, ship });
    }
  }
  root.add(engineGlow);

  // The flagship's shield: a boxy superellipsoid standing off the hull.
  const flagship = ships.find((ship) => ship.spec.id === FLAGSHIP.spec.id);
  let shield: Mesh | null = null;
  if (flagship) {
    const geometry = new SphereGeometry(1, 56, 36);
    const p = geometry.getAttribute('position');
    const rx = FLAGSHIP.spec.beam / 2 + 34;
    const ry = FLAGSHIP.spec.height / 2 + 46;
    const rz = FLAGSHIP.spec.length / 2 + 70;
    const e = 0.38;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      p.setXYZ(i, Math.sign(x) * Math.abs(x) ** e * rx, Math.sign(y) * Math.abs(y) ** e * ry, Math.sign(z) * Math.abs(z) ** e * rz);
    }
    geometry.computeVertexNormals();
    shield = new Mesh(geometry, createShieldMaterial());
    shield.userData.raildIgnoreOcclusion = true;
    shield.renderOrder = 4;
    shield.frustumCulled = false;
    flagship.group.add(shield);
    disposables.push(geometry, shield.material as MeshBasicNodeMaterial);
  }

  // ---- animation state ----
  const scratchMatrix = new Matrix4();
  const scratchQuaternion = new Quaternion();
  const scratchScale = new Vector3();
  const scratchColor = new Color();
  const scratchEuler = new Euler();
  let shieldState: 'up' | 'collapsing' | 'down' = 'up';
  let shieldTimer = 0;
  let shieldHitAge = 9;
  let destroyedAt = -1;
  let destroyedClock = 0;

  const enemyShips = ships.filter((ship) => ship.spec.side === 'enemy' && ship.spec.id !== FLAGSHIP.spec.id);
  enemyShips.forEach((ship, index) => {
    const away = ship.base.position.clone().setY(0).normalize();
    ship.drift.set(away.x * (16 + index % 3 * 7), 6 + (index % 4) * 3, away.z * (6 + index % 2 * 8) - 18);
    ship.tumble.set(((index % 3) - 1) * 0.03, 0.03 + (index % 5) * 0.01, ((index + 1) % 3 - 1) * 0.05);
  });

  function reset() {
    shieldState = 'up';
    shieldTimer = 0;
    shieldStrengthUniform.value = 1;
    shieldFlickerUniform.value = 0;
    destroyedAt = -1;
    destroyedClock = 0;
    for (const ship of ships) {
      ship.group.position.copy(ship.base.position);
      ship.group.quaternion.copy(ship.base.quaternion);
      if (ship.halves) {
        ship.halves.fore.position.set(0, 0, 0);
        ship.halves.fore.quaternion.identity();
        ship.halves.aft.position.set(0, 0, 0);
        ship.halves.aft.quaternion.identity();
      }
    }
    if (shield) shield.visible = true;
  }

  function collapseShield() {
    if (shieldState !== 'up') return;
    shieldState = 'collapsing';
    shieldTimer = 0;
  }

  function hitShield(world: Vector3) {
    if (!flagship || !shield) return;
    const local = flagship.group.worldToLocal(world.clone());
    shieldHitPositionUniform.value.copy(local);
    shieldHitAge = 0;
  }

  /** The flagship dies: it splits, and the enemy line drifts and tumbles apart. */
  function destroy(clock: number) {
    destroyedAt = clock;
    destroyedClock = 0;
    if (shieldState !== 'down') {
      shieldState = 'down';
      shieldStrengthUniform.value = 0;
    }
  }

  function update(dt: number, elapsed: number, camera: Camera, beat = 0) {
    // Shield
    shieldHitAge += dt;
    shieldHitAgeUniform.value = Math.min(9, shieldHitAge);
    if (shieldState === 'collapsing') {
      shieldTimer += dt;
      const t = shieldTimer / 1.1;
      shieldFlickerUniform.value = Math.sin(shieldTimer * 60) > 0 ? 1 : 0;
      shieldStrengthUniform.value = Math.max(0, 1 - t * t) * (0.6 + 0.4 * Math.sin(shieldTimer * 38));
      if (t >= 1) {
        shieldState = 'down';
        shieldStrengthUniform.value = 0;
        shieldFlickerUniform.value = 0;
      }
    }
    if (shield) shield.visible = shieldState !== 'down' || shieldStrengthUniform.value > 0.01;

    // Engines
    let count = 0;
    for (const engine of engineData) {
      const pulse = 0.82 + 0.18 * Math.sin(elapsed * 6.5 + engine.phase);
      const size = engine.radius * (2.6 + 0.35 * pulse);
      scratchMatrix.compose(engine.position, camera.quaternion, scratchScale.set(size, size, size));
      engineGlow.setMatrixAt(count, scratchMatrix);
      engineGlow.setColorAt(count, scratchColor.copy(engine.color).multiplyScalar(0.34 + 0.16 * pulse + 0.14 * beat));
      count += 1;
    }
    engineGlow.count = count;
    engineGlow.instanceMatrix.needsUpdate = true;
    if (engineGlow.instanceColor) engineGlow.instanceColor.needsUpdate = true;

    // Victory: the enemy line scatters.
    if (destroyedAt >= 0) {
      destroyedClock += dt;
      const ramp = Math.min(1, destroyedClock / 2.5);
      for (const ship of enemyShips) {
        ship.group.position.addScaledVector(ship.drift, dt * ramp);
        scratchEuler.set(ship.tumble.x * dt * ramp * 8, ship.tumble.y * dt * ramp * 8, ship.tumble.z * dt * ramp * 8);
        ship.group.quaternion.multiply(scratchQuaternion.setFromEuler(scratchEuler));
      }
      if (flagship?.halves) {
        const t = destroyedClock;
        const split = Math.min(1, Math.max(0, t - 0.15));
        const push = split * split * 34 + split * 8;
        flagship.halves.fore.position.set(0, split * 5, -push);
        flagship.halves.aft.position.set(0, -split * 4, push * 0.8);
        flagship.halves.fore.quaternion.setFromEuler(scratchEuler.set(-split * 0.12, split * 0.05, split * 0.1));
        flagship.halves.aft.quaternion.setFromEuler(scratchEuler.set(split * 0.16, -split * 0.07, -split * 0.14));
      }
    }
  }

  function dispose() {
    root.removeFromParent();
    for (const item of disposables) item.dispose();
    engineGeometry.dispose();
    engineMaterial.dispose();
    engineGlow.dispose();
  }

  /** The enemy bay mouth closest to `point`, within `maxDistance`: where swarm craft visibly launch from. */
  function nearestBay(point: Vector3, maxDistance = 1500) {
    let best: Vector3 | null = null;
    let bestDistance = maxDistance;
    for (const ship of ships) {
      if (ship.spec.side !== 'enemy') continue;
      for (const bay of ship.worldHangars) {
        const distance = bay.distanceTo(point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = bay;
        }
      }
    }
    return best;
  }

  return { root, ships, flagship, enemyShips, update, reset, collapseShield, hitShield, destroy, nearestBay, dispose };
}
