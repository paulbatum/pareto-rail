import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createCameraDirector } from './camera';
import { createBroadsideTlluGameplay, HEART_DEADLINE } from './gameplay';
import { BARS, BROADSIDE_TLLU_BPM, BROADSIDE_TLLU_MARKERS, BROADSIDE_TLLU_SECTIONS, BROADSIDE_TLLU_TIME } from './timing';
import {
  bindCallouts,
  composeBroadsideOutput,
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

export const broadsideTlluLevel: LevelDefinition = {
  id: 'broadside-tllu',
  title: 'Broadside',
  description: 'Launch from your flagship into a full fleet engagement, fly the gaps between cruisers, and destroy the enemy flagship.',
  bpm: BROADSIDE_TLLU_BPM,
  markers: BROADSIDE_TLLU_MARKERS,
  sections: BROADSIDE_TLLU_SECTIONS.map((section) => ({ name: section.name, time: BROADSIDE_TLLU_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x020104,
    bloom: { strength: 0.85, threshold: 0.78, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.66 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const director = createCameraDirector(feel);
    createEnvironment(scene, camera);

    // Narration: set pieces get names. The score and the rail own the pacing; this only watches the clock.
    let now = 0;
    let runTime = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const say = (text: string, hold = 2.2) => {
      hud.setCallout(text);
      calloutUntil = now + hold;
    };
    const bar = (value: number) => BROADSIDE_TLLU_TIME.bar(value);
    const timed = [
      { at: bar(0.2), text: 'LAUNCH — FLY THE GAPS', hold: 2.6 },
      { at: bar(BARS.crossfirePush - 0.1), text: 'CROSSFIRE', hold: 2.0 },
      { at: bar(BARS.flank + 0.1), text: 'BROADSIDE — RUN THE FLANK', hold: 2.4 },
      { at: bar(BARS.eye + 0.1), text: 'THE EYE OF THE BATTLE', hold: 2.6 },
      { at: bar(BARS.belly + 0.1), text: 'ENEMY WARSHIP — RAKE HER TURRETS', hold: 2.6 },
      { at: bar(BARS.flagship + 0.1), text: 'THE FLAGSHIP — BREAK THE SHIELD GENERATORS', hold: 2.8 },
    ];
    installVisualEventHandlers(bus, feel, () => director.beginFinale());
    // Boss progress: name each blow so the fight reads as a checklist the player is working through.
    const bossKinds = new Map<number, string>();
    let gensDown = 0;
    let coresDown = 0;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'gen' || kind === 'core' || kind === 'heart') bossKinds.set(enemyId, kind);
    });
    bus.on('kill', ({ enemyId }) => {
      const kind = bossKinds.get(enemyId);
      if (kind === 'gen') say(`SHIELD GENERATOR ${++gensDown}/4 DESTROYED`, 1.5);
      else if (kind === 'core') say(`REACTOR CORE ${++coresDown}/2 DESTROYED`, 1.5);
    });
    bus.on('stage', ({ enemyId }) => {
      if (bossKinds.get(enemyId) === 'heart') say('ARMOR BREACHED — HIT THE REACTOR', 1.6);
    });
    bus.on('runstart', () => {
      bossKinds.clear();
      gensDown = 0;
      coresDown = 0;
    });
    bus.on('volley', ({ size, kills }) => {
      if (size >= 6 && kills >= 6 && calloutUntil - now < 0.5) say('FULL SALVO +600', 1.0);
    });
    bindCallouts(say);
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      director.reset();
      hud.setCallout('');
    });

    const gameplay = createBroadsideTlluGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip} • Shoot down crimson plasma. Fly the gaps.`,
      level: {
        ...gameplay,
        updateCameraEffects({ camera: cam, curve, runTime: time, runProgress, dt }) {
          director.update({ camera: cam, curve, runTime: time, runProgress, dt });
        },
      },
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (nextCallout < timed.length && runTime >= timed[nextCallout].at) {
            say(timed[nextCallout].text, timed[nextCallout].hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          hud.setCallout('');
          calloutUntil = -1;
        }
        game.update(dt);
        updateVisuals({ dt, elapsed, runTime: Math.min(runTime, HEART_DEADLINE + 10), running, camera });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        feel.dispose();
        hud.setCallout('');
      },
    };
  },
};
