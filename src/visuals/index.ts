import {
  BoxGeometry,
  ConeGeometry,
  DoubleSide,
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
import type { Camera } from 'three';
import type { EnemyKind, EventBus } from '../events';

const enemyMaterials = {
  node: new MeshBasicMaterial({ color: 0x3bdcff }),
  drifter: new MeshBasicMaterial({ color: 0xff5bd6 }),
  orbiter: new MeshBasicMaterial({ color: 0xffe45b }),
};

const lockedMaterial = new MeshBasicMaterial({ color: 0xffffff });
const projectileMaterial = new MeshBasicMaterial({ color: 0xb8ff6a });
const reticleMaterial = new MeshBasicMaterial({ color: 0x78e7ff, transparent: true, opacity: 0.82, side: DoubleSide });
const reticleActiveMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, side: DoubleSide });

const impactGeometry = new SphereGeometry(0.45, 12, 8);
const killGeometry = new TorusGeometry(0.8, 0.08, 8, 24);
const projectileGeometry = new ConeGeometry(0.16, 0.8, 8);

const effects: Array<{ mesh: Mesh; age: number; lifetime: number }> = [];
let environmentRoot: Group | null = null;
let beatPulse = 0;

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
};

export function createEnvironment(scene: Scene) {
  const root = new Group();
  environmentRoot = root;

  const railMaterial = new MeshBasicMaterial({ color: 0x16364f });
  for (let i = 0; i < 18; i += 1) {
    const marker = new Mesh(new BoxGeometry(26, 0.08, 0.08), railMaterial);
    marker.position.set(0, -4, -i * 15);
    root.add(marker);
  }

  const sideMaterial = new MeshBasicMaterial({ color: 0x07182c });
  for (let i = 0; i < 12; i += 1) {
    const left = new Mesh(new BoxGeometry(0.12, 12, 0.12), sideMaterial);
    left.position.set(-14, 0, -i * 22);
    const right = left.clone();
    right.position.x = 14;
    root.add(left, right);
  }

  scene.add(root);
  return root;
}

export function createEnemyMesh(kind: EnemyKind) {
  const geometry = kind === 'node'
    ? new BoxGeometry(1.35, 1.35, 1.35)
    : kind === 'drifter'
      ? new ConeGeometry(0.95, 1.7, 4)
      : new TorusGeometry(0.75, 0.18, 8, 18);
  const mesh = new Mesh(geometry, enemyMaterials[kind].clone());
  mesh.userData.baseMaterial = enemyMaterials[kind].clone();
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.traverse((child) => {
    if (child instanceof Mesh) {
      child.material = locked ? lockedMaterial : child.userData.baseMaterial;
    }
  });
}

export function createProjectileMesh() {
  const mesh = new Mesh(projectileGeometry, projectileMaterial.clone());
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

export function createReticle() {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.58, 0.68, 32), reticleMaterial.clone());
  const vertical = new Mesh(new BoxGeometry(0.05, 1.9, 0.05), reticleMaterial.clone());
  const horizontal = new Mesh(new BoxGeometry(1.9, 0.05, 0.05), reticleMaterial.clone());
  group.add(ring, vertical, horizontal);
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055);
  reticle.traverse((child) => {
    if (child instanceof Mesh) {
      child.material = active ? reticleActiveMaterial : reticleMaterial;
    }
  });
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('hit', ({ worldPosition }) => addEffect(scene, impactGeometry, worldPosition, 0x88f7ff, 0.22));
  bus.on('kill', ({ worldPosition }) => addEffect(scene, killGeometry, worldPosition, 0xffffff, 0.34));
  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = isDownbeat ? 1 : 0.45;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  beatPulse = Math.max(0, beatPulse - dt * 3.2);
  if (environmentRoot) {
    environmentRoot.scale.setScalar(1 + beatPulse * 0.018);
  }

  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    effect.age += dt;
    const progress = effect.age / effect.lifetime;
    effect.mesh.scale.setScalar(1 + progress * 2.5);
    const material = effect.mesh.material;
    if (material instanceof MeshBasicMaterial) material.opacity = Math.max(0, 1 - progress);
    if (effect.age >= effect.lifetime) {
      ctx.scene.remove(effect.mesh);
      effects.splice(i, 1);
    }
  }
}

function addEffect(scene: Scene, geometry: SphereGeometry | TorusGeometry, position: Vector3, color: number, lifetime: number) {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ color, transparent: true, opacity: 1, side: DoubleSide }),
  );
  mesh.position.copy(position);
  scene.add(mesh);
  effects.push({ mesh, age: 0, lifetime });
}
