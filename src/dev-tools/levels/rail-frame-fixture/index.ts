// Dev-only fixture level. It is loadable only through the gameplay snapshot
// page (`--level rail-frame-fixture`); it is not in the level registry, the
// benchmark catalog, or the gallery.
import type { LevelDefinition } from '../../../engine/types';
import { createLockOnRunner } from '../../../engine/lock-on-runner';
import { createFixtureGameplay, createFixtureRail, FIXTURE_BPM } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
} from './visuals';

export const railFrameFixtureLevel: LevelDefinition = {
  id: 'rail-frame-fixture',
  title: 'Rail Frame Fixture',
  description: 'Dev-only rail with a 60-degree bank, a vertical loop, a look target, and a spinning corridor.',
  bpm: FIXTURE_BPM,
  post: { clearColor: 0x03060c, bloom: { strength: 0.4, threshold: 0.8, radius: 0.1 } },
  createAudio() {
    let master = 1;
    let music = 1;
    let sfx = 1;
    return {
      start: async () => {},
      installGestureStart() {},
      setMasterVolume(value) { master = value; },
      getMasterVolume() { return master; },
      setMusicVolume(value) { music = value; },
      getMusicVolume() { return music; },
      setSfxVolume(value) { sfx = value; },
      getSfxVolume() { return sfx; },
      suspend: async () => {},
      dispose() {},
    };
  },
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const environment = createEnvironment(scene, createFixtureRail());
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: createFixtureGameplay(bus),
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });
    return {
      update(dt) {
        game.update(dt);
        environment.rings.update(game.runProgress, dt);
      },
      dispose() {
        game.dispose();
        disposeEnvironment(scene, environment);
      },
    };
  },
};

export default railFrameFixtureLevel;
