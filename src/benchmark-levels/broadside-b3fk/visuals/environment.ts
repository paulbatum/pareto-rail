import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, PerspectiveCamera, Quaternion } from 'three';
import { disposeObject3D } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import type { BroadsidePalette } from './models';
import {
  BROADSIDE_B3FK_MARKERS,
} from '../timing';
import { broadsideRunProgress } from '../gameplay';

type CapitalShip = {
  root: Group;
  friendly: boolean;
  flagship: boolean;
  drift: Vector3;
  homePosition: Vector3;
  homeQuaternion: Quaternion;
  engineMaterials: MeshBasicMaterial[];
  seamMaterials: MeshBasicMaterial[];
};

type Crossfire = {
  root: Mesh;
  material: MeshBasicMaterial;
  phase: number;
  friendly: boolean;
};

type BroadsideEnvironmentOptions = {
  rail: import('three').CatmullRomCurve3;
  palette: BroadsidePalette;
};

function seeded(index: number) {
  const value = Math.sin(index * 91.739 + 17.21) * 43758.5453;
  return value - Math.floor(value);
}

function mat(color: Color, intensity = 1, transparent = false, opacity = 1) {
  return new MeshBasicMaterial({
    color: color.clone().multiplyScalar(intensity),
    transparent,
    opacity,
    depthWrite: !transparent,
    blending: transparent ? AdditiveBlending : undefined,
    side: DoubleSide,
  });
}

