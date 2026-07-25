import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { thermalInkT6nvGameplay } from './gameplay';
import { THERMAL_INK_T6NV_BPM, THERMAL_INK_T6NV_MARKERS, THERMAL_INK_T6NV_SECTIONS, THERMAL_INK_T6NV_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';
import { composeThermalInkOutput } from './visuals/post-fx';

export const thermalInkT6nvLevel: LevelDefinition = {
  id: 'thermal-ink-t6nv',
  title: 'Thermal Ink',
  description: 'Strike through black ink blackout clouds using stark infrared thermal vision against a giant harbor mutant octopus.',
  bpm: THERMAL_INK_T6NV_BPM,
  markers: THERMAL_INK_T6NV_MARKERS,
  sections: THERMAL_INK_T6NV_SECTIONS.map((sec) => ({
    name: sec.name,
    time: THERMAL_INK_T6NV_TIME.bar(sec.bar),
  })),
  post: {
    clearColor: 0x080605,
    bloom: { strength: 1.1, threshold: 0.55, radius: 0.2 },
    vignette: { inner: 0.3, outer: 1.0, strength: 0.6 },
    composeOutput: composeThermalInkOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let manualIrToggle = false;
    let coreExposed = false;

    // Keyboard & Mouse inputs for manual Infrared Vision toggle (Space / Right-Click)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        manualIrToggle = !manualIrToggle;
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      manualIrToggle = !manualIrToggle;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenu);

    const levelAudio = createAudio(bus);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: thermalInkT6nvGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        if (game.state === 'running') {
          runTime += dt;
        } else {
          runTime = 0;
        }

        // Determine Ink Cloud blackout windows (Bar 9-13, Bar 19-23, Bar 25-28)
        const bar9Time = THERMAL_INK_T6NV_TIME.bar(9);
        const bar13Time = THERMAL_INK_T6NV_TIME.bar(13);
        const bar19Time = THERMAL_INK_T6NV_TIME.bar(19);
        const bar23Time = THERMAL_INK_T6NV_TIME.bar(23);
        const bar24Time = THERMAL_INK_T6NV_TIME.bar(24);
        const bar25Time = THERMAL_INK_T6NV_TIME.bar(25);
        const bar28Time = THERMAL_INK_T6NV_TIME.bar(28);

        const inInk1 = runTime >= bar9Time && runTime < bar13Time;
        const inInk2 = runTime >= bar19Time && runTime < bar23Time;
        const inInk3 = runTime >= bar25Time && runTime < bar28Time;
        const inInkCloud = inInk1 || inInk2 || inInk3;

        const inkAmount = inInkCloud ? 1.0 : 0.0;
        coreExposed = runTime >= bar24Time;

        // Auto-engage Infrared when inside ink clouds or if player manually toggled
        const irActive = inInkCloud || manualIrToggle;

        // Sync Audio IR mode filter & HUD callout
        levelAudio.setInfraredMode(irActive);

        if (game.state === 'running') {
          if (inInk1 && runTime < bar9Time + 2.5) {
            hud.setCallout('INK BLACKOUT — INFRARED ENGAGED');
          } else if (inInk2 && runTime < bar19Time + 2.5) {
            hud.setCallout('DENSE INK STORM — THERMAL TARGETING');
          } else if (coreExposed && runTime < bar24Time + 2.5) {
            hud.setCallout('CORE EXPOSED — PREPARE FINAL STRIKE');
          } else if (inInk3 && runTime < bar25Time + 2.5) {
            hud.setCallout('FINAL INK BLACKOUT — STRIKE THE CORE');
          } else if (!inInkCloud && runTime > bar13Time && runTime < bar13Time + 2.0) {
            hud.setCallout('VISIBILITY RESTORED');
          }
        }

        game.update(dt);
        updateVisuals(dt, {
          elapsed,
          runTime,
          running: game.state === 'running',
          irActive,
          inkAmount,
          coreExposed,
        });
      },
      dispose() {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('contextmenu', onContextMenu);
        game.dispose();
      },
    };
  },
};
