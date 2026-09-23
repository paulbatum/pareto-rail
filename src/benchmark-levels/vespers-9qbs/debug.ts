import { Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import type { EventBus } from '../../events';

// Debug only (`?rose=autoplay`): a perfect-aim pilot that sweeps and releases
// through the real pointer path, so snapshots and playtesters can watch the
// whole loop — locks, volleys, light going home, the rose burning — without
// playing. It decides nothing about the level.

const MAX_LOCKS = 6;
const NDC = new Vector3();

export function createAutopilot(bus: EventBus, scene: Scene, camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
  let pointerDown = false;
  let lockCount = 0;
  const busy = new Set<number>();

  bus.on('lock', ({ enemyId, lockCount: count }) => {
    lockCount = count;
    busy.add(enemyId);
  });
  bus.on('unlock', ({ lockCount: count }) => {
    lockCount = count;
  });
  bus.on('hit', ({ enemyId, lethal }) => {
    if (!lethal) busy.delete(enemyId);
  });
  bus.on('reject', () => {
    lockCount = 0;
    busy.clear();
  });
  bus.on('runstart', () => {
    lockCount = 0;
    busy.clear();
  });

  const dispatch = (type: string, x: number, y: number, buttons: number) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: rect.left + ((x + 1) / 2) * rect.width,
      clientY: rect.top + ((1 - y) / 2) * rect.height,
      buttons,
      button: 0,
      pointerId: 1,
      bubbles: true,
    }));
  };
  const release = () => {
    if (!pointerDown) return;
    dispatch('pointerup', 0, 0, 0);
    pointerDown = false;
  };

  function targets() {
    const found: Array<{ id: number; x: number; y: number }> = [];
    scene.traverse((object: Object3D) => {
      const data = object.userData;
      if (data.raildRole !== 'target' || data.raildTargetPurpose !== 'enemy' || !object.visible) return;
      const id = data.raildEnemyId as number;
      if (busy.has(id)) return;
      NDC.copy(object.position).project(camera);
      if (NDC.z < -1 || NDC.z > 1 || Math.abs(NDC.x) > 0.95 || Math.abs(NDC.y) > 0.95) return;
      found.push({ id, x: NDC.x, y: NDC.y });
    });
    return found.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  }

  return {
    update(running: boolean) {
      if (!running) {
        release();
        return;
      }
      if (lockCount >= MAX_LOCKS) {
        release();
        return;
      }
      const candidates = targets();
      if (candidates.length === 0) {
        if (lockCount > 0) release();
        return;
      }
      dispatch(pointerDown ? 'pointermove' : 'pointerdown', candidates[0].x, candidates[0].y, 1);
      pointerDown = true;
    },
  };
}
