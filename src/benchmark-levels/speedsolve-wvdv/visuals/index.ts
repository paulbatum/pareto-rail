import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import type { EventBus } from '../../../events';
import { disposeObject3D } from '../../../engine/visual-kit';
import { FACE_NORMALS, facePoint } from '../gameplay';
import {
  GRAPHITE,
  MACHINE,
  SOLVE_COLORS,
  VOID_WHITE,
  createBolt,
  createCoreTarget,
  createLetterMesh,
  createPlayerProjectile,
  createPolyhedron,
  createPuzzleReticle,
  createTileTarget,
  createWeakpoint,
} from './models';

export type SpeedsolveVisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type EnemyRecord = { mesh: Group; kind: string; locked: boolean; lockCount: number; tintFace: number };
type FaceRig = { group: Group; cells: Group[]; currentAngle: number; targetAngle: number; solved: number; released: boolean };
type Fragment = { mesh: Mesh; velocity: Vector3; spin: Vector3; age: number; life: number };
type Pulse = { mesh: Mesh; age: number; life: number; maxScale: number };

const enemyQueue: EnemyRecord[] = [];
const enemyById = new Map<number, EnemyRecord>();
const faceRigs: FaceRig[] = [];
const fragments: Fragment[] = [];
const pulses: Pulse[] = [];
let environmentRoot: Group | null = null;
let shellRoot: Group | null = null;
let machineRoot: Group | null = null;
let elapsedNow = 0;
let beatKick = 0;
let cameraImpact = 0;
let facesReleased = 0;

const matte = (color: Color | number, opacity = 1) => new MeshLambertMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: opacity >= 1,
});
const unlit = (color: Color | number, opacity = 1) => new MeshBasicMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: opacity >= 1,
});

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = new Color(0xbfc5ce);
  scene.fog = new Fog(0xbfc5ce, 48, 96);

  const root = new Group();
  root.name = 'speedsolve-void-arena';
  root.userData.raildIgnoreOcclusion = true;
  root.add(new AmbientLight(0xffffff, 1.15));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(18, 24, 32);
  root.add(key);
  const fill = new DirectionalLight(0x9eb8d2, 0.72);
  fill.position.set(-24, -10, -16);
  root.add(fill);
  root.add(createArenaRings());
  root.add(createVoidDust());
  shellRoot = createPuzzleShell();
  machineRoot = createMachine();
  root.add(machineRoot, shellRoot);
  scene.add(root);
  environmentRoot = root;
  return root;
}

function createArenaRings() {
  const group = new Group();
  group.name = 'silent-timing-cage';
  for (let i = 0; i < 9; i += 1) {
    const ring = new Mesh(
      new TorusGeometry(20 + i * 3.2, i % 4 === 0 ? 0.095 : 0.035, 5, 72),
      unlit(i % 4 === 0 ? new Color(0.55, 0.59, 0.64) : new Color(0.72, 0.75, 0.79), 0.34),
    );
    ring.rotation.set(i * 0.37, i * 0.61, i * 0.23);
    group.add(ring);
  }
  const axes = new BufferGeometry();
  axes.setAttribute('position', new Float32BufferAttribute([
    -38, 0, 0, 38, 0, 0,
    0, -38, 0, 0, 38, 0,
    0, 0, -38, 0, 0, 38,
  ], 3));
  group.add(new LineSegments(axes, new LineBasicMaterial({ color: 0x91979f, transparent: true, opacity: 0.34 })));
  return group;
}

function createVoidDust() {
  const count = 480;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const a = i * 2.399963;
    const r = 28 + ((i * 41) % 62);
    const y = ((i * 71) % 88) - 44;
    positions.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    const color = i % 29 === 0 ? SOLVE_COLORS[i % 6] : new Color(0.5, 0.54, 0.59);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Points(geometry, new PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, opacity: 0.72 }));
}

