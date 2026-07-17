import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_BPM, prismGameplay } from './gameplay';
import { PRISM_MARKERS, PRISM_ARRANGEMENT_SECTIONS, PRISM_TIME } from './timing';
import { createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive, updateVisuals, disposeEnvironment } from './visuals';

export const prismWarmPalette8q3kLevel: LevelDefinition = {
  id: 'prism-warm-palette-8q3k',
  title: 'Prism Warm Palette',
  description: 'A warm luminous Prism Bloom passage of amber, coral, cream, and gold.',
  bpm: PRISM_BPM,
  markers: PRISM_MARKERS,
  sections: PRISM_ARRANGEMENT_SECTIONS.map((section) => ({ name: section.name, time: PRISM_TIME.bar(section.fromBar) })),
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, level: prismGameplay,
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive } });
    return { update(dt, elapsed) { game.update(dt); updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress }); feel.update(dt); }, dispose() { game.dispose(); feel.dispose(); disposeEnvironment(); } };
  },
};
