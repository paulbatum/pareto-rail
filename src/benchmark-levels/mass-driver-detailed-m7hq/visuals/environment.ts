import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import {
  MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS,
  MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
  MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME,
  mdBar,
} from '../timing';
import {
  MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U,
  createMassDriverDetailedM7hqRail,
  massDriverDetailedM7hqRingU,
  massDriverDetailedM7hqRunProgress,
  massDriverDetailedM7hqSpeedAt,
} from '../gameplay';
import { MD_ARC, MD_STEEL, MD_STEEL_LIT, MD_VIOLET, MD_WHITE, heatColor } from './palette';

const Z_AXIS = new Vector3(0, 0, 1);

function additive(color: number | Color, intensity = 1, opacity = 1) {
  const value = color instanceof Color ? color.clone() : new Color(color);
  value.multiplyScalar(intensity);
  return new MeshBasicMaterial({ color: value, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false });
}

function orientToFrame(object: Group | Mesh, tangent: Vector3) {
  object.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, tangent.clone().normalize()));
}

type RingUnit = {
  root: Group;
  conductor: Mesh<TorusGeometry, MeshBasicMaterial>;
  baseColor: Color;
  index: number;
  downbeat: boolean;
};

export type MassDriverEnvironment = ReturnType<typeof createMassDriverEnvironment>;

