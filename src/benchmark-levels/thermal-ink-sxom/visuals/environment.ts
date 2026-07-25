import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  PlaneGeometry,
  PointLight,
  Points,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { THERMAL_INK_BOSS_CENTER } from '../gameplay';
import {
  DARK_RUST,
  DIRTY_CREAM,
  FLESH_RIDGE,
  INK,
  LAMP,
  MURK,
  OCHRE,
  OILY_FLESH,
  RUST,
  TOBACCO,
} from './palette';
import {
  thermalBasic,
  thermalPoints,
  thermalStandard,
} from './materials';

type HarborLamp = {
  fixture: Group;
  light?: PointLight;
  phase: number;
};

let harborRoot: Group | null = null;
let bossRoot: Group | null = null;
let dustField: Points | null = null;
let overheadWater: Mesh | null = null;
let currentScene: Scene | null = null;
let collapse = 0;
let beatEnergy = 0;
let bossBaseY = 0;
const lamps: HarborLamp[] = [];
const hangingCables: Group[] = [];

const boxGeometry = new BoxGeometry(1, 1, 1);
const cylinderGeometry = new CylinderGeometry(1, 1, 1, 10);

export function createHarborEnvironment(scene: Scene) {
  currentScene = scene;
  harborRoot = new Group();
  harborRoot.name = 'thermal-ink-harbor';
  // Harbor geometry deliberately frames and briefly crosses the sightline as
  // the rail skims wreckage. It is scenery, never target cover; target
  // readability is carried by the hot silhouettes and signal cores.
  harborRoot.userData.raildIgnoreOcclusion = true;
  scene.add(harborRoot);
  lamps.length = 0;
  hangingCables.length = 0;
  collapse = 0;
  beatEnergy = 0;

  scene.fog = new FogExp2(MURK, 0.0125);
  const ambient = new AmbientLight(0x7d542e, 1.28);
  ambient.userData.thermalAmbient = true;
  scene.add(ambient);
  const sodiumKey = new DirectionalLight(0xffad54, 1.65);
  sodiumKey.position.set(-30, 42, 18);
  sodiumKey.target.position.copy(THERMAL_INK_BOSS_CENTER);
  sodiumKey.userData.thermalKey = true;
  scene.add(sodiumKey, sodiumKey.target);

  createWaterVolume(harborRoot);
  createParticulate(harborRoot);
  createCentralWreck(harborRoot);
  createOuterWrecks(harborRoot);
  createPipeForest(harborRoot);
  createChainsAndCables(harborRoot);
  createLampRing(harborRoot);
  bossRoot = createOctopusBody();
  bossRoot.position.copy(THERMAL_INK_BOSS_CENTER);
  bossBaseY = bossRoot.position.y;
  harborRoot.add(bossRoot);
}

