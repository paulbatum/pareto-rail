import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  type Camera,
  Color,
  Float32BufferAttribute,
  Fog,
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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  createMassDriverDef9Rail,
  massDriverDef9RunProgress,
  speedFactorAt,
} from '../gameplay';
import {
  MASS_DRIVER_DEF9_BARS,
  MASS_DRIVER_DEF9_RUN_DURATION,
  MASS_DRIVER_DEF9_TIME,
} from '../timing';
import {
  ARC_BLUE,
  BARREL,
  BARREL_EDGE,
  CHARGE_WHITE,
  COIL_VIOLET,
  ION_CYAN,
  VOID,
  chargeColor,
  hdr,
} from './palette';

export type DriverEnvironment = {
  scene: Scene;
  root: Group;
  coils: InstancedMesh;
  nodes: InstancedMesh;
  coilMaterial: MeshBasicMaterial;
  nodeMaterial: MeshBasicMaterial;
  starfield: Group;
  muzzleRoot: Group;
  muzzlePetals: Mesh[];
  chargeCore: Mesh;
  chargeRings: Mesh[];
  muzzlePosition: Vector3;
  openAmount: number;
  failureAmount: number;
  dispose(): void;
};

export type DriverEnvironmentFrame = {
  runTime: number;
  running: boolean;
  launchCleared: boolean;
  barrelFailed: boolean;
  beatEnergy: number;
  camera: Camera;
};

const rail = createMassDriverDef9Rail();
const beatSeconds = MASS_DRIVER_DEF9_TIME.beatSeconds;
const muzzleTime = MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch, 3);
const ringCount = Math.floor(muzzleTime / beatSeconds) + 1;
const ringRadius = 16;
const housingRadius = 19.3;
const Z_AXIS = new Vector3(0, 0, 1);
const unitScale = new Vector3(1, 1, 1);
const transform = new Matrix4();
const baseTransform = new Matrix4();
const localTransform = new Matrix4();
const quaternion = new Quaternion();
const localQuaternion = new Quaternion();
const position = new Vector3();
const nextPosition = new Vector3();
const midpoint = new Vector3();
const direction = new Vector3();

