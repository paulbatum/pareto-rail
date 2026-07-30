import { Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';

/* Detached debug camera. It flies a clone of the player camera, so the game keeps
   running and posing its own camera untouched — leaving freecam just points the
   frame back at the player camera, which was never wrong. */

const DEFAULT_SPEED = 12;
const BOOST_MULTIPLIER = 4;
const LOOK_RADIANS_PER_PIXEL = 0.0022;
const PITCH_LIMIT = MathUtils.degToRad(89);
const WORLD_UP = new Vector3(0, 1, 0);

export type FreecamOptions = {
  playerCamera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** Redirects the rendered frame. Called with the freecam clone, then with the player camera on exit. */
  onCameraChange: (camera: PerspectiveCamera) => void;
};

export type Freecam = ReturnType<typeof createFreecam>;

export function createFreecam({ playerCamera, canvas, onCameraChange }: FreecamOptions) {
  const camera = playerCamera.clone();
  const held = new Set<string>();
  const look = new Euler(0, 0, 0, 'YXZ');
  const move = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  let active = false;
  let speed = DEFAULT_SPEED;

  const onMouseMove = (event: MouseEvent) => {
    if (!active || document.pointerLockElement !== canvas) return;
    look.y -= event.movementX * LOOK_RADIANS_PER_PIXEL;
    look.x = MathUtils.clamp(look.x - event.movementY * LOOK_RADIANS_PER_PIXEL, -PITCH_LIMIT, PITCH_LIMIT);
    camera.quaternion.setFromEuler(look);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!active) return;
    if (event.code === 'Space') event.preventDefault();
    held.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.code);
  /* A key released while the tab is away never reports, so it would stay stuck down. */
  const onBlur = () => held.clear();

  /* Escape releases the cursor and opens the pause menu. Freecam stays armed;
     clicking the canvas takes the cursor back. */
  const onCanvasPointerDown = () => {
    if (active && document.pointerLockElement !== canvas) void requestLock();
  };

  async function requestLock() {
    try {
      await canvas.requestPointerLock();
    } catch (error) {
      console.warn('Freecam could not capture the pointer', error);
    }
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onCanvasPointerDown);

  function setActive(next: boolean) {
    if (next === active) return;
    active = next;
    held.clear();
    if (active) {
      camera.position.copy(playerCamera.position);
      /* Reading the pose as yaw-then-pitch drops the rail camera's cosmetic bank,
         which a fly camera should not inherit. */
      look.setFromQuaternion(playerCamera.quaternion, 'YXZ');
      look.z = 0;
      camera.quaternion.setFromEuler(look);
      syncAspect(playerCamera.aspect);
      onCameraChange(camera);
      void requestLock();
    } else {
      onCameraChange(playerCamera);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
  }

  function syncAspect(aspect: number) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  function update(dt: number) {
    if (!active) return;
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    move.set(0, 0, 0);
    if (held.has('KeyW')) move.add(forward);
    if (held.has('KeyS')) move.sub(forward);
    if (held.has('KeyD')) move.add(right);
    if (held.has('KeyA')) move.sub(right);
    if (held.has('Space')) move.add(WORLD_UP);
    if (held.has('ControlLeft') || held.has('ControlRight') || held.has('KeyC')) move.sub(WORLD_UP);
    if (move.lengthSq() === 0) return;
    const boosted = held.has('ShiftLeft') || held.has('ShiftRight');
    camera.position.addScaledVector(move.normalize(), speed * (boosted ? BOOST_MULTIPLIER : 1) * dt);
  }

  return {
    isActive: () => active,
    setActive,
    setSpeed(unitsPerSecond: number) {
      if (Number.isFinite(unitsPerSecond)) speed = Math.max(0, unitsPerSecond);
    },
    syncAspect,
    update,
    dispose() {
      setActive(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
    },
  };
}
