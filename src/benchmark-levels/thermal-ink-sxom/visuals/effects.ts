import {
  BoxGeometry,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  Object3D,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { beginBossCollapse, pulseHarborBeat, resetBossEnvironment } from './environment';
import { thermalBasic, thermalStandard } from './materials';
import {
  DIRTY_CREAM,
  INK,
  LAMP,
  OCHRE,
  RUST,
  UI_CREAM,
  UI_RED,
} from './palette';

type EffectKind = 'spawn' | 'lock' | 'unlock' | 'fire' | 'hit' | 'kill' | 'miss' | 'stage' | 'collapse';

type Transient = {
  root: Group;
  age: number;
  duration: number;
  kind: EffectKind;
  velocities: Vector3[];
};

const transients: Transient[] = [];
let rejectEnergy = 0;
let hullHitEnergy = 0;
let maxLockEnergy = 0;

export function resetVisualEffects(scene?: Scene) {
  if (scene) {
    for (const transient of transients) scene.remove(transient.root);
  }
  transients.length = 0;
  rejectEnergy = 0;
  hullHitEnergy = 0;
  maxLockEnergy = 0;
}

export function installEffectHandlers(bus: EventBus, scene: Scene) {
  bus.on('runstart', () => {
    resetVisualEffects(scene);
    resetBossEnvironment();
  });
  bus.on('spawn', ({ kind, worldPosition }) => {
    if (kind === 'letter' || kind === 'ink-cloud') return;
    createPulse(scene, worldPosition, 'spawn', kind === 'arm' ? 2.7 : kind === 'core' ? 3.2 : 1.2);
  });
  bus.on('lock', ({ lockCount, worldPosition }) => {
    createPulse(scene, worldPosition, 'lock', 0.68 + lockCount * 0.09);
    if (lockCount >= 6) maxLockEnergy = 1;
  });
  bus.on('unlock', ({ worldPosition }) => {
    createPulse(scene, worldPosition, 'unlock', 0.55);
  });
  bus.on('fire', ({ worldPosition, volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) > 0) return;
    createPulse(scene, worldPosition, 'fire', 0.9 + volleySize * 0.12);
  });
  bus.on('hit', ({ worldPosition, lethal, stageCompleted }) => {
    createBurst(scene, worldPosition, stageCompleted ? 'stage' : 'hit', lethal ? 14 : 7);
  });
  bus.on('stage', ({ worldPosition }) => {
    createPulse(scene, worldPosition, 'stage', 2.2);
    createBurst(scene, worldPosition, 'stage', 18);
  });
  bus.on('kill', ({ worldPosition }) => {
    createPulse(scene, worldPosition, 'kill', 2.4);
    createBurst(scene, worldPosition, 'kill', 20);
  });
  bus.on('miss', ({ worldPosition }) => {
    createPulse(scene, worldPosition, 'miss', 1.25);
  });
  bus.on('reject', () => {
    rejectEnergy = 1;
  });
  bus.on('playerhit', () => {
    hullHitEnergy = 1;
  });
  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) maxLockEnergy = 1.45;
  });
  bus.on('beat', ({ isDownbeat }) => {
    pulseHarborBeat(isDownbeat);
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      createPulse(scene, new Vector3(0, 0, -220), 'stage', 6.2);
    } else if (phase === 'destroyed') {
      beginBossCollapse();
      createCollapse(scene, new Vector3(0, 0, -220));
    }
  });
}

