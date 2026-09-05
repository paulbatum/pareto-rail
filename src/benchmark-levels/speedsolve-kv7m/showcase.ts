import type { Group, PerspectiveCamera } from 'three';
import type { EventBus } from '../../events';

/** A local inspection driver: it uses real pointer input and the normal fight rules. */
export function createShowcaseDriver(canvas: HTMLCanvasElement, camera: PerspectiveCamera, bus: EventBus, targets: Map<number, Group>) {
  let down = false, locks = 0;
  const inFlight = new Set<number>();
  const off = [
    bus.on('runstart', () => { down = false; locks = 0; inFlight.clear(); }),
    bus.on('lock', e => { locks = e.lockCount; }),
    bus.on('unlock', e => { locks = e.lockCount; inFlight.add(e.enemyId); }),
    bus.on('fire', e => { inFlight.add(e.enemyId); }),
    bus.on('hit', e => { inFlight.delete(e.enemyId); }),
    bus.on('kill', e => { inFlight.delete(e.enemyId); }),
    bus.on('miss', e => { inFlight.delete(e.enemyId); }),
  ];
  const release = () => {
    if (!down) return;
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, bubbles: true })); down = false;
  };
  return {
    update(running: boolean) {
      if (!running) return;
      if (locks >= 6) { release(); return; }
      const candidates = [...targets.entries()].filter(([id, m]) => m.visible && m.parent && m.userData.kind !== 'letter' && !m.userData.locked && !inFlight.has(id))
        .map(([id, m]) => ({ id, p: m.position.clone().project(camera), priority: m.userData.kind === 'bolt' ? -1 : 0 }))
        .filter(({ p }) => p.z > -1 && p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95)
        .sort((a, b) => a.priority - b.priority || a.p.lengthSq() - b.p.lengthSq());
      const target = candidates[0];
      if (!target) { if (locks > 0) release(); return; }
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(down ? 'pointermove' : 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true,
        clientX: rect.left + (target.p.x + 1) * rect.width / 2, clientY: rect.top + (1 - target.p.y) * rect.height / 2 }));
      down = true;
    },
    dispose() { release(); off.forEach(fn => fn()); },
  };
}
