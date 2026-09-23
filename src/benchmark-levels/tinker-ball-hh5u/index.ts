import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { onTinker } from './channel';
import { createTinkerBallHh5uGameplay, TINKER_BPM } from './gameplay';
import { TINKER_BARS, TINKER_MARKERS, TINKER_RUN_SECTIONS, TINKER_TIME } from './timing';
import { createTinkerVisuals } from './visuals';
import { CLEAR } from './visuals/palette';
import { composeTinkerOutput, lensGlue, warmFlash } from './visuals/post-fx';

export const tinkerBallHh5uLevel: LevelDefinition = {
  id: 'tinker-ball-hh5u',
  title: 'Tinker Ball',
  description: 'Roll up a glue-monster infestation across one enormous worktable, from marble to melon.',
  bpm: TINKER_BPM,
  markers: TINKER_MARKERS,
  sections: TINKER_RUN_SECTIONS.map((section) => ({ name: section.name, time: TINKER_TIME.bar(section.fromBar) })),
  post: {
    clearColor: CLEAR,
    bloom: { strength: 0.55, threshold: 0.95, radius: 0.22 },
    vignette: { inner: 0.4, outer: 1.15, strength: 0.6 },
    composeOutput: composeTinkerOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const gameplay = createTinkerBallHh5uGameplay(bus);
    const visuals = createTinkerVisuals(scene, bus, gameplay);

    // Narration: size-ups and the spill get names; gameplay owns the fight.
    let now = 0;
    let runTime = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timed = [
      { bar: TINKER_BARS.growTennis - 0.1, text: 'SIZE UP · TENNIS BALL', hold: 2.2 },
      { bar: TINKER_BARS.growMelon - 0.1, text: 'SIZE UP · MELON', hold: 2.2 },
      { bar: TINKER_BARS.spillReveal, text: 'THE SPILL', hold: 2.4 },
    ];
    let nextTimed = 0;
    bus.on('runstart', () => {
      runTime = 0;
      nextTimed = 0;
      calloutUntil = -1;
      hud.setCallout('');
      lensGlue.value = 0;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('CRACK THE HEART', 2.4);
      if (phase === 'destroyed') say('SPOTLESS!', 3.2);
    });

    // Feel: kills tick the camera, a full six-lock volley and every size-up
    // punch the lens; a glob on the lens is the one hard shake.
    bus.on('kill', ({ indexInVolley }) => {
      feel.shake(0.12 + (indexInVolley ?? 0) * 0.03, { decay: 3.2 });
    });
    bus.on('volley', ({ size, kills }) => {
      if (size === 6 && kills === 6) {
        feel.kickFov(3.2, { decay: 3 });
        warmFlash.value = Math.max(warmFlash.value, 0.5);
      }
    });
    bus.on('playerhit', () => {
      feel.shake(0.8, { decay: 1.8 });
      lensGlue.value = 1;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') {
        feel.kickFov(5, { decay: 1.6 });
        feel.shake(0.6, { decay: 1.4 });
        warmFlash.value = 1;
      }
    });
    onTinker(bus, 'tinker:grow', () => {
      feel.kickFov(-4.5, { decay: 2.2 });
      feel.shake(0.35, { decay: 2 });
      warmFlash.value = Math.max(warmFlash.value, 0.7);
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
      level: gameplay,
      visuals: visuals.factories,
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextTimed < timed.length && runTime >= TINKER_TIME.bar(timed[nextTimed].bar)) {
            say(timed[nextTimed].text, timed[nextTimed].hold);
            nextTimed += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        visuals.update(dt, { camera, elapsed, mode: game.state, runTime });
        lensGlue.value = Math.max(0, lensGlue.value - dt * 0.45);
        warmFlash.value = Math.max(0, warmFlash.value - dt * 1.4);
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
