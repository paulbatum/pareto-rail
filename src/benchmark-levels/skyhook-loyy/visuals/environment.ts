import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { createSkyhookRail, SKYHOOK_LOYY_MARKERS, SKYHOOK_LOYY_RUN_DURATION } from '../gameplay';
import {
  GRAPHITE,
  HAZARD_DARK,
  INDIGO,
  ORANGE,
  PANEL,
  PANEL_SHADE,
  SKY,
  SPACE,
  STORM,
  SUN_WHITE,
  TETHER,
  mulberry32,
} from './palette';

type Door = { mesh: Mesh; axis: Vector3; openDistance: number };
type FallingDebris = { mesh: Mesh; speed: number; drift: number; spin: Vector3 };

export type SkyhookEnvironment = {
  root: Group;
  car: Group;
  carPanels: MeshBasicMaterial[];
  carIntegrity: MeshBasicMaterial[];
  carWarnings: MeshBasicMaterial[];
  tether: Group;
  clouds: Group[];
  rain: LineSegments;
  speedLines: LineSegments;
  speedPositions: Float32Array;
  speedSeeds: Float32Array;
  stars: Points;
  station: Group;
  stationDoors: Door[];
  stationCollars: Group[];
  stationLamps: Mesh[];
  debrisRig: Group;
  debris: FallingDebris[];
  lightningRig: Group;
  lightning: LineSegments[];
  lightningPulse: number;
  lightningIndex: number;
  lastLightningBar: number;
  ambientLightningTime: number;
  lastAmbientLightning: number;
  atmosphere(progress: number): void;
};

const rail = createSkyhookRail();
const Z_AXIS = new Vector3(0, 0, 1);

export function createEnvironmentInternal(scene: Scene): SkyhookEnvironment {
  scene.background = STORM.clone();
  scene.fog = new Fog(STORM.clone(), 12, 115);
  const root = new Group();
  // The tether, cloud cards, planet limb, and station frame are composition
  // layers, not cover mechanics; target silhouettes must remain actionable.
  root.userData.raildIgnoreOcclusion = true;

  const planet = createPlanet();
  const sun = createSun();
  const { group: tether } = createTether();
  const clouds = createCloudField();
  const stars = createStars();
  const rain = createRain();
  const speed = createSpeedLines();
  const stationBuild = createStation();
  const { group: car, panels: carPanels, integrity: carIntegrity, warnings: carWarnings } = createCar();
  const { group: debrisRig, debris } = createFallingDebris();
  const { group: lightningRig, bolts: lightning } = createLightning();
  tether.name = 'skyhook-tether';
  tether.userData.raildIgnoreOcclusion = true;
  car.name = 'climber-car';
  car.userData.raildIgnoreOcclusion = true;

  root.add(planet, sun, tether, ...clouds, stars, stationBuild.group);
  scene.add(root, rain, speed.lines, car, debrisRig, lightningRig);

  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: STORM, fog: STORM, near: 10, far: 100 },
    { progress: 0.15, background: new Color(0x667b87), fog: new Color(0x778b92), near: 18, far: 150 },
    { progress: 0.24, background: SKY, fog: new Color(0x8db1c1), near: 30, far: 250 },
    { progress: 0.46, background: new Color(0x225582), fog: new Color(0x476e91), near: 60, far: 520 },
    { progress: 0.64, background: INDIGO, fog: INDIGO, near: 140, far: 1150 },
    { progress: 0.74, background: SPACE, fog: SPACE, near: 300, far: 2600 },
    { progress: 1, background: SPACE, fog: SPACE, near: 500, far: 4000 },
  ]);

  return {
    root,
    car,
    carPanels,
    carIntegrity,
    carWarnings,
    tether,
    clouds,
    rain,
    speedLines: speed.lines,
    speedPositions: speed.positions,
    speedSeeds: speed.seeds,
    stars,
    station: stationBuild.group,
    stationDoors: stationBuild.doors,
    stationCollars: stationBuild.collars,
    stationLamps: stationBuild.lamps,
    debrisRig,
    debris,
    lightningRig,
    lightning,
    lightningPulse: 0,
    lightningIndex: 0,
    lastLightningBar: -1,
    ambientLightningTime: 0,
    lastAmbientLightning: -1,
    atmosphere,
  };
}

