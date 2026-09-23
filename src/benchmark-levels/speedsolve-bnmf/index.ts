import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import { onCubeSignal } from './signals';
import { SPEEDSOLVE_BPM, SPEEDSOLVE_MARKERS, SPEEDSOLVE_SECTIONS, SPEEDSOLVE_TIME } from './timing';
import { createSpeedsolveVisuals } from './visuals';
import { FACE_NAMES, VOID } from './visuals/palette';

export const speedsolveLevel: LevelDefinition = {
  id: 'speedsolve-bnmf',
  title: 'Speedsolve',
  description: 'A one-minute boss fight against a colossal puzzle cube: shoot its rows into place on the beat, face by face, down to the naked core.',
  bpm: SPEEDSOLVE_BPM,
  markers: SPEEDSOLVE_MARKERS,
  sections: SPEEDSOLVE_SECTIONS.map((section) => ({ name: section.name, time: SPEEDSOLVE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: VOID.getHex(),
    // The shared post passes `threshold` into BloomNode's radius slot and
    // `radius` into its threshold slot. On a pale void that matters: the
    // luminance cut must sit above the background (~0.9), so the cut lives in
    // `radius` here and the spread in `threshold`.
    bloom: { strength: 0.7, threshold: 0.22, radius: 1.0 },
    vignette: { inner: 0.5, outer: 1.3, strength: 0.22 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const gameplay = createSpeedsolveGameplay(bus);
    const feel = createCameraFeel(camera);
    const visuals = createSpeedsolveVisuals(scene, bus, gameplay, feel);

    // The speedcubing timer: every hand-solved face posts its time.
    let now = 0;
    let calloutUntil = -1;
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = now + seconds;
    };
    const offSignals = onCubeSignal((signal) => {
      if (signal.type === 'solved') say(signal.auto ? `${FACE_NAMES[signal.face]} · AUTO` : `${FACE_NAMES[signal.face]} · ${signal.seconds.toFixed(2)}s`, 1.6);
      if (signal.type === 'shell') say('NAKED CORE', 1.8);
      if (signal.type === 'burst') say(signal.destroyed ? 'SOLVED' : 'CORE LOST', 2.6);
    });
    const offRunStart = bus.on('runstart', () => {
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
      level: gameplay,
      visuals: visuals.factories,
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        visuals.beforeRunner(dt, camera, game.state === 'ended');
        game.update(dt);
        visuals.update(dt, { camera, elapsed, running: game.state === 'running' });
        if (calloutUntil >= 0 && now >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
      },
      dispose() {
        offSignals();
        offRunStart();
        visuals.dispose();
        feel.dispose();
        game.dispose();
      },
    };
  },
};
