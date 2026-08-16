import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  fract,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { scatterAlongRail } from '../../../engine/environment-kit';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BELLY_TIME,
  BROADSIDE_DURATION,
  EYE_TIME,
  MELEE2_TIME,
  SOVEREIGN,
  broadsideRunProgress,
  createBroadsideRail,
  placeFleet,
  railU,
  type ShipPlacement,
} from '../gameplay';
import { SALVO_TIMES } from '../timing';
import { spawnBloom, burstSparks, dropTrail } from './effects';
import { createCruiserMesh, createFlagshipMesh, type FlagshipMesh } from './fleet';
import {
  CRIMSON_FIRE,
  CYAN_ENGINE,
  CYAN_FIRE,
  CYAN_WINDOW,
  MOLTEN_ORANGE,
  NEBULA_DEEP,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  PLAYER_WHITE,
  SPACE_BLACK,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// The battlefield. Everything in the level that is not a target lives here:
// the magenta-and-gold nebula that owns the sky, the two fleets slugging it
// out in silhouette, the crossfire stitched between them, RELENTLESS's
// beat-timed broadside, the wreck field in the eye, and the flagship's
// death throes. Fleets are placed from the same rail anchors gameplay uses,
// so the set pieces always meet the camera on their bars.

export const beatUniform = uniform(0);

export type Environment = {
  root: Group;
  flagship: FlagshipMesh;
  relentless: Group;
  startFlagshipDeath(): void;
  flagshipDying(): boolean;
  update(dt: number, frame: EnvironmentFrame): void;
  resetRun(): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
};

const NEBULA_DIR = new Vector3(-0.3, 0.12, -0.94).normalize();

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = NEBULA_DEEP.clone();
  // Distance melts into the sky's own haze, never into black.
  // Authored in sRGB: the linear working-space lift would otherwise read as
  // a pale purple wash over everything past a few hundred units.
  scene.fog = new FogExp2(new Color().setRGB(0.14, 0.045, 0.15, SRGBColorSpace), 0.00045);

  const root = new Group();
  const rng = mulberry32(20260814);
  const curve = createBroadsideRail();
  const fleet = placeFleet(curve);

  const skydome = createSkydome();
  root.add(skydome);
  const { stars, starsMaterial } = createStars(rng);
  root.add(stars);
  root.add(createNebulaClouds(rng));
  // The nebula's gold heart: a fixed soft glow off the eye's shoulder, so
  // the debris field drifts through its backlight. Deterministic — the
  // scattered clouds are set dressing, this one is a landmark.
  const heartMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
  heartMaterial.colorNode = vec3(NEBULA_GOLD.r, NEBULA_GOLD.g, NEBULA_GOLD.b)
    .mul(smoothstep(float(0.5), float(0.02), positionLocal.xy.length()).mul(0.2));
  const heart = new Mesh(new PlaneGeometry(1, 1), heartMaterial);
  heart.scale.set(820, 480, 1);
  heart.position.copy(curve.getPointAt(railU(EYE_TIME + 1.8))).add(new Vector3(-430, 190, -260));
  heart.userData.raildIgnoreOcclusion = true;
  root.add(heart);

  // ---- the fleets ----------------------------------------------------------------
  const friendlyEngines: MeshBasicMaterial[] = [];
  const addShip = (placement: ShipPlacement, options: { variant: 'carrier' | 'cruiser' | 'wreck' | 'distant' }) => {
    const ship = createCruiserMesh({ faction: placement.faction, length: placement.length, variant: options.variant, rng });
    ship.group.position.copy(placement.position);
    ship.group.quaternion.copy(placement.quaternion);
    if (placement.faction === 'friendly') friendlyEngines.push(...ship.engineMaterials);
    root.add(ship.group);
    return ship.group;
  };

  addShip(fleet.home, { variant: 'carrier' });
  addShip(fleet.duelFriendly, { variant: 'cruiser' });
  addShip(fleet.duelEnemy, { variant: 'cruiser' });
  const relentless = addShip(fleet.relentless, { variant: 'cruiser' });
  addShip(fleet.belly, { variant: 'cruiser' });
  const wrecks = fleet.wrecks.map((placement) => {
    const group = addShip(placement, { variant: 'wreck' });
    group.userData.spin = new Vector3((rng() - 0.5) * 0.1, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.08);
    // Drifting hulks are set dressing: a target sliding briefly behind one
    // is fair play, so they never count as occluders.
    group.traverse((object) => { object.userData.raildIgnoreOcclusion = true; });
    return group;
  });
  const distant = fleet.distant.map((placement) => addShip(placement, { variant: 'distant' }));

  const flagship = createFlagshipMesh({
    beam: SOVEREIGN.beam,
    height: SOVEREIGN.height,
    dorsalY: SOVEREIGN.dorsalY,
    trenchFloorY: SOVEREIGN.trenchFloorY,
    trenchHalfWidth: SOVEREIGN.trenchHalfWidth,
    trenchZFrom: SOVEREIGN.trenchZFrom,
    trenchZTo: SOVEREIGN.trenchZTo,
    center: SOVEREIGN.center,
  });
  root.add(flagship.group);

  // RELENTLESS broadside battery: five starboard mounts facing the rail.
  const batteryLocal = [-0.3, -0.17, -0.04, 0.09, 0.22].map(
    (fraction) => new Vector3(52, 10, fraction * fleet.relentless.length),
  );
  const batteryPoints = batteryLocal.map((point) => relentless.localToWorld(point.clone()));

  // ---- dynamic systems --------------------------------------------------------------
  const crossfire = createCrossfire(rng);
  root.add(crossfire.mesh);

  const streaks = createStreaks(rng);
  root.add(streaks.lines);

  const debris = createEyeDebris(rng, curve);
  root.add(debris.group);

  const shells = createShellPool();
  for (const shell of shells.items) root.add(shell.mesh);

  scene.add(root);

  // ---- state ---------------------------------------------------------------------------
  let nextSalvoIndex = 0;
  let salvoPulse = 0;
  let nextBattleBloomAt = 0.4;
  let dying = false;
  let deathT = 0;
  let nextDeathBloomAt = 0;
  let scattered = false;
  const engineBase = friendlyEngines.map((material) => material.color.clone());
  const seamBase = flagship.seamMaterials.map((material) => material.color.clone());
  const flagshipEngineBase = flagship.engineMaterials.map((material) => material.color.clone());

  function fireSalvo(camera: PerspectiveCamera) {
    for (const [index, point] of batteryPoints.entries()) {
      // Muzzle flash on the hull and a shell arcing overhead to starboard.
      spawnBloom(point, hdr(CYAN_FIRE, 1.8), 7 + index, 0.4);
      const shell = shells.items.find((candidate) => candidate.life < 0);
      if (!shell) continue;
      shell.mesh.position.copy(point);
      shell.mesh.visible = true;
      shell.velocity.set(0.86 + index * 0.02, 0.42 - index * 0.04, -0.18).normalize().multiplyScalar(330);
      shell.age = 0;
      shell.life = 1.35 + index * 0.06;
    }
    void camera;
  }

  return {
    root,
    flagship,
    relentless,
    startFlagshipDeath() {
      dying = true;
      deathT = 0;
      nextDeathBloomAt = 0;
    },
    flagshipDying() {
      return dying;
    },
    resetRun() {
      nextSalvoIndex = 0;
      salvoPulse = 0;
      dying = false;
      deathT = 0;
      scattered = false;
      flagship.sections.bow.position.set(0, 0, 0);
      flagship.sections.bow.rotation.set(0, 0, 0);
      flagship.sections.mid.position.set(0, 0, 0);
      flagship.sections.stern.position.set(0, 0, 0);
      flagship.sections.stern.rotation.set(0, 0, 0);
      for (const [index, material] of flagship.seamMaterials.entries()) material.color.copy(seamBase[index]);
      for (const [index, material] of flagship.engineMaterials.entries()) material.color.copy(flagshipEngineBase[index]);
      for (const shell of shells.items) {
        shell.life = -1;
        shell.mesh.visible = false;
      }
    },
    update(dt, frame) {
      const { camera, elapsed, runTime, running, speed, beatEnergy } = frame;
      const progress = running ? broadsideRunProgress(runTime) : 0;

      // The sky rides with the camera: the run covers 2,100 units, far more
      // than any static dome could hold.
      skydome.position.copy(camera.position);
      stars.position.copy(camera.position);
      stars.rotation.y = elapsed * 0.0035;

      // Beat-pulsed friendly engines.
      for (const [index, material] of friendlyEngines.entries()) {
        material.color.copy(engineBase[index]).multiplyScalar(1 + beatEnergy * 0.8);
      }

      // Wrecks tumble dead slow in the eye.
      for (const wreck of wrecks) {
        const spin = wreck.userData.spin as Vector3;
        wreck.rotation.x += spin.x * dt;
        wreck.rotation.y += spin.y * dt;
        wreck.rotation.z += spin.z * dt;
      }

      crossfire.update(dt, beatEnergy);

      // Speed streaks hug the camera and brighten with the surge.
      streaks.lines.position.copy(camera.position);
      streaks.offset.value = (streaks.offset.value + dt * (speed * 120 + 30)) % 10000;
      streaks.glow.value = 0.1 + Math.max(0, speed - 0.6) * 0.3;

      debris.update(progress, dt);

      // The broadside: salvos on the authored beats.
      if (running && nextSalvoIndex < SALVO_TIMES.length && runTime >= SALVO_TIMES[nextSalvoIndex]) {
        nextSalvoIndex += 1;
        salvoPulse = 1;
        fireSalvo(camera);
      }
      salvoPulse = Math.max(0, salvoPulse - dt * 2.2);

      // Shells arc to starboard and burst over the distant enemy line.
      for (const shell of shells.items) {
        if (shell.life < 0) continue;
        shell.age += dt;
        if (shell.age >= shell.life) {
          shell.life = -1;
          shell.mesh.visible = false;
          spawnBloom(shell.mesh.position, hdr(NEBULA_GOLD, 1.2), 26 + Math.random() * 14, 0.9);
          burstSparks(shell.mesh.position, hdr(CRIMSON_FIRE, 0.9), 6, 20);
          continue;
        }
        shell.mesh.position.addScaledVector(shell.velocity, dt);
        dropTrail(shell.mesh.position, CYAN_WINDOW.clone().multiplyScalar(0.5), 0.7);
      }

      // Distant ordnance: the battle breathes on the horizon in both colors.
      if (elapsed >= nextBattleBloomAt) {
        nextBattleBloomAt = elapsed + 0.25 + rng() * 0.8;
        const side = rng() < 0.5 ? -1 : 1;
        const point = new Vector3(
          side * (180 + rng() * 320),
          -40 + rng() * 200,
          -400 - rng() * 1600,
        );
        const friendly = rng() < 0.5;
        spawnBloom(point, hdr(friendly ? CYAN_FIRE : CRIMSON_FIRE, 1.1), 20 + rng() * 42, 0.7 + rng() * 0.5);
      }

      // ---- flagship death: the core goes and the fire walks her length -----------
      if (dying) {
        deathT += dt;
        const ramp = Math.min(1, deathT / 1.2);
        for (const [index, material] of flagship.seamMaterials.entries()) {
          material.color.copy(seamBase[index]).multiplyScalar(1 + ramp * 2.4);
        }
        for (const [index, material] of flagship.engineMaterials.entries()) {
          const flicker = Math.max(0.12, 1 - ramp) * (0.5 + Math.sin(elapsed * 23 + index * 3.1) * 0.5);
          material.color.copy(flagshipEngineBase[index]).multiplyScalar(flicker);
        }
        if (deathT >= nextDeathBloomAt) {
          nextDeathBloomAt = deathT + 0.12;
          const spread = (deathT / 3.2) * (SOVEREIGN.length * 0.5);
          const z = SOVEREIGN.corePosition.z + (rng() * 2 - 1) * Math.min(SOVEREIGN.length * 0.48, spread);
          const point = new Vector3(
            SOVEREIGN.center.x + (rng() - 0.5) * SOVEREIGN.beam * 0.9,
            30 + (rng() - 0.5) * SOVEREIGN.height * 0.7,
            z,
          );
          spawnBloom(point, hdr(MOLTEN_ORANGE, 1.5), 16 + rng() * 26, 0.8);
          burstSparks(point, hdr(MOLTEN_ORANGE, 1.1), 5, 26);
        }
        // She comes apart: bow dips, stern drifts back, the midsection sags.
        const drift = Math.min(1, deathT / 4);
        flagship.sections.bow.rotation.x = -drift * 0.05;
        flagship.sections.bow.position.z = drift * 9;
        flagship.sections.bow.position.y = -drift * 6;
        flagship.sections.stern.position.z = -drift * 12;
        flagship.sections.stern.position.y = -drift * 8;
        flagship.sections.stern.rotation.z = drift * 0.04;
        flagship.sections.mid.position.y = -drift * 5;

        // The enemy line scatters: fire walks the far silhouettes too.
        if (!scattered && deathT > 1.4) {
          scattered = true;
          for (const ship of distant) {
            if (rng() < 0.4) continue;
            for (let i = 0; i < 3; i += 1) {
              const point = ship.position.clone().add(new Vector3((rng() - 0.5) * 200, (rng() - 0.5) * 60, (rng() - 0.5) * 300));
              spawnBloom(point, hdr(MOLTEN_ORANGE, 1.2), 30 + rng() * 40, 1.1);
            }
          }
        }
      }
      void BELLY_TIME;
    },
  };
}