function createSun() {
  const frame = sampleRailFrame(rail, 0.42);
  const group = new Group();
  group.position.copy(frame.position)
    .addScaledVector(frame.up, 72)
    .addScaledVector(frame.right, -42)
    .addScaledVector(frame.tangent, 45);
  group.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent.clone().negate());
  const disc = new Mesh(
    new CircleGeometry(13, 32),
    new MeshBasicMaterial({ color: 0xe6c785, side: DoubleSide }),
  );
  const halo = new Mesh(
    new RingGeometry(14, 19, 40),
    new MeshBasicMaterial({ color: 0xd4c49d, side: DoubleSide, transparent: true, opacity: 0.13, depthWrite: false }),
  );
  group.add(disc, halo);
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

function createPlanet() {
  const endFrame = sampleRailFrame(rail, 1);
  const center = endFrame.position.clone()
    .addScaledVector(endFrame.tangent, 660)
    .addScaledVector(endFrame.up, -520);
  const group = new Group();
  const surface = new Mesh(
    new SphereGeometry(610, 72, 48),
    new MeshBasicMaterial({ color: new Color(0x1b4259) }),
  );
  surface.position.copy(center);
  group.add(surface);

  // Broad procedural land/sea bands, geometry only: low-poly flattened caps
  // float just above the sphere and read as continents at orbital distance.
  const rng = mulberry32(51996);
  for (let i = 0; i < 26; i += 1) {
    const angle = rng() * Math.PI * 2;
    const latitude = (rng() - 0.58) * 1.25;
    const patch = new Mesh(
      new SphereGeometry(612 + rng() * 1.4, 10, 6, angle, 0.22 + rng() * 0.38, Math.PI / 2 + latitude, 0.12 + rng() * 0.3),
      new MeshBasicMaterial({ color: rng() > 0.25 ? 0x52674f : 0xb7c2bf, side: DoubleSide }),
    );
    patch.position.copy(center);
    group.add(patch);
  }

  const atmosphere = new Mesh(
    new SphereGeometry(626, 64, 40),
    new MeshBasicMaterial({ color: new Color(0x75b6d9), transparent: true, opacity: 0.11, side: DoubleSide, depthWrite: false }),
  );
  atmosphere.position.copy(center);
  group.add(atmosphere);
  return group;
}

function createTether() {
  const points: Vector3[] = [];
  for (let i = 0; i <= 80; i += 1) {
    const frame = sampleRailFrame(rail, i / 80);
    points.push(frame.position.clone().addScaledVector(frame.right, 7.2));
  }
  const tetherCurve = new CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  const group = new Group();
  group.add(new Mesh(new TubeGeometry(tetherCurve, 220, 0.62, 8, false), new MeshBasicMaterial({ color: TETHER })));
  group.add(new Mesh(new TubeGeometry(tetherCurve, 220, 0.14, 5, false), new MeshBasicMaterial({ color: PANEL_SHADE })));

  for (let i = 2; i < 46; i += 1) {
    const u = i / 47;
    const point = tetherCurve.getPointAt(u);
    const tangent = tetherCurve.getTangentAt(u).normalize();
    const collar = new Group();
    collar.position.copy(point);
    collar.quaternion.setFromUnitVectors(Z_AXIS, tangent);
    const ring = new Mesh(new TorusGeometry(0.95, 0.13, 5, 12), new MeshBasicMaterial({ color: i % 4 === 0 ? ORANGE : PANEL_SHADE }));
    collar.add(ring);
    group.add(collar);
  }
  return { group, curve: tetherCurve };
}

