import {
  createReaverShellMesh,
  type SkyhookTintPart,
} from './models';
import {
  BackSide,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
} from 'three';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import {
  SKYHOOK_7631_BOSS_TIME,
  SKYHOOK_7631_CLOUDBREAK_TIME,
  SKYHOOK_7631_DOCKING_TIME,
  SKYHOOK_7631_RUN_DURATION,
} from '../timing';
import {
  createSkyhook7631Rail,
  skyhook7631RunProgress,
  skyhook7631SpeedFactorAt,
} from '../gameplay';
import {
  CLOUD_GREY,
  CLOUD_WHITE,
  GRAPHITE,
  HAZARD_ORANGE,
  HIGH_BLUE,
  INDIGO,
  ORBIT_BLACK,
  PANEL_SHADE,
  PANEL_WHITE,
  STORM_SKY,
  SUNLIT_BLUE,
  WINDOW_BLUE,
  hdr,
} from './palette';

type FallParticle = {
  x: number;
  y: number;
  z: number;
  speed: number;
  length: number;
  width: number;
  drift: number;
  phase: number;
};

export type SkyhookEnvironment = {
  root: Group;
  rail: CatmullRomCurve3;
  cloudMaterial: MeshBasicMaterial;
  lowerCloudMaterial: MeshBasicMaterial;
  streakRoot: Group;
  streaks: InstancedMesh;
  streakMaterial: MeshBasicMaterial;
  fallParticles: FallParticle[];
  debrisRoot: Group;
  debris: InstancedMesh;
  debrisMaterial: MeshBasicMaterial;
  debrisParticles: FallParticle[];
  stars: Points;
  starMaterial: PointsMaterial;
  planetRoot: Group;
  planetMaterial: MeshBasicMaterial;
  atmosphereMaterial: MeshBasicMaterial;
  climber: Group;
  hullPips: Mesh[];
  hazardMaterials: MeshBasicMaterial[];
  station: Group;
  stationDoors: [Mesh, Mesh];
  stationRingMaterials: MeshBasicMaterial[];
  stationRotors: Group[];
  reaverShell: Group;
  damageFlash: number;
  beatPulse: number;
  bossDestroyed: boolean;
  bossDestroyAge: number;
};

const scratchMatrix = new Matrix4();
const scratchScale = new Vector3();
const scratchQuaternion = new Quaternion();
const identityQuaternion = new Quaternion();

export function createEnvironmentInternal(scene: Scene): SkyhookEnvironment {
  const root = new Group();
  root.name = 'skyhook-environment';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  const rail = createSkyhook7631Rail();
  scene.background = STORM_SKY.clone();
  scene.fog = new Fog(STORM_SKY.clone(), 10, 92);

  const hemisphere = new HemisphereLight(0xcbdbe0, 0x272421, 2.15);
  root.add(hemisphere);

  createTether(root, rail);
  createServiceCollars(root, rail);
  const { cloudMaterial, lowerCloudMaterial } = createClouds(root, rail);
  const speedField = createFallField(92, CLOUD_WHITE, 0.36);
  const debrisField = createFallField(34, HAZARD_ORANGE, 0.42);
  root.add(speedField.root, debrisField.root);
  const { stars, material: starMaterial } = createStars();
  root.add(stars);
  const planet = createPlanet();
  root.add(planet.root);
  const climber = createClimber();
  root.add(climber.root);
  const station = createStation(rail);
  root.add(station.root);
  const reaverShell = createReaverShellMesh();
  reaverShell.visible = false;
  root.add(reaverShell);

  const environment: SkyhookEnvironment = {
    root,
    rail,
    cloudMaterial,
    lowerCloudMaterial,
    streakRoot: speedField.root,
    streaks: speedField.mesh,
    streakMaterial: speedField.material,
    fallParticles: speedField.particles,
    debrisRoot: debrisField.root,
    debris: debrisField.mesh,
    debrisMaterial: debrisField.material,
    debrisParticles: debrisField.particles,
    stars,
    starMaterial,
    planetRoot: planet.root,
    planetMaterial: planet.surface,
    atmosphereMaterial: planet.atmosphere,
    climber: climber.root,
    hullPips: climber.hullPips,
    hazardMaterials: climber.hazardMaterials,
    station: station.root,
    stationDoors: station.doors,
    stationRingMaterials: station.ringMaterials,
    stationRotors: station.rotors,
    reaverShell,
    damageFlash: 0,
    beatPulse: 0,
    bossDestroyed: false,
    bossDestroyAge: 0,
  };
  resetEnvironment(environment);
  return environment;
}