// ---- skydome: the nebula --------------------------------------------------------------

function createSkydome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const dir = positionLocal.normalize();
  // The galactic band, tilted across the sky.
  const band = float(1).sub(dir.dot(vec3(0.22, 0.9, 0.38).normalize()).abs()).clamp(0, 1);
  // The gold heart of the nebula, burning ahead of the whole run.
  const core = dir.dot(vec3(NEBULA_DIR.x, NEBULA_DIR.y, NEBULA_DIR.z).normalize()).max(0).pow(7);
  const drift = time.mul(0.005);
  const clouds = mx_noise_float(dir.mul(2.6).add(vec3(drift, 0, drift.mul(0.6)))).mul(0.5).add(0.5);
  const veins = mx_noise_float(dir.mul(5.8).add(vec3(0, drift.mul(0.4), 3.7))).mul(0.5).add(0.5);
  const dust = mx_noise_float(dir.mul(9.5).add(vec3(5.2, 1.3, 0))).mul(0.5).add(0.5);

  let color = mix(vec3(SPACE_BLACK.r, SPACE_BLACK.g, SPACE_BLACK.b), vec3(NEBULA_DEEP.r, NEBULA_DEEP.g, NEBULA_DEEP.b), band.pow(1.3));
  color = mix(
    color,
    vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b).mul(1.15),
    band.pow(2.3).mul(clouds.mul(0.75).add(0.25)),
  );
  color = color.add(vec3(NEBULA_GOLD.r, NEBULA_GOLD.g, NEBULA_GOLD.b).mul(core.mul(veins.mul(0.7).add(0.5)).mul(1.35)));
  color = color.mul(dust.mul(0.42).add(0.62));
  material.colorNode = color;

  const dome = new Mesh(new SphereGeometry(1500, 40, 26), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// ---- stars ---------------------------------------------------------------------------------

function createStars(rng: Rng) {
  const COUNT = 1300;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i += 1) {
    const v = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(1400);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    const warm = rng();
    const intensity = 0.3 + rng() * 0.7;
    colors[i * 3] = intensity * (warm > 0.75 ? 1 : 0.85);
    colors[i * 3 + 1] = intensity * 0.88;
    colors[i * 3 + 2] = intensity * (warm > 0.75 ? 0.75 : 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starsMaterial = new PointsMaterial(additiveMaterialParameters({
    size: 2.6,
    vertexColors: true,
    sizeAttenuation: false,
    opacity: 1,
    fog: false,
  }));
  starsMaterial.transparent = true;
  const stars = new Points(geometry, starsMaterial);
  stars.frustumCulled = false;
  stars.userData.raildIgnoreOcclusion = true;
  return { stars, starsMaterial };
}

// ---- nebula cloud billboards -----------------------------------------------------------------

function createNebulaClouds(rng: Rng) {
  const group = new Group();
  const geometry = new PlaneGeometry(1, 1);
  // Soft discs: radial alpha falloff from the plane's local center.
  for (let i = 0; i < 9; i += 1) {
    const gold = i % 3 === 0;
    const color = (gold ? NEBULA_GOLD : NEBULA_MAGENTA).clone();
    const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
    const centered = positionLocal.xy;
    const falloff = smoothstep(float(0.55), float(0.1), centered.length());
    material.colorNode = vec3(color.r, color.g, color.b).mul(falloff.mul(gold ? 0.11 : 0.09));
    const cloud = new Mesh(geometry, material);
    const scale = 260 + rng() * 420;
    cloud.scale.set(scale, scale * (0.5 + rng() * 0.5), 1);
    // Off the flight corridor and above the decks: backdrop texture, never a
    // wash over the hulls.
    const side = rng() < 0.5 ? -1 : 1;
    cloud.position.set(
      side * (480 + rng() * 820),
      140 + rng() * 420,
      -600 - rng() * 2400,
    );
    cloud.rotation.z = rng() * Math.PI;
    cloud.userData.raildIgnoreOcclusion = true;
    group.add(cloud);
  }
  return group;
}

// ---- crossfire: tracer fire stitched between the fleets -----------------------------------------

const TRACER_COUNT = 44;

type Tracer = {
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  cyan: boolean;
};

function createCrossfire(rng: Rng) {
  // Thin additive darts instanced across the whole battle corridor, cyan one
  // way, crimson the other. Each flies a straight shot between the lines and
  // respawns — the fleets' unending argument.
  const geometry = new BoxGeometry(0.7, 0.7, 24);
  const material = createAdditiveBasicMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geometry, material, TRACER_COUNT);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;

  const tracers: Tracer[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const color = new Color();
  const Z_AXIS = new Vector3(0, 0, 1);

  const respawn = (tracer: Tracer) => {
    const fromFriendly = rng() < 0.5;
    const side = fromFriendly ? -1 : 1;
    tracer.cyan = fromFriendly;
    tracer.position.set(
      side * (150 + rng() * 320),
      -50 + rng() * 220,
      -250 - rng() * 1600,
    );
    const target = new Vector3(
      -side * (150 + rng() * 320),
      -50 + rng() * 220,
      tracer.position.z + (rng() - 0.5) * 500,
    );
    const speed = 300 + rng() * 160;
    tracer.velocity.copy(target.sub(tracer.position).normalize().multiplyScalar(speed));
    tracer.life = tracer.position.distanceTo(target) / speed;
    tracer.age = rng() * tracer.life; // desync the field at boot
  };

  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const tracer: Tracer = { position: new Vector3(), velocity: new Vector3(), age: 0, life: 1, cyan: i % 2 === 0 };
    respawn(tracer);
    tracers.push(tracer);
  }

  return {
    mesh,
    update(dt: number, beatEnergy: number) {
      for (let i = 0; i < tracers.length; i += 1) {
        const tracer = tracers[i];
        tracer.age += dt;
        if (tracer.age >= tracer.life) respawn(tracer);
        tracer.position.addScaledVector(tracer.velocity, dt);
        const fade = Math.min(1, Math.min(tracer.age * 4, (tracer.life - tracer.age) * 2));
        quaternion.setFromUnitVectors(Z_AXIS, tracer.velocity.clone().normalize());
        scale.set(1, 1, 1);
        matrix.compose(tracer.position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        color
          .copy(tracer.cyan ? CYAN_FIRE : CRIMSON_FIRE)
          .multiplyScalar(Math.max(0, fade) * (0.55 + beatEnergy * 0.5));
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

// ---- speed streaks -----------------------------------------------------------------------------

const STREAK_SPAN = 70;
const STREAK_BACK = 38;

function createStreaks(rng: Rng) {
  const COUNT = 150;
  const positions: number[] = [];
  const y0: number[] = [];
  const dy: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 4 + rng() * 13;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 1.6 + rng() * 3.4;
    const c = CYAN_WINDOW.clone().lerp(PLAYER_WHITE, rng()).multiplyScalar(0.25 + rng() * 0.55);
    for (const delta of [0, length]) {
      positions.push(x, 0, z);
      y0.push(start);
      dy.push(delta);
      colors.push(c.r, c.g, c.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('y0', new Float32BufferAttribute(y0, 1));
  geometry.setAttribute('dy', new Float32BufferAttribute(dy, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const offset = uniform(0);
  const glow = uniform(0.2);
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const wrapped = attribute<'float'>('y0', 'float').sub(offset).mod(STREAK_SPAN).sub(STREAK_BACK);
  material.positionNode = vec3(positionLocal.x, wrapped.add(attribute<'float'>('dy', 'float')), positionLocal.z);
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 8), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(glow);
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  return { lines, offset, glow };
}

// ---- eye debris ----------------------------------------------------------------------------------

function createEyeDebris(rng: Rng, curve: ReturnType<typeof createBroadsideRail>) {
  const dark = new MeshBasicMaterial({ color: 0x0b0a10 });
  const field = scatterAlongRail(curve, {
    count: 42,
    seed: 20260815,
    rng,
    window: { behind: 70, ahead: 280 },
    alignToRail: false,
    make(_index, makeRng) {
      const chunk = new Group();
      const body = new Mesh(
        new SphereGeometry(0.5 + makeRng() * 2.2, 4, 3),
        dark,
      );
      body.scale.set(1 + makeRng() * 2.4, 0.4 + makeRng() * 0.5, 0.8 + makeRng() * 1.6);
      chunk.add(body);
      if (makeRng() < 0.4) {
        const glint = new Mesh(
          new PlaneGeometry(0.14, 1.2 + makeRng() * 2),
          createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE, 0.5), side: DoubleSide }),
        );
        glint.position.y = 0.4;
        chunk.add(glint);
      }
      chunk.rotation.set(makeRng() * 3, makeRng() * 3, makeRng() * 3);
      chunk.userData.raildIgnoreOcclusion = true;
      return chunk;
    },
    place(_index, placeRng) {
      const u0 = railU(EYE_TIME) - 0.05;
      const u1 = railU(MELEE2_TIME) + 0.04;
      const angle = placeRng() * Math.PI * 2;
      const radius = 12 + placeRng() * 55;
      return {
        u: u0 + placeRng() * (u1 - u0),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, 0),
      };
    },
    onUpdate(item, dt) {
      item.object.rotation.x += dt * 0.2;
      item.object.rotation.z += dt * 0.13;
    },
  });
  return field;
}

// ---- salvo shells ------------------------------------------------------------------------------------

type Shell = {
  mesh: Mesh;
  velocity: Vector3;
  age: number;
  life: number;
};

function createShellPool() {
  const items: Shell[] = [];
  const geometry = new SphereGeometry(0.7, 6, 5);
  for (let i = 0; i < 14; i += 1) {
    const mesh = new Mesh(geometry, createAdditiveBasicMaterial({ color: hdr(CYAN_FIRE, 1.9) }));
    mesh.visible = false;
    items.push({ mesh, velocity: new Vector3(), age: 0, life: -1 });
  }
  return { items };
}