function createCloudField() {
  const rng = mulberry32(99173);
  const clouds: Group[] = [];
  for (let i = 0; i < 44; i += 1) {
    const u = i < 28 ? 0.02 + rng() * 0.19 : 0.18 + rng() * 0.14;
    const frame = sampleRailFrame(rail, u);
    const cloud = new Group();
    const stormy = u < 0.16;
    const base = stormy ? new Color(0x737d82) : new Color(0xafbec2);
    const lobeCount = 3 + Math.floor(rng() * 4);
    for (let lobe = 0; lobe < lobeCount; lobe += 1) {
      const sphere = new Mesh(
        new SphereGeometry(5 + rng() * 8, 8, 6),
        new MeshBasicMaterial({
          color: base.clone().multiplyScalar(0.62 + rng() * 0.22),
          transparent: true,
          opacity: stormy ? 0.38 : 0.29,
          depthWrite: false,
        }),
      );
      sphere.position.set((rng() - 0.5) * 17, (rng() - 0.5) * 7, (rng() - 0.5) * 8);
      sphere.scale.set(1.7 + rng(), 0.55 + rng() * 0.45, 1.1 + rng());
      cloud.add(sphere);
    }
    const radius = i < 28 ? 18 + rng() * 38 : 8 + rng() * 42;
    const side = rng() < 0.5 ? -1 : 1;
    cloud.position.copy(frame.position)
      .addScaledVector(frame.right, side * radius)
      .addScaledVector(frame.up, (rng() - 0.5) * 35)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 25);
    cloud.userData.spin = (rng() - 0.5) * 0.035;
    clouds.push(cloud);
  }
  return clouds;
}

function createStars() {
  const rng = mulberry32(44012);
  const count = 950;
  const positions = new Float32Array(count * 3);
  const end = rail.getPointAt(0.76);
  for (let i = 0; i < count; i += 1) {
    const theta = rng() * Math.PI * 2;
    const z = rng() * 2 - 1;
    const radius = 900 + rng() * 1500;
    const radial = Math.sqrt(1 - z * z);
    positions[i * 3] = end.x + Math.cos(theta) * radial * radius;
    positions[i * 3 + 1] = end.y + z * radius;
    positions[i * 3 + 2] = end.z + Math.sin(theta) * radial * radius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(geometry, new PointsMaterial({ color: SUN_WHITE, size: 1.3, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
  points.frustumCulled = false;
  return points;
}

function createRain() {
  const rng = mulberry32(1291);
  const count = 150;
  const positions = new Float32Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    const x = (rng() - 0.5) * 45;
    const y = (rng() - 0.5) * 28;
    const z = -8 - rng() * 75;
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x - 0.5;
    positions[i * 6 + 4] = y - 2.8 - rng() * 4;
    positions[i * 6 + 5] = z + 1.2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0xa7bdc5, transparent: true, opacity: 0.28 }));
  lines.frustumCulled = false;
  return lines;
}

function createLightning() {
  const group = new Group();
  const bolts: LineSegments[] = [];
  group.userData.raildIgnoreOcclusion = true;
  for (let boltIndex = 0; boltIndex < 4; boltIndex += 1) {
    const vertices: number[] = [];
    let x = (boltIndex - 1.5) * 8;
    let y = 14;
    const z = -48 - boltIndex * 7;
    for (let segment = 0; segment < 7; segment += 1) {
      const nextX = x + Math.sin(boltIndex * 4.7 + segment * 2.1) * (1.2 + segment * 0.18);
      const nextY = y - 4.3;
      vertices.push(x, y, z, nextX, nextY, z + segment * 0.3);
      if (segment === 3 || segment === 5) {
        vertices.push(nextX, nextY, z, nextX + (boltIndex % 2 === 0 ? -3 : 3), nextY - 3, z + 1.1);
      }
      x = nextX;
      y = nextY;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    const material = new LineBasicMaterial({ color: new Color(1.7, 1.82, 1.95), transparent: true, opacity: 0, depthWrite: false });
    const bolt = new LineSegments(geometry, material);
    bolt.visible = false;
    group.add(bolt);
    bolts.push(bolt);
  }
  return { group, bolts };
}

function createSpeedLines() {
  const rng = mulberry32(9917);
  const count = 120;
  const positions = new Float32Array(count * 6);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    seeds[i * 3] = (rng() - 0.5) * 52;
    seeds[i * 3 + 1] = (rng() - 0.5) * 32;
    seeds[i * 3 + 2] = -18 - rng() * 96;
  }
  resetSpeedPositions(positions, seeds);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0xb9c4c8, transparent: true, opacity: 0.16 }));
  lines.frustumCulled = false;
  return { lines, positions, seeds };
}

