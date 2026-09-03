import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  VESPERS_DADE_BARS,
  VESPERS_DADE_BPM,
  VESPERS_DADE_MARKERS,
  VESPERS_DADE_TIME,
  vespersDadeGameplay,
} from './gameplay';
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

export const vespersDadeLevel: LevelDefinition = {
  id: 'vespers-dade',
  title: 'Vespers',
  description: 'Fly the nave of a black cathedral while something eats the light out of it. Win every window back, then break open the rose.',
  bpm: VESPERS_DADE_BPM,
  markers: { ...VESPERS_DADE_MARKERS },
  sections: [
    { name: 'pedal-solo', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.run) },
    { name: 'second-voice', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.secondVoice) },
    { name: 'third-voice', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.thirdVoice) },
    { name: 'choir-full', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.choir) },
    { name: 'dark-span', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.darkSpan) },
    { name: 'finale', time: VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.boss) },
  ],
  post: {
    clearColor: 0x020208,
    bloom: { strength: 0.6, threshold: 0.7, radius: 0.2 },
    vignette: { inner: 0.25, outer: 1.05, strength: 0.65 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('spawn', ({ kind }) => {
      if (kind === 'eater') say('THE EATER OF LIGHT', 3.0);
    });
    bus.on('kill', () => {
      // The rose ignition callout is timed by the finale itself.
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: vespersDadeGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    // Celebrate the rose ignition with a named moment.
    let roseSaid = false;
    bus.on('runstart', () => {
      roseSaid = false;
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        // When the run ends in a lit cathedral, name it.
        if (!roseSaid && game.runProgress > 0.985) {
          roseSaid = true;
          say('THE ROSE BURNS', 3.0);
        }
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
