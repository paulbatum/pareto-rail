import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { VESPERS_NOLZ_BPM, vespersNolzGameplay } from './gameplay';
import { createVisuals } from './visuals';

export const vespersNolzLevel: LevelDefinition = {
  id: 'vespers-nolz', title: 'Vespers',
  description: 'Return stolen colour to a midnight cathedral. A sixty-second organ nocturne, ending at the dead rose window.',
  bpm: VESPERS_NOLZ_BPM,
  post: { clearColor: 0x020309, bloom: { strength: 0.48, threshold: 0.85, radius: 0.25 }, vignette: { inner: 0.38, outer: 1.2, strength: 0.45 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const visuals = createVisuals(scene, camera, bus);
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, level: vespersNolzGameplay, visuals });
    return {
      update(dt) { game.update(dt); visuals.update(dt); },
      dispose() { game.dispose(); visuals.dispose(); },
    };
  },
};