function createFallingDebris() {
  const rng = mulberry32(71881);
  const group = new Group();
  const debris: FallingDebris[] = [];
  group.userData.raildIgnoreOcclusion = true;
  const sharedGeometry = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < 26; i += 1) {
    const material = new MeshBasicMaterial({ color: i % 7 === 0 ? ORANGE : i % 2 === 0 ? PANEL_SHADE : GRAPHITE });
    const mesh = new Mesh(sharedGeometry, material);
    mesh.position.set((rng() - 0.5) * 46, (rng() - 0.5) * 29, -14 - rng() * 100);
    mesh.scale.set(0.12 + rng() * 0.42, 0.04 + rng() * 0.14, 0.9 + rng() * 2.8);
    group.add(mesh);
    debris.push({
      mesh,
      speed: 29 + rng() * 46,
      drift: (rng() - 0.5) * 1.8,
      spin: new Vector3((rng() - 0.5) * 3, (rng() - 0.5) * 4, (rng() - 0.5) * 5),
    });
  }
  return { group, debris };
}

function resetSpeedPositions(positions: Float32Array, seeds: Float32Array) {
  for (let i = 0; i < seeds.length / 3; i += 1) {
    const x = seeds[i * 3];
    const y = seeds[i * 3 + 1];
    const z = seeds[i * 3 + 2];
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = z - 4 - Math.abs(x) * 0.12;
  }
}

function createStation() {
  const frame = sampleRailFrame(rail, 1);
  const group = new Group();
  group.position.copy(frame.position).addScaledVector(frame.tangent, 36);
  group.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent);
  const doors: Door[] = [];
  const collars: Group[] = [];
  const lamps: Mesh[] = [];
  const lampGeometry = new BoxGeometry(0.42, 1.25, 0.3);

  for (let depth = 0; depth < 5; depth += 1) {
    const collar = new Group();
    collar.position.z = depth * 8;
    const ring = new Mesh(
      new TorusGeometry(14 - depth * 0.7, 1.1 + depth * 0.13, 8, 28),
      new MeshBasicMaterial({ color: depth % 2 === 0 ? PANEL : PANEL_SHADE }),
    );
    collar.add(ring);
    for (let arm = 0; arm < 8; arm += 1) {
      const angle = arm / 8 * Math.PI * 2;
      const strut = new Mesh(new BoxGeometry(1.2, 6.8, 1.3), new MeshBasicMaterial({ color: arm % 2 === 0 ? ORANGE : GRAPHITE }));
      strut.position.set(Math.cos(angle) * 12.4, Math.sin(angle) * 12.4, 0);
      strut.rotation.z = angle;
      collar.add(strut);

      const lamp = new Mesh(lampGeometry, new MeshBasicMaterial({ color: HAZARD_DARK }));
      lamp.position.set(Math.cos(angle) * (9.5 - depth * 0.28), Math.sin(angle) * (9.5 - depth * 0.28), -0.8);
      lamp.rotation.z = angle;
      lamp.userData.depth = depth;
      lamp.userData.slot = arm;
      collar.add(lamp);
      lamps.push(lamp);
    }
    group.add(collar);
    collars.push(collar);
  }

  const dark = new Mesh(new RingGeometry(0, 13.5, 32), new MeshBasicMaterial({ color: 0x030405, side: DoubleSide }));
  dark.position.z = 34;
  group.add(dark);
  const captureBeacon = new Mesh(
    new RingGeometry(2.7, 3.1, 16),
    new MeshBasicMaterial({ color: ORANGE, side: DoubleSide }),
  );
  captureBeacon.position.z = 33.2;
  captureBeacon.userData.captureBeacon = true;
  group.add(captureBeacon);

  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2 + Math.PI / 4;
    const axis = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const door = new Mesh(new BoxGeometry(10.5, 5.2, 0.8), new MeshBasicMaterial({ color: index % 2 === 0 ? PANEL : PANEL_SHADE }));
    door.position.copy(axis).multiplyScalar(10.5);
    door.position.z = 33.2;
    door.rotation.z = angle - Math.PI / 2;
    group.add(door);
    doors.push({ mesh: door, axis, openDistance: 10.5 });
  }
  group.userData.captureBeacon = captureBeacon;
  return { group, doors, collars, lamps };
}