export function createMassDriverEnvironment(scene: Scene) {
  const curve = createMassDriverDetailedM7hqRail();
  const root = new Group();
  const barrel = new Group();
  const space = new Group();
  const cameraRig = new Group();
  root.name = 'mass-driver-detailed-environment';
  root.userData.raildIgnoreOcclusion = true;
  barrel.userData.raildIgnoreOcclusion = true;
  space.userData.raildIgnoreOcclusion = true;
  cameraRig.userData.raildIgnoreOcclusion = true;
  root.add(barrel, space, cameraRig);
  scene.add(root);
  scene.background = new Color(0x01030b);

  const rings: RingUnit[] = [];
  const ringCount = Math.round(MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME / MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS) + 1;
  const normalRing = new TorusGeometry(10.8, 0.07, 5, 54);
  const downbeatRing = new TorusGeometry(11.0, 0.105, 6, 58);
  const housingGeometry = new TorusGeometry(11.22, 0.17, 5, 36);
  for (let beat = 1; beat < ringCount; beat += 1) {
    const progress = beat / (ringCount - 1);
    const u = massDriverDetailedM7hqRingU(beat);
    const frame = sampleRailFrame(curve, u);
    const downbeat = beat % 4 === 0;
    const unit = new Group();
    const baseColor = heatColor(Math.pow(progress, 1.12), 0.88 + progress * 0.65);
    const conductor = new Mesh(downbeat ? downbeatRing : normalRing, additive(baseColor, 1, 0.82));
    unit.position.copy(frame.position);
    orientToFrame(unit, frame.tangent);
    unit.rotation.z += beat * 0.057;
    unit.add(conductor);
    if (downbeat) {
      const housing = new Mesh(housingGeometry, new MeshBasicMaterial({ color: new Color(MD_STEEL_LIT).multiplyScalar(0.78) }));
      housing.scale.z = 1.45;
      unit.add(housing);
      for (let lug = 0; lug < 4; lug += 1) {
        const angle = Math.PI / 4 + lug / 4 * Math.PI * 2;
        const block = new Mesh(new BoxGeometry(1.2, 0.72, 1.8), new MeshBasicMaterial({ color: MD_STEEL }));
        block.position.set(Math.cos(angle) * 10.9, Math.sin(angle) * 10.9, 0);
        block.rotation.z = angle;
        unit.add(block);
      }
    }
    unit.traverse((child) => { child.raycast = () => {}; });
    barrel.add(unit);
    rings.push({ root: unit, conductor, baseColor, index: beat, downbeat });
  }

  // Four longitudinal conductors at the diagonals: dark beams under thin hot seams.
  const conductorSeams: LineBasicMaterial[] = [];
  for (let railIndex = 0; railIndex < 4; railIndex += 1) {
    const angle = Math.PI / 4 + railIndex / 4 * Math.PI * 2;
    const beamPositions: number[] = [];
    const seamPositions: number[] = [];
    const seamColors: number[] = [];
    const samples = 220;
    for (let index = 0; index < samples; index += 1) {
      const pointAt = (sample: number, radius: number) => {
        const u = MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U * sample / samples;
        const frame = sampleRailFrame(curve, u);
        return frame.position.clone()
          .addScaledVector(frame.right, Math.cos(angle) * radius)
          .addScaledVector(frame.up, Math.sin(angle) * radius);
      };
      const a = pointAt(index, 11.62);
      const b = pointAt(index + 1, 11.62);
      beamPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const sa = pointAt(index, 11.42);
      const sb = pointAt(index + 1, 11.42);
      seamPositions.push(sa.x, sa.y, sa.z, sb.x, sb.y, sb.z);
      const colorA = heatColor(index / samples * 0.7, 0.95 + railIndex % 2 * 0.08);
      const colorB = heatColor((index + 1) / samples * 0.7, 0.95 + railIndex % 2 * 0.08);
      seamColors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b);
    }
    const beamGeometry = new BufferGeometry();
    beamGeometry.setAttribute('position', new Float32BufferAttribute(beamPositions, 3));
    const beam = new LineSegments(beamGeometry, new LineBasicMaterial({ color: MD_STEEL_LIT, transparent: true, opacity: 0.65 }));
    const seamGeometry = new BufferGeometry();
    seamGeometry.setAttribute('position', new Float32BufferAttribute(seamPositions, 3));
    seamGeometry.setAttribute('color', new Float32BufferAttribute(seamColors, 3));
    const seam = new LineSegments(seamGeometry, new LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      blending: AdditiveBlending,
      depthWrite: false,
    }));
    beam.raycast = () => {};
    seam.raycast = () => {};
    conductorSeams.push(seam.material);
    barrel.add(beam, seam);
  }

  // Rib panels imply a continuous bore without making a bright, occluding wall.
  const panelGeometry = new BoxGeometry(3.25, 0.28, 5.2);
  const panelMaterial = new MeshBasicMaterial({ color: new Color(MD_STEEL).multiplyScalar(0.72) });
  const panelCount = Math.floor(ringCount / 2) * 8;
  const panels = new InstancedMesh(panelGeometry, panelMaterial, panelCount);
  const panelMatrix = new Matrix4();
  const panelRotation = new Matrix4();
  const panelQuaternion = new Quaternion();
  const panelTwist = new Quaternion();
  const panelScale = new Vector3(1, 1, 1);
  let panelInstance = 0;
  for (let beat = 2; beat < ringCount; beat += 2) {
    const frame = sampleRailFrame(curve, massDriverDetailedM7hqRingU(beat));
    panelRotation.makeBasis(frame.right, frame.up, frame.tangent);
    for (let side = 0; side < 8; side += 1) {
      const angle = side / 8 * Math.PI * 2 + (beat % 4) * 0.035;
      const position = frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * 12.2)
        .addScaledVector(frame.up, Math.sin(angle) * 12.2);
      panelQuaternion.setFromRotationMatrix(panelRotation);
      panelTwist.setFromAxisAngle(Z_AXIS, angle + Math.PI / 2);
      panelQuaternion.multiply(panelTwist);
      panelMatrix.compose(position, panelQuaternion, panelScale);
      panels.setMatrixAt(panelInstance, panelMatrix);
      panelInstance += 1;
    }
  }
  panels.instanceMatrix.needsUpdate = true;
  panels.raycast = () => {};
  panels.frustumCulled = false;
  barrel.add(panels);

  const serviceGeometry = new BoxGeometry(0.16, 0.16, 0.6);
  const serviceMaterial = additive(MD_ARC, 0.85, 0.42);
  const serviceLights = new InstancedMesh(serviceGeometry, serviceMaterial, 28);
  for (let index = 0; index < 28; index += 1) {
    const beat = 3 + index * 4;
    const frame = sampleRailFrame(curve, massDriverDetailedM7hqRingU(Math.min(ringCount - 1, beat)));
    const angle = (index * 5 % 8) / 8 * Math.PI * 2 + 0.18;
    const position = frame.position.clone()
      .addScaledVector(frame.right, Math.cos(angle) * 11.95)
      .addScaledVector(frame.up, Math.sin(angle) * 11.95);
    panelRotation.makeBasis(frame.right, frame.up, frame.tangent);
    panelQuaternion.setFromRotationMatrix(panelRotation);
    panelTwist.setFromAxisAngle(Z_AXIS, angle + Math.PI / 2);
    panelQuaternion.multiply(panelTwist);
    panelMatrix.compose(position, panelQuaternion, new Vector3(index % 9 === 0 ? 1.8 : 1, 1, 1));
    serviceLights.setMatrixAt(index, panelMatrix);
  }
  serviceLights.instanceMatrix.needsUpdate = true;
  serviceLights.raycast = () => {};
  serviceLights.frustumCulled = false;
  barrel.add(serviceLights);

  // The muzzle crown and its capped charge disc sit precisely at bar 28.
  const muzzleFrame = sampleRailFrame(curve, MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U);
  const muzzle = new Group();
  muzzle.position.copy(muzzleFrame.position);
  orientToFrame(muzzle, muzzleFrame.tangent);
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    const tooth = new Mesh(new BoxGeometry(1.15, 4.6, 6.8), new MeshBasicMaterial({ color: index % 2 ? MD_STEEL : MD_STEEL_LIT }));
    tooth.position.set(Math.cos(angle) * 13.2, Math.sin(angle) * 13.2, 0);
    tooth.rotation.z = angle;
    muzzle.add(tooth);
  }
  const crown = new Mesh(new TorusGeometry(12.2, 0.42, 7, 64), new MeshBasicMaterial({ color: MD_STEEL_LIT }));
  const crownSeam = new Mesh(new TorusGeometry(12.2, 0.075, 5, 64), additive(MD_WHITE, 1.5, 0.7));
  const chargeMaterial = additive(MD_WHITE, 1.2, 0);
  const chargeDisc = new Mesh(new RingGeometry(0, 4.6, 48), chargeMaterial);
  chargeDisc.position.z = -0.2;
  muzzle.add(crown, crownSeam, chargeDisc);
  muzzle.traverse((child) => { child.raycast = () => {}; });
  barrel.add(muzzle);

  // Open-space payoff: deterministic blue/violet star scatter and a dead-ahead beacon.
  const starPositions: number[] = [];
  const starColors: number[] = [];
  const streakPositions: number[] = [];
  for (let index = 0; index < 1150; index += 1) {
    const theta = index * 2.39996323;
    const radius = 32 + (index * 71 % 440);
    const z = 60 + (index * 113 % 1250);
    const x = muzzleFrame.position.x + Math.cos(theta) * radius;
    const y = muzzleFrame.position.y + Math.sin(theta) * radius;
    const depth = muzzleFrame.position.z - z;
    starPositions.push(x, y, depth);
    const color = index % 13 === 0 ? new Color(MD_VIOLET) : index % 7 === 0 ? new Color(MD_ARC) : new Color(MD_WHITE);
    const strength = index % 47 === 0 ? 1.9 : 0.74;
    starColors.push(color.r * strength, color.g * strength, color.b * strength);
    if (index % 3 === 0) streakPositions.push(x, y, depth, x, y, depth - 3 - index % 24);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  const starsMaterial = new PointsMaterial({ size: 0.75, vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const stars = new Points(starGeometry, starsMaterial);
  const starStreakGeometry = new BufferGeometry();
  starStreakGeometry.setAttribute('position', new Float32BufferAttribute(streakPositions, 3));
  const starStreakMaterial = new LineBasicMaterial({ color: MD_ARC, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const starStreaks = new LineSegments(starStreakGeometry, starStreakMaterial);
  const endFrame = sampleRailFrame(curve, 1);
  const beacon = new Group();
  beacon.position.copy(endFrame.position).addScaledVector(endFrame.tangent, 350);
  const beaconCore = new Mesh(new SphereGeometry(1.4, 12, 8), additive(MD_WHITE, 3.2));
  const beaconRing = new Mesh(new RingGeometry(3.4, 3.7, 36), additive(MD_ARC, 1.7, 0.7));
  beacon.add(beaconCore, beaconRing);
  space.add(stars, starStreaks, beacon);
  space.visible = false;
  space.traverse((child) => { child.raycast = () => {}; });

  // Camera-riding speed streak shell.
  const speedPositions: number[] = [];
  const speedCount = 180;
  for (let index = 0; index < speedCount; index += 1) {
    const angle = index * 2.39996323;
    const radius = 5.2 + (index * 17 % 48) / 10;
    const z = -3 - index % 32;
    const length = 0.35 + index % 11 * 0.12;
    speedPositions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z, Math.cos(angle) * radius, Math.sin(angle) * radius, z - length);
  }
  const speedGeometry = new BufferGeometry();
  speedGeometry.setAttribute('position', new Float32BufferAttribute(speedPositions, 3));
  const speedMaterial = new LineBasicMaterial({ color: MD_ARC, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false });
  const speedStreaks = new LineSegments(speedGeometry, speedMaterial);
  cameraRig.add(speedStreaks);

  const crossingMaterial = additive(MD_ARC, 1.7, 0);
  const crossingPulse = new Mesh(new RingGeometry(0.68, 0.78, 48), crossingMaterial);
  crossingPulse.position.z = -4.2;
  cameraRig.add(crossingPulse);

  // Full-frame overlays: physical camera-facing planes avoid a bespoke post pass.
  const flashMaterial = additive(MD_WHITE, 1.8, 0);
  const chargeOverlayMaterial = additive(MD_VIOLET, 0.95, 0);
  const detonationMaterial = new MeshBasicMaterial({ color: 0xff1630, transparent: true, opacity: 0, depthWrite: false });
  const overlayGeometry = new PlaneGeometry(7.2, 4.2);
  const flashOverlay = new Mesh(overlayGeometry, flashMaterial);
  const chargeOverlay = new Mesh(overlayGeometry, chargeOverlayMaterial);
  const detonationOverlay = new Mesh(overlayGeometry, detonationMaterial);
  const fracturePositions: number[] = [];
  for (let spoke = 0; spoke < 18; spoke += 1) {
    const angle = spoke / 18 * Math.PI * 2 + (spoke % 3) * 0.035;
    let previousRadius = 0.08;
    let previousAngle = angle;
    for (let step = 1; step <= 6; step += 1) {
      const radius = 0.08 + step * (0.34 + spoke % 4 * 0.018);
      const jaggedAngle = angle + Math.sin(spoke * 7.13 + step * 4.71) * 0.055;
      fracturePositions.push(
        Math.cos(previousAngle) * previousRadius,
        Math.sin(previousAngle) * previousRadius,
        -1.135,
        Math.cos(jaggedAngle) * radius,
        Math.sin(jaggedAngle) * radius,
        -1.135,
      );
      previousRadius = radius;
      previousAngle = jaggedAngle;
    }
  }
  const fractureGeometry = new BufferGeometry();
  fractureGeometry.setAttribute('position', new Float32BufferAttribute(fracturePositions, 3));
  const fractureMaterial = new LineBasicMaterial({
    color: 0xffe8ef,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const detonationFracture = new LineSegments(fractureGeometry, fractureMaterial);
  detonationFracture.renderOrder = 1002;
  detonationFracture.raycast = () => {};
  cameraRig.add(detonationFracture);
  const chargeBlooms = [
    { mesh: new Mesh(new CircleGeometry(1, 64), additive(MD_WHITE, 1.25, 0)), opacity: 0.07, scale: 0.72 },
    { mesh: new Mesh(new CircleGeometry(1, 64), additive(MD_VIOLET, 1.15, 0)), opacity: 0.055, scale: 1.25 },
    { mesh: new Mesh(new CircleGeometry(1, 64), additive(MD_VIOLET, 0.82, 0)), opacity: 0.032, scale: 2.05 },
  ];
  for (const bloom of chargeBlooms) {
    bloom.mesh.position.z = -1.16;
    bloom.mesh.renderOrder = 990;
    bloom.mesh.raycast = () => {};
    cameraRig.add(bloom.mesh);
  }
  for (const overlay of [flashOverlay, chargeOverlay, detonationOverlay]) {
    overlay.renderOrder = 1000;
    overlay.raycast = () => {};
    cameraRig.add(overlay);
  }

  let flash = 0;
  let detonation = 0;
  let strobe = 0;
  let lastRing = -1;
  let ringPulse = 0;
  let crossingAge = 99;
  let crossingDownbeat = false;
  let ambientTime = 0;

  return {
    root,
    shotFlash(success: boolean) {
      if (success) flash = 1.3;
      else {
        detonation = 1.25;
        flash = Math.max(flash, 0.58);
      }
    },
    tunnelStrobe() {
      strobe = 1;
      flash = Math.max(flash, 0.55);
    },
    pumpFlash(amount = 0.16) {
      flash = Math.max(flash, amount);
    },
    reset() {
      flash = 0;
      detonation = 0;
      strobe = 0;
      lastRing = -1;
      ringPulse = 0;
      crossingAge = 99;
      barrel.visible = true;
      barrel.position.set(0, 0, 0);
      barrel.rotation.set(0, 0, 0);
      space.visible = false;
      starsMaterial.opacity = 0;
      starStreakMaterial.opacity = 0;
    },
    update(dt: number, runTime: number, running: boolean, camera: PerspectiveCamera, fired: boolean, failed: boolean) {
      ambientTime += dt;
      const time = running ? runTime : 0;
      const beatFloat = time / MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS;
      const currentRing = Math.floor(beatFloat);
      if (running && currentRing > 0 && currentRing !== lastRing) {
        lastRing = currentRing;
        ringPulse = 1;
        crossingAge = 0;
        crossingDownbeat = currentRing % 4 === 0;
      }
      ringPulse = Math.max(0, ringPulse - dt * 7.2);
      crossingAge += dt;
      const charge = MathUtils.clamp((time - mdBar(20)) / (MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - mdBar(20)), 0, 1);
      for (const seam of conductorSeams) seam.opacity = 0.42 + ringPulse * (crossingDownbeat ? 0.34 : 0.2) + charge * 0.16;
      serviceMaterial.opacity = 0.3 + ringPulse * 0.18 + charge * 0.08;
      const preGlowIndex = currentRing + 1;
      for (const ring of rings) {
        const justPassed = ring.index === currentRing;
        const next = ring.index === preGlowIndex;
        const aheadCharge = ring.index > currentRing && charge > 0 ? charge * 0.55 : 0;
        const pulse = (justPassed ? ringPulse * (ring.downbeat ? 2.5 : 1.45) : 0) + (next ? 0.32 + ringPulse * 0.22 : 0) + aheadCharge;
        ring.conductor.material.color.copy(ring.baseColor).lerp(new Color(MD_WHITE).multiplyScalar(2.2), Math.min(0.72, charge * charge + strobe));
        const idleShimmer = running ? 0 : Math.sin(ambientTime * 1.3 + ring.index * 0.61) * 0.055;
        ring.conductor.material.color.multiplyScalar(1 + pulse + idleShimmer);
        ring.conductor.material.opacity = 0.62 + Math.min(0.36, pulse * 0.16);
        ring.root.scale.setScalar(1 + (justPassed ? ringPulse * (ring.downbeat ? 0.06 : 0.025) : 0));
      }
      strobe = Math.max(0, strobe - dt * 4.6);

      const chargeVisible = running && time >= mdBar(20) && time < MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME;
      chargeMaterial.opacity = chargeVisible ? 0.08 + charge * 0.27 + Math.sin(time * 17) * 0.025 : 0;
      chargeDisc.scale.setScalar(0.65 + charge * 0.35);
      crownSeam.material.opacity = 0.48 + charge * 0.42;
      crownSeam.rotation.z += dt * (0.1 + charge * 1.8);

      const launch = MathUtils.clamp((time - MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME) / 0.9, 0, 1);
      if (fired && launch > 0) {
        space.visible = true;
        barrel.visible = launch < 0.72;
        starsMaterial.opacity = Math.min(1, launch * 1.4);
        starStreakMaterial.opacity = Math.min(0.8, launch * 1.2);
      } else if (failed) {
        barrel.visible = true;
        space.visible = false;
        detonation = Math.max(detonation, 0.2 + Math.abs(Math.sin(time * 31)) * 0.12);
        barrel.rotation.z += dt * 2.6;
        barrel.position.x = Math.sin(time * 29) * 0.35;
        barrel.position.y = Math.cos(time * 23) * 0.3;
      }

      const speed = running ? massDriverDetailedM7hqSpeedAt(time) : 0.18;
      speedMaterial.opacity = Math.min(0.9, 0.06 + speed * 0.12 + charge * 0.14);
      speedMaterial.color.copy(heatColor(Math.min(1, time / MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME), 1.1 + launch * 1.8));
      speedStreaks.scale.z = 1 + speed * 0.85;
      speedStreaks.position.z = -((time * speed * 18) % 8);
      beaconRing.scale.setScalar(1 + Math.sin(time * 3.1) * 0.14);

      const crossingLife = crossingDownbeat ? 0.46 : 0.3;
      const crossingT = Math.min(1, crossingAge / crossingLife);
      const crossingStrength = Math.max(0, 1 - crossingT);
      crossingPulse.scale.setScalar((crossingDownbeat ? 1.15 : 0.85) + crossingT * (crossingDownbeat ? 5.4 : 3.8));
      crossingMaterial.opacity = crossingStrength * (crossingDownbeat ? 0.72 : 0.42);
      crossingMaterial.color.copy(heatColor(Math.min(1, time / MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME), 1.35 + crossingStrength));

      cameraRig.position.copy(camera.position);
      cameraRig.quaternion.copy(camera.quaternion);
      for (const overlay of [flashOverlay, chargeOverlay, detonationOverlay]) overlay.position.set(0, 0, -1.15);
      flash = Math.max(0, flash - dt * (fired ? 1.45 : 5.5));
      detonation = Math.max(0, detonation - dt * 0.48);
      flashMaterial.opacity = Math.min(1, flash);
      chargeOverlayMaterial.opacity = chargeVisible ? Math.max(0, charge * charge * 0.12 - launch) : 0;
      for (const [index, bloom] of chargeBlooms.entries()) {
        const bloomPulse = 1 + Math.sin(time * (2.4 + index * 0.65)) * 0.035;
        bloom.mesh.scale.setScalar(bloom.scale * bloomPulse);
        (bloom.mesh.material as MeshBasicMaterial).opacity = chargeVisible ? charge * charge * bloom.opacity : 0;
      }
      detonationMaterial.opacity = Math.min(0.72, detonation);
      const fractureProgress = 1 - Math.min(1, detonation / 1.25);
      fractureMaterial.opacity = failed ? Math.min(0.92, 0.16 + detonation * 0.72) : 0;
      detonationFracture.scale.setScalar(0.68 + fractureProgress * 0.48);
      detonationFracture.rotation.z = failed ? time * 0.35 + Math.sin(time * 9) * 0.025 : 0;
      (scene.background as Color).copy(failed ? new Color(0x180008) : fired ? new Color(0x000106) : new Color(0x01030b)).lerp(new Color(MD_VIOLET), charge * 0.08);
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}