function createTether(root: Group, rail: CatmullRomCurve3) {
  const pathPoints: Vector3[] = [];
  const secondaryPoints: Vector3[] = [];
  for (let index = 0; index <= 180; index += 1) {
    const u = index / 180;
    pathPoints.push(offsetFromRail(rail, u, new Vector3(6.2, 0, 0)));
    secondaryPoints.push(offsetFromRail(rail, u, new Vector3(6.95, 0, 0)));
  }
  const cablePath = new CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.3);
  const tracerPath = new CatmullRomCurve3(secondaryPoints, false, 'catmullrom', 0.3);
  root.add(
    new Mesh(new TubeGeometry(cablePath, 220, 0.32, 7, false), new MeshStandardMaterial({ color: GRAPHITE, roughness: 0.72, metalness: 0.65 })),
    new Mesh(new TubeGeometry(tracerPath, 220, 0.075, 5, false), new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.7) })),
  );
}

function createServiceCollars(root: Group, rail: CatmullRomCurve3) {
  const count = 34;
  const beamMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: PANEL_SHADE, roughness: 0.56, metalness: 0.7 }), count);
  const orangeMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: HAZARD_ORANGE }), count);
  beamMesh.frustumCulled = false;
  orangeMesh.frustumCulled = false;
  for (let index = 0; index < count; index += 1) {
    const u = 0.025 + index / (count - 1) * 0.94;
    const frame = sampleRailFrame(rail, u);
    const position = frame.position.clone().addScaledVector(frame.right, 6.2);
    const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
    scratchQuaternion.setFromRotationMatrix(basis);
    scratchMatrix.compose(position, scratchQuaternion, new Vector3(3.8, 0.16, 0.17));
    beamMesh.setMatrixAt(index, scratchMatrix);
    const orangePosition = position.clone().addScaledVector(frame.up, index % 2 === 0 ? 0.42 : -0.42);
    scratchMatrix.compose(orangePosition, scratchQuaternion, new Vector3(1.25, 0.09, 0.2));
    orangeMesh.setMatrixAt(index, scratchMatrix);
  }
  beamMesh.instanceMatrix.needsUpdate = true;
  orangeMesh.instanceMatrix.needsUpdate = true;
  root.add(beamMesh, orangeMesh);
}