function createPuzzleShell() {
  const shell = new Group();
  shell.name = 'six-face-puzzle-shell';
  faceRigs.length = 0;
  for (let face = 0; face < 6; face += 1) {
    const group = new Group();
    group.name = `face-${face}`;
    const cells: Group[] = [];
    for (let row = -1; row <= 1; row += 1) {
      for (let col = -1; col <= 1; col += 1) {
        const cell = new Group();
        cell.position.copy(facePoint(face, col, row, 8.25));
        cell.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), FACE_NORMALS[face]);
        const body = new Mesh(new BoxGeometry(3.35, 3.35, 1.15), matte(new Color(0.72, 0.74, 0.77)));
        cell.add(body);
        const scrambleIndex = (face * 3 + row * 5 + col * 7 + 19) % 6;
        const stickerMaterial = unlit(SOLVE_COLORS[(scrambleIndex + 6) % 6]);
        const sticker = new Mesh(new BoxGeometry(2.88, 2.88, 0.08), stickerMaterial);
        sticker.position.z = 0.62;
        cell.add(sticker);
        cell.userData.sticker = stickerMaterial;
        cell.userData.col = col;
        cell.userData.row = row;
        group.add(cell);
        cells.push(cell);
      }
    }
    shell.add(group);
    faceRigs.push({ group, cells, currentAngle: 0, targetAngle: 0, solved: 0, released: false });
  }
  return shell;
}

function createMachine() {
  const group = new Group();
  group.name = 'white-grey-inner-machine';
  const cage = new Mesh(new IcosahedronGeometry(7.2, 1), matte(new Color(0.5, 0.53, 0.57), 0.82));
  group.add(cage);
  const dark = new Mesh(new IcosahedronGeometry(5.8, 1), matte(GRAPHITE));
  group.add(dark);
  for (let i = 0; i < 3; i += 1) {
    const gimbal = new Mesh(new TorusGeometry(6.6 - i * 0.72, 0.24, 8, 36), matte(i === 1 ? VOID_WHITE : MACHINE));
    gimbal.rotation.set(i === 0 ? Math.PI / 2 : Math.PI / 5, i === 1 ? Math.PI / 2 : Math.PI / 7, i * Math.PI / 4);
    group.add(gimbal);
  }
  for (const normal of FACE_NORMALS) {
    const piston = new Mesh(new BoxGeometry(1.15, 1.15, 7.6), matte(new Color(0.64, 0.67, 0.7)));
    piston.position.copy(normal).multiplyScalar(4.8);
    piston.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    group.add(piston);
  }
  return group;
}

export function disposeEnvironment() {
  for (const fragment of fragments) {
    fragment.mesh.removeFromParent();
    fragment.mesh.geometry.dispose();
    (fragment.mesh.material as Material).dispose();
  }
  for (const pulse of pulses) {
    pulse.mesh.removeFromParent();
    pulse.mesh.geometry.dispose();
    (pulse.mesh.material as Material).dispose();
  }
  fragments.length = 0;
  pulses.length = 0;
  enemyQueue.length = 0;
  enemyById.clear();
  faceRigs.length = 0;
  if (environmentRoot) {
    environmentRoot.removeFromParent();
    disposeObject3D(environmentRoot);
  }
  environmentRoot = null;
  shellRoot = null;
  machineRoot = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  if (kind === 'letter' || letter) mesh = createLetterMesh(letter ?? 'A');
  else if (kind === 'tile') mesh = createTileTarget();
  else if (kind === 'weakpoint') mesh = createWeakpoint();
  else if (kind === 'core') mesh = createCoreTarget();
  else if (kind === 'bolt') mesh = createBolt();
  else mesh = createPolyhedron(kind as 'tetra' | 'octa' | 'prism');
  mesh.userData.kind = kind;
  enemyQueue.push({ mesh, kind, locked: false, lockCount: 0, tintFace: -1 });
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  mesh.scale.setScalar(locked ? 1.08 + lockCount * 0.035 : mesh.userData.baseScale ?? 1);
  mesh.traverse((child) => {
    const material = (child as Mesh).material;
    const materials = material ? (Array.isArray(material) ? material : [material]) : [];
    for (const item of materials) {
      if ('emissive' in item) (item as MeshLambertMaterial).emissive.set(locked ? 0x28313a : 0x000000);
    }
  });
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.denied = 1;
  mesh.rotation.z += Math.PI / 10;
  mesh.scale.multiplyScalar(0.76);
}

export function createProjectileMesh() {
  return createPlayerProjectile();
}

export function createReticle() {
  return createPuzzleReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + (active ? 0.09 : 0) + lockCount * 0.018);
  reticle.rotation.z = active ? Math.PI / 4 : 0;
  const pips = reticle.getObjectByName('pips');
  if (pips) pips.children.forEach((pip, index) => { pip.visible = index < lockCount; });
}

function faceForPosition(position: Vector3) {
  let face = 0;
  let best = -Infinity;
  FACE_NORMALS.forEach((normal, index) => {
    const dot = position.dot(normal);
    if (dot > best) { best = dot; face = index; }
  });
  return face;
}

