import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { createEnemyModel } from './enemies';
import {
  createStrandlineEnvironment,
  disposeStrandlineEnvironment,
  pulseStrandlineEnvironment,
  setStrandlineLiberated,
  updateStrandlineEnvironment,
} from './environment';
import {
  DENIED,
  JELLY_CREAM,
  JELLY_GOLD,
  JELLY_GREEN,
  PARASITE_DARK,
  PARASITE_SOUR,
  PARASITE_VIOLET,
  PLAYER_CYAN,
  PLAYER_GOLD,
  fleshMat,
  strandMat,
} from './palette';

export type StrandlineVisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  locked: boolean;
  baseScale: number;
};

type BloomEffect = {
  group: Group;
  age: number;
  duration: number;
  speed: number;
  drift: Vector3;
};

const enemyQueue: EnemyRecord[] = [];
const enemies = new Map<number, EnemyRecord>();
const blooms: BloomEffect[] = [];
let elapsedNow = 0;
let environmentScene: Scene | null = null;
let parentRecord: EnemyRecord | null = null;
let parentStage = 0;
let parentOpen = false;
let impactWash = 0;
let deniedWash = 0;

export function createEnvironment(scene: Scene) {
  environmentScene = scene;
  return createStrandlineEnvironment(scene);
}

export function disposeEnvironment() {
  for (const bloom of blooms) {
    bloom.group.removeFromParent();
    disposeTree(bloom.group);
  }
  blooms.length = 0;
  enemies.clear();
  enemyQueue.length = 0;
  parentRecord = null;
  parentStage = 0;
  parentOpen = false;
  environmentScene = null;
  disposeStrandlineEnvironment();
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = letter || kind === 'letter' ? createLetterMesh(letter ?? 'A') : createEnemyModel(kind);
  mesh.userData.kind = kind;
  mesh.userData.locked = false;
  enemyQueue.push({ mesh, kind, locked: false, baseScale: 1 });
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  const record = findRecord(mesh);
  if (record) record.locked = locked;
  mesh.scale.setScalar(locked ? 1.14 : 1);
  const core = mesh.userData.core as Mesh | undefined;
  if (core?.material instanceof MeshBasicMaterial) core.material.color.copy(locked ? PLAYER_CYAN : PARASITE_SOUR);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  mesh.scale.set(1.28, 0.76, 1.28);
  const core = mesh.userData.core as Mesh | undefined;
  if (core?.material instanceof MeshBasicMaterial) core.material.color.copy(DENIED);
  deniedWash = 1;
}

export function createProjectileMesh() {
  const group = new Group();
  const seed = new Mesh(new SphereGeometry(0.13, 8, 5), strandMat(PLAYER_GOLD));
  group.add(seed);
  const head = new Mesh(new ConeGeometry(0.1, 0.62, 5), strandMat(PLAYER_CYAN));
  head.rotation.x = Math.PI * 0.5;
  head.position.z = -0.3;
  group.add(head);
  for (let strand = 0; strand < 3; strand += 1) {
    const tail = new Mesh(new CylinderGeometry(0.018, 0.045, 1.25, 4), strandMat(strand === 0 ? PLAYER_GOLD : PLAYER_CYAN, 0.62));
    tail.rotation.x = Math.PI * 0.5;
    tail.rotation.z = (strand / 3) * Math.PI * 2;
    tail.position.z = 0.62;
    tail.position.x = Math.cos((strand / 3) * Math.PI * 2) * 0.08;
    tail.position.y = Math.sin((strand / 3) * Math.PI * 2) * 0.08;
    group.add(tail);
  }
  return group;
}

