import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createTinkerGameplay, TINKER_BPM } from './gameplay';
import { tinkerPost } from './post-fx';
import { TINKER_MARKERS, TINKER_RUN_SECTIONS, TINKER_TIME } from './timing';
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

const TINKER_CAMERA_SHAKE = {
  decay: 2.6,
  maxTrauma: 1.4,
  pitchDegrees: 0.3,
  yawDegrees: 0.24,
  rollDegrees: 0.7,
  frequency: 8.5,
  smoothing: 20,
};

export const tinkerBallLevel: LevelDefinition = {
  id: 'tinker-ball-6fh9',
  title: 'Tinker Ball',
  description: 'Roll the worktable clean: crack the glue cores, rescue the supplies.',
  bpm: TINKER_BPM,
  markers: { ...TINKER_MARKERS, boss: TINKER_MARKERS.bossEntrance },
  sections: TINKER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_TIME.bar(section.fromBar),
  })),
  post: tinkerPost,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss beat callouts: gameplay owns the fight, this narrates it.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE GLUE SPILL', 2.6);
      if (phase === 'exposed') say('HEART EXPOSED', 2.6);
      if (phase === 'destroyed') say('TABLE CLEAN!', 3.2);
    });
    bus.on('playerhit', () => feel.shake(1.1, TINKER_CAMERA_SHAKE));
    bus.on('volley', ({ kills, size }) => {
      if (kills >= 4 && kills >= size) feel.kickFov(3.2);
    });
    bus.on('kill', () => feel.shake(0.16, TINKER_CAMERA_SHAKE));
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') feel.shake(1.3, TINKER_CAMERA_SHAKE);
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      feel.restore();
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
      level: createTinkerGameplay(bus),
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
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        feel.update(dt, { shake: TINKER_CAMERA_SHAKE });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