function makeCapitalShip(palette: BroadsidePalette, friendly: boolean, scale: number, flagship = false) {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  const detailRoot = new Group();
  detailRoot.name = 'capital-ship-close-detail';
  root.userData.detailRoot = detailRoot;
  root.add(detailRoot);
  const combatDetailRoot = new Group();
  combatDetailRoot.name = 'capital-ship-combat-detail';
  root.userData.combatDetailRoot = combatDetailRoot;
  root.add(combatDetailRoot);
  const hullColor = friendly ? palette.friendlyDark : palette.enemyHull;
  const armorColor = friendly ? palette.friendlyHull : palette.enemyHull.clone().multiplyScalar(0.7);
  const seamColor = friendly ? palette.cyan : palette.molten;
  const engineColor = friendly ? palette.cyanWhite : palette.crimson;
  const hull = mat(hullColor);
  const armor = mat(armorColor);
  const seamMaterials: MeshBasicMaterial[] = [];
  const engineMaterials: MeshBasicMaterial[] = [];
  const length = flagship ? 175 : 105 + scale * 14;
  const beam = flagship ? 28 : 15 + scale * 2.5;
  const shoulderGeometry = new BoxGeometry(beam * 0.48, beam * 0.22, length * 0.76);
  const stripeGeometry = new BoxGeometry(0.17, beam * 0.12, length * 0.72);
  const turretBaseGeometry = new CylinderGeometry(1.4, 1.8, 0.9, 8);
  const turretBarrelGeometry = new BoxGeometry(0.32, 0.32, 4.8);
  const hangarGeometry = new BoxGeometry(beam * 0.16, beam * 0.18, length * 0.27);
  const apertureGeometry = new BoxGeometry(0.12, beam * 0.1, length * 0.032);
  const antennaGeometry = new CylinderGeometry(0.08, 0.14, 1, 5);
  const lampGeometry = new SphereGeometry(0.2 + scale * 0.06, 6, 4);
  const ribGeometries = [
    new BoxGeometry(beam * 0.58, 0.12, length * 0.035),
    new BoxGeometry(beam * 0.7, 0.12, length * 0.035),
  ];

  const spine = new Mesh(new BoxGeometry(beam, beam * 0.42, length), hull);
  root.add(spine);
  const prow = new Mesh(new CylinderGeometry(0, beam * 0.62, length * 0.22, 6), armor);
  prow.rotation.x = Math.PI / 2;
  prow.position.z = -length * 0.57;
  root.add(prow);
  const dorsal = new Mesh(new BoxGeometry(beam * 0.34, beam * 0.38, length * 0.7), armor);
  dorsal.position.y = beam * 0.28;
  root.add(dorsal);
  for (const side of [-1, 1]) {
    const shoulder = new Mesh(shoulderGeometry, armor);
    shoulder.position.set(side * beam * 0.57, -beam * 0.05, length * 0.02);
    root.add(shoulder);
    const seam = mat(seamColor, friendly ? 1.35 : 1.65);
    seamMaterials.push(seam);
    const stripe = new Mesh(stripeGeometry, seam);
    stripe.position.set(side * beam * 0.82, beam * 0.04, length * 0.02);
    root.add(stripe);
    for (let gun = 0; gun < (flagship ? 8 : 5); gun += 1) {
      const z = length * 0.32 - gun * length * 0.11;
      const turret = new Group();
      const base = new Mesh(turretBaseGeometry, armor);
      base.rotation.x = Math.PI / 2;
      turret.add(base);
      const barrel = new Mesh(turretBarrelGeometry, hull);
      barrel.position.z = -2.2;
      turret.add(barrel);
      turret.position.set(side * beam * 0.82, beam * 0.2, z);
      turret.rotation.y = side * 0.8;
      combatDetailRoot.add(turret);
    }
    const hangar = new Mesh(hangarGeometry, hull);
    hangar.position.set(side * beam * 0.835, -beam * 0.14, length * 0.08);
    detailRoot.add(hangar);
    const hangarGlow = mat(seamColor, friendly ? 1.45 : 1.8);
    seamMaterials.push(hangarGlow);
    for (let bay = 0; bay < 5; bay += 1) {
      const aperture = new Mesh(apertureGeometry, hangarGlow);
      aperture.position.set(side * beam * 0.925, -beam * 0.14, length * 0.19 - bay * length * 0.055);
      detailRoot.add(aperture);
    }
  }
  const bridge = new Group();
  const bridgeBase = new Mesh(new BoxGeometry(beam * 0.34, beam * 0.34, length * 0.12), armor);
  bridgeBase.position.y = beam * 0.43;
  bridge.add(bridgeBase);
  const bridgeCrown = new Mesh(new BoxGeometry(beam * 0.2, beam * 0.24, length * 0.065), hull);
  bridgeCrown.position.y = beam * 0.68;
  bridge.add(bridgeCrown);
  bridge.position.z = -length * 0.12;
  detailRoot.add(bridge);
  for (let mast = 0; mast < (flagship ? 7 : 4); mast += 1) {
    const height = beam * (0.42 + seeded(mast + length) * 0.4);
    const antenna = new Mesh(antennaGeometry, hull);
    antenna.scale.y = height;
    antenna.position.set((seeded(mast + 303) - 0.5) * beam * 0.42, beam * 0.54 + height * 0.5, -length * 0.27 + mast * length * 0.08);
    detailRoot.add(antenna);
    const lampMaterial = mat(mast % 2 === 0 ? seamColor : engineColor, 1.8);
    seamMaterials.push(lampMaterial);
    const lamp = new Mesh(lampGeometry, lampMaterial);
    lamp.position.copy(antenna.position);
    lamp.position.y += height * 0.52;
    detailRoot.add(lamp);
  }
  for (let rib = 0; rib < 9; rib += 1) {
    const plate = new Mesh(ribGeometries[rib % 2], rib % 2 === 0 ? armor : hull);
    plate.position.set(0, beam * 0.225, -length * 0.36 + rib * length * 0.087);
    plate.rotation.z = (rib % 3 - 1) * 0.035;
    detailRoot.add(plate);
  }
  const engineGeometry = new RingGeometry(1.25, 2.2, 14);
  for (let index = 0; index < (flagship ? 7 : 4); index += 1) {
    const angle = index / (flagship ? 7 : 4) * Math.PI * 2;
    const engineMaterial = mat(engineColor, friendly ? 2 : 2.4, true, 0.9);
    engineMaterials.push(engineMaterial);
    const engine = new Mesh(engineGeometry, engineMaterial);
    engine.position.set(Math.cos(angle) * beam * 0.42, Math.sin(angle) * beam * 0.21, length * 0.505);
    root.add(engine);
  }
  const bellyPlateGeometry = new BoxGeometry(beam * 0.72, 0.08, length * 0.045);
  for (let plate = 0; plate < 12; plate += 1) {
    const panel = new Mesh(bellyPlateGeometry, plate % 2 === 0 ? hull : armor);
    panel.position.set(0, -beam * 0.225, -length * 0.4 + plate * length * 0.07);
    panel.rotation.z = (plate % 3 - 1) * 0.05;
    combatDetailRoot.add(panel);
  }
  root.children.forEach((child) => {
    child.userData.homePosition = child.position.clone();
    child.userData.homeQuaternion = child.quaternion.clone();
  });
  root.scale.setScalar(scale);
  return { root, engineMaterials, seamMaterials };
}