export function createEnvironmentInternal(scene: Scene): DriverEnvironment {
  const root = new Group();
  root.name = 'mass-driver-barrel';
  scene.add(root);
  scene.background = VOID.clone();
  scene.fog = new Fog(VOID.clone(), 42, 205);

  const coilMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const coils = new InstancedMesh(new TorusGeometry(ringRadius, 0.105, 5, 56), coilMaterial, ringCount);
  coils.frustumCulled = false;
  coils.name = 'accelerator coils';
  coils.userData.raildIgnoreOcclusion = true;

  const housingMaterial = new MeshBasicMaterial({ color: BARREL_EDGE.clone().multiplyScalar(0.55) });
  const housings = new InstancedMesh(new TorusGeometry(housingRadius, 0.22, 5, 40), housingMaterial, ringCount);
  housings.frustumCulled = false;
  housings.name = 'coil housings';
  housings.userData.raildIgnoreOcclusion = true;

  const nodeMaterial = new MeshBasicMaterial({ color: hdr(ION_CYAN, 0.75) });
  const nodes = new InstancedMesh(new SphereGeometry(0.28, 6, 4), nodeMaterial, ringCount * 2);
  nodes.frustumCulled = false;
  nodes.name = 'capacitor nodes';
  nodes.userData.raildIgnoreOcclusion = true;

  const strutMaterial = new MeshBasicMaterial({ color: BARREL.clone().lerp(BARREL_EDGE, 0.42) });
  const strutCount = Math.ceil(ringCount / 2) * 4;
  const struts = new InstancedMesh(new BoxGeometry(0.24, 5.6, 0.26), strutMaterial, strutCount);
  struts.frustumCulled = false;
  struts.name = 'radial struts';
  struts.userData.raildIgnoreOcclusion = true;

  const railMaterial = new MeshBasicMaterial({ color: BARREL.clone().lerp(BARREL_EDGE, 0.34) });
  const rails = new InstancedMesh(new BoxGeometry(0.18, 0.18, 1), railMaterial, Math.max(0, ringCount - 1) * 6);
  rails.frustumCulled = false;
  rails.name = 'longitudinal rails';
  rails.userData.raildIgnoreOcclusion = true;

  let nodeIndex = 0;
  let strutIndex = 0;
  let railIndex = 0;
  for (let index = 0; index < ringCount; index += 1) {
    const time = Math.min(muzzleTime, index * beatSeconds);
    const progress = massDriverDef9RunProgress(time);
    const frame = sampleRailFrame(rail, progress);
    baseTransform.makeBasis(frame.right, frame.up, frame.tangent);
    baseTransform.setPosition(frame.position);
    coils.setMatrixAt(index, baseTransform);
    housings.setMatrixAt(index, baseTransform);
    const ringColor = chargeColor(time / MASS_DRIVER_DEF9_RUN_DURATION);
    coils.setColorAt(index, ringColor);
    housings.setColorAt(index, BARREL_EDGE.clone().lerp(ringColor, 0.13));

    const nodeAngle = index % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
    for (const side of [-1, 1]) {
      localTransform.makeTranslation(
        Math.cos(nodeAngle) * housingRadius * side,
        Math.sin(nodeAngle) * housingRadius * side,
        0,
      );
      transform.multiplyMatrices(baseTransform, localTransform);
      nodes.setMatrixAt(nodeIndex, transform);
      nodes.setColorAt(nodeIndex, ringColor.clone().multiplyScalar(0.9));
      nodeIndex += 1;
    }

    if (index % 2 === 0) {
      for (let arm = 0; arm < 4; arm += 1) {
        const angle = arm / 4 * Math.PI * 2 + (index % 4) * Math.PI / 8;
        localQuaternion.setFromAxisAngle(Z_AXIS, angle - Math.PI / 2);
        localTransform.compose(
          position.set(Math.cos(angle) * (housingRadius + 2.6), Math.sin(angle) * (housingRadius + 2.6), 0),
          localQuaternion,
          unitScale,
        );
        transform.multiplyMatrices(baseTransform, localTransform);
        struts.setMatrixAt(strutIndex, transform);
        strutIndex += 1;
      }
    }

    if (index >= ringCount - 1) continue;
    const nextTime = Math.min(muzzleTime, (index + 1) * beatSeconds);
    const nextFrame = sampleRailFrame(rail, massDriverDef9RunProgress(nextTime));
    for (let lane = 0; lane < 6; lane += 1) {
      const angle = lane / 6 * Math.PI * 2;
      position.copy(frame.position)
        .addScaledVector(frame.right, Math.cos(angle) * housingRadius)
        .addScaledVector(frame.up, Math.sin(angle) * housingRadius);
      nextPosition.copy(nextFrame.position)
        .addScaledVector(nextFrame.right, Math.cos(angle) * housingRadius)
        .addScaledVector(nextFrame.up, Math.sin(angle) * housingRadius);
      direction.copy(nextPosition).sub(position);
      const length = direction.length();
      midpoint.copy(position).add(nextPosition).multiplyScalar(0.5);
      quaternion.setFromUnitVectors(Z_AXIS, direction.normalize());
      transform.compose(midpoint, quaternion, new Vector3(1, 1, length));
      rails.setMatrixAt(railIndex, transform);
      railIndex += 1;
    }
  }

  coils.instanceMatrix.needsUpdate = true;
  housings.instanceMatrix.needsUpdate = true;
  nodes.instanceMatrix.needsUpdate = true;
  struts.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  if (coils.instanceColor) coils.instanceColor.needsUpdate = true;
  if (housings.instanceColor) housings.instanceColor.needsUpdate = true;
  if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
  root.add(rails, housings, struts, coils, nodes);

  const muzzle = createMuzzle();
  root.add(muzzle.root);
  const starfield = createStarfield();
  starfield.visible = false;
  root.add(starfield);

  const environment: DriverEnvironment = {
    scene,
    root,
    coils,
    nodes,
    coilMaterial,
    nodeMaterial,
    starfield,
    muzzleRoot: muzzle.root,
    muzzlePetals: muzzle.petals,
    chargeCore: muzzle.core,
    chargeRings: muzzle.chargeRings,
    muzzlePosition: muzzle.frame.position.clone(),
    openAmount: 0,
    failureAmount: 0,
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
  return environment;
}

function createMuzzle() {
  const progress = massDriverDef9RunProgress(muzzleTime);
  const frame = sampleRailFrame(rail, progress);
  const root = new Group();
  baseTransform.makeBasis(frame.right, frame.up, frame.tangent);
  root.position.copy(frame.position);
  root.quaternion.setFromRotationMatrix(baseTransform);

  const collar = new Mesh(
    new TorusGeometry(21.5, 0.65, 8, 64),
    new MeshBasicMaterial({ color: BARREL_EDGE.clone().multiplyScalar(0.8) }),
  );
  root.add(collar);

  const petals: Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const petal = new Mesh(
      new BoxGeometry(8.2, 5.4, 5.8),
      new MeshBasicMaterial({ color: BARREL.clone().lerp(COIL_VIOLET, 0.12) }),
    );
    petal.position.set(Math.cos(angle) * 13.8, Math.sin(angle) * 13.8, 0);
    petal.rotation.z = angle + Math.PI / 2;
    petal.userData.angle = angle;
    petal.userData.baseRadius = 13.8;
    root.add(petal);
    petals.push(petal);
  }

  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(COIL_VIOLET, 1.15), opacity: 0.44 });
  const core = new Mesh(new SphereGeometry(3.1, 16, 10), coreMaterial);
  root.add(core);

  const chargeRings: Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const chargeRing = new Mesh(
      new TorusGeometry(5.1 + index * 2.2, 0.075 + index * 0.012, 5, 48),
      createAdditiveBasicMaterial({ color: hdr(index === 0 ? ARC_BLUE : COIL_VIOLET, 1.05), opacity: 0.8 }),
    );
    chargeRing.position.z = 0.5 + index * 0.6;
    chargeRing.userData.spin = (index % 2 === 0 ? 1 : -1) * (0.7 + index * 0.4);
    root.add(chargeRing);
    chargeRings.push(chargeRing);
  }
  return { root, petals, core, chargeRings, frame };
}

