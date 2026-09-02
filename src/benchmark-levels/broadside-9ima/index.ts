import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BROADSIDE_9IMA_BPM, broadside9imaGameplay, broadsideSpeed } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  post,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const broadside9imaLevel: LevelDefinition = {
  id: 'broadside-9ima',
  title: 'Broadside',
  description:
    'A 60-second fleet engagement scored for full orchestra. Launch off your flagship into crossfire between kilometer-long capital ships, run the flank of a friendly cruiser as its broadsides light off overhead, rake an enemy warship belly, and assault the enemy flagship across dual phases.',
  bpm: BROADSIDE_9IMA_BPM,
  post,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: broadside9imaGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    let currentRunTime = 0;
    bus.on('runstart', () => {
      currentRunTime = 0;
    });

    return {
      update(dt) {
        currentRunTime += dt;
        const factor = broadsideSpeed.speedAt(currentRunTime);
        game.update(dt);
        updateVisuals(dt, currentRunTime, factor);
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