function createClouds(root: Group, rail: CatmullRomCurve3) {
  const rng = seeded(7631);
  const cloudGeometry = new IcosahedronGeometry(1, 1);
  const cloudMaterial = new MeshBasicMaterial({
    color: CLOUD_WHITE,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const deckCount = 150;
  const deck = new InstancedMesh(cloudGeometry, cloudMaterial, deckCount);
  const deckU = skyhook7631RunProgress(SKYHOOK_7631_CLOUDBREAK_TIME, SKYHOOK_7631_RUN_DURATION);
  for (let index = 0; index < deckCount; index += 1) {
    const u = MathUtils.clamp(deckU + (rng() - 0.5) * 0.11, 0, 1);
    const x = (rng() - 0.5) * 175;
    const y = (rng() - 0.5) * 34;
    const z = (rng() - 0.5) * 36;
    const position = offsetFromRail(rail, u, new Vector3(x, y, z));
    const cloudScale = 5 + rng() * 13;
    scratchScale.set(cloudScale * (1.4 + rng()), cloudScale * (0.38 + rng() * 0.32), cloudScale * (0.8 + rng() * 0.6));
    scratchQuaternion.setFromAxisAngle(randomUnit(rng), rng() * Math.PI * 2);
    scratchMatrix.compose(position, scratchQuaternion, scratchScale);
    deck.setMatrixAt(index, scratchMatrix);
    deck.setColorAt(index, CLOUD_WHITE.clone().lerp(CLOUD_GREY, rng() * 0.48));
  }
  deck.instanceMatrix.needsUpdate = true;
  if (deck.instanceColor) deck.instanceColor.needsUpdate = true;

  const lowerCloudMaterial = new MeshBasicMaterial({
    color: CLOUD_GREY,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  const lowerCount = 74;
  const lower = new InstancedMesh(cloudGeometry, lowerCloudMaterial, lowerCount);
  for (let index = 0; index < lowerCount; index += 1) {
    const u = rng() * Math.max(0.02, deckU - 0.045);
    const position = offsetFromRail(rail, u, new Vector3((rng() - 0.5) * 120, (rng() - 0.5) * 55, (rng() - 0.5) * 25));
    const cloudScale = 4 + rng() * 10;
    scratchScale.set(cloudScale * (1.2 + rng()), cloudScale * 0.5, cloudScale);
    scratchQuaternion.setFromAxisAngle(randomUnit(rng), rng() * Math.PI * 2);
    scratchMatrix.compose(position, scratchQuaternion, scratchScale);
    lower.setMatrixAt(index, scratchMatrix);
  }
  lower.instanceMatrix.needsUpdate = true;
  root.add(deck, lower);
  return { cloudMaterial, lowerCloudMaterial };
}

function createFallField(count: number, color: Color, opacity: number) {
  const rng = seeded(count * 97 + 31);
  const root = new Group();
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, count);
  mesh.frustumCulled = false;
  const particles: FallParticle[] = [];
  for (let index = 0; index < count; index += 1) {
    particles.push({
      x: (rng() - 0.5) * 31,
      y: (rng() - 0.5) * 28,
      z: -7 - rng() * 62,
      speed: 0.45 + rng() * 1.3,
      length: 0.6 + rng() * 3.1,
      width: 0.018 + rng() * 0.08,
      drift: (rng() - 0.5) * 0.7,
      phase: rng() * Math.PI * 2,
    });
  }
  root.add(mesh);
  return { root, mesh, material, particles };
}

function createStars() {
  const rng = seeded(9127);
  const positions: number[] = [];
  const center = new Vector3(0, 380, -165);
  for (let index = 0; index < 620; index += 1) {
    const direction = randomUnit(rng);
    const radius = 250 + rng() * 185;
    const point = center.clone().addScaledVector(direction, radius);
    positions.push(point.x, point.y, point.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: CLOUD_WHITE,
    size: 0.85,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return { stars: new Points(geometry, material), material };
}

function createPlanet() {
  const root = new Group();
  const surface = new MeshBasicMaterial({ color: new Color(0x173d55), transparent: true, opacity: 0.08 });
  const atmosphere = new MeshBasicMaterial({
    color: SUNLIT_BLUE.clone().multiplyScalar(0.75),
    transparent: true,
    opacity: 0.06,
    side: BackSide,
    depthWrite: false,
  });
  const globe = new Mesh(new SphereGeometry(330, 56, 30), surface);
  globe.position.set(0, -410, -270);
  const shell = new Mesh(new SphereGeometry(339, 56, 30), atmosphere);
  shell.position.copy(globe.position);
  root.add(globe, shell);
  return { root, surface, atmosphere };
}

function createClimber() {
  const root = new Group();
  const hullPips: Mesh[] = [];
  const hazardMaterials: MeshBasicMaterial[] = [];
  const panelMaterial = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.58) });
  const darkMaterial = new MeshBasicMaterial({ color: GRAPHITE });

  for (const side of [-1, 1]) {
    const sill = new Mesh(new BoxGeometry(1, 1, 1), panelMaterial.clone());
    sill.position.set(side * 3.15, -2.28, -4.8);
    sill.scale.set(2.8, 0.36, 4.6);
    sill.rotation.z = side * -0.05;
    const brace = new Mesh(new BoxGeometry(1, 1, 1), darkMaterial.clone());
    brace.position.set(side * 3.95, -1.2, -5.5);
    brace.scale.set(0.18, 2.2, 0.22);
    brace.rotation.z = side * -0.48;
    root.add(sill, brace);
    for (let stripe = 0; stripe < 4; stripe += 1) {
      const material = new MeshBasicMaterial({ color: stripe % 2 === 0 ? HAZARD_ORANGE : GRAPHITE });
      const marker = new Mesh(new BoxGeometry(1, 1, 1), material);
      marker.position.set(side * (2.4 + stripe * 0.38), -2.05, -2.75);
      marker.scale.set(0.26, 0.08, 0.5);
      marker.rotation.z = side * 0.5;
      root.add(marker);
      if (stripe % 2 === 0) hazardMaterials.push(material);
    }
  }

  const dash = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: GRAPHITE }));
  dash.position.set(0, -2.42, -3.25);
  dash.scale.set(3.2, 0.28, 1.1);
  root.add(dash);
  for (let index = 0; index < 4; index += 1) {
    const pip = new Mesh(new BoxGeometry(0.48, 0.12, 0.12), new MeshBasicMaterial({ color: HAZARD_ORANGE }));
    pip.position.set((index - 1.5) * 0.68, -2.18, -2.66);
    root.add(pip);
    hullPips.push(pip);
  }
  return { root, hullPips, hazardMaterials };
}

