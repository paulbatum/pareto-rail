import { Vector2 } from 'three';

export type InputState = {
  pointerNdc: Vector2;
  pointerDown: boolean;
  justReleased: boolean;
};

export type InputHandlers = {
  onRestart: () => void;
  onPause: () => void;
  onFullscreen?: () => void;
  onPointerDown?: () => void;
};

export function createInput(target: HTMLElement, handlers: InputHandlers) {
  const state: InputState = {
    pointerNdc: new Vector2(0, 0),
    pointerDown: false,
    justReleased: false,
  };

  const updatePointer = (event: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    state.pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
  };

  const onPointerMove = (event: PointerEvent) => updatePointer(event);
  const onPointerDown = (event: PointerEvent) => {
    updatePointer(event);
    state.pointerDown = true;
    handlers.onPointerDown?.();
    target.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent) => {
    updatePointer(event);
    if (state.pointerDown) state.justReleased = true;
    state.pointerDown = false;
    target.releasePointerCapture?.(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') handlers.onPause();
    if (event.key.toLowerCase() === 'f') handlers.onFullscreen?.();
    if (event.key.toLowerCase() === 'r') handlers.onRestart();
  };

  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    state,
    consumeRelease() {
      const released = state.justReleased;
      state.justReleased = false;
      return released;
    },
    dispose() {
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