function createCar() {
  const group = new Group();
  const panels: MeshBasicMaterial[] = [];
  const integrity: MeshBasicMaterial[] = [];
  const warnings: MeshBasicMaterial[] = [];
  const addPanel = (geometry: BoxGeometry, color: Color, x: number, y: number, z: number) => {
    const material = new MeshBasicMaterial({ color: color.clone() });
    material.userData.base = color.clone();
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    panels.push(material);
    return mesh;
  };
  addPanel(new BoxGeometry(12, 0.65, 5), GRAPHITE, 0, -3.4, -5.5);
  addPanel(new BoxGeometry(4.8, 0.35, 2.7), PANEL, 0, -2.95, -4.7);
  addPanel(new BoxGeometry(1.0, 5.0, 0.8), PANEL_SHADE, -6.2, -1.2, -5.6).rotation.z = -0.18;
  addPanel(new BoxGeometry(1.0, 5.0, 0.8), PANEL_SHADE, 6.2, -1.2, -5.6).rotation.z = 0.18;
  for (let i = -4; i <= 4; i += 2) addPanel(new BoxGeometry(1.2, 0.12, 0.4), ORANGE, i, -2.56, -3.45);
  const pipGeometry = new BoxGeometry(0.62, 0.24, 0.22);
  for (let index = 0; index < 6; index += 1) {
    const material = new MeshBasicMaterial({ color: ORANGE.clone() });
    const pip = new Mesh(pipGeometry, material);
    pip.position.set((index - 2.5) * 0.78, -1.78, -3.15);
    group.add(pip);
    integrity.push(material);
  }
  for (const side of [-1, 1]) {
    const material = new MeshBasicMaterial({ color: HAZARD_DARK.clone(), side: DoubleSide });
    const warning = new Mesh(new CircleGeometry(0.42, 3), material);
    // Seat the warnings farther down the camera-local rail than the integrity
    // lamps. At the closer lamp depth this lateral offset falls outside the
    // frustum on a 16:9 camera, making an active car threat invisible.
    warning.position.set(side * 4.45, -0.9, -5.2);
    warning.rotation.z = side < 0 ? 0 : Math.PI;
    material.userData.warningMesh = warning;
    group.add(warning);
    warnings.push(material);
  }
  const leftRail = addPanel(new BoxGeometry(0.18, 0.18, 8), PANEL, -5.1, -2.6, -7.2);
  const rightRail = addPanel(new BoxGeometry(0.18, 0.18, 8), PANEL, 5.1, -2.6, -7.2);
  leftRail.rotation.x = rightRail.rotation.x = 0.06;
  group.userData.damagePulse = 0;
  group.userData.carThreats = 0;
  return { group, panels, integrity, warnings };
}