function createStation(rail: CatmullRomCurve3) {
  const root = new Group();
  root.name = 'skyhook-orbital-station';
  const frame = sampleRailFrame(rail, 0.982);
  root.position.copy(frame.position);
  root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));

  const ringMaterials: MeshBasicMaterial[] = [];
  const rotors: Group[] = [];
  for (let ringIndex = 0; ringIndex < 4; ringIndex += 1) {
    const rotor = new Group();
    rotor.position.z = ringIndex * 8;
    const radius = 10.5 - ringIndex * 0.45;
    const ringMaterial = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.42) });
    const ring = new Mesh(new TorusGeometry(radius, 0.48, 7, 36), ringMaterial);
    rotor.add(ring);
    ringMaterials.push(ringMaterial);
    for (let strutIndex = 0; strutIndex < 8; strutIndex += 1) {
      const angle = strutIndex * Math.PI / 4;
      const strut = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: strutIndex % 2 === 0 ? PANEL_SHADE : GRAPHITE }));
      strut.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      strut.scale.set(0.35, 3.1, 0.48);
      strut.rotation.z = angle;
      rotor.add(strut);
      if (strutIndex % 2 === 0) {
        const lampMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.78) });
        const lamp = new Mesh(new BoxGeometry(0.42, 0.18, 0.16), lampMaterial);
        lamp.position.set(Math.cos(angle) * (radius - 1), Math.sin(angle) * (radius - 1), -0.52);
        lamp.rotation.z = angle;
        rotor.add(lamp);
        ringMaterials.push(lampMaterial);
      }
    }
    root.add(rotor);
    rotors.push(rotor);
  }

  const doorMaterial = new MeshBasicMaterial({ color: PANEL_WHITE });
  const leftDoor = new Mesh(new BoxGeometry(1, 1, 1), doorMaterial.clone());
  const rightDoor = new Mesh(new BoxGeometry(1, 1, 1), doorMaterial.clone());
  leftDoor.scale.set(5.0, 10.2, 0.38);
  rightDoor.scale.copy(leftDoor.scale);
  leftDoor.position.set(-5.1, 0, 14);
  rightDoor.position.set(5.1, 0, 14);
  root.add(leftDoor, rightDoor);
  return { root, doors: [leftDoor, rightDoor] as [Mesh, Mesh], ringMaterials, rotors };
}

export function resetEnvironment(environment: SkyhookEnvironment) {
  environment.damageFlash = 0;
  environment.beatPulse = 0;
  environment.bossDestroyed = false;
  environment.bossDestroyAge = 0;
  environment.reaverShell.visible = false;
  environment.reaverShell.scale.setScalar(1);
  for (const pip of environment.hullPips) (pip.material as MeshBasicMaterial).color.copy(HAZARD_ORANGE);
  for (const material of environment.hazardMaterials) material.color.copy(HAZARD_ORANGE);
}

export function markBossDestroyed(environment: SkyhookEnvironment) {
  environment.bossDestroyed = true;
  environment.bossDestroyAge = 0;
  environment.beatPulse = Math.max(environment.beatPulse, 1.6);
}

export function damageClimber(environment: SkyhookEnvironment, healthRemaining: number) {
  environment.damageFlash = 1;
  for (let index = 0; index < environment.hullPips.length; index += 1) {
    const material = environment.hullPips[index].material as MeshBasicMaterial;
    material.color.copy(index < healthRemaining ? HAZARD_ORANGE : GRAPHITE);
  }
}

export function pulseEnvironment(environment: SkyhookEnvironment, downbeat: boolean) {
  environment.beatPulse = Math.max(environment.beatPulse, downbeat ? 1 : 0.38);
}

