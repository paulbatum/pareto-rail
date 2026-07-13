import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { massDriverRunProgress } from '../gameplay';
import type { MassDriverPalette } from './enemies';

type EnvironmentOptions = {
  rail: CatmullRomCurve3;
  duration: number;
  beatSeconds: number;
  muzzleTime: number;
  palette: MassDriverPalette;
};

export function createMassDriverEnvironment(scene: Scene, options: EnvironmentOptions) {
  const { rail, duration, beatSeconds, muzzleTime, palette } = options;
  const root = new Group();
  const coilRoot = new Group();
  const ringCount = Math.floor(duration / beatSeconds) + 1;
  const ringGeometry = new TorusGeometry(10.8, 0.052, 5, 56);
  const ringMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.86,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const rings = new InstancedMesh(ringGeometry, ringMaterial, ringCount);
  const trussGeometry = new TorusGeometry(11.4, 0.16, 5, 32);
  const trussMaterial = new MeshBasicMaterial({ color: palette.steel.clone().multiplyScalar(0.62) });
  const trussCount = Math.ceil(ringCount / 4);
  const trusses = new InstancedMesh(trussGeometry, trussMaterial, trussCount);
  const matrix = new Matrix4();
  const rotation = new Matrix4();
  const quaternion = new Quaternion();
  const twist = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  let trussIndex = 0;

  for (let index = 0; index < ringCount; index += 1) {
    const time = Math.min(duration, index * beatSeconds);
    const progress = massDriverRunProgress(time, duration);
    const frame = sampleRailFrame(rail, progress);
    rotation.makeBasis(frame.right, frame.up, frame.tangent);
    quaternion.setFromRotationMatrix(rotation);
    twist.setFromAxisAngle(new Vector3(0, 0, 1), index * 0.17);
    quaternion.multiply(twist);
    matrix.compose(frame.position, quaternion, scale);
    rings.setMatrixAt(index, matrix);
    const heat = Math.pow(time / duration, 1.45);
    const color = heat < 0.56
      ? palette.arc.clone().lerp(palette.violet, heat / 0.56)
      : palette.violet.clone().lerp(palette.white, (heat - 0.56) / 0.44);
    rings.setColorAt(index, color.multiplyScalar(0.75 + heat * 1.55));
    if (index % 4 === 0) {
      trusses.setMatrixAt(trussIndex, matrix);
      trussIndex += 1;
    }
  }
  rings.instanceMatrix.needsUpdate = true;
  if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  trusses.instanceMatrix.needsUpdate = true;
  rings.frustumCulled = false;
  trusses.frustumCulled = false;
  // Coils are thin visual conductors, not solid collision walls. Let the
  // lock-on ray reach drones seen cleanly through their open centers.
  rings.raycast = () => {};
  trusses.raycast = () => {};
  coilRoot.add(trusses, rings);

  const lattice = createLongitudinalLattice(rail, palette);
  lattice.raycast = () => {};
  coilRoot.add(lattice);

  const muzzle = createMuzzle(rail, palette);
  muzzle.traverse((child) => { child.raycast = () => {}; });
  coilRoot.add(muzzle);

  const starfield = createStarfield(rail.getPointAt(1), palette);
  starfield.raycast = () => {};
  starfield.visible = false;
  const payload = createPayloadRig(palette);
  root.add(coilRoot, starfield, payload.root);
  scene.add(root);
  scene.background = palette.void.clone();

  let safetyCleared = false;
  let outcome: 'pending' | 'success' | 'failure' = 'pending';
  let flash = 0;
  let outcomeAge = 0;

  return {
    root,
    setSafetyCleared(cleared: boolean) {
      safetyCleared = cleared;
    },
    setOutcome(success: boolean) {
      const nextOutcome = success ? 'success' : 'failure';
      if (outcome === nextOutcome) {
        flash = Math.max(flash, 0.85);
        return;
      }
      outcome = nextOutcome;
      outcomeAge = 0;
      flash = 1;
    },
    arcFlash(amount = 0.35) {
      flash = Math.max(flash, amount);
    },
    resetRun() {
      safetyCleared = false;
      outcome = 'pending';
      outcomeAge = 0;
      flash = 0;
      coilRoot.visible = true;
      coilRoot.position.set(0, 0, 0);
      coilRoot.rotation.set(0, 0, 0);
      coilRoot.scale.setScalar(1);
      starfield.visible = false;
      starfield.position.set(0, 0, 0);
      starfield.scale.setScalar(1);
      const fadeMaterials = starfield.userData.fadeMaterials as Array<PointsMaterial | LineBasicMaterial>;
      for (const material of fadeMaterials) material.opacity = 0;
      (scene.background as Color).copy(palette.void);
      payload.body.position.set(0, 0, 0);
    },
    update(dt: number, runTime: number, running: boolean, beatEnergy: number, camera: Camera) {
      if (outcome !== 'pending') outcomeAge += dt;
      const charge = running ? Math.min(1, runTime / duration) : 0;
      const release = running ? Math.max(0, Math.min(1, (runTime - muzzleTime) / Math.max(0.2, duration - muzzleTime))) : 0;
      ringMaterial.opacity = (0.66 + charge * 0.24 + beatEnergy * 0.1) * (safetyCleared ? 1 : 0.92);
      ringMaterial.color.setRGB(0.86 + charge * 0.48, 0.96 + charge * 0.28, 1.12 + charge * 0.72);
      lattice.material.opacity = 0.16 + beatEnergy * 0.08 + charge * 0.08;
      muzzle.children.forEach((child, index) => {
        child.rotation.z += dt * (0.025 + index * 0.002) * (1 + charge * 3);
      });

      // The player is physically riding the round: camera-relative payload
      // shoulders provide a stable speed reference without blocking locks.
      payload.root.position.copy(camera.position);
      payload.root.quaternion.copy(camera.quaternion);
      const vibration = running ? charge * (0.008 + beatEnergy * 0.012) : 0;
      payload.body.position.set(
        Math.sin(runTime * 31) * vibration,
        Math.cos(runTime * 37) * vibration,
        0,
      );
      payload.cells.forEach(({ material, threshold }, index) => {
        const active = charge >= threshold;
        const hot = Math.max(0, (charge - threshold) / Math.max(0.001, 1 - threshold));
        const color = hot > 0.62
          ? palette.violet.clone().lerp(palette.white, (hot - 0.62) / 0.38)
          : palette.arc.clone().lerp(palette.violet, hot / 0.62);
        material.color.copy(active ? color.multiplyScalar(1.25 + hot * 1.4 + beatEnergy * 0.25) : palette.dormant.clone().multiplyScalar(0.38));
        material.opacity = active ? 0.92 : 0.5 + (index % 2) * 0.08;
      });

      if (safetyCleared && release > 0) {
        coilRoot.visible = release < 0.88;
        starfield.visible = true;
        const fadeMaterials = starfield.userData.fadeMaterials as Array<PointsMaterial | LineBasicMaterial>;
        fadeMaterials[0].opacity = Math.min(1, release * 1.8);
        fadeMaterials[1].opacity = Math.min(0.92, Math.max(0, release - 0.08) * 1.7);
        starfield.position.copy(camera.position).multiplyScalar(0.02);
        starfield.scale.z = 1 + release * 2.8;
        flash = Math.max(flash, (1 - release) * 0.85);
      } else if (!safetyCleared && release > 0.3) {
        flash = Math.max(flash, Math.sin(runTime * 38) * 0.14 + release * 0.22);
      }

      if (outcome === 'failure') {
        coilRoot.visible = true;
        coilRoot.rotation.z += dt * (1.8 + Math.min(7, outcomeAge * 3.5));
        const rupture = Math.min(1, outcomeAge / 0.7);
        coilRoot.scale.setScalar(1 + rupture * 0.14 + Math.sin(outcomeAge * 34) * 0.035);
        coilRoot.position.x = Math.sin(outcomeAge * 23) * rupture * 0.7;
        coilRoot.position.y = Math.cos(outcomeAge * 29) * rupture * 0.55;
        ringMaterial.opacity = 0.35 + Math.abs(Math.sin(outcomeAge * 42)) * 0.62;
      }

      flash = Math.max(0, flash - dt * (outcome === 'failure' ? 0.7 : 1.5));
      const base = palette.void;
      const flashColor = outcome === 'failure' ? palette.violet : palette.white;
      (scene.background as Color).copy(base).lerp(flashColor, Math.min(0.72, flash));
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}

function createPayloadRig(palette: MassDriverPalette) {
  const root = new Group();
  const body = new Group();
  const steel = new MeshBasicMaterial({ color: palette.steel.clone().multiplyScalar(1.35) });
  const edge = new MeshBasicMaterial({
    color: palette.arc.clone().multiplyScalar(1.15),
    transparent: true,
    opacity: 0.72,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const nose = new Mesh(new ConeGeometry(0.72, 3.4, 6), steel);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, -1.52, -2.7);
  const noseSeam = new Mesh(new TorusGeometry(0.56, 0.025, 4, 24), edge);
  noseSeam.position.set(0, -1.52, -1.32);
  body.add(nose, noseSeam);

  const cells: Array<{ material: MeshBasicMaterial; threshold: number }> = [];
  for (const side of [-1, 1]) {
    const shoulder = new Mesh(new BoxGeometry(0.28, 0.26, 3.15), steel);
    shoulder.position.set(side * 1.18, -1.16, -2.45);
    const rail = new Mesh(new BoxGeometry(0.055, 0.035, 2.8), edge);
    rail.position.set(side * 1.18, -1.005, -2.48);
    body.add(shoulder, rail);

    for (let index = 0; index < 6; index += 1) {
      const cellMaterial = new MeshBasicMaterial({
        color: palette.dormant.clone().multiplyScalar(0.38),
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const cell = new Mesh(new BoxGeometry(0.1, 0.045, 0.28), cellMaterial);
      cell.position.set(side * 1.18, -0.97, -1.42 - index * 0.41);
      body.add(cell);
      cells.push({ material: cellMaterial, threshold: (index * 2 + (side > 0 ? 2 : 1)) / 12 });
    }
  }

  root.add(body);
  root.traverse((child) => { child.raycast = () => {}; });
  root.userData.payload = true;
  return { root, body, cells };
}

function createLongitudinalLattice(rail: CatmullRomCurve3, palette: MassDriverPalette) {
  const positions: number[] = [];
  const segments = 180;
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle = spoke / 8 * Math.PI * 2;
    for (let index = 0; index < segments; index += 1) {
      const point = (u: number) => {
        const frame = sampleRailFrame(rail, u);
        return frame.position.clone()
          .addScaledVector(frame.right, Math.cos(angle) * 11.42)
          .addScaledVector(frame.up, Math.sin(angle) * 11.42);
      };
      const a = point(index / segments);
      const b = point((index + 1) / segments);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const line = new LineSegments(geometry, new LineBasicMaterial({
    color: palette.dormant.clone().multiplyScalar(0.72),
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  line.frustumCulled = false;
  return line;
}

function createMuzzle(rail: CatmullRomCurve3, palette: MassDriverPalette) {
  const group = new Group();
  const frame = sampleRailFrame(rail, 0.965);
  const rotation = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  const quaternion = new Quaternion().setFromRotationMatrix(rotation);
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    const petal = new Mesh(
      new BoxGeometry(1.1, 5.4, 22),
      new MeshBasicMaterial({ color: (index % 2 ? palette.steel : palette.dormant).clone().multiplyScalar(0.8) }),
    );
    petal.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * 14)
      .addScaledVector(frame.up, Math.sin(angle) * 14)
      .addScaledVector(frame.tangent, 2);
    petal.quaternion.copy(quaternion);
    petal.rotateZ(angle);
    group.add(petal);
  }
  return group;
}

function createStarfield(origin: Vector3, palette: MassDriverPalette) {
  const group = new Group();
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const streakPositions = new Float32Array(count * 6);
  const streakColors = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const theta = index * 2.399963;
    const z = 80 + (index * 47 % 900);
    const radius = 40 + (index * 83 % 380);
    const x = origin.x + Math.cos(theta) * radius;
    const y = origin.y + Math.sin(theta) * radius;
    const depth = origin.z - z;
    positions.set([x, y, depth], index * 3);
    const color = index % 9 === 0 ? palette.violet : index % 5 === 0 ? palette.arc : palette.white;
    const intensity = index % 31 === 0 ? 1.8 : 0.72;
    colors.set([color.r * intensity, color.g * intensity, color.b * intensity], index * 3);
    const streakLength = 3 + index % 19;
    streakPositions.set([x, y, depth, x, y, depth - streakLength], index * 6);
    streakColors.set([
      color.r * intensity, color.g * intensity, color.b * intensity,
      color.r * 0.03, color.g * 0.03, color.b * 0.03,
    ], index * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const pointMaterial = new PointsMaterial({
    size: 0.82,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const points = new Points(geometry, pointMaterial);
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', new Float32BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('color', new Float32BufferAttribute(streakColors, 3));
  const streakMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const streaks = new LineSegments(streakGeometry, streakMaterial);
  points.raycast = () => {};
  streaks.raycast = () => {};
  group.add(points, streaks);
  group.userData.fadeMaterials = [pointMaterial, streakMaterial];
  return group;
}
