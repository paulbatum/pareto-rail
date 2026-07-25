import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createThermalInkSxomGameplay } from './gameplay';
import { composeThermalInkOutput } from './post';
import {
  resetThermalState,
  setInfrared,
  thermalState,
  toggleInfrared,
  updateThermalState,
} from './thermal-state';
import {
  THERMAL_INK_SXOM_BPM,
  THERMAL_INK_SXOM_INK_WINDOWS,
  THERMAL_INK_SXOM_MARKERS,
  THERMAL_INK_SXOM_SCORE_SECTIONS,
  THERMAL_INK_SXOM_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const thermalInkSxomLevel: LevelDefinition = {
  id: 'thermal-ink-sxom',
  title: 'Thermal Ink',
  description: 'Circle a harbor-sized mutant octopus, switch to infrared inside its ink, and sever it arm by arm.',
  bpm: THERMAL_INK_SXOM_BPM,
  markers: THERMAL_INK_SXOM_MARKERS,
  sections: THERMAL_INK_SXOM_SCORE_SECTIONS.map((section) => ({
    name: section.index,
    time: THERMAL_INK_SXOM_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x120b07,
    bloom: { strength: 0.82, threshold: 0.64, radius: 0.16 },
    vignette: { inner: 0.29, outer: 1.08, strength: 0.76 },
    composeOutput: composeThermalInkOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    resetThermalState();
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let elapsedNow = 0;
    let runTime = 0;
    let calloutUntil = -1;
    let activeInkIndex = -1;
    let nextInkIndex = 0;
    let armBreaks = 0;
    const armIds = new Set<number>();
    let coreId = -1;

    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = elapsedNow + seconds;
    };

    const gameplay = createThermalInkSxomGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: gameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    const switchVision = () => {
      if (game.state !== 'running') return;
      const infrared = toggleInfrared();
      say(infrared ? 'INFRARED // HEAT ACQUIRED' : 'NORMAL OPTICS // SODIUM MURK', 1.8);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key !== 'e' && key !== 'i') return;
      event.preventDefault();
      switchVision();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) switchVision();
    };
    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      switchVision();
    };
    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('dblclick', onDoubleClick);

    bus.on('runstart', () => {
      resetThermalState();
      if (debugValue === 'infrared') setInfrared(true);
      runTime = 0;
      activeInkIndex = -1;
      nextInkIndex = 0;
      armBreaks = 0;
      armIds.clear();
      coreId = -1;
      say('E / I / RIGHT CLICK // TOGGLE INFRARED', 4.2);
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'arm') armIds.add(enemyId);
      if (kind === 'core') coreId = enemyId;
    });
    bus.on('kill', ({ enemyId }) => {
      if (armIds.delete(enemyId)) {
        armBreaks += 1;
        say(`ARM ${String(armBreaks).padStart(2, '0')} / 08 SEVERED`, 1.25);
      }
      if (enemyId === coreId) {
        setInfrared(false);
        say('CORE COLD // HARBOR LIGHTS RETURN', 4.5);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THERMAL MASS // EIGHT SIGNAL KNOTS', 2.8);
      if (phase === 'exposed') say('CENTRAL CORE EXPOSED', 2.7);
      if (phase === 'destroyed') {
        setInfrared(false);
        say('THERMAL SILHOUETTE COLLAPSING', 4);
      }
    });

    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        const wasRunning = game.state === 'running';
        if (wasRunning) runTime += dt;
        updateThermalState(dt, runTime, wasRunning);

        if (wasRunning && nextInkIndex < THERMAL_INK_SXOM_INK_WINDOWS.length) {
          const next = THERMAL_INK_SXOM_INK_WINDOWS[nextInkIndex];
          if (runTime >= next.start - 0.45) {
            activeInkIndex = nextInkIndex;
            nextInkIndex += 1;
            say(`${next.label} // E: INFRARED`, activeInkIndex === 3 ? 4.2 : 3);
          }
        }
        if (activeInkIndex >= 0) {
          const window = THERMAL_INK_SXOM_INK_WINDOWS[activeInkIndex];
          if (runTime >= window.end && runTime < window.end + dt * 1.5) {
            say(
              thermalState().infrared
                ? 'INK THINNING // E: NORMAL OPTICS'
                : 'VISIBILITY RETURNING',
              2.1,
            );
          }
        }

        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running: game.state === 'running',
        });

        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
      },
      dispose() {
        window.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('dblclick', onDoubleClick);
        camera.fov = 62;
        camera.updateProjectionMatrix();
        disposeVisuals();
        game.dispose();
      },
    };
  },
};
