import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import {
  broadside61z2RunProgress,
  createBroadside61z2Rail,
} from '../gameplay';
import {
  BROADSIDE_61Z2_BARS,
  BROADSIDE_61Z2_RUN_DURATION,
  BROADSIDE_61Z2_TIME,
} from '../timing';
import { hdr, PALETTE, type BroadsidePalette } from './palette';

type Muzzle = {
  material: MeshBasicMaterial;
  friendly: boolean;
  phase: number;
};

type ShipRecord = {
  group: Group;
  friendly: boolean;
  u: number;
  offset: Vector3;
  muzzles: Muzzle[];
};

export type BroadsideBossPhase = 'pending' | 'summoned' | 'exposed' | 'destroyed';

export type BroadsideEnvironment = {
  root: Group;
  update(dt: number, runTime: number, running: boolean, runProgress: number, beatEnergy: number, camera: PerspectiveCamera): void;
  resetRun(): void;
  setBossPhase(phase: Exclude<BroadsideBossPhase, 'pending'>): void;
  setOutcome(success: boolean): void;
  dispose(): void;
};

function mat(color: Color, intensity = 1, options: { additive?: boolean; opacity?: number } = {}) {
  const additive = options.additive ?? false;
  const base = color.clone().multiplyScalar(intensity);
  const material = new MeshBasicMaterial({
    color: base,
    side: DoubleSide,
    transparent: additive || options.opacity !== undefined,
    opacity: options.opacity ?? 1,
    depthWrite: !additive,
    blending: additive ? AdditiveBlending : undefined,
  });
  material.userData.baseColor = base.clone();
  return material;
}

function placeOnRail(object: Object3DLike, rail: ReturnType<typeof createBroadside61z2Rail>, u: number, offset: Vector3) {
  const frame = sampleRailFrame(rail, u);
  object.position.copy(frame.position)
    .addScaledVector(frame.right, offset.x)
    .addScaledVector(frame.up, offset.y)
    .addScaledVector(frame.tangent, offset.z);
  const basis = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(frame.right, frame.up, frame.tangent),
  );
  object.quaternion.copy(basis);
}

