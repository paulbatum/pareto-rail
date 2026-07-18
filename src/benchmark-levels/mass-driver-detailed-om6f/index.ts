import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import { composeMassDriverOutput } from './post-fx';
import { onSignal } from './state';
import { MD_BPM, MD_MARKERS, MD_RUN_SECTIONS, MD_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  spawnDetonation,
  spawnMuzzleFlash,
  updateVisuals,
} from './visuals';

// A metallic gun-barrel rattle: quick and tight, more roll than pitch, so the
// whole barrel rings rather than the camera taking a soft impact.
const BARREL_RATTLE = {
  decay: 4.6,
  pitchDegrees: 0.24,
  yawDegrees: 0.2,
  rollDegrees: 1.6,
  frequency: 17,
  smoothing: 30,
};

export const massDriverDetailedOm6fLevel: LevelDefinition = {
  id: 'mass-driver-detailed-om6f',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MD_BPM,
  markers: MD_MARKERS,
  sections: MD_RUN_SECTIONS.map((section) => ({ name: section.name, time: MD_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x000508,
    // Restrained: the glow lives on thin lines and small cores, under a soft
    // vignette so the charge bloom has somewhere to build.
    bloom: { strength: 0.9, threshold: 0.62, radius: 0.42 },
    vignette: { inner: 0.3, outer: 1.05, strength: 0.6 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Timed callouts frame the deadline; gameplay owns when they fire, this
    // just puts them on the HUD and clears them again.
    let calloutUntil = -1;
    let now = 0;

    const offSignal = onSignal((signal) => {
      if (signal.type === 'callout') {
        hud.setCallout(signal.text);
        calloutUntil = now + signal.seconds;
        return;
      }
      if (signal.type === 'shot') {
        // THE SHOT: a wide FOV punch, a heavy shake, a muzzle flash.
        feel.kickFov(19, { decay: 1.5 });
        feel.shake(1);
        spawnMuzzleFlash(camera);
        return;
      }
      if (signal.type === 'detonation') {
        feel.kickFov(-7, { decay: 2.2 });
        feel.shake(1);
        spawnDetonation(camera);
      }
    });

    bus.on('runstart', () => {
      calloutUntil = -1;
      hud.setCallout('');
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
      level: createMassDriverGameplay(bus),
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
        updateVisuals(dt, { scene, camera, feel, elapsed });
        feel.update(dt, { shake: BARREL_RATTLE });
      },
      dispose() {
        offSignal();
        feel.dispose();
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