function createStarfield() {
  const rng = mulberry32(0xdef9);
  const root = new Group();
  root.name = 'launch star streaks';
  const streakCount = 260;
  const streakMesh = new InstancedMesh(
    new BoxGeometry(0.11, 0.11, 1),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: false,
      fog: false,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
    streakCount,
  );
  const starPosition = new Vector3();
  const starScale = new Vector3();
  const starQuaternion = new Quaternion();
  for (let index = 0; index < streakCount; index += 1) {
    const distance = 9 + rng() * 150;
    const angle = rng() * Math.PI * 2;
    const radius = distance * (0.06 + Math.sqrt(rng()) * 0.4);
    const length = 2.5 + rng() * 11;
    starPosition.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -distance);
    starScale.set(0.7 + rng() * 1.4, 0.7 + rng() * 1.4, length);
    transform.compose(starPosition, starQuaternion, starScale);
    streakMesh.setMatrixAt(index, transform);
    const tint = rng() > 0.86 ? CHARGE_WHITE : rng() > 0.45 ? ION_CYAN : ARC_BLUE;
    streakMesh.setColorAt(index, tint.clone().multiplyScalar(0.55 + rng() * 0.65));
  }
  streakMesh.instanceMatrix.needsUpdate = true;
  if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;
  streakMesh.frustumCulled = false;
  streakMesh.name = 'relativistic star streaks';

  const positions: number[] = [];
  const streaks: number[] = [];
  const streakColors: number[] = [];
  const colors: number[] = [];
  for (let index = 0; index < 420; index += 1) {
    const distance = 12 + rng() * 170;
    const angle = rng() * Math.PI * 2;
    const radius = distance * (0.055 + Math.sqrt(rng()) * 0.42);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = -distance;
    positions.push(x, y, z);
    const tint = rng() > 0.84 ? CHARGE_WHITE : rng() > 0.48 ? ION_CYAN : ARC_BLUE;
    const intensity = 0.7 + rng() * 0.95;
    colors.push(tint.r * intensity, tint.g * intensity, tint.b * intensity);

    const trail = 4 + rng() * 12;
    streaks.push(x, y, z - trail, x, y, z);
    streakColors.push(
      tint.r * intensity * 0.08,
      tint.g * intensity * 0.08,
      tint.b * intensity * 0.08,
      tint.r * intensity * 0.72,
      tint.g * intensity * 0.72,
      tint.b * intensity * 0.72,
    );
  }
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  pointGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const points = new Points(
    pointGeometry,
    new PointsMaterial({
      color: new Color(1, 1, 1),
      size: 1.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexColors: true,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  );
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', new Float32BufferAttribute(streaks, 3));
  streakGeometry.setAttribute('color', new Float32BufferAttribute(streakColors, 3));
  const lines = new LineSegments(
    streakGeometry,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: false,
      fog: false,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  );
  points.frustumCulled = false;
  lines.frustumCulled = false;
  root.add(streakMesh, lines, points);
  return root;
}

export function updateEnvironment(environment: DriverEnvironment, dt: number, frame: DriverEnvironmentFrame) {
  const progress = frame.running ? Math.max(0, Math.min(1, frame.runTime / MASS_DRIVER_DEF9_RUN_DURATION)) : 0;
  const speed = frame.running ? speedFactorAt(frame.runTime) : 0.38;
  const pulse = frame.beatEnergy;
  environment.coilMaterial.color.setRGB(1 + pulse * 0.14, 1 + pulse * 0.1, 1 + pulse * 0.18);
  environment.nodeMaterial.color.copy(chargeColor(progress)).multiplyScalar(0.72 + pulse * 0.2);

  const openTarget = frame.launchCleared ? 1 : 0;
  environment.openAmount += (openTarget - environment.openAmount) * Math.min(1, dt * 2.8);
  const failTarget = frame.barrelFailed ? 1 : 0;
  environment.failureAmount += (failTarget - environment.failureAmount) * Math.min(1, dt * 8);

  for (const [index, petal] of environment.muzzlePetals.entries()) {
    const angle = petal.userData.angle as number;
    const baseRadius = petal.userData.baseRadius as number;
    const jitter = environment.failureAmount * Math.sin(frame.runTime * 37 + index) * 0.8;
    const radius = baseRadius + environment.openAmount * 12 + jitter;
    petal.position.x = Math.cos(angle) * radius;
    petal.position.y = Math.sin(angle) * radius;
    petal.position.z = environment.openAmount * 4;
    petal.rotation.x = environment.openAmount * (index % 2 === 0 ? 0.58 : -0.58);
  }

  const charge = frame.running
    ? Math.max(0, Math.min(1, (frame.runTime - MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.redline)) / (MASS_DRIVER_DEF9_RUN_DURATION - MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.redline))))
    : 0.12;
  const coreMaterial = environment.chargeCore.material as MeshBasicMaterial;
  const discharge = frame.launchCleared && frame.runTime >= MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch);
  const openSpace = frame.launchCleared && frame.runTime >= muzzleTime;
  const coreScale = discharge
    ? Math.max(0.04, 1 - (frame.runTime - MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch)) * 1.3)
    : 0.7 + charge * 1.35 + Math.sin(frame.runTime * (5 + speed)) * (0.04 + charge * 0.08);
  environment.chargeCore.scale.setScalar(coreScale + environment.failureAmount * 7);
  coreMaterial.color.copy(environment.failureAmount > 0.1 ? CHARGE_WHITE : chargeColor(charge));
  coreMaterial.opacity = environment.failureAmount > 0.1 ? 0.82 : discharge ? Math.max(0, coreScale * 0.35) : 0.24 + charge * 0.34;

  for (const [index, ring] of environment.chargeRings.entries()) {
    ring.rotation.z += dt * (ring.userData.spin as number) * (1 + speed * 0.35);
    const collapse = discharge ? Math.max(0.05, coreScale) : 1;
    ring.scale.setScalar(collapse * (1 + Math.sin(frame.runTime * 4 + index) * 0.04));
    (ring.material as MeshBasicMaterial).opacity = discharge ? Math.max(0, coreScale * 0.6) : 0.45 + charge * 0.4;
  }

  environment.starfield.visible = openSpace;
  if (openSpace) {
    environment.starfield.position.copy(frame.camera.position);
    environment.starfield.quaternion.copy(frame.camera.quaternion);
  }
  if (environment.scene.fog instanceof Fog) {
    const spaceMix = openSpace ? Math.max(0, Math.min(1, (frame.runTime - muzzleTime) / 0.32)) : 0;
    environment.scene.fog.far = 205 + spaceMix * 1350;
    environment.scene.fog.near = 42 + spaceMix * 120;
    environment.scene.fog.color.copy(VOID).lerp(new Color(0.001, 0.004, 0.018), spaceMix);
  }
  if (environment.scene.background instanceof Color) {
    environment.scene.background.copy(VOID).lerp(new Color(0.002, 0.005, 0.022), openSpace ? 0.7 : progress * 0.12);
  }
}