export function updateEnvironment(
  environment: SkyhookEnvironment,
  dt: number,
  camera: PerspectiveCamera,
  scene: Scene,
  runTime: number,
  running: boolean,
) {
  const time = running ? runTime : 0;
  const speed = running ? skyhook7631SpeedFactorAt(time) : 0.58;
  environment.damageFlash = Math.max(0, environment.damageFlash - dt * 2.4);
  environment.beatPulse = Math.max(0, environment.beatPulse - dt * 3.2);

  const sky = skyColorAt(time, running);
  (scene.background as Color).lerp(sky, Math.min(1, dt * 1.7));
  if (scene.fog instanceof Fog) {
    scene.fog.color.copy(scene.background as Color);
    const altitude = MathUtils.clamp(time / SKYHOOK_7631_BOSS_TIME, 0, 1);
    scene.fog.near = MathUtils.lerp(10, 86, altitude);
    scene.fog.far = MathUtils.lerp(92, 490, altitude);
  }

  const deckFade = 1 - smoother(MathUtils.clamp(
    (time - (SKYHOOK_7631_CLOUDBREAK_TIME - 1.3)) / 3,
    0,
    1,
  ));
  environment.cloudMaterial.opacity = running ? deckFade * 0.32 : 0.26;
  environment.lowerCloudMaterial.opacity = running ? Math.max(0, 0.38 - time / 38) : 0.32;
  const starFade = running ? smoother(MathUtils.clamp((time - 29) / 10, 0, 1)) : 0;
  environment.starMaterial.opacity = starFade * 0.92;

  environment.planetRoot.position.copy(camera.position);
  environment.planetRoot.quaternion.copy(camera.quaternion);
  const planetFade = running ? 0.08 + smoother(MathUtils.clamp((time - 15) / 25, 0, 1)) * 0.84 : 0.08;
  environment.planetMaterial.opacity = planetFade;
  environment.planetMaterial.color.copy(new Color(0x173d55)).lerp(new Color(0x122939), MathUtils.clamp((time - 28) / 18, 0, 1));
  environment.atmosphereMaterial.opacity = planetFade * 0.24;

  environment.streakRoot.position.copy(camera.position);
  environment.streakRoot.quaternion.copy(camera.quaternion);
  environment.debrisRoot.position.copy(camera.position);
  environment.debrisRoot.quaternion.copy(camera.quaternion);
  updateFallField(environment.streaks, environment.fallParticles, dt, speed, time, false);
  updateFallField(environment.debris, environment.debrisParticles, dt, speed, time, true);
  const air = 1 - MathUtils.clamp(time / 45, 0, 1);
  environment.streakMaterial.opacity = (0.06 + air * 0.34) * (0.8 + environment.beatPulse * 0.25);
  environment.streakMaterial.color.copy(CLOUD_WHITE).lerp(WINDOW_BLUE, MathUtils.clamp((time - 14) / 16, 0, 1));
  environment.debrisMaterial.opacity = running ? 0.08 + (1 - air) * 0.28 : 0.12;

  environment.climber.position.copy(camera.position);
  environment.climber.quaternion.copy(camera.quaternion);
  const warning = environment.damageFlash;
  for (const material of environment.hazardMaterials) {
    material.color.copy(HAZARD_ORANGE).lerp(CLOUD_WHITE, warning * 0.8).multiplyScalar(1 + warning * 0.4);
  }

  const dockOpen = environment.bossDestroyed
    ? smoother(MathUtils.clamp((time - (SKYHOOK_7631_DOCKING_TIME - 1.8)) / 2.2, 0, 1))
    : 0;
  environment.stationDoors[0].position.x = -5.1 - dockOpen * 7.8;
  environment.stationDoors[1].position.x = 5.1 + dockOpen * 7.8;
  for (let index = 0; index < environment.stationRotors.length; index += 1) {
    environment.stationRotors[index].rotation.z += dt * (index % 2 === 0 ? 0.055 : -0.04) * (1 + dockOpen * 3);
  }
  const stationLight = 0.42 + environment.beatPulse * 0.12 + dockOpen * 0.45;
  for (const material of environment.stationRingMaterials) material.color.copy(PANEL_WHITE).multiplyScalar(stationLight);

  updateReaverShell(environment, dt, camera, time, running);
}

