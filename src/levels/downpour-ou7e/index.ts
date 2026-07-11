import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { DOWNPOUR_OU7E_BPM, DOWNPOUR_OU7E_TIME, downpourOu7eGameplay } from './gameplay';
import { createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive, updateVisuals } from './visuals';

export const downpourOu7eLevel: LevelDefinition = {
  id: 'downpour-ou7e', title: 'Downpour', description: 'Run the black-channel courier route before an acid-green hunter gunship closes the city.', bpm: DOWNPOUR_OU7E_BPM,
  markers: { 'tower-drop': DOWNPOUR_OU7E_TIME.bar(10), 'avenue-drop': DOWNPOUR_OU7E_TIME.bar(20), 'undercity': DOWNPOUR_OU7E_TIME.bar(28), 'canal-moon': DOWNPOUR_OU7E_TIME.bar(33), 'hunter': DOWNPOUR_OU7E_TIME.bar(36), 'cloud-release': DOWNPOUR_OU7E_TIME.bar(42) },
  sections: [
    { name: 'storm ceiling', time: DOWNPOUR_OU7E_TIME.bar(0) }, { name: 'tower descent', time: DOWNPOUR_OU7E_TIME.bar(10) },
    { name: 'avenue drop', time: DOWNPOUR_OU7E_TIME.bar(20) }, { name: 'undercity', time: DOWNPOUR_OU7E_TIME.bar(28) },
    { name: 'moonlit canal', time: DOWNPOUR_OU7E_TIME.bar(33) }, { name: 'hunter citadel', time: DOWNPOUR_OU7E_TIME.bar(36) },
  ],
  post: { clearColor: 0x010207, bloom: { strength: 0.85, threshold: 0.62, radius: 0.15 }, vignette: { inner: 0.35, outer: 1.1, strength: 0.72 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene); installVisualEventHandlers(bus, scene);
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, level: downpourOu7eGameplay, visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive } });
    return { update(dt) { game.update(dt); updateVisuals(dt); }, dispose() { game.dispose(); } };
  },
};