export function updateEnvironment(env: SkyhookEnvironment, dt: number, camera: PerspectiveCamera, runTime: number, running: boolean) {
  const progress = running ? MathUtils.clamp(runTime / SKYHOOK_LOYY_RUN_DURATION, 0, 1) : 0;
  env.atmosphere(progress);

  env.car.position.copy(camera.position);
  env.car.quaternion.copy(camera.quaternion);
  const damagePulse = Math.max(0, (env.car.userData.damagePulse as number) - dt * 2.2);
  env.car.userData.damagePulse = damagePulse;
  for (const panel of env.carPanels) panel.color.lerp(panel.userData.base as Color, Math.min(1, dt * 8));
  const threatActive = Number(env.car.userData.carThreats ?? 0) > 0;
  const threatUrgency = MathUtils.clamp(Number(env.car.userData.carThreatUrgency ?? 0), 0, 1);
  const warningPulse = 0.5 + Math.sin(runTime * (9 + threatUrgency * 17)) * 0.5;
  for (const warning of env.carWarnings) {
    warning.color.copy(threatActive ? ORANGE : HAZARD_DARK);
    if (threatActive) warning.color.lerp(SUN_WHITE, warningPulse * (0.58 + threatUrgency * 0.34));
    const warningMesh = warning.userData.warningMesh as Mesh | undefined;
    warningMesh?.scale.setScalar(threatActive ? 0.84 + warningPulse * 0.16 + threatUrgency * 0.18 : 0.72);
  }

  env.rain.position.copy(camera.position);
  env.rain.quaternion.copy(camera.quaternion);
  env.rain.visible = !running || runTime < SKYHOOK_LOYY_MARKERS.cloudbreak + 2;
  (env.rain.material as LineBasicMaterial).opacity = running ? MathUtils.clamp(1 - runTime / 13, 0, 0.34) : 0.22;
  env.rain.rotation.z += dt * 0.04;

  env.lightningRig.position.copy(camera.position);
  env.lightningRig.quaternion.copy(camera.quaternion);
  env.lightningRig.visible = !running || runTime < SKYHOOK_LOYY_MARKERS.cloudbreak;
  if (!running) {
    env.ambientLightningTime += dt;
    const ambientFlash = Math.floor(env.ambientLightningTime / 3.7);
    if (ambientFlash !== env.lastAmbientLightning) {
      env.lastAmbientLightning = ambientFlash;
      triggerLightning(env, ambientFlash % 3 === 1 ? 0.82 : 0.58);
    }
  } else if (runTime < SKYHOOK_LOYY_MARKERS.cloudbreak) {
    const bar = Math.floor(runTime / 2.5);
    if (bar !== env.lastLightningBar && runTime - bar * 2.5 >= 0.035) {
      env.lastLightningBar = bar;
      triggerLightning(env, bar % 2 === 0 ? 0.9 : 0.68);
    }
  } else if (running && runTime < dt * 2) {
    env.lastLightningBar = -1;
  }
  env.lightningPulse = Math.max(0, env.lightningPulse - dt * 5.4);
  env.lightning.forEach((bolt, index) => {
    const active = index === env.lightningIndex && env.lightningPulse > 0;
    bolt.visible = active;
    (bolt.material as LineBasicMaterial).opacity = active ? Math.pow(env.lightningPulse, 1.35) : 0;
  });

  env.speedLines.position.copy(camera.position);
  env.speedLines.quaternion.copy(camera.quaternion);
  const lineOpacity = running ? MathUtils.lerp(0.28, 0.055, progress) : 0.08;
  (env.speedLines.material as LineBasicMaterial).opacity = runTime >= SKYHOOK_LOYY_MARKERS.dock ? lineOpacity * 0.2 : lineOpacity;
  const speed = runTime >= SKYHOOK_LOYY_MARKERS.dock ? MathUtils.lerp(42, 4, (runTime - SKYHOOK_LOYY_MARKERS.dock) / 5) : 42 + progress * 48;
  for (let i = 0; i < env.speedSeeds.length / 3; i += 1) {
    const p = i * 6;
    env.speedPositions[p + 2] += dt * speed;
    env.speedPositions[p + 5] += dt * speed;
    if (env.speedPositions[p + 2] > -7) {
      const z = -100 - (i % 17) * 2.3;
      env.speedPositions[p + 2] = z;
      env.speedPositions[p + 5] = z - 4 - Math.abs(env.speedPositions[p]) * 0.12;
    }
  }
  (env.speedLines.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;

  env.debrisRig.position.copy(camera.position);
  env.debrisRig.quaternion.copy(camera.quaternion);
  env.debrisRig.visible = running && runTime >= SKYHOOK_LOYY_MARKERS.cloudbreak && runTime < SKYHOOK_LOYY_MARKERS.boss;
  for (const piece of env.debris) {
    piece.mesh.position.z += dt * piece.speed;
    piece.mesh.position.y -= dt * (9 + piece.speed * 0.12);
    piece.mesh.position.x += dt * piece.drift;
    piece.mesh.rotation.x += dt * piece.spin.x;
    piece.mesh.rotation.y += dt * piece.spin.y;
    piece.mesh.rotation.z += dt * piece.spin.z;
    if (piece.mesh.position.z > -5 || piece.mesh.position.y < -22) {
      piece.mesh.position.z = -90 - (piece.speed % 37);
      piece.mesh.position.y = 12 + (piece.speed % 19);
      piece.mesh.position.x = MathUtils.clamp(piece.mesh.position.x * -0.7, -23, 23);
    }
  }

  env.clouds.forEach((cloud, index) => {
    cloud.rotation.y += dt * (cloud.userData.spin as number);
    cloud.position.x += Math.sin(runTime * 0.22 + index) * dt * 0.12;
  });
  env.stars.rotation.y += dt * 0.002;

  const dock = MathUtils.clamp((runTime - SKYHOOK_LOYY_MARKERS.dock - 2.2) / 2.2, 0, 1);
  for (const door of env.stationDoors) {
    const distance = MathUtils.lerp(door.openDistance, 3.1, dock * dock * (3 - 2 * dock));
    door.mesh.position.x = door.axis.x * distance;
    door.mesh.position.y = door.axis.y * distance;
  }
  const docking = MathUtils.clamp((runTime - SKYHOOK_LOYY_MARKERS.dock) / 5, 0, 1);
  env.stationCollars.forEach((collar, index) => {
    const direction = index % 2 === 0 ? 1 : -1;
    collar.rotation.z += dt * direction * (0.025 + docking * 0.18);
  });
  const chase = Math.floor((runTime - SKYHOOK_LOYY_MARKERS.dock) * 8);
  env.stationLamps.forEach((lamp) => {
    const slot = Number(lamp.userData.slot);
    const depth = Number(lamp.userData.depth);
    const lit = docking > 0 && ((slot + depth * 2 - chase) % 8 + 8) % 8 < 2;
    (lamp.material as MeshBasicMaterial).color.copy(lit ? ORANGE : HAZARD_DARK);
    lamp.scale.setScalar(lit ? 1.35 : 1);
  });
  const beacon = env.station.userData.captureBeacon as Mesh | undefined;
  if (beacon) {
    const pulse = docking > 0 ? 1 + Math.sin(runTime * 7) * 0.12 : 0.72;
    beacon.scale.setScalar(pulse);
    (beacon.material as MeshBasicMaterial).color.copy(docking > 0 ? ORANGE : HAZARD_DARK);
  }
}

export function triggerLightning(env: SkyhookEnvironment, intensity: number) {
  env.lightningIndex = (env.lightningIndex + 1) % env.lightning.length;
  env.lightningPulse = Math.max(env.lightningPulse, intensity);
}

export function flashCarDamage(env: SkyhookEnvironment, healthRemaining: number) {
  env.car.userData.damagePulse = 1;
  for (const panel of env.carPanels) {
    panel.color.copy(ORANGE);
  }
  env.carIntegrity.forEach((material, index) => {
    material.color.copy(index < healthRemaining ? ORANGE : HAZARD_DARK);
  });
}

export function resetCarIntegrity(env: SkyhookEnvironment) {
  for (const material of env.carIntegrity) material.color.copy(ORANGE);
  env.lastLightningBar = -1;
  env.lightningPulse = 0;
  env.car.userData.carThreats = 0;
  env.car.userData.carThreatUrgency = 0;
}

export function setCarThreatCount(env: SkyhookEnvironment, count: number, urgency = 0) {
  env.car.userData.carThreats = Math.max(0, count);
  env.car.userData.carThreatUrgency = MathUtils.clamp(urgency, 0, 1);
}
