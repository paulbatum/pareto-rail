import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel, type CameraFeelShakeOptions } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { MathUtils } from 'three';
import { createAudio } from './audio';
import { createCameraDirector, PULL_SECONDS, vistaWeight } from './camera';
import { createStrandlineGameplay, STRANDLINE_BPM } from './gameplay';
import { bar, STRANDLINE_DURATION, STRANDLINE_MARKERS, STRANDLINE_RUN_SECTIONS, STRANDLINE_TIME } from './timing';
import { createStrandlineVisuals } from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.6,
  pitchDegrees: 0.34,
  yawDegrees: 0.28,
  rollDegrees: 0.8,
  frequency: 8,
  smoothing: 20,
};

export const strandlineLevel: LevelDefinition = {
  id: 'strandline-2nqi',
  title: 'Strandline',
  description: 'Free a colossal jellyfish from its parasites: thread its glowing tentacles, swing wide under the bell, and tear the parent loose from the crown.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({ name: section.name, time: STRANDLINE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x06213a,
    bloom: { strength: 0.5, threshold: 0.86, radius: 0.5 },
    vignette: { inner: 0.4, outer: 1.15, strength: 0.5 },
    composeOutput: composeStrandlineOutput,
  },
  debugSelector: {
    queryParam: 'debugBoss',
    label: 'Parent',
    options: [
      { id: 'exposed', title: 'Bare from the start' },
      { id: 'freed', title: 'Lets go at once' },
    ],
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    // The water is deep and the animal is enormous: push the far plane out.
    camera.near = 0.2;
    camera.far = 3200;
    camera.updateProjectionMatrix();

    const feel = createCameraFeel(camera);
    const gameplay = createStrandlineGameplay(bus, debugValue === 'exposed' || debugValue === 'freed' ? debugValue : undefined);
    const rail = gameplay.createRail();
    const visuals = createStrandlineVisuals(scene, bus, camera, feel, () => gameplay.boss.freedBy());
    const director = createCameraDirector(camera, rail, feel);

    // Narration: a few words at the moments the run turns.
    let now = 0;
    let runTime = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timed = [
      { at: bar(7.85), text: 'THE BELL', hold: 2.6 },
      { at: bar(9.55), text: 'BACK INTO THE STRANDS', hold: 2 },
    ];
    let nextTimed = 0;
    bus.on('runstart', () => {
      runTime = 0;
      nextTimed = 0;
      calloutUntil = -1;
      hud.setCallout('');
      director.beginRun();
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE PARENT — CLEAR ITS BROODS', 3.2);
      else if (phase === 'exposed') say('BARE — TEAR IT LOOSE', 3);
      else if (phase === 'destroyed') say(gameplay.boss.freedBy() === 'kill' ? 'THE ANIMAL DRIFTS ON' : 'IT LETS GO', 5);
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
      level: {
        ...gameplay,
        updateCameraEffects({ dt, runTime: time }) {
          director.update(dt, time, gameplay.boss.freedAt() ?? -1);
          feel.update(dt, { shake: SHAKE });
        },
      },
      visuals: {
        createEnemyMesh: visuals.createEnemyMesh,
        setEnemyLocked: visuals.setEnemyLocked,
        setEnemyDenied: visuals.setEnemyDenied,
        createProjectileMesh: visuals.createProjectileMesh,
        createReticle: visuals.createReticle,
        setReticleActive: visuals.setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        const state = game.state;
        const running = state === 'running';
        if (running) {
          runTime = Math.min(STRANDLINE_DURATION, runTime + dt);
          while (nextTimed < timed.length && runTime >= timed[nextTimed].at) {
            say(timed[nextTimed].text, timed[nextTimed].hold);
            nextTimed += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        if (state === 'ended' && (gameplay.boss.freedAt() ?? -1) >= 0) director.drift(dt);
        game.update(dt);

        const freedAt = gameplay.boss.freedAt() ?? -1;
        const sinceFree = freedAt >= 0 ? runTime - freedAt : -1;
        const cleanse = sinceFree >= 0 ? MathUtils.smoothstep(sinceFree, 0, 6) : 0;
        const reveal = sinceFree >= 0 ? MathUtils.smoothstep(sinceFree / PULL_SECONDS, 0.05, 0.85) : 0;
        visuals.update(dt, {
          running,
          runTime,
          elapsed,
          vista: running ? vistaWeight(runTime) : 0,
          reveal: state === 'ended' && freedAt >= 0 ? 1 : reveal,
          cleanse: state === 'ended' && freedAt >= 0 ? 1 : cleanse,
        });
      },
      dispose() {
        feel.dispose();
        visuals.dispose();
        game.dispose();
      },
    };
  },
};