export function createReticle() {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(0.65, 0.69, 40), strandMat(PLAYER_CYAN, 0.88));
  const inner = new Mesh(new RingGeometry(0.31, 0.34, 32), strandMat(JELLY_GOLD, 0.72));
  group.add(outer, inner);
  const pearls: Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 - Math.PI * 0.5;
    const pearl = new Mesh(new SphereGeometry(0.055, 7, 5), strandMat(PLAYER_CYAN, 0.82));
    pearl.position.set(Math.cos(angle) * 0.83, Math.sin(angle) * 0.83, 0);
    group.add(pearl);
    pearls.push(pearl);
  }
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI * 0.5;
    const tick = new Mesh(new BoxGeometry(0.18, 0.028, 0.01), strandMat(PLAYER_GOLD, 0.85));
    tick.position.set(Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0);
    tick.rotation.z = angle;
    group.add(tick);
  }
  group.userData.outer = outer;
  group.userData.inner = inner;
  group.userData.pearls = pearls;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.052 + (active ? 0.08 : 0));
  const outer = reticle.userData.outer as Mesh | undefined;
  const inner = reticle.userData.inner as Mesh | undefined;
  if (outer?.material instanceof MeshBasicMaterial) outer.material.color.copy(active ? PLAYER_GOLD : PLAYER_CYAN);
  if (inner) inner.rotation.z = elapsedNow * (active ? 0.7 : 0.22);
  const pearls = (reticle.userData.pearls as Mesh[] | undefined) ?? [];
  for (let index = 0; index < pearls.length; index += 1) {
    const pearl = pearls[index];
    const filled = index < lockCount;
    pearl.scale.setScalar(filled ? 1.75 : 1);
    if (pearl.material instanceof MeshBasicMaterial) pearl.material.color.copy(filled ? PLAYER_GOLD : PLAYER_CYAN);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('runstart', () => {
    parentRecord = null;
    parentStage = 0;
    parentOpen = false;
    setStrandlineLiberated(false);
  });
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyQueue.shift();
    if (record) {
      enemies.set(enemyId, record);
      if (kind === 'parent') parentRecord = record;
    }
    const color = kind === 'letter' ? JELLY_GOLD : kind === 'parent' ? PARASITE_SOUR : PARASITE_VIOLET;
    addBloom(scene, worldPosition, color, kind === 'parent' ? 4.2 : 1.15, kind === 'parent' ? 0.8 : 0.34, 1.4);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record) record.locked = true;
    addBloom(scene, worldPosition, lockCount >= 5 ? PLAYER_GOLD : PLAYER_CYAN, 0.82 + lockCount * 0.12, 0.23, 2.2);
  });
  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record) record.locked = false;
    addBloom(scene, worldPosition, JELLY_GREEN, 0.72, 0.2, 1.1);
  });
  bus.on('fire', ({ worldPosition, volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) === 0) addBloom(scene, worldPosition, volleySize >= 6 ? JELLY_GOLD : PLAYER_CYAN, 0.45 + volleySize * 0.08, 0.18, 3.5);
  });
  bus.on('hit', ({ enemyId, worldPosition, lethal, stageCompleted }) => {
    const record = enemies.get(enemyId);
    if (record) record.mesh.userData.hitUntil = elapsedNow + (stageCompleted ? 0.34 : 0.18);
    addBloom(scene, worldPosition, lethal ? JELLY_GOLD : PARASITE_SOUR, lethal ? 2.25 : 0.92, lethal ? 0.48 : 0.25, lethal ? 3.1 : 1.9);
    impactWash = Math.max(impactWash, lethal ? 0.75 : 0.32);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const boss = record?.kind === 'parent';
    enemies.delete(enemyId);
    addBloom(scene, worldPosition, boss ? JELLY_CREAM : JELLY_GOLD, boss ? 6.8 : 2.8, boss ? 1.2 : 0.58, boss ? 1.2 : 3.4);
    if (boss) {
      parentRecord = null;
      setStrandlineLiberated(true, elapsedNow);
    }
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    enemies.delete(enemyId);
    addBloom(scene, worldPosition, record?.kind === 'brood' ? PARASITE_SOUR : PARASITE_DARK, 1.15, 0.44, 0.75);
  });
  bus.on('stage', ({ enemyId, stageIndex, worldPosition }) => {
    if (parentRecord && enemies.get(enemyId) === parentRecord) {
      parentStage = stageIndex;
      parentOpen = false;
    }
    addBloom(scene, worldPosition, JELLY_GOLD, 4.2, 0.72, 4.5);
    pulseStrandlineEnvironment(1.4);
  });
  bus.on('reject', ({ enemyIds }) => {
    deniedWash = 1;
    for (const enemyId of enemyIds) {
      const record = enemies.get(enemyId);
      if (record) record.mesh.userData.deniedUntil = elapsedNow + 0.5;
    }
  });
  bus.on('beat', ({ isDownbeat }) => pulseStrandlineEnvironment(isDownbeat ? 1 : 0.36));
  bus.on('playerhit', () => {
    deniedWash = 1;
    impactWash = 0.9;
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') parentOpen = false;
    if (phase === 'exposed') {
      parentOpen = true;
      if (parentRecord) parentRecord.mesh.userData.openFlashUntil = elapsedNow + 0.8;
      pulseStrandlineEnvironment(1.2);
    }
    if (phase === 'destroyed') setStrandlineLiberated(true, elapsedNow);
  });
}