function addPulse(scene: Scene, position: Vector3, color: Color, maxScale = 5, life = 0.7) {
  const mesh = new Mesh(new RingGeometry(0.28, 0.4, 20), unlit(color, 0.82));
  mesh.position.copy(position);
  mesh.userData.raildIgnoreOcclusion = true;
  scene.add(mesh);
  pulses.push({ mesh, age: 0, life, maxScale });
}

function addFragments(scene: Scene, position: Vector3, color: Color, count: number, power: number, tiny = false) {
  const geometry = new BoxGeometry(tiny ? 0.16 : 0.48, tiny ? 0.16 : 0.48, tiny ? 0.16 : 0.48);
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(geometry.clone(), unlit(i % 5 === 0 ? VOID_WHITE : color));
    mesh.userData.raildIgnoreOcclusion = true;
    const direction = new Vector3(
      Math.sin(i * 12.9898) * 0.75,
      Math.cos(i * 7.313) * 0.75,
      Math.sin(i * 4.117 + 1.7) * 0.75,
    ).normalize();
    mesh.position.copy(position).addScaledVector(direction, tiny ? 0.5 : 1.2);
    scene.add(mesh);
    fragments.push({
      mesh,
      velocity: direction.multiplyScalar(power * (0.6 + (i % 7) * 0.08)),
      spin: new Vector3(1.7 + i % 3, 2.2 + i % 5, 1.1 + i % 7),
      age: 0,
      life: tiny ? 3.8 + (i % 7) * 0.18 : 2.1 + (i % 5) * 0.14,
    });
  }
}

function solveFaceStep(face: number) {
  const rig = faceRigs[face];
  if (!rig || rig.released) return;
  rig.solved = Math.min(4, rig.solved + 1);
  rig.targetAngle += Math.PI / 2;
  const color = SOLVE_COLORS[face];
  const count = rig.solved === 4 ? 9 : Math.min(9, rig.solved * 2);
  for (let i = 0; i < count; i += 1) (rig.cells[(i * 5) % 9].userData.sticker as MeshBasicMaterial).color.copy(color);
}

function releaseFace(scene: Scene, face: number, position: Vector3) {
  const rig = faceRigs[face];
  if (!rig || rig.released) return;
  rig.released = true;
  rig.group.visible = false;
  facesReleased += 1;
  addFragments(scene, position, SOLVE_COLORS[face], 32, 8.5);
  addPulse(scene, position, SOLVE_COLORS[face], 14, 1.15);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('runstart', () => {
    facesReleased = 0;
    if (shellRoot) shellRoot.visible = true;
    if (machineRoot) machineRoot.visible = true;
    for (const rig of faceRigs) {
      rig.group.visible = true;
      rig.currentAngle = 0;
      rig.targetAngle = 0;
      rig.solved = 0;
      rig.released = false;
    }
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed' && shellRoot) shellRoot.visible = false;
  });
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyQueue.shift();
    if (record) {
      record.kind = kind;
      enemyById.set(enemyId, record);
    }
    addPulse(scene, worldPosition, kind === 'bolt' ? SOLVE_COLORS[3] : new Color(0.55, 0.61, 0.68), 2.4, 0.35);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemyById.get(enemyId);
    if (record) { record.locked = true; record.lockCount = lockCount; }
    addPulse(scene, worldPosition, SOLVE_COLORS[(lockCount - 1) % 6], 2.2, 0.28);
  });
  bus.on('unlock', ({ enemyId }) => {
    const record = enemyById.get(enemyId);
    if (record) { record.locked = false; record.lockCount = 0; }
  });
  bus.on('fire', ({ worldPosition, volleySize }) => {
    addPulse(scene, worldPosition, new Color(0.2, 0.78, 1), 3 + volleySize * 0.35, 0.42);
  });
  bus.on('hit', ({ worldPosition, lethal, stageCompleted }) => {
    cameraImpact = Math.max(cameraImpact, stageCompleted ? 1 : 0.45);
    addFragments(scene, worldPosition, lethal ? new Color(1, 1, 1) : new Color(0.55, 0.74, 0.9), lethal ? 14 : 6, lethal ? 5.8 : 3.1, true);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyById.get(enemyId);
    if (!record) return;
    if (record.kind === 'tile') solveFaceStep(faceForPosition(worldPosition));
    else if (record.kind === 'weakpoint') releaseFace(scene, faceForPosition(worldPosition), worldPosition);
    else if (record.kind === 'core') {
      if (shellRoot) shellRoot.visible = false;
      if (machineRoot) machineRoot.visible = false;
      addFragments(scene, worldPosition, SOLVE_COLORS[5], 210, 13.5, true);
      for (let face = 0; face < 6; face += 1) addPulse(scene, worldPosition, SOLVE_COLORS[face], 12 + face * 2.5, 1.8 + face * 0.12);
    } else addFragments(scene, worldPosition, SOLVE_COLORS[(enemyId + 2) % 6], 18, 6.5, true);
    enemyById.delete(enemyId);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    addPulse(scene, worldPosition, new Color(0.28, 0.3, 0.33), 4, 0.5);
    enemyById.delete(enemyId);
  });
  bus.on('reject', () => {
    cameraImpact = Math.max(cameraImpact, 0.32);
    addPulse(scene, new Vector3(), SOLVE_COLORS[1], 8, 0.48);
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatKick = Math.max(beatKick, isDownbeat ? 1 : 0.44);
  });
  bus.on('playerhit', () => { cameraImpact = 1.35; });
}