function beamBetween(start: Vector3, end: Vector3, radius: number, material: MeshBasicMaterial) {
  const delta = end.clone().sub(start);
  const mesh = new Mesh(new CylinderGeometry(radius, radius, delta.length(), 5), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

export function createBroadsideEnvironment(scene: Scene, options: BroadsideEnvironmentOptions) {
  const { rail, palette } = options;
  const root = new Group();
  root.name = 'broadside-fleet-engagement';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  const nebulaRoot = new Group();
  const nebulaShell = new Mesh(
    new SphereGeometry(1850, 28, 18),
    new MeshBasicMaterial({ color: palette.void, side: BackSide, depthWrite: false }),
  );
  nebulaRoot.add(nebulaShell);
  for (let index = 0; index < 48; index += 1) {
    const gold = index % 3 === 0;
    const cloudMaterial = mat(gold ? palette.gold : palette.magenta, gold ? 0.72 : 0.68, true, 0.07 + seeded(index + 3) * 0.11);
    const cloud = new Mesh(new IcosahedronGeometry(70 + seeded(index) * 150, 1), cloudMaterial);
    const angle = seeded(index + 5) * Math.PI * 2;
    const radius = 530 + seeded(index + 7) * 620;
    const side = Math.cos(angle) < 0 ? -1 : 1;
    cloud.position.set(
      side * (420 + seeded(index + 15) * 760),
      (seeded(index + 9) - 0.5) * 980,
      -610 + Math.sin(angle) * radius * 0.72,
    );
    cloud.scale.set(1.45, 0.55 + seeded(index + 11) * 0.75, 0.38 + seeded(index + 13) * 0.5);
    nebulaRoot.add(cloud);
  }
  root.add(nebulaRoot);

  const starPositions: number[] = [];
  const starColors: number[] = [];
  for (let index = 0; index < 1100; index += 1) {
    const angle = seeded(index + 101) * Math.PI * 2;
    const height = (seeded(index + 211) - 0.5) * 1300;
    const radius = 500 + seeded(index + 307) * 1050;
    starPositions.push(Math.cos(angle) * radius, height, -610 + Math.sin(angle) * radius);
    const warm = seeded(index + 401) > 0.74;
    const color = warm ? palette.gold : palette.cyanWhite;
    starColors.push(color.r, color.g, color.b);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  const stars = new Points(starGeometry, new PointsMaterial({ size: 1.25, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.84, depthWrite: false }));
  root.add(stars);

  const ships: CapitalShip[] = [];
  const shipPlacements = [
    { u: 0.01, side: 0, up: -16, friendly: true, scale: 1.32, flagship: true, roll: 0 },
    { u: 0.15, side: -74, up: 28, friendly: true, scale: 0.78, roll: 0.16 },
    { u: 0.24, side: 92, up: -38, friendly: false, scale: 0.82, roll: -0.2 },
    { u: 0.34, side: -28, up: -32, friendly: true, scale: 1.18, roll: 0.08 },
    { u: 0.44, side: 34, up: 31, friendly: false, scale: 1.24, roll: Math.PI * 0.9 },
    { u: 0.56, side: -96, up: 19, friendly: false, scale: 0.85, roll: 0.21 },
    { u: 0.65, side: 92, up: -24, friendly: true, scale: 0.9, roll: -0.14 },
    { u: 0.76, side: -70, up: 33, friendly: true, scale: 0.78, roll: 0.18 },
    { u: 0.86, side: 62, up: 16, friendly: false, scale: 0.82, roll: -0.12 },
    { u: 0.94, side: 0, up: 6, friendly: false, scale: 0.86, flagship: true, roll: 0.03 },
  ];
  for (const [index, placement] of shipPlacements.entries()) {
    const frame = sampleRailFrame(rail, placement.u);
    const model = makeCapitalShip(palette, placement.friendly, placement.scale, placement.flagship);
    model.root.position.copy(frame.position)
      .addScaledVector(frame.right, placement.side)
      .addScaledVector(frame.up, placement.up);
    model.root.lookAt(model.root.position.clone().add(frame.tangent));
    model.root.rotateZ(placement.roll);
    root.add(model.root);
    ships.push({
      ...model,
      friendly: placement.friendly,
      flagship: Boolean(placement.flagship),
      drift: frame.right.clone().multiplyScalar((index % 2 === 0 ? 1 : -1) * (0.025 + index * 0.003)),
      homePosition: model.root.position.clone(),
      homeQuaternion: model.root.quaternion.clone(),
    });
  }
  const enemyFlagship = ships.find((ship) => ship.flagship && !ship.friendly) ?? null;

  // Crossfire is distributed over the whole volume, so the battle never reads as a formation.
  const crossfire: Crossfire[] = [];
  for (let index = 0; index < 46; index += 1) {
    const friendly = index % 2 === 0;
    const u = 0.08 + seeded(index + 61) * 0.84;
    const frame = sampleRailFrame(rail, u);
    const start = frame.position.clone()
      .addScaledVector(frame.right, (friendly ? -1 : 1) * (55 + seeded(index + 71) * 120))
      .addScaledVector(frame.up, (seeded(index + 73) - 0.5) * 110);
    const end = frame.position.clone()
      .addScaledVector(frame.right, (friendly ? 1 : -1) * (75 + seeded(index + 79) * 150))
      .addScaledVector(frame.up, (seeded(index + 83) - 0.5) * 130)
      .addScaledVector(frame.tangent, (seeded(index + 89) - 0.5) * 100);
    const beamMaterial = mat(friendly ? palette.cyan : palette.crimson, friendly ? 1.75 : 1.95, true, 0);
    const beam = beamBetween(start, end, friendly ? 0.055 : 0.08, beamMaterial);
    beam.userData.raildIgnoreOcclusion = true;
    root.add(beam);
    crossfire.push({ root: beam, material: beamMaterial, phase: seeded(index + 97) * 9, friendly });
  }

  const broadsideRoot = new Group();
  root.add(broadsideRoot);
  const broadsideFrame = sampleRailFrame(rail, 0.35);
  const broadsideFlashGeometry = new SphereGeometry(0.75, 8, 5);
  for (let index = 0; index < 18; index += 1) {
    const start = broadsideFrame.position.clone()
      .addScaledVector(broadsideFrame.right, -32 + index * 3.1)
      .addScaledVector(broadsideFrame.up, 31)
      .addScaledVector(broadsideFrame.tangent, -35 + index * 4.4);
    const end = start.clone().addScaledVector(broadsideFrame.right, 260).addScaledVector(broadsideFrame.up, 25 + (index % 3) * 8);
    const fireMaterial = mat(palette.cyan, 2.15, true, 0);
    const fire = beamBetween(start, end, 0.13 + (index % 3) * 0.035, fireMaterial);
    fire.userData.phase = index * 0.12;
    broadsideRoot.add(fire);
    const flashMaterial = mat(index % 3 === 0 ? palette.gold : palette.cyanWhite, 1.75, true, 0);
    const flash = new Mesh(broadsideFlashGeometry, flashMaterial);
    flash.position.copy(start);
    flash.userData.phase = index * 0.12;
    flash.userData.muzzleFlash = true;
    broadsideRoot.add(flash);
  }

  const flagshipFrame = sampleRailFrame(rail, 0.965);
  const shieldMaterial = mat(palette.crimson, 1.55, true, 0.17);
  shieldMaterial.wireframe = true;
  const shield = new Mesh(new SphereGeometry(38, 20, 14), shieldMaterial);
  shield.scale.z = 2.35;
  shield.position.copy(flagshipFrame.position).addScaledVector(flagshipFrame.tangent, 12);
  root.add(shield);
  const trenchRings: Mesh[] = [];
  for (let index = 0; index < 13; index += 1) {
    const ringMaterial = mat(index % 2 === 0 ? palette.molten : palette.enemyEdge, 1.3, true, 0);
    const ring = new Mesh(new TorusGeometry(8.6 + (index % 2) * 1.2, 0.15, 6, 24), ringMaterial);
    const frame = sampleRailFrame(rail, 0.89 + index * 0.0072);
    ring.position.copy(frame.position).addScaledVector(frame.up, -4.5);
    ring.lookAt(ring.position.clone().add(frame.tangent));
    ring.userData.material = ringMaterial;
    root.add(ring);
    trenchRings.push(ring);
  }

  // Dormant until the last power system dies: localized plasma blossoms and
  // chunks separate from the flagship while the camera pulls out.
  const cascadeRoot = new Group();
  cascadeRoot.userData.raildIgnoreOcclusion = true;
  const cascadePieces: Array<{ mesh: Mesh; material: MeshBasicMaterial; base: Vector3; drift: Vector3; delay: number }> = [];
  for (let index = 0; index < 14; index += 1) {
    const glow = index % 3 !== 0;
    const cascadeMaterial = mat(glow ? (index % 2 === 0 ? palette.gold : palette.crimson) : palette.enemyHull, glow ? 2.2 : 0.8, glow, 0);
    const geometry = glow
      ? (index % 2 === 0 ? new SphereGeometry(1.2 + seeded(index + 601) * 2.4, 7, 5) : new RingGeometry(1.5, 2.2 + seeded(index + 603) * 2.6, 12))
      : new IcosahedronGeometry(1.4 + seeded(index + 607) * 3.4, 0);
    const piece = new Mesh(geometry, cascadeMaterial);
    const base = new Vector3(
      (seeded(index + 611) - 0.5) * 24,
      (seeded(index + 613) - 0.5) * 16,
      (seeded(index + 617) - 0.5) * 125,
    );
    piece.position.copy(base);
    const drift = new Vector3(
      seeded(index + 619) - 0.5,
      seeded(index + 623) - 0.5,
      seeded(index + 631) - 0.5,
    ).normalize().multiplyScalar(12 + seeded(index + 637) * 30);
    cascadeRoot.add(piece);
    cascadePieces.push({ mesh: piece, material: cascadeMaterial, base, drift, delay: seeded(index + 641) * 0.58 });
  }
  cascadeRoot.visible = false;
  root.add(cascadeRoot);

  let shieldsDestroyed = 0;
  let coresDestroyed = 0;
  let outcome: boolean | null = null;
  let explosion = 0;
  const cloudWorld = new Vector3();
  const victoryCenter = sampleRailFrame(rail, 0.58).position;
  const compressedShipPosition = new Vector3();

  function update(_dt: number, runTime: number, running: boolean, beatEnergy: number, camera: Camera) {
    nebulaRoot.rotation.y += 0.00008;
    const victoryPull = MathUtilsClamp((runTime - BROADSIDE_B3FK_MARKERS.victory) / 1);
    for (let index = 1; index < nebulaRoot.children.length; index += 1) {
      const cloud = nebulaRoot.children[index];
      cloud.visible = cloud.getWorldPosition(cloudWorld).distanceTo(camera.position) > (victoryPull > 0 ? 780 : 360);
    }
    ships.forEach((ship, index) => {
      if (ship === enemyFlagship && runTime >= BROADSIDE_B3FK_MARKERS.flagship && runTime < BROADSIDE_B3FK_MARKERS.trench) {
        const bossU = Math.min(0.94, broadsideRunProgress(runTime) + 0.044);
        const frame = sampleRailFrame(rail, bossU);
        ship.root.position.copy(frame.position)
          .addScaledVector(frame.up, 7)
          .addScaledVector(frame.tangent, 36);
        ship.root.lookAt(ship.root.position.clone().add(frame.tangent));
        ship.root.rotateZ(0.03);
        shield.position.copy(frame.position).addScaledVector(frame.tangent, 30);
        shield.lookAt(shield.position.clone().add(frame.tangent));
      }
      if (!(ship === enemyFlagship && runTime >= BROADSIDE_B3FK_MARKERS.flagship)) {
        ship.root.position.addScaledVector(ship.drift, _dt * (running ? 1 : 0.18));
      }
      if (victoryPull > 0) {
        compressedShipPosition.copy(ship.homePosition).sub(victoryCenter).multiplyScalar(0.46).add(victoryCenter);
        ship.root.position.lerp(compressedShipPosition, victoryPull * victoryPull);
      }
      const detail = ship.root.userData.detailRoot as Group | undefined;
      if (detail) detail.visible = runTime < BROADSIDE_B3FK_MARKERS.victory + 0.15 && ship.root.position.distanceTo(camera.position) < 330;
      const combatDetail = ship.root.userData.combatDetailRoot as Group | undefined;
      if (combatDetail) combatDetail.visible = victoryPull < 0.15;
      ship.root.rotation.z += (index % 2 === 0 ? 1 : -1) * _dt * 0.0021;
      const enginePulse = 1.15 + Math.sin(runTime * 5 + index) * 0.18 + beatEnergy * 0.16;
      ship.engineMaterials.forEach((value) => value.color.set(ship.friendly ? palette.cyanWhite : palette.crimson).multiplyScalar(enginePulse + 0.55));
      ship.seamMaterials.forEach((value) => value.color.set(ship.friendly ? palette.cyan : palette.molten).multiplyScalar(1.2 + beatEnergy * 0.2));
    });
    crossfire.forEach((fire, index) => {
      const cadence = fire.friendly ? 1.9 : 1.45;
      const burst = Math.sin(runTime * cadence * Math.PI * 2 + fire.phase) > (fire.friendly ? 0.74 : 0.8);
      const eyeFade = runTime > BROADSIDE_B3FK_MARKERS.eye - 0.5 && runTime < BROADSIDE_B3FK_MARKERS.flagship + 0.5 ? 0.08 : 1;
      fire.material.opacity = (burst ? 0.62 : 0.015) * eyeFade;
      fire.root.scale.y = burst ? 1 : 0.08;
      fire.root.visible = !running || runTime > index * 0.07;
    });
    for (const child of broadsideRoot.children as Mesh[]) {
      const phase = Number(child.userData.phase ?? 0);
      const local = runTime - BROADSIDE_B3FK_MARKERS.broadside - phase;
      const active = local >= 0 && local < 1.55 && Math.sin(local * 17) > -0.15;
      child.visible = active;
      (child.material as MeshBasicMaterial).opacity = active ? (child.userData.muzzleFlash ? 0.78 : 0.92) : 0;
      if (child.userData.muzzleFlash) {
        const flash = Math.max(0, 1 - local * 2.4);
        child.scale.setScalar(0.32 + flash * 1.85);
      } else {
        child.scale.y = active ? 1 : 0.03;
      }
    }
    const scriptedDive = runTime >= BROADSIDE_B3FK_MARKERS.secondPass;
    const shieldStrength = scriptedDive ? 0 : Math.max(0, 1 - shieldsDestroyed / 4);
    shieldMaterial.opacity = 0.025 + shieldStrength * (0.1 + Math.sin(runTime * 5.2) * 0.025);
    shield.visible = runTime >= BROADSIDE_B3FK_MARKERS.flagship - 1 && shieldsDestroyed < 4 && !scriptedDive;
    shield.rotation.y += 0.0015;
    trenchRings.forEach((ring, index) => {
      const material = ring.userData.material as MeshBasicMaterial;
      const reveal = MathUtilsClamp((runTime - BROADSIDE_B3FK_MARKERS.trench + index * 0.05) / 0.7);
      material.opacity = reveal * (0.2 + beatEnergy * 0.13) * (1 - coresDestroyed / 4);
      ring.rotation.z += 0.002 * (index % 2 === 0 ? 1 : -1);
    });
    if (outcome === true || coresDestroyed === 3) explosion = Math.min(1, explosion + _dt * 0.42);
    if (explosion > 0) {
      if (enemyFlagship) {
        cascadeRoot.visible = true;
        cascadeRoot.position.copy(enemyFlagship.root.position);
        cascadeRoot.quaternion.copy(enemyFlagship.root.quaternion);
        cascadePieces.forEach((piece, index) => {
          const local = MathUtilsClamp((explosion - piece.delay) / Math.max(0.08, 1 - piece.delay));
          piece.mesh.position.copy(piece.base).addScaledVector(piece.drift, local * local);
          piece.mesh.rotation.x += _dt * (0.7 + index % 4) * local;
          piece.mesh.rotation.z += _dt * (0.5 + index % 3) * local;
          piece.mesh.scale.setScalar(0.3 + Math.sin(local * Math.PI) * (index % 3 === 0 ? 1.2 : 2.4));
          piece.material.opacity = index % 3 === 0 ? 1 : Math.sin(local * Math.PI) * 0.78;
        });
        enemyFlagship.root.children.forEach((child, index) => {
          if (!child.userData.breakDrift) {
            child.userData.breakDrift = new Vector3(
              seeded(index + 701) - 0.5,
              seeded(index + 709) - 0.5,
              seeded(index + 719) - 0.5,
            ).normalize().multiplyScalar(0.6 + seeded(index + 727) * 1.8);
          }
          child.position.addScaledVector(child.userData.breakDrift as Vector3, _dt * explosion * explosion * 7.5);
          child.rotation.y += _dt * explosion * (index % 2 === 0 ? 0.32 : -0.24);
          child.rotation.x += _dt * explosion * (index % 3 - 1) * 0.11;
        });
      }
      ships.forEach((ship) => {
        if (!ship.friendly) {
          ship.seamMaterials.forEach((value) => value.color.copy(palette.gold).multiplyScalar(1.4 + explosion * 1.8));
          ship.root.rotation.x += _dt * explosion * 0.018;
        }
      });
      shield.visible = false;
      const pull = MathUtilsClamp((runTime - BROADSIDE_B3FK_MARKERS.victory) / 2);
      if (pull > 0) {
        const perspective = camera as PerspectiveCamera;
        perspective.fov = Math.min(92, perspective.fov + _dt * pull * 2.5);
        perspective.updateProjectionMatrix();
      }
    }
  }

  function reset() {
    shieldsDestroyed = 0;
    coresDestroyed = 0;
    outcome = null;
    explosion = 0;
    shield.visible = false;
    cascadeRoot.visible = false;
    ships.forEach((ship) => {
      ship.root.position.copy(ship.homePosition);
      ship.root.quaternion.copy(ship.homeQuaternion);
      ship.root.children.forEach((child) => {
        const homePosition = child.userData.homePosition as Vector3 | undefined;
        const homeQuaternion = child.userData.homeQuaternion as Quaternion | undefined;
        if (homePosition) child.position.copy(homePosition);
        if (homeQuaternion) child.quaternion.copy(homeQuaternion);
        delete child.userData.breakDrift;
      });
      const detail = ship.root.userData.detailRoot as Group | undefined;
      const combatDetail = ship.root.userData.combatDetailRoot as Group | undefined;
      if (detail) detail.visible = true;
      if (combatDetail) combatDetail.visible = true;
    });
  }

  return {
    root,
    update,
    reset,
    setBossState(nextShields: number, nextCores: number) {
      shieldsDestroyed = nextShields;
      coresDestroyed = nextCores;
    },
    setOutcome(success: boolean) { outcome = success; },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}

function MathUtilsClamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