// Structural typing keeps the placement helper usable with Groups and Meshes without
// importing the entire Object3D type into the small geometry leaf.
type Object3DLike = {
  position: Vector3;
  quaternion: Quaternion;
};

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createBroadsideEnvironment(scene: Scene): BroadsideEnvironment {
  const rail = createBroadside61z2Rail();
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.background = PALETTE.space.clone();
  scene.fog = new FogExp2(new Color(0.05, 0.004, 0.045), 0.0024);

  const nebulaDome = new Mesh(
    new SphereGeometry(560, 24, 16),
    new MeshBasicMaterial({ color: new Color(0.08, 0.002, 0.045), side: BackSide, fog: false }),
  );
  nebulaDome.userData.raildIgnoreOcclusion = true;
  root.add(nebulaDome);

  root.add(createNebulaSheets(rail));
  root.add(createStarfield(rail));

  const ships: ShipRecord[] = [];
  addShip(ships, rail, true, 7.2, new Vector3(-31, 6, 0), 1.05, 106, 11);
  addShip(ships, rail, true, 11.8, new Vector3(-34, -3, 0), 0.88, 94, 17);
  addShip(ships, rail, true, 15.7, new Vector3(32, 7, 0), 0.9, 112, 23);
  addShip(ships, rail, false, 5.8, new Vector3(34, -1, 0), 0.92, 118, 37);
  addShip(ships, rail, false, 13.7, new Vector3(33, -4, 0), 1.0, 132, 43);
  addShip(ships, rail, false, 18.8, new Vector3(30, 5, 0), 1.18, 150, 53);
  for (const ship of ships) root.add(ship.group);

  const flagship = createFlagship(rail);
  root.add(flagship.group);

  const distantFleet = createDistantFleet(rail);
  root.add(distantFleet);

  scene.add(root);

  let bossPhase: BroadsideBossPhase = 'pending';
  let outcome: 'pending' | 'success' | 'failure' = 'pending';
  let outcomeAge = 0;
  let flash = 0;
  let beatClock = 0;

  return {
    root,
    update(dt, runTime, running, runProgress, beatEnergy, camera) {
      beatClock += dt;
      if (outcome !== 'pending') outcomeAge += dt;
      const battleProgress = running ? MathUtilsClamp(runProgress, 0, 1) : 0;
      const broadsideWindow = running && runTime >= BROADSIDE_61Z2_TIME.bar(BROADSIDE_61Z2_BARS.broadside) && runTime < BROADSIDE_61Z2_TIME.bar(BROADSIDE_61Z2_BARS.crossfire);
      const enemyWindow = running && runTime >= BROADSIDE_61Z2_TIME.bar(BROADSIDE_61Z2_BARS.crossfire);
      for (const ship of ships) {
        updateShipLights(ship, beatClock, beatEnergy, broadsideWindow, enemyWindow);
      }

      flagship.update(runTime, running, battleProgress, beatEnergy, beatClock, bossPhase, outcome, outcomeAge);
      distantFleet.rotation.y = Math.sin(beatClock * 0.08) * 0.01;
      if (outcome === 'success') {
        const breakApart = Math.min(1, outcomeAge / 3.4);
        flagship.group.rotation.z = breakApart * 0.12;
        flagship.group.position.y = Math.sin(outcomeAge * 3.1) * breakApart * 0.7;
        flash = Math.max(flash, (1 - breakApart) * 0.48);
      } else if (outcome === 'failure') {
        flagship.group.rotation.z += dt * (0.22 + outcomeAge * 0.1);
        flash = Math.max(flash, Math.sin(outcomeAge * 31) * 0.16 + 0.1);
      }

      const background = scene.background as Color;
      const battleTint = PALETTE.nebula.clone().lerp(PALETTE.nebulaHot, Math.min(1, battleProgress * 0.8));
      background.copy(PALETTE.space).lerp(battleTint, 0.22 + beatEnergy * 0.025 + (outcome === 'success' ? 0.22 : 0));
      if (flash > 0) {
        background.lerp(outcome === 'failure' ? PALETTE.crimson : PALETTE.gold, Math.min(0.38, flash));
        flash = Math.max(0, flash - dt * (outcome === 'failure' ? 0.75 : 1.8));
      }
      // Keep the distant fleet just far enough back that it reads as a horizon,
      // while the flagship and cruisers own the screen edges.
      distantFleet.position.copy(camera.position).multiplyScalar(0.018);
    },
    resetRun() {
      bossPhase = 'pending';
      outcome = 'pending';
      outcomeAge = 0;
      flash = 0;
      flagship.reset();
      distantFleet.visible = true;
      root.rotation.set(0, 0, 0);
    },
    setBossPhase(phase) {
      bossPhase = phase;
      flagship.setPhase(phase);
      if (phase === 'summoned') flash = Math.max(flash, 0.42);
      if (phase === 'exposed') flash = Math.max(flash, 0.8);
      if (phase === 'destroyed') flash = Math.max(flash, 1.1);
    },
    setOutcome(success) {
      outcome = success ? 'success' : 'failure';
      outcomeAge = 0;
      flash = success ? 1.2 : 0.85;
      distantFleet.visible = true;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}

function addShip(
  ships: ShipRecord[],
  rail: ReturnType<typeof createBroadside61z2Rail>,
  friendly: boolean,
  bar: number,
  offset: Vector3,
  scale: number,
  length: number,
  seed: number,
) {
  const group = createCruiser(friendly, length, seed);
  group.scale.setScalar(scale);
  placeOnRail(group, rail, broadside61z2RunProgress(BROADSIDE_61Z2_TIME.bar(bar), BROADSIDE_61Z2_RUN_DURATION), offset);
  ships.push({
    group,
    friendly,
    u: broadside61z2RunProgress(BROADSIDE_61Z2_TIME.bar(bar), BROADSIDE_61Z2_RUN_DURATION),
    offset,
    muzzles: group.userData.muzzles as Muzzle[],
  });
}

function createCruiser(friendly: boolean, length: number, seed: number) {
  const group = new Group();
  const hull = mat(friendly ? PALETTE.iceShadow : PALETTE.obsidian, friendly ? 1.7 : 2.1);
  const armor = mat(friendly ? PALETTE.ice : PALETTE.obsidianEdge, friendly ? 1.25 : 1.35);
  const hot = mat(friendly ? PALETTE.cyan : PALETTE.orange, friendly ? 2.1 : 1.9, { additive: true });
  const fire = mat(friendly ? PALETTE.cyanWhite : PALETTE.crimson, friendly ? 2.6 : 2.7, { additive: true, opacity: 0.7 });
  const width = friendly ? 12 : 14;
  const height = friendly ? 8 : 9;
  const body = new Mesh(new BoxGeometry(width, height, length), hull);
  body.position.y = 0;
  const upper = new Mesh(new BoxGeometry(width * 0.62, height * 0.58, length * 0.62), armor);
  upper.position.set(friendly ? -1.4 : 1.3, height * 0.52, -length * 0.08);
  const keel = new Mesh(new BoxGeometry(width * 0.72, 1.1, length * 0.88), armor);
  keel.position.y = -height * 0.52;
  const ridge = new Mesh(new BoxGeometry(0.65, 0.6, length * 0.92), hot);
  ridge.position.set(friendly ? 2.4 : -2.4, height * 0.48, 0);
  group.add(body, upper, keel, ridge);

  const fins = [
    new Mesh(new BoxGeometry(2.4, 3.4, length * 0.36), armor),
    new Mesh(new BoxGeometry(2.4, 3.4, length * 0.36), armor),
  ];
  fins[0].position.set(-width * 0.55, -1.0, length * 0.12);
  fins[1].position.set(width * 0.55, -1.0, length * 0.12);
  fins[0].rotation.z = friendly ? -0.18 : 0.18;
  fins[1].rotation.z = friendly ? 0.18 : -0.18;
  group.add(...fins);

  const muzzles: Muzzle[] = [];
  const rng = seeded(seed);
  for (let index = 0; index < 6; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const z = -length * 0.34 + Math.floor(index / 2) * length * 0.28;
    const turret = new Group();
    const base = new Mesh(new CylinderGeometry(0.72, 0.92, 0.38, 8), hull);
    const barrel = new Mesh(new BoxGeometry(0.22, 0.22, 2.7), armor);
    const muzzleMaterial = fire.clone();
    const muzzle = new Mesh(new SphereGeometry(0.2, 7, 5), muzzleMaterial);
    base.position.set(side * (width * 0.5 + 0.18), height * 0.42, z);
    barrel.position.set(side * (width * 0.5 + 0.18), height * 0.42, z - 1.15);
    muzzle.position.set(side * (width * 0.5 + 0.18), height * 0.42, z - 2.45);
    barrel.rotation.y = side * (0.08 + rng() * 0.08);
    turret.add(base, barrel, muzzle);
    group.add(turret);
    muzzles.push({ material: muzzleMaterial, friendly, phase: rng() * Math.PI * 2 });
  }

  const engineMaterial = hot.clone();
  const engineGeometry = new SphereGeometry(1.0, 8, 6);
  for (const side of [-1, 1]) {
    const engine = new Mesh(engineGeometry, engineMaterial.clone());
    engine.scale.set(0.76, 0.76, 1.65);
    engine.position.set(side * 3.4, -0.7, length * 0.52);
    group.add(engine);
  }
  group.userData.muzzles = muzzles;
  return group;
}

function updateShipLights(ship: ShipRecord, time: number, beatEnergy: number, friendlyWindow: boolean, enemyWindow: boolean) {
  for (const muzzle of ship.muzzles) {
    const sectionActive = muzzle.friendly ? friendlyWindow : enemyWindow;
    const cadence = muzzle.friendly ? 2.7 : 2.15;
    const pulse = Math.max(0, Math.sin(time * cadence + muzzle.phase));
    const intensity = sectionActive ? 0.55 + pulse * (1.35 + beatEnergy * 1.2) : 0.18 + pulse * 0.24;
    muzzle.material.opacity = Math.min(1, sectionActive ? 0.42 + pulse * 0.58 : 0.18 + pulse * 0.24);
    muzzle.material.color.copy(hdr(muzzle.friendly ? PALETTE.cyanWhite : PALETTE.crimson, intensity));
  }
}

function createFlagship(rail: ReturnType<typeof createBroadside61z2Rail>) {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const hull = mat(PALETTE.obsidian, 2.25);
  const armor = mat(PALETTE.obsidianEdge, 1.2);
  const orange = mat(PALETTE.orange, 1.8, { additive: true });
  const trench = mat(PALETTE.crimson, 2.5, { additive: true, opacity: 0.8 });
  const shield = mat(PALETTE.orange, 1.4, { additive: true, opacity: 0.14 });
  const length = 242;
  const main = new Mesh(new BoxGeometry(27, 17, length), hull);
  main.position.set(17, 4.5, 0);
  const prow = new Mesh(new BoxGeometry(34, 12, 32), hull);
  prow.position.set(17, 3, -length * 0.46);
  const topSpine = new Mesh(new BoxGeometry(11, 6, length * 0.88), armor);
  topSpine.position.set(18, 15, 1);
  const belly = new Mesh(new BoxGeometry(9, 4.2, length * 0.9), armor);
  belly.position.set(1.5, -7.2, 3);
  const trenchLine = new Mesh(new BoxGeometry(0.34, 0.34, length * 0.82), trench);
  trenchLine.position.set(0.2, -5.3, 4);
  group.add(main, prow, topSpine, belly, trenchLine);

  const shieldRing = new Mesh(new TorusGeometry(28, 0.18, 7, 72), shield);
  shieldRing.position.set(10, 4, -length * 0.1);
  group.add(shieldRing);

  const generators = new Group();
  const generatorRail = mat(PALETTE.orange, 1.5, { additive: true, opacity: 0.78 });
  for (let index = 0; index < 4; index += 1) {
    const socket = new Mesh(new BoxGeometry(0.18, 0.18, 30), generatorRail);
    socket.position.set(-14 + index * 10, 10.5 + (index % 2) * 2, -62 + index * 39);
    socket.rotation.x = (index % 2 === 0 ? 1 : -1) * 0.08;
    generators.add(socket);
  }
  group.add(generators);

  const coreLamps: MeshBasicMaterial[] = [];
  for (let index = 0; index < 3; index += 1) {
    const lampMaterial = mat(PALETTE.white, 2.4, { additive: true, opacity: 0.15 });
    const lamp = new Mesh(new SphereGeometry(0.72, 8, 6), lampMaterial);
    lamp.position.set(-8.5 + index * 8.5, -8.8, 48 + index * 30);
    group.add(lamp);
    coreLamps.push(lampMaterial);
  }

  const warningStrips: MeshBasicMaterial[] = [];
  for (const side of [-1, 1]) {
    const stripMaterial = mat(PALETTE.crimson, 1.7, { additive: true, opacity: 0.24 });
    const strip = new Mesh(new BoxGeometry(0.16, 0.16, length * 0.8), stripMaterial);
    strip.position.set(17 + side * 14, 10.5, 5);
    group.add(strip);
    warningStrips.push(stripMaterial);
  }

  placeOnRail(group, rail, broadside61z2RunProgress(BROADSIDE_61Z2_TIME.bar(22.8), BROADSIDE_61Z2_RUN_DURATION), new Vector3(0, 0, 0));
  const basePosition = group.position.clone();
  const baseQuaternion = group.quaternion.clone();

  const reset = () => {
    group.visible = true;
    group.position.copy(basePosition);
    group.quaternion.copy(baseQuaternion);
    group.scale.setScalar(1);
    shieldRing.visible = true;
    shieldRing.scale.setScalar(1);
    shield.opacity = 0.14;
    for (const material of coreLamps) material.opacity = 0.08;
    for (const material of warningStrips) material.opacity = 0.2;
  };

  const setPhase = (phase: Exclude<BroadsideBossPhase, 'pending'>) => {
    if (phase === 'summoned') {
      shieldRing.visible = true;
      shield.opacity = 0.16;
    } else if (phase === 'exposed') {
      shieldRing.visible = false;
      shield.opacity = 0;
      for (const material of coreLamps) material.opacity = 0.86;
      for (const material of warningStrips) material.opacity = 0.68;
    } else {
      shieldRing.visible = false;
      for (const material of coreLamps) material.opacity = 1;
      for (const material of warningStrips) material.opacity = 0.9;
    }
  };

  return {
    group,
    reset,
    setPhase,
    update(runTime: number, running: boolean, progress: number, beatEnergy: number, time: number, phase: BroadsideBossPhase, outcome: 'pending' | 'success' | 'failure', outcomeAge: number) {
      const bossVisible = running && progress > broadside61z2RunProgress(BROADSIDE_61Z2_TIME.bar(16), BROADSIDE_61Z2_RUN_DURATION);
      group.visible = bossVisible || outcome !== 'pending';
      const charge = MathUtilsClamp((runTime - BROADSIDE_61Z2_TIME.bar(18)) / BROADSIDE_61Z2_TIME.beats(4), 0, 1);
      shieldRing.rotation.z += 0.003 + beatEnergy * 0.01;
      shieldRing.scale.setScalar(1 + Math.sin(time * 1.4) * 0.025 + charge * 0.06);
      if (phase === 'summoned') shield.opacity = 0.11 + Math.max(0, Math.sin(time * 8)) * 0.13;
      if (phase === 'exposed' || phase === 'destroyed') {
        for (const [index, material] of coreLamps.entries()) {
          material.opacity = 0.64 + Math.max(0, Math.sin(time * (5.5 + index) + index)) * (0.2 + beatEnergy * 0.18);
          material.color.copy(hdr(phase === 'destroyed' ? PALETTE.white : PALETTE.orange, 1.4 + beatEnergy * 1.5));
        }
      }
      if (outcome === 'success') {
        const blast = Math.min(1, outcomeAge / 1.1);
        group.scale.setScalar(1 + blast * 0.08);
        shieldRing.scale.setScalar(1 + blast * 1.8);
        shield.opacity = Math.max(0, 0.5 - blast * 0.5);
      } else if (outcome === 'failure') {
        group.position.x += Math.sin(time * 12) * 0.01;
        for (const material of warningStrips) material.opacity = 0.42 + Math.abs(Math.sin(time * 22)) * 0.5;
      }
    },
  };
}

function createNebulaSheets(rail: ReturnType<typeof createBroadside61z2Rail>) {
  const group = new Group();
  const rng = seeded(9217);
  for (let index = 0; index < 10; index += 1) {
    const u = 0.04 + index / 10 * 0.92;
    const frame = sampleRailFrame(rail, u);
    const material = mat(index % 3 === 0 ? PALETTE.gold : PALETTE.nebula, 0.52, { additive: true, opacity: 0.12 + rng() * 0.09 });
    const sheet = new Mesh(new PlaneGeometry(150 + rng() * 80, 75 + rng() * 45), material);
    sheet.position.copy(frame.position)
      .addScaledVector(frame.right, (index % 2 === 0 ? -1 : 1) * (105 + rng() * 35))
      .addScaledVector(frame.up, 20 + rng() * 35);
    sheet.lookAt(frame.position);
    sheet.userData.raildIgnoreOcclusion = true;
    group.add(sheet);
  }
  return group;
}

function createStarfield(rail: ReturnType<typeof createBroadside61z2Rail>) {
  const group = new Group();
  const rng = seeded(42061);
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  for (let index = 0; index < 340; index += 1) {
    const u = 0.02 + rng() * 0.98;
    const frame = sampleRailFrame(rail, u);
    const radius = 80 + rng() * 170;
    positions.push(
      frame.position.x + frame.right.x * (rng() - 0.5) * radius + frame.up.x * (rng() - 0.5) * radius,
      frame.position.y + frame.right.y * (rng() - 0.5) * radius + frame.up.y * (rng() - 0.5) * radius,
      frame.position.z + frame.right.z * (rng() - 0.5) * radius + frame.up.z * (rng() - 0.5) * radius,
    );
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(geometry, new PointsMaterial({ color: PALETTE.gold.clone().multiplyScalar(1.6), size: 0.65, transparent: true, opacity: 0.72, depthWrite: false }));
  points.userData.raildIgnoreOcclusion = true;
  group.add(points);
  return group;
}

function createDistantFleet(rail: ReturnType<typeof createBroadside61z2Rail>) {
  const group = new Group();
  const rng = seeded(773);
  const friendly = mat(PALETTE.iceShadow, 0.7);
  const enemy = mat(PALETTE.obsidianEdge, 0.78);
  for (let index = 0; index < 20; index += 1) {
    const frame = sampleRailFrame(rail, 0.12 + rng() * 0.83);
    const ship = new Mesh(new BoxGeometry(3 + rng() * 4, 2 + rng() * 2, 12 + rng() * 22), index % 2 === 0 ? friendly : enemy);
    ship.position.copy(frame.position)
      .addScaledVector(frame.right, (rng() - 0.5) * 150)
      .addScaledVector(frame.up, (rng() - 0.3) * 90);
    ship.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), frame.tangent);
    group.add(ship);
  }
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

function MathUtilsClamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
