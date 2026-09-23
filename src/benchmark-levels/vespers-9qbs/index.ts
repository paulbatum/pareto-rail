import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createAutopilot } from './debug';
import { createVespersGameplay, VESPERS_BPM } from './gameplay';
import { VESPERS_MARKERS, VESPERS_RUN_SECTIONS, VESPERS_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  previewRelitWindows,
  previewRoseIgnition,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateAttractCamera,
  updateCameraEffects,
  updateVisuals,
} from './visuals';
import { composeVespersOutput } from './visuals/post-fx';

export const vespersLevel: LevelDefinition = {
  id: 'vespers-9qbs',
  title: 'Vespers',
  description: 'Fly the nave of a cathedral at night and win its light back, window by window, to the building\'s own organ.',
  bpm: VESPERS_BPM,
  markers: VESPERS_MARKERS,
  sections: VESPERS_RUN_SECTIONS.map((section) => ({ name: section.name, time: VESPERS_TIME.bar(section.fromBar) })),
  // Snapshots cannot shoot, so these previews fake the visual consequences.
  debugSelector: {
    queryParam: 'rose',
    label: 'Preview',
    options: [
      { id: 'burn', title: 'Ignite the rose at bar 19' },
      { id: 'lit', title: 'Relight windows as creatures appear' },
      { id: 'heart', title: 'Tear the heart loose at bar 16' },
      { id: 'autoplay', title: 'Autoplay with perfect aim' },
    ],
  },
  post: {
    clearColor: 0x000000,
    bloom: { strength: 0.95, threshold: 0.66, radius: 0.12 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.72 },
    composeOutput: composeVespersOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);
    if (debugValue === 'burn') previewRoseIgnition(VESPERS_TIME.bar(19));
    if (debugValue === 'lit') previewRelitWindows();

    // Narration: a few words at the turns of the piece. Gameplay owns the
    // fight; this only listens.
    let now = 0;
    let runTime = 0;
    let calloutUntil = -1;
    let burned = false;
    let escapedSaid = false;
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      runTime = 0;
      burned = false;
      escapedSaid = false;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE WEST ROSE', 2.6);
      if (phase === 'exposed') say('BREAK IT OPEN', 2.2);
      if (phase === 'destroyed') {
        burned = true;
        say('THE ROSE BURNS', 4);
      }
    });

    const gameplay = createVespersGameplay(bus, debugValue === 'heart' ? VESPERS_TIME.bar(16) : -1);
    const pilot = debugValue === 'autoplay' ? createAutopilot(bus, scene, camera, canvas) : null;
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: {
        ...gameplay,
        updateCameraEffects({ camera: runCamera, runTime: time, dt }) {
          updateCameraEffects({ camera: runCamera, runTime: time, dt, running: true });
        },
        updateAttractCamera({ camera: attractCamera, modeTime }) {
          updateAttractCamera(attractCamera, modeTime);
        },
      },
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
        now = elapsed;
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          if (!burned && !escapedSaid && runTime >= VESPERS_MARKERS.deadline) {
            escapedSaid = true;
            say('THE DARK KEEPS IT', 3);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        pilot?.update(game.state === 'running');
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