export function updateVisuals(dt: number, context: StrandlineVisualContext) {
  elapsedNow = context.elapsed;
  impactWash = Math.max(0, impactWash - dt * 2.7);
  deniedWash = Math.max(0, deniedWash - dt * 3.8);
  updateStrandlineEnvironment(dt, context);

  for (const record of enemies.values()) {
    const { mesh, kind } = record;
    const denied = elapsedNow < ((mesh.userData.deniedUntil as number | undefined) ?? -1);
    const hit = elapsedNow < ((mesh.userData.hitUntil as number | undefined) ?? -1);
    const openFlash = elapsedNow < ((mesh.userData.openFlashUntil as number | undefined) ?? -1);
    const throb = 1 + Math.sin(context.elapsed * (kind === 'brood' ? 4.8 : 2.3) + mesh.id) * (kind === 'parent' ? 0.025 : 0.045);
    const deniedScale = denied ? 0.78 + Math.sin(context.elapsed * 47) * 0.2 : 1;
    const lockScale = record.locked ? 1.14 : 1;
    mesh.scale.setScalar(record.baseScale * throb * deniedScale * lockScale * (hit ? 1.12 : 1));

    const core = mesh.userData.core as Mesh | undefined;
    if (core?.material instanceof MeshBasicMaterial) {
      core.material.color.copy(denied ? DENIED : record.locked || openFlash ? PLAYER_CYAN : PARASITE_SOUR);
      core.material.opacity = hit ? 1 : 0.88;
    }
    if (kind === 'cyst') {
      const cage = mesh.userData.cage as Mesh | undefined;
      if (cage) cage.rotation.z += dt * 0.55;
    }
    if (kind === 'brood') {
      const body = mesh.children[0];
      if (body) body.rotation.z += dt * 0.45;
    }
    if (kind === 'stinger') mesh.rotation.z += dt * 3.5;
    if (kind === 'parent') updateParentVisual(mesh, dt, context.elapsed);
  }

  for (let index = blooms.length - 1; index >= 0; index -= 1) {
    const bloom = blooms[index];
    bloom.age += dt;
    const t = Math.min(1, bloom.age / bloom.duration);
    bloom.group.position.addScaledVector(bloom.drift, dt);
    bloom.group.quaternion.copy(context.camera.quaternion);
    bloom.group.scale.multiplyScalar(1 + dt * bloom.speed * (1 - t * 0.35));
    for (const child of bloom.group.children) {
      const material = (child as Mesh).material;
      if (material instanceof MeshBasicMaterial) material.opacity = Math.max(0, (1 - t) * 0.9);
    }
    if (t >= 1) {
      bloom.group.removeFromParent();
      disposeTree(bloom.group);
      blooms.splice(index, 1);
    }
  }

  // The water itself catches only a restrained tint; geometry remains readable
  // with bloom at zero because all target cores have opaque base color.
  if (environmentScene && (impactWash > 0 || deniedWash > 0)) {
    const background = environmentScene.background;
    if (background instanceof Color) {
      if (impactWash > 0) background.lerp(JELLY_GOLD, impactWash * 0.035);
      if (deniedWash > 0) background.lerp(PARASITE_VIOLET, deniedWash * 0.055);
    }
  }
}

