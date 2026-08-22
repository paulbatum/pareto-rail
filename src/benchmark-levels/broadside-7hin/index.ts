import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { vec4 } from 'three/tsl';
import { createAudio } from './audio';
import {
  BROADSIDE_7HIN_BPM,
  BROADSIDE_7HIN_MARKERS,
  BROADSIDE_7HIN_RUN_DURATION,
  BROADSIDE_7HIN_SECTIONS,
  createBroadsideGameplay,
} from './gameplay';
import { finaleFlash, updateVisuals } from './visuals';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
} from './visuals';
import { BROADSIDE_7HIN_TIME } from './timing';

export const broadsideLevel: LevelDefinition = {
  id: 'broadside-7hin',
  title: 'Broadside',
  description: 'A sixty-second run across a full fleet engagement: launch off your flagship, corkscrew the crossfire, ride a cruiser’s broadside, rake an enemy keel, and dive the flagship’s trench.',
  bpm: BROADSIDE_7HIN_BPM,
  markers: { ...BROADSIDE_7HIN_MARKERS },
  sections: BROADSIDE_7HIN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_7HIN_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x050208,
    bloom: { strength: 0.72, threshold: 0.62, radius: 0.12 },
    vignette: { inner: 0.32, outer: 1.0, strength: 0.48 },
    composeOutput({ base }) {
      // Finale flash only: gold-white bloom as the flagship breaks apart.
      return base.add(vec4(1.0, 0.82, 0.55, 0).mul(finaleFlash));
    },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss narration, space-opera style.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELDS DOWN', 2.4);
      if (phase === 'destroyed') say('FLAGSHIP DESTROYED', 3);
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
      level: createBroadsideGameplay(bus),
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
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
