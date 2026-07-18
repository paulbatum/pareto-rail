import { MathUtils, type Color, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type Vector3 } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { createMassDriverEffects } from './effects';
import { createMassDriverEnvironment, type MassDriverEnvironment } from './environment';
import {
  createMassDriverEnemy,
  createMassDriverLetter,
  createMassDriverProjectile,
  createMassDriverReticle,
  denyEnemyColors,
  lockEnemyColors,
  restoreEnemyColors,
} from './models';

const tracked = new Set<Object3D>();

export function createEnvironment(scene: Scene) {
  return createMassDriverEnvironment(scene);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig, environment: MassDriverEnvironment) {
  return createMassDriverEffects(bus, scene, feel, environment);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createMassDriverLetter(letter ?? 'A') : createMassDriverEnemy(kind);
  tracked.add(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.mdLocked = locked;
  mesh.userData.mdLockCount = lockCount;
  if (locked) lockEnemyColors(mesh, lockCount);
  else if (!(mesh.userData.mdDenied as number)) restoreEnemyColors(mesh);
  const bossScale = mesh.userData.isInterlock ? 1.1 : 1;
  mesh.scale.setScalar(locked ? (1.08 + lockCount * 0.018) * bossScale : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.mdDenied = 0.28;
  mesh.userData.mdLocked = false;
  denyEnemyColors(mesh);
  mesh.scale.setScalar(0.9);
}

export function createProjectileMesh() {
  const projectile = createMassDriverProjectile();
  projectile.userData.kind = 'projectile';
  tracked.add(projectile);
  return projectile;
}

export function createReticle() {
  return createMassDriverReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  const segments = reticle.userData.segments as Mesh[];
  segments?.forEach((segment, index) => { segment.visible = index < lockCount; });
  const now = performance.now() * 0.001;
  const spinner = reticle.userData.spinner as Mesh | undefined;
  if (spinner) spinner.rotation.z = now * (active ? 2.8 + lockCount * 0.62 : 0.65);
  reticle.rotation.z = active ? -now * (0.28 + lockCount * 0.08) : -now * 0.08;
  reticle.scale.setScalar(1 + (active ? 0.06 : 0) + lockCount * 0.032);
}

export function updateEnemyVisuals(dt: number, runTime: number, camera: PerspectiveCamera) {
  for (const root of tracked) {
    if (!root.parent) {
      disposeInstanceMaterials(root);
      tracked.delete(root);
      continue;
    }
    const denied = Math.max(0, (root.userData.mdDenied as number | undefined ?? 0) - dt);
    root.userData.mdDenied = denied;
    if (denied <= 0 && root.userData.mdDeniedRestored !== true) {
      root.userData.mdDeniedRestored = true;
      if (root.userData.mdLocked) lockEnemyColors(root, root.userData.mdLockCount as number);
      else restoreEnemyColors(root);
      const bossScale = root.userData.isInterlock ? 1.1 : 1;
      root.scale.setScalar(root.userData.mdLocked ? (1.08 + (root.userData.mdLockCount as number) * 0.018) * bossScale : 1);
    } else if (denied > 0) {
      root.userData.mdDeniedRestored = false;
      root.scale.setScalar(0.9 + Math.abs(Math.sin(runTime * 42)) * 0.12);
    }

    const kind = root.userData.kind as string;
    const age = root.userData.age as number | undefined ?? runTime;
    if (!root.userData.mdLocked && denied <= 0) {
      const distance = root.position.distanceTo(camera.position);
      const proximityLight = 1 + MathUtils.clamp(1 - distance / 74, 0, 1) * 0.34;
      const materials = root.userData.mdMaterials as Array<{ color: Color }> | undefined;
      const hot = root.userData.mdHotMaterials as Array<{ color: Color }> | undefined;
      const baseColors = root.userData.mdBaseColors as Color[] | undefined;
      const hotColors = root.userData.mdHotColors as Color[] | undefined;
      if (baseColors) materials?.forEach((entry, index) => entry.color.copy(baseColors[index]).multiplyScalar(proximityLight));
      if (hotColors) hot?.forEach((entry, index) => entry.color.copy(hotColors[index]).multiplyScalar(proximityLight));
    }
    if (kind === 'arc') {
      const shells = root.userData.shells as Object3D[];
      shells?.forEach((shell, index) => {
        shell.rotation.x = age * (8.3 + index * 2.1);
        shell.rotation.y = age * (11.7 - index * 1.8);
        shell.rotation.z = age * (14.1 + index);
        const jitter = 0.78 + Math.abs(Math.sin(age * (37 + index * 11) + index * 2.3)) * 0.62;
        shell.scale.set(jitter, 1.45 - jitter * 0.3, 0.9 + Math.sin(age * 53 + index) * 0.25);
      });
      const core = root.userData.core as Object3D | undefined;
      core?.scale.setScalar(0.78 + Math.abs(Math.sin(age * 45)) * 0.52);
    } else if (kind === 'capacitor') {
      const staves = root.userData.staves as Object3D | undefined;
      const core = root.userData.core as Object3D | undefined;
      const exposed = Boolean(root.userData.exposed);
      const exposedAt = root.userData.exposedAt as number | undefined;
      const breakAge = exposed && exposedAt !== undefined ? Math.max(0, age - exposedAt) : 0;
      const breakT = MathUtils.smootherstep(MathUtils.clamp(breakAge / 0.34, 0, 1), 0, 1);
      if (staves) {
        staves.visible = !exposed || breakAge < 0.34;
        for (const stave of staves.children) {
          const base = stave.userData.basePosition as Vector3 | undefined;
          if (base) stave.position.copy(base).multiplyScalar(1 + breakT * 2.1);
          stave.rotation.z = (stave.userData.baseRotation as number | undefined ?? stave.rotation.z) + breakT * 0.7;
          stave.rotation.x = breakT * (staves.children.indexOf(stave) % 2 ? 1 : -1);
        }
      }
      if (core) {
        const shudder = exposed ? Math.sin(age * 48) * 0.06 : 0;
        core.scale.set(1 + shudder, 1 - shudder, 1 + shudder);
      }
    } else if (kind === 'interlock') {
      const exposed = Boolean(root.userData.exposed);
      const cowl = root.userData.cowl as Object3D | undefined;
      const cowlRing = root.userData.cowlRing as Object3D | undefined;
      const core = root.userData.core as Object3D | undefined;
      const jam = root.userData.jam as Object3D | undefined;
      const exposedAt = root.userData.exposedAt as number | undefined;
      const breakAge = exposed && exposedAt !== undefined ? Math.max(0, age - exposedAt) : 0;
      const cowlBreakT = MathUtils.smootherstep(MathUtils.clamp(breakAge / 0.28, 0, 1), 0, 1);
      if (cowl) {
        cowl.visible = !exposed || breakAge < 0.28;
        cowl.position.z = (root.userData.cowlBaseZ as number) + cowlBreakT * 2.4;
        cowl.scale.set(1 + cowlBreakT * 0.45, 1 + cowlBreakT * 0.45, Math.max(0.1, 1 - cowlBreakT * 0.8));
        cowl.rotation.z = cowlBreakT * 1.4;
      }
      if (cowlRing) {
        cowlRing.visible = !exposed || breakAge < 0.28;
        cowlRing.position.z = (root.userData.cowlRingBaseZ as number) + cowlBreakT * 2.7;
        cowlRing.scale.setScalar(1 + cowlBreakT * 0.9);
      }
      if (core) {
        core.visible = exposed;
        core.scale.setScalar(0.88 + Math.abs(Math.sin(age * 33)) * 0.32);
        core.rotation.z = age * 3.5;
      }
      if (jam) {
        jam.rotation.z = age * 2.6;
        const telegraph = root.userData.telegraph as number | undefined ?? 0;
        jam.scale.setScalar(1 + telegraph * 0.35 + Math.sin(age * 15) * 0.04);
      }
    } else if (kind === 'coil') {
      const eye = root.userData.eye as Object3D | undefined;
      const core = root.userData.core as Object3D | undefined;
      const telegraph = root.userData.telegraph as number | undefined ?? 0;
      if (eye) eye.scale.setScalar(1 + telegraph * 0.5 + Math.sin(age * 2.2) * 0.06);
      if (core) core.position.z = 0.48 - telegraph * 0.24;
    } else if (kind === 'threader') {
      const tail = root.userData.ionTail as Object3D | undefined;
      if (tail) {
        tail.scale.y = 0.84 + Math.sin(age * 19) * 0.16;
        tail.scale.x = 0.9 + Math.sin(age * 23) * 0.08;
      }
    }

    // Quick overshoot-in for every hostile and letter plate.
    const spawnScale = age < 0.32 ? 1 + Math.sin(MathUtils.clamp(age / 0.32, 0, 1) * Math.PI) * 0.22 : 1;
    if (!root.userData.mdLocked && denied <= 0) root.scale.setScalar(spawnScale);
  }
}

export function disposeVisuals() {
  for (const root of tracked) disposeInstanceMaterials(root);
  tracked.clear();
}

function disposeInstanceMaterials(root: Object3D) {
  const disposed = new Set<object>();
  root.traverse((child) => {
    const holder = child as Object3D & { material?: { dispose(): void } | Array<{ dispose(): void }> };
    const materials = holder.material ? (Array.isArray(holder.material) ? holder.material : [holder.material]) : [];
    for (const material of materials) {
      if (disposed.has(material)) continue;
      disposed.add(material);
      material.dispose();
    }
  });
}

export type { MassDriverEnvironment } from './environment';