function createWaterVolume(root: Group) {
  overheadWater = new Mesh(
    new PlaneGeometry(520, 520, 12, 12),
    thermalStandard('water', 0x4b351c, {
      opacity: 0.28,
      roughness: 0.2,
      metalness: 0.1,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  overheadWater.rotation.x = Math.PI / 2;
  overheadWater.position.set(0, 18, -220);
  overheadWater.userData.waterSurface = true;
  root.add(overheadWater);

  const bed = new Mesh(
    new PlaneGeometry(500, 500, 2, 2),
    thermalStandard('world', TOBACCO, { roughness: 1, metalness: 0, side: DoubleSide }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, -27, -220);
  root.add(bed);

  // Long sediment ridges make low passes readable even with bloom disabled.
  for (let index = 0; index < 22; index += 1) {
    const ridge = new Mesh(
      new BoxGeometry(1, 0.45, 1),
      thermalStandard('world', index % 3 === 0 ? OCHRE : TOBACCO, { roughness: 1 }),
    );
    const angle = index * 2.399963;
    const radius = 32 + (index % 7) * 18;
    ridge.position.set(
      Math.cos(angle) * radius,
      -26.5 + (index % 3) * 0.2,
      -220 + Math.sin(angle) * radius,
    );
    ridge.scale.set(7 + (index % 5) * 3, 1, 1.2 + (index % 4) * 0.5);
    ridge.rotation.y = angle + 0.4;
    root.add(ridge);
  }
}

function createParticulate(root: Group) {
  const positions: number[] = [];
  for (let index = 0; index < 1100; index += 1) {
    const angle = index * 2.399963;
    const radius = 8 + ((index * 37) % 145);
    positions.push(
      Math.cos(angle) * radius,
      -24 + ((index * 53) % 42),
      -220 + Math.sin(angle) * radius,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  dustField = new Points(
    geometry,
    thermalPoints('world', 0x8d6333, { size: 0.17, opacity: 0.48, depthWrite: false }),
  );
  dustField.userData.sediment = true;
  root.add(dustField);
}

function createCentralWreck(root: Group) {
  const wreck = new Group();
  wreck.name = 'central-drowned-slip';
  wreck.position.copy(THERMAL_INK_BOSS_CENTER).add(new Vector3(0, -13, 5));
  wreck.rotation.y = -0.22;
  wreck.userData.raildIgnoreOcclusion = true;

  const keel = new Mesh(
    new BoxGeometry(4.5, 3.8, 52),
    thermalStandard('rust', DARK_RUST, { roughness: 0.92, metalness: 0.55 }),
  );
  keel.rotation.x = 0.08;
  wreck.add(keel);

  for (let index = 0; index < 11; index += 1) {
    const rib = new Mesh(
      new TorusGeometry(9.5 - (index % 2) * 0.7, 0.32, 7, 22, Math.PI * 1.22),
      thermalStandard('rust', index % 3 === 0 ? DIRTY_CREAM : RUST, {
        roughness: 0.84,
        metalness: 0.62,
      }),
    );
    rib.position.z = -24 + index * 4.8;
    rib.rotation.z = Math.PI * 0.89;
    rib.rotation.y = index % 2 ? 0.12 : -0.08;
    wreck.add(rib);
  }

  for (let index = 0; index < 16; index += 1) {
    const plate = new Mesh(
      boxGeometry,
      thermalStandard(index % 4 === 0 ? 'cream' : 'rust', index % 4 === 0 ? DIRTY_CREAM : RUST, {
        roughness: 0.88,
        metalness: 0.5,
      }),
    );
    const side = index % 2 ? -1 : 1;
    plate.position.set(side * (7.6 + (index % 3)), -1 + (index % 4) * 1.35, -21 + index * 2.8);
    plate.scale.set(4.4 + (index % 3), 0.45, 3.4);
    plate.rotation.set(0.15 * side, 0.08 * index, side * 0.44);
    wreck.add(plate);
  }

  const mast = new Mesh(
    new CylinderGeometry(0.85, 1.25, 33, 10),
    thermalStandard('rust', RUST, { roughness: 0.86, metalness: 0.65 }),
  );
  mast.position.set(-5, 13, 2);
  mast.rotation.z = 0.13;
  wreck.add(mast);
  const snappedBoom = new Mesh(
    new BoxGeometry(1.2, 1.2, 32),
    thermalStandard('cream', DIRTY_CREAM, { roughness: 0.86, metalness: 0.55 }),
  );
  snappedBoom.position.set(4, 25, -8);
  snappedBoom.rotation.set(0.1, -0.55, 1.02);
  wreck.add(snappedBoom);
  root.add(wreck);
}

function createOuterWrecks(root: Group) {
  const specs = [
    { position: new Vector3(76, -12, -212), rotation: -0.72, scale: 1.1 },
    { position: new Vector3(-78, -8, -232), rotation: 0.64, scale: 1.2 },
    { position: new Vector3(45, -18, -292), rotation: -0.18, scale: 0.82 },
    { position: new Vector3(-44, -17, -152), rotation: 0.31, scale: 0.9 },
  ];
  for (const [wreckIndex, spec] of specs.entries()) {
    const wreck = new Group();
    wreck.position.copy(spec.position);
    wreck.rotation.y = spec.rotation;
    wreck.scale.setScalar(spec.scale);
    wreck.userData.raildIgnoreOcclusion = true;

    const hull = new Mesh(
      new BoxGeometry(16, 7, 54),
      thermalStandard('rust', wreckIndex % 2 ? DARK_RUST : RUST, {
        roughness: 0.9,
        metalness: 0.54,
      }),
    );
    hull.rotation.z = wreckIndex % 2 ? 0.26 : -0.18;
    wreck.add(hull);

    for (let plateIndex = 0; plateIndex < 10; plateIndex += 1) {
      const plate = new Mesh(
        boxGeometry,
        thermalStandard(plateIndex % 3 === 0 ? 'cream' : 'rust', plateIndex % 3 === 0 ? DIRTY_CREAM : RUST, {
          roughness: 0.9,
          metalness: 0.5,
        }),
      );
      const side = plateIndex % 2 ? -1 : 1;
      plate.position.set(side * 8.4, -1 + (plateIndex % 4) * 1.4, -21 + plateIndex * 4.6);
      plate.scale.set(4.2, 0.35, 3.8);
      plate.rotation.z = side * (0.52 + (plateIndex % 3) * 0.1);
      wreck.add(plate);
    }
    root.add(wreck);
  }
}

function createPipeForest(root: Group) {
  for (let index = 0; index < 32; index += 1) {
    const angle = index * 2.399963;
    const radius = 45 + (index % 9) * 7;
    const height = 7 + (index % 6) * 3.7;
    const pipe = new Mesh(
      new CylinderGeometry(0.45 + (index % 3) * 0.16, 0.55 + (index % 3) * 0.16, height, 8),
      thermalStandard(index % 5 === 0 ? 'cream' : 'rust', index % 5 === 0 ? DIRTY_CREAM : RUST, {
        roughness: 0.86,
        metalness: 0.63,
      }),
    );
    pipe.position.set(
      Math.cos(angle) * radius,
      -25 + height / 2,
      -220 + Math.sin(angle) * radius,
    );
    pipe.rotation.z = Math.sin(index * 1.7) * 0.28;
    root.add(pipe);
    if (index % 4 === 0) {
      const rim = new Mesh(
        new TorusGeometry(0.82 + (index % 3) * 0.15, 0.12, 5, 15),
        thermalStandard('rust', DARK_RUST, { roughness: 0.82, metalness: 0.72 }),
      );
      rim.position.copy(pipe.position);
      rim.position.y += height / 2;
      rim.rotation.x = Math.PI / 2;
      root.add(rim);
    }
  }
}

function createChainsAndCables(root: Group) {
  for (let cableIndex = 0; cableIndex < 7; cableIndex += 1) {
    const angle = cableIndex * Math.PI * 2 / 7 + 0.25;
    const radius = 25 + cableIndex * 6.8;
    const cable = new Group();
    cable.userData.raildIgnoreOcclusion = true;
    const points = [
      new Vector3(Math.cos(angle) * radius, 14, -220 + Math.sin(angle) * radius),
      new Vector3(Math.cos(angle + 0.2) * radius * 0.92, 3 - cableIndex, -220 + Math.sin(angle + 0.2) * radius * 0.92),
      new Vector3(Math.cos(angle + 0.45) * radius * 0.8, -11, -220 + Math.sin(angle + 0.45) * radius * 0.8),
    ];
    const curve = new CatmullRomCurve3(points);
    const tube = new Mesh(
      new TubeGeometry(curve, 26, 0.18 + (cableIndex % 3) * 0.05, 6, false),
      thermalStandard('rust', cableIndex % 2 ? DARK_RUST : RUST, {
        roughness: 0.82,
        metalness: 0.62,
      }),
    );
    cable.add(tube);
    cable.userData.cablePhase = cableIndex * 0.8;
    hangingCables.push(cable);
    root.add(cable);
  }

  // One snapped chain hangs close to the route. Alternating link planes keep
  // the silhouette unmistakable at a glance.
  const chain = new Group();
  chain.position.set(-30, 13, -193);
  chain.rotation.z = 0.22;
  chain.userData.raildIgnoreOcclusion = true;
  for (let index = 0; index < 22; index += 1) {
    const link = new Mesh(
      new TorusGeometry(0.72, 0.15, 6, 14),
      thermalStandard('rust', RUST, { roughness: 0.78, metalness: 0.72 }),
    );
    link.position.set(Math.sin(index * 0.34) * 1.3, -index * 1.1, Math.cos(index * 0.34) * 0.8);
    link.rotation.y = index % 2 ? Math.PI / 2 : 0;
    chain.add(link);
  }
  root.add(chain);
}

function createLampRing(root: Group) {
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI * 2 / 12 + 0.18;
    const radius = 49 + (index % 3) * 8;
    const lamp = new Group();
    lamp.position.set(
      Math.cos(angle) * radius,
      -7 + (index % 4) * 4.2,
      -220 + Math.sin(angle) * radius,
    );
    lamp.lookAt(THERMAL_INK_BOSS_CENTER);
    const pole = new Mesh(
      new CylinderGeometry(0.26, 0.34, 9, 7),
      thermalStandard('rust', RUST, { roughness: 0.82, metalness: 0.66 }),
    );
    pole.position.y = -4.4;
    lamp.add(pole);
    const hood = new Mesh(
      new ConeGeometry(1.25, 1.1, 8, 1, true),
      thermalStandard('cream', DIRTY_CREAM, {
        roughness: 0.76,
        metalness: 0.48,
        side: DoubleSide,
      }),
    );
    hood.rotation.x = Math.PI;
    lamp.add(hood);
    const lens = new Mesh(
      new SphereGeometry(0.58, 10, 7),
      thermalStandard('lamp', LAMP, {
        emissive: LAMP,
        emissiveIntensity: 1.25,
        thermalEmissiveIntensity: 0.2,
        roughness: 0.25,
      }),
    );
    lens.position.y = -0.48;
    lamp.add(lens);
    let light: PointLight | undefined;
    if (index % 2 === 0) {
      light = new PointLight(0xffa542, 11, 32, 1.8);
      light.position.y = -0.7;
      lamp.add(light);
    }
    lamps.push({ fixture: lamp, light, phase: index * 0.71 });
    root.add(lamp);
  }
}

function createOctopusBody() {
  const body = new Group();
  body.name = 'thermal-ink-octopus-body';
  body.userData.octopusBody = true;
  body.userData.raildIgnoreOcclusion = true;

  const mantle = new Mesh(
    new SphereGeometry(8.2, 24, 16),
    thermalStandard('hot', OILY_FLESH, {
      roughness: 0.44,
      metalness: 0.04,
      emissive: 0x080302,
      emissiveIntensity: 0.12,
      thermalEmissiveIntensity: 0.38,
    }),
  );
  mantle.scale.set(1.08, 1.38, 0.96);
  mantle.position.y = 5;
  mantle.rotation.x = -0.18;
  body.add(mantle);

  const brow = new Mesh(
    new SphereGeometry(6.4, 20, 13),
    thermalStandard('hot', FLESH_RIDGE, {
      roughness: 0.5,
      emissive: 0x080302,
      emissiveIntensity: 0.1,
    }),
  );
  brow.scale.set(1.2, 0.55, 0.82);
  brow.position.set(0, 1.1, 4.7);
  body.add(brow);

  for (let side = -1; side <= 1; side += 2) {
    const eye = new Mesh(
      new SphereGeometry(1.1, 16, 10),
      thermalStandard('hot', 0x725a3b, {
        emissive: 0x1c1108,
        emissiveIntensity: 0.25,
        thermalEmissiveIntensity: 0.48,
        roughness: 0.32,
      }),
    );
    eye.position.set(side * 2.7, 2, 9.7);
    eye.scale.set(0.75, 1.25, 0.42);
    body.add(eye);
    const pupil = new Mesh(
      new SphereGeometry(0.42, 12, 8),
      thermalStandard('hot', INK, { roughness: 0.2 }),
    );
    pupil.position.set(side * 2.7, 2, 10.15);
    pupil.scale.set(0.45, 1.1, 0.28);
    body.add(pupil);
  }

  for (let tentacleIndex = 0; tentacleIndex < 8; tentacleIndex += 1) {
    const angle = tentacleIndex * Math.PI / 4 + 0.2;
    const reach = 20 + (tentacleIndex % 3) * 6;
    const points = [
      new Vector3(Math.cos(angle) * 4, -1, Math.sin(angle) * 4),
      new Vector3(Math.cos(angle + 0.25) * 10, -5 - (tentacleIndex % 2) * 2, Math.sin(angle + 0.25) * 10),
      new Vector3(Math.cos(angle - 0.18) * reach, -8 + (tentacleIndex % 3) * 3, Math.sin(angle - 0.18) * reach),
      new Vector3(Math.cos(angle + 0.45) * (reach + 7), -12 + (tentacleIndex % 4) * 2, Math.sin(angle + 0.45) * (reach + 7)),
    ];
    const tentacle = new Mesh(
      new TubeGeometry(new CatmullRomCurve3(points), 32, 1.45 - tentacleIndex * 0.055, 9, false),
      thermalStandard('hot', tentacleIndex % 2 ? FLESH_RIDGE : OILY_FLESH, {
        roughness: 0.5,
        emissive: 0x080302,
        emissiveIntensity: 0.1,
        thermalEmissiveIntensity: 0.34,
      }),
    );
    tentacle.userData.bodyTentacle = tentacleIndex;
    body.add(tentacle);
  }

  // Rust collars and snapped cables show the animal is already integrated into
  // the wreck when the run starts.
  for (let index = 0; index < 5; index += 1) {
    const collar = new Mesh(
      new TorusGeometry(5.5 + index * 0.55, 0.22, 7, 24, Math.PI * 1.2),
      thermalStandard('rust', index % 2 ? RUST : DIRTY_CREAM, {
        roughness: 0.82,
        metalness: 0.62,
      }),
    );
    collar.position.set(0, -1.5 - index * 1.05, 0);
    collar.rotation.set(Math.PI / 2, index * 0.4, 0.5);
    body.add(collar);
  }

  return body;
}

export function pulseHarborBeat(isDownbeat: boolean) {
  beatEnergy = Math.max(beatEnergy, isDownbeat ? 1.25 : 0.72);
}

export function beginBossCollapse() {
  collapse = Math.max(collapse, 0.001);
}

export function resetBossEnvironment() {
  collapse = 0;
  if (!bossRoot) return;
  bossRoot.visible = true;
  bossRoot.position.copy(THERMAL_INK_BOSS_CENTER);
  bossRoot.scale.set(1, 1, 1);
  bossRoot.rotation.set(0, 0, 0);
  bossBaseY = bossRoot.position.y;
}

export function updateHarborEnvironment(
  dt: number,
  elapsed: number,
  runTime: number,
  infrared: number,
  inkDensity: number,
  camera: PerspectiveCamera,
) {
  beatEnergy = Math.max(0, beatEnergy - dt * 2.5);
  if (dustField) {
    dustField.rotation.y += dt * 0.006;
    dustField.position.y = Math.sin(elapsed * 0.12) * 0.8;
  }
  if (overheadWater) {
    overheadWater.position.y = 18 + Math.sin(elapsed * 0.22) * 0.45;
    overheadWater.rotation.z = Math.sin(elapsed * 0.08) * 0.015;
  }
  for (const cable of hangingCables) {
    const phase = Number(cable.userData.cablePhase ?? 0);
    cable.rotation.z = Math.sin(elapsed * 0.25 + phase) * 0.018;
  }
  for (const lamp of lamps) {
    const pulse = 0.78 + beatEnergy * 0.32 + Math.sin(elapsed * 2.1 + lamp.phase) * 0.08;
    lamp.fixture.scale.setScalar(1 + beatEnergy * 0.008);
    if (lamp.light) {
      lamp.light.intensity = (10.5 * pulse) * (1 - infrared * 0.84) * (1 - inkDensity * 0.62);
    }
  }

  if (currentScene?.fog instanceof FogExp2) {
    currentScene.fog.color
      .setRGB(0.35, 0.22, 0.105)
      .lerp(new Color().setRGB(0.008, 0.009, 0.009), infrared);
    currentScene.fog.density = 0.0125 + inkDensity * 0.018 * (1 - infrared) - infrared * 0.004;
  }
  currentScene?.traverse((object) => {
    if (object.userData.thermalAmbient && 'intensity' in object) {
      (object as AmbientLight).intensity = 1.28 * (1 - infrared * 0.72);
    }
    if (object.userData.thermalKey && 'intensity' in object) {
      (object as DirectionalLight).intensity = 1.65 * (1 - infrared * 0.82);
    }
  });

  if (!bossRoot) return;
  const breathe = 1 + Math.sin(elapsed * 0.92) * 0.025;
  bossRoot.lookAt(camera.position);
  bossRoot.scale.set(breathe, breathe * (1 + Math.sin(elapsed * 0.46) * 0.018), breathe);
  bossRoot.rotateY(Math.sin(runTime * 0.16) * 0.08);
  bossRoot.rotateZ(Math.sin(runTime * 0.22) * 0.035);
  if (collapse > 0) {
    collapse = Math.min(1, collapse + dt * 0.42);
    const crush = collapse * collapse * (3 - 2 * collapse);
    bossRoot.scale.set(1 + crush * 0.2, Math.max(0.04, 1 - crush * 0.95), 1 - crush * 0.34);
    bossRoot.position.y = bossBaseY - crush * 22;
    bossRoot.rotation.z += crush * 0.95;
    if (collapse >= 0.99) bossRoot.visible = false;
  }
}