function updateEnemyRecords(context: SpeedsolveVisualContext) {
  for (const record of enemyById.values()) {
    const face = record.mesh.userData.face as number | undefined;
    if (face !== undefined && face !== record.tintFace) {
      record.tintFace = face;
      const tintMaterials = (record.mesh.userData.tintMaterials ?? []) as Array<MeshBasicMaterial | MeshLambertMaterial>;
      for (const material of tintMaterials) material.color.copy(SOLVE_COLORS[face]);
    }
    const denied = record.mesh.userData.denied as number | undefined;
    if (denied && denied > 0) {
      record.mesh.userData.denied = Math.max(0, denied - 0.08);
      record.mesh.scale.setScalar(0.78 + (1 - denied) * 0.22);
    } else if (record.locked) {
      record.mesh.scale.setScalar(1.08 + record.lockCount * 0.035 + Math.sin(context.elapsed * 12) * 0.035);
    }
  }
}

export function updateVisuals(dt: number, context: SpeedsolveVisualContext) {
  elapsedNow = context.elapsed;
  beatKick *= Math.exp(-dt * 9);
  cameraImpact *= Math.exp(-dt * 7);
  if (machineRoot) {
    machineRoot.rotation.x += dt * (0.08 + facesReleased * 0.055);
    machineRoot.rotation.y -= dt * (0.11 + facesReleased * 0.07);
    machineRoot.scale.setScalar(1 + beatKick * 0.018 + cameraImpact * 0.018);
  }
  for (let i = 0; i < faceRigs.length; i += 1) {
    const rig = faceRigs[i];
    rig.currentAngle = MathUtilsDamp(rig.currentAngle, rig.targetAngle, 12, dt);
    rig.group.quaternion.setFromAxisAngle(FACE_NORMALS[i], rig.currentAngle);
  }
  updateEnemyRecords(context);

  for (let i = fragments.length - 1; i >= 0; i -= 1) {
    const fragment = fragments[i];
    fragment.age += dt;
    fragment.velocity.multiplyScalar(Math.exp(-dt * 0.34));
    fragment.velocity.y -= dt * 0.42;
    fragment.mesh.position.addScaledVector(fragment.velocity, dt);
    fragment.mesh.rotation.x += fragment.spin.x * dt;
    fragment.mesh.rotation.y += fragment.spin.y * dt;
    fragment.mesh.rotation.z += fragment.spin.z * dt;
    fragment.mesh.scale.setScalar(Math.max(0.001, 1 - (fragment.age / fragment.life) ** 3));
    if (fragment.age >= fragment.life) {
      fragment.mesh.removeFromParent();
      fragment.mesh.geometry.dispose();
      (fragment.mesh.material as Material).dispose();
      fragments.splice(i, 1);
    }
  }
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const pulse = pulses[i];
    pulse.age += dt;
    const t = pulse.age / pulse.life;
    pulse.mesh.quaternion.copy(context.camera.quaternion);
    pulse.mesh.scale.setScalar(0.2 + pulse.maxScale * (1 - (1 - Math.min(1, t)) ** 2));
    (pulse.mesh.material as MeshBasicMaterial).opacity = Math.max(0, (1 - t) ** 1.6);
    if (pulse.age >= pulse.life) {
      pulse.mesh.removeFromParent();
      pulse.mesh.geometry.dispose();
      (pulse.mesh.material as Material).dispose();
      pulses.splice(i, 1);
    }
  }
}

function MathUtilsDamp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