function updateReaverShell(
  environment: SkyhookEnvironment,
  dt: number,
  camera: PerspectiveCamera,
  time: number,
  running: boolean,
) {
  const shell = environment.reaverShell;
  if (!running || time < SKYHOOK_7631_BOSS_TIME) {
    shell.visible = false;
    return;
  }
  shell.visible = true;
  const fight = MathUtils.clamp((time - SKYHOOK_7631_BOSS_TIME) / (SKYHOOK_7631_DOCKING_TIME - SKYHOOK_7631_BOSS_TIME), 0, 1);
  const approach = 1 - (1 - fight) ** 2;
  const progress = skyhook7631RunProgress(time, SKYHOOK_7631_RUN_DURATION);
  const distanceAhead = MathUtils.lerp(58, 7.2, approach);
  const frame = sampleRailFrame(environment.rail, MathUtils.clamp(progress + distanceAhead / environment.rail.getLength(), 0, 1));
  shell.position.copy(frame.position)
    .addScaledVector(frame.right, 6.2)
    .addScaledVector(frame.up, 1.4);
  shell.quaternion.copy(camera.quaternion);
  shell.rotateZ(Math.sin(time * 0.65) * 0.08);
  const latchIn = smoother(MathUtils.clamp((time - SKYHOOK_7631_BOSS_TIME) / 0.9, 0, 1));
  shell.scale.setScalar(latchIn);

  const gears = shell.userData.gears as Mesh[] | undefined;
  if (gears) {
    gears[0].rotation.z += dt * (0.8 + approach * 2.5);
    gears[1].rotation.z -= dt * 1.4;
  }
  const jaws = shell.userData.jaws as Group[] | undefined;
  if (jaws) {
    for (const [index, jaw] of jaws.entries()) jaw.rotation.z = (index === 0 ? 1 : -1) * (0.06 + Math.sin(time * (2 + approach * 4)) * (0.05 + approach * 0.12));
  }
  const parts = shell.userData.tintParts as SkyhookTintPart[] | undefined;
  if (parts) {
    for (const part of parts) {
      const pulse = part.role === 'hot' ? 0.78 + environment.beatPulse * 0.16 : 0.72 + approach * 0.28;
      part.material.color.copy(part.base).multiplyScalar(pulse);
    }
  }

  if (environment.bossDestroyed) {
    environment.bossDestroyAge += dt;
    const collapse = Math.max(0, 1 - environment.bossDestroyAge / 1.15);
    shell.scale.setScalar(latchIn * collapse);
    shell.position.addScaledVector(frame.right, environment.bossDestroyAge * 7);
    shell.rotateZ(environment.bossDestroyAge * 2.8);
    if (collapse <= 0) shell.visible = false;
  }
}

function updateFallField(
  mesh: InstancedMesh,
  particles: FallParticle[],
  dt: number,
  speed: number,
  time: number,
  debris: boolean,
) {
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.y -= dt * (16 + speed * (debris ? 52 : 38)) * particle.speed;
    particle.x += dt * (particle.drift + Math.sin(time * 0.6 + particle.phase) * 0.18);
    if (particle.y < -15) {
      particle.y = 14 + (index % 7) * 0.7;
      particle.x = ((index * 11.37) % 31) - 15.5;
      particle.z = -8 - ((index * 17.19) % 61);
    }
    const stretch = particle.length * (0.7 + speed * 1.5);
    scratchScale.set(particle.width, stretch, particle.width);
    scratchMatrix.compose(new Vector3(particle.x, particle.y, particle.z), identityQuaternion, scratchScale);
    mesh.setMatrixAt(index, scratchMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function skyColorAt(time: number, running: boolean) {
  if (!running) return STORM_SKY;
  if (time < 12.5) return STORM_SKY.clone().lerp(CLOUD_GREY.clone().multiplyScalar(0.48), smoother(time / 12.5));
  if (time < 18) return CLOUD_GREY.clone().multiplyScalar(0.48).lerp(SUNLIT_BLUE, smoother((time - 12.5) / 5.5));
  if (time < 30) return SUNLIT_BLUE.clone().lerp(HIGH_BLUE, smoother((time - 18) / 12));
  if (time < 39) return HIGH_BLUE.clone().lerp(INDIGO, smoother((time - 30) / 9));
  return INDIGO.clone().lerp(ORBIT_BLACK, smoother(MathUtils.clamp((time - 39) / 8, 0, 1)));
}

function smoother(value: number) {
  return value * value * (3 - 2 * value);
}

function seeded(seedValue: number) {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomUnit(rng: () => number) {
  const result = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
  if (result.lengthSq() < 0.0001) result.set(1, 0, 0);
  return result.normalize();
}