function createPulse(
  scene: Scene,
  position: Vector3,
  kind: EffectKind,
  scale: number,
) {
  const root = new Group();
  root.position.copy(position);
  root.userData.raildIgnoreOcclusion = true;
  const role = kind === 'lock' || kind === 'hit' || kind === 'stage' ? 'ui-red' : kind === 'miss' ? 'ink' : 'ui';
  const color = kind === 'lock' || kind === 'hit' || kind === 'stage'
    ? UI_RED
    : kind === 'miss'
      ? INK
      : UI_CREAM;
  const ring = new Mesh(
    new RingGeometry(scale * 0.6, scale * 0.68, 32),
    thermalBasic(role, color, { opacity: kind === 'miss' ? 0.34 : 0.72, depthWrite: false }),
  );
  ring.userData.pulseRing = true;
  root.add(ring);
  if (kind === 'spawn' || kind === 'kill' || kind === 'stage') {
    const second = new Mesh(
      new TorusGeometry(scale * 0.42, scale * 0.035, 5, 24),
      thermalBasic(kind === 'stage' ? 'ui-red' : 'ui', kind === 'stage' ? UI_RED : LAMP, {
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    second.rotation.x = Math.PI / 2;
    second.userData.pulseRing = true;
    root.add(second);
  }
  scene.add(root);
  transients.push({
    root,
    age: 0,
    duration: kind === 'miss' ? 0.8 : kind === 'stage' ? 1.05 : 0.62,
    kind,
    velocities: [],
  });
}

function createBurst(scene: Scene, position: Vector3, kind: EffectKind, count: number) {
  const root = new Group();
  root.position.copy(position);
  root.userData.raildIgnoreOcclusion = true;
  const velocities: Vector3[] = [];
  const geometry = kind === 'kill'
    ? new ConeGeometry(0.12, 0.65, 5)
    : new BoxGeometry(0.14, 0.14, 0.55);
  for (let index = 0; index < count; index += 1) {
    const hot = index % 3 !== 0;
    const shard = new Mesh(
      geometry,
      thermalStandard(hot ? 'hot' : 'rust', hot ? OCHRE : RUST, {
        emissive: hot ? 0x6a2508 : 0x000000,
        emissiveIntensity: hot ? 0.8 : 0,
        thermalEmissiveIntensity: hot ? 1.2 : 0,
        roughness: 0.55,
        metalness: hot ? 0.18 : 0.62,
      }),
    );
    const theta = index * 2.399963;
    const z = -0.8 + 1.6 * ((index * 13) % count) / Math.max(1, count - 1);
    const radius = Math.sqrt(Math.max(0.02, 1 - z * z));
    const velocity = new Vector3(
      Math.cos(theta) * radius,
      Math.sin(theta) * radius,
      z,
    ).multiplyScalar(4.8 + (index % 5) * 1.15);
    velocities.push(velocity);
    shard.rotation.set(theta, theta * 0.7, theta * 1.2);
    shard.userData.burstIndex = index;
    root.add(shard);
  }
  scene.add(root);
  transients.push({
    root,
    age: 0,
    duration: kind === 'kill' ? 1.05 : 0.72,
    kind,
    velocities,
  });
}

function createCollapse(scene: Scene, position: Vector3) {
  const root = new Group();
  root.position.copy(position);
  root.userData.raildIgnoreOcclusion = true;
  const velocities: Vector3[] = [];
  const geometry = new IcosahedronGeometry(0.48, 0);
  for (let index = 0; index < 54; index += 1) {
    const ember = new Mesh(
      geometry,
      thermalStandard(index % 4 === 0 ? 'core' : 'hot', index % 4 === 0 ? UI_RED : DIRTY_CREAM, {
        emissive: index % 4 === 0 ? 0x9a1207 : 0x7a4c1c,
        emissiveIntensity: 1.2,
        thermalEmissiveIntensity: 1.8,
        roughness: 0.42,
      }),
    );
    const theta = index * 2.399963;
    const y = -1 + 2 * ((index * 17) % 53) / 53;
    const radial = Math.sqrt(Math.max(0.01, 1 - y * y));
    const velocity = new Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial)
      .multiplyScalar(8 + (index % 8) * 1.2);
    velocities.push(velocity);
    root.add(ember);
  }
  const shock = new Mesh(
    new TorusGeometry(4.5, 0.25, 8, 48),
    thermalBasic('ui-red', UI_RED, { opacity: 0.82, depthWrite: false }),
  );
  shock.userData.collapseShock = true;
  root.add(shock);
  scene.add(root);
  transients.push({ root, age: 0, duration: 2.8, kind: 'collapse', velocities });
}

export function updateVisualEffects(dt: number, camera: Object3D) {
  rejectEnergy = Math.max(0, rejectEnergy - dt * 3.6);
  hullHitEnergy = Math.max(0, hullHitEnergy - dt * 2.7);
  maxLockEnergy = Math.max(0, maxLockEnergy - dt * 2.9);

  for (let index = transients.length - 1; index >= 0; index -= 1) {
    const transient = transients[index];
    transient.age += dt;
    const progress = Math.min(1, transient.age / transient.duration);
    const fade = 1 - progress;
    transient.root.quaternion.copy(camera.quaternion);

    let velocityIndex = 0;
    transient.root.traverse((child) => {
      if (child.userData.pulseRing) {
        const scale = 1 + progress * (transient.kind === 'stage' ? 5.2 : 3.2);
        child.scale.setScalar(scale);
        child.rotation.z += dt * (transient.kind === 'lock' ? 5 : 1.4);
        setOpacity(child, fade * fade);
      } else if (child.userData.collapseShock) {
        child.scale.setScalar(1 + progress * 8);
        setOpacity(child, fade);
      } else if (typeof child.userData.burstIndex === 'number' || transient.kind === 'collapse') {
        const velocity = transient.velocities[velocityIndex];
        velocityIndex += 1;
        if (!velocity) return;
        child.position.addScaledVector(velocity, dt);
        velocity.y -= dt * (transient.kind === 'collapse' ? 2.1 : 4.8);
        child.rotation.x += dt * 5.2;
        child.rotation.z -= dt * 3.7;
        child.scale.setScalar(Math.max(0.01, fade));
      }
    });

    if (progress >= 1) {
      transient.root.removeFromParent();
      transients.splice(index, 1);
    }
  }
}

function setOpacity(object: Object3D, scale: number) {
  const mesh = object as Mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
  for (const material of materials) {
    const base = Number(material.userData.thermal?.baseOpacity ?? 1);
    material.opacity = base * scale;
    material.transparent = true;
  }
}

export function visualImpactEnergy() {
  return Math.max(rejectEnergy * 0.62, hullHitEnergy, maxLockEnergy * 0.35);
}

export function rejectVisualEnergy() {
  return rejectEnergy;
}

