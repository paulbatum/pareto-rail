import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { DOWNPOUR_BPM, DOWNPOUR_MARKERS, downpourGameplay } from './gameplay';
import { DOWNPOUR_SECTIONS, DOWNPOUR_TIME } from './timing';
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
  disposeEnvironment,
} from './visuals';

export const downpourHlhtLevel: LevelDefinition = {
  id: 'downpour-hlht',
  title: 'Downpour',
  description: 'A courier drone dives through a rain-neon megacity while a green hunter-gunship closes in.',
  bpm: DOWNPOUR_BPM,
  markers: DOWNPOUR_MARKERS,
  sections: DOWNPOUR_SECTIONS.map((section) => ({ name: section.name, time: DOWNPOUR_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x02050b,
    bloom: { strength: 0.96, threshold: 0.64, radius: 0.18 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.7 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);
    let runTime = 0;
    let running = false;
    let nextCallout = 0;
    const callouts = [
      { at: DOWNPOUR_MARKERS.firstDrop - 1.2, text: 'DROP THROUGH THE STORM' },
      { at: DOWNPOUR_MARKERS.secondDrop - 0.7, text: 'CANAL BREACH' },
      { at: DOWNPOUR_MARKERS.hunt, text: 'HUNTER LOCKED' },
      { at: DOWNPOUR_MARKERS.release, text: 'ABOVE THE WEATHER' },
    ];
    bus.on('runstart', () => { runTime = 0; running = true; nextCallout = 0; });
    bus.on('runend', () => { running = false; });
    bus.on('playerhit', () => feel.shake(0.72, { decay: 2.4, pitchDegrees: 1.1, yawDegrees: 0.9, rollDegrees: 1.8 }));

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: downpourGameplay,
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
        game.update(dt);
        if (running && game.state === 'running') {
          const before = runTime; runTime += dt;
          while (nextCallout < callouts.length && before < callouts[nextCallout].at && runTime >= callouts[nextCallout].at) {
            hud.setCallout(callouts[nextCallout].text); nextCallout += 1;
          }
          if (nextCallout > 0 && runTime > (callouts[nextCallout - 1]?.at ?? 0) + 2.1) hud.setCallout('');
          if ((before < DOWNPOUR_MARKERS.firstDrop && runTime >= DOWNPOUR_MARKERS.firstDrop) || (before < DOWNPOUR_MARKERS.secondDrop && runTime >= DOWNPOUR_MARKERS.secondDrop)) feel.kickFov(10, { decay: 1.7 });
          if (before < DOWNPOUR_MARKERS.hunt && runTime >= DOWNPOUR_MARKERS.hunt) feel.kickFov(5, { decay: 2.3 });
        }
        updateVisuals(dt, { camera, elapsed, runTime, running: running && game.state === 'running' });
        feel.update(dt, { shake: { maxTrauma: 1, decay: 2.5, pitchDegrees: 0.85, yawDegrees: 0.7, rollDegrees: 1.25, frequency: 11 } });
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeEnvironment();
      },
    };
  },
};