function updateParentVisual(mesh: Group, dt: number, elapsed: number) {
  const webLayers = (mesh.userData.webLayers as Group[] | undefined) ?? [];
  const webStage = (mesh.userData.webStage as number | undefined) ?? parentStage;
  const visibleLayers = Math.max(0, 3 - webStage);
  for (let index = 0; index < webLayers.length; index += 1) {
    const web = webLayers[index];
    web.visible = index < visibleLayers;
    web.rotation.z += dt * (index % 2 === 0 ? 0.19 : -0.14) * (1 + parentStage * 0.35);
    if (web.visible) {
      const currentLayer = index === visibleLayers - 1;
      const pulse = currentLayer && parentOpen ? 0.82 + Math.sin(elapsed * 8) * 0.12 : 1;
      web.scale.setScalar(pulse);
      for (const child of web.children) {
        const material = (child as Mesh).material;
        if (material instanceof MeshBasicMaterial) {
          material.opacity = currentLayer && parentOpen ? 0.27 : 0.58;
          material.color.copy(currentLayer && parentOpen ? JELLY_GOLD : PARASITE_SOUR);
        }
      }
    }
  }
  const halo = mesh.userData.targetHalo as Mesh | undefined;
  if (halo) {
    halo.visible = parentOpen;
    halo.rotation.z -= dt * 0.8;
    halo.scale.setScalar(1 + Math.sin(elapsed * 5.5) * 0.12);
  }
}

function addBloom(scene: Scene, position: Vector3, color: Color, size: number, duration: number, speed: number) {
  while (blooms.length >= 24) {
    const oldest = blooms.shift();
    if (!oldest) break;
    oldest.group.removeFromParent();
    disposeTree(oldest.group);
  }
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.46, 0.55, 24), strandMat(color, 0.88));
  group.add(ring);
  const inner = new Mesh(new RingGeometry(0.15, 0.2, 16), strandMat(color, 0.72));
  inner.rotation.z = Math.PI / 6;
  group.add(inner);
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    const filament = new Mesh(new CylinderGeometry(0.018, 0.045, 0.52 + (index % 3) * 0.18, 4), strandMat(color, 0.78));
    filament.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, 0);
    filament.rotation.z = -angle;
    group.add(filament);
  }
  group.position.copy(position);
  group.scale.setScalar(size);
  scene.add(group);
  blooms.push({
    group,
    age: 0,
    duration,
    speed,
    drift: new Vector3(Math.sin(position.x * 0.13) * 0.2, 0.32 + size * 0.025, Math.cos(position.y * 0.17) * 0.12),
  });
}

function createLetterMesh(character: string) {
  const outer = new Group();
  const plate = new Group();
  outer.add(plate);
  const cellGeometry = new BoxGeometry(0.235, 0.235, 0.11);
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(cellGeometry, fleshMat(JELLY_CREAM));
    block.position.set((cell.x - 2) * 0.29, (3 - cell.y) * 0.29, 0);
    plate.add(block);
    const pearl = new Mesh(new SphereGeometry(0.045, 6, 4), strandMat(JELLY_GOLD));
    pearl.position.set(block.position.x, block.position.y, 0.09);
    plate.add(pearl);
  }
  const ring = new Mesh(new TorusGeometry(0.99, 0.045, 6, 28), strandMat(JELLY_GREEN, 0.86));
  plate.add(ring);
  for (let index = 0; index < 4; index += 1) {
    const tendril = new Mesh(new ConeGeometry(0.035, 0.65 + index * 0.08, 4), strandMat(JELLY_GOLD, 0.72));
    tendril.position.set(-0.58 + index * 0.38, -1.18, 0);
    tendril.rotation.z = (index - 1.5) * 0.12;
    plate.add(tendril);
  }
  outer.userData.core = ring;
  return outer;
}

function findRecord(mesh: Object3D) {
  return enemyQueue.find((record) => record.mesh === mesh)
    ?? [...enemies.values()].find((record) => record.mesh === mesh);
}

function disposeTree(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
