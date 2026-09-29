import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BOSS_TIME, createSkyhookGameplay, SKYHOOK_U9LG_BPM } from './gameplay';
import { createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, disposeVisuals, installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive, updateVisuals } from './visuals';

export const skyhookU9lgLevel: LevelDefinition = {
  id: 'skyhook-u9lg', title: 'Skyhook',
  description: 'Ride a space-elevator climber from storm to stars. Defend its hull. Clear the tether. Dock at U9.',
  bpm: SKYHOOK_U9LG_BPM,
  markers: { weather: 4, cloudbreak: 14, blue: 20, thinning: 28, contact: BOSS_TIME, approach: 50, docking: 56 },
  sections: [{ name: 'WEATHER', time: 0 }, { name: 'CLOUD BREAK', time: 14 }, { name: 'STRATOSPHERE', time: 24 }, { name: 'TETHER CONTACT', time: 36 }, { name: 'DOCK U9', time: 54 }],
  post: { clearColor: 0x303c47, bloom: { strength: 0.32, threshold: 0.9, radius: 0.15 }, vignette: { inner: 0.5, outer: 1.2, strength: 0.28 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    createEnvironment(scene);
    const stopVisuals = installVisualEventHandlers(bus, scene);
    const level = createSkyhookGameplay(bus);
    let runTime = 0, nextCue = 0, cueUntil = 0, elapsedNow = 0, lastCarHits = 0, bossNotified = false;
    const oldFov = camera.fov, oldFar = camera.far;
    camera.far = 2400; camera.updateProjectionMatrix();
    const say = (text: string, seconds = 2.6) => { hud.setCallout(text); cueUntil = elapsedNow + seconds; };
    const cues = [
      { at: 0.4, text: 'CLIMB AUTHORIZED · PROTECT THE CAR' },
      { at: 9, text: 'ORANGE GRIPPERS TARGET THE CLIMBER' },
      { at: 14, text: 'CLOUD DECK CLEARED' },
      { at: 24, text: 'ATMOSPHERE FALLING AWAY' },
      { at: 36, text: 'TETHER CONTACT · STOP ITS DESCENT', hold: 3.6 },
      { at: 51, text: 'U9 · FINAL APPROACH' },
      { at: 55.5, text: 'CAPTURE ARMS OPEN' },
      { at: 58, text: 'DOCKED · WELCOME ABOVE', hold: 2 },
    ];
    const telemetry = document.createElement('div');
    telemetry.style.cssText = 'position:fixed;left:24px;bottom:88px;pointer-events:none;color:#e0e3db;font:11px monospace;letter-spacing:2px;line-height:1.8;text-shadow:0 1px 4px #101820;background:#10182090;padding:10px 14px;border-left:2px solid #d16b25;z-index:4;display:none';
    const label = document.createElement('div');
    const car = document.createElement('div');
    const threat = document.createElement('div');
    telemetry.append(label, car, threat); document.body.append(telemetry);
    const off = [
      bus.on('runstart', () => { runTime = 0; nextCue = 0; lastCarHits = 0; bossNotified = false; telemetry.style.display = 'block'; say(''); }),
      bus.on('runend', () => { telemetry.style.display = 'none'; camera.fov = oldFov; camera.updateProjectionMatrix(); }),
    ];
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'HOLD · SWEEP UP TO SIX · RELEASE  /  ORANGE GRIPPERS ATTACK THE CAR',
      level: {
        ...level,
        updateCameraEffects({ camera, runTime }) {
          const storm = Math.max(0, 1 - runTime / 16);
          camera.rotateZ(Math.sin(runTime * 3) * 0.003 * storm);
          camera.fov = runTime < 54 ? 62 + Math.sin(Math.min(1, runTime / 14) * Math.PI / 2) * 4 : 66 - Math.min(1, (runTime - 54) / 6) * 12;
          camera.updateProjectionMatrix();
        },
      },
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });
    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime = Math.min(60, runTime + dt);
          while (nextCue < cues.length && runTime >= cues[nextCue].at) { const cue = cues[nextCue++]; say(cue.text, cue.hold ?? 2.6); }
        }
        game.update(dt);
        const status = level.status();
        if (status.carHits > lastCarHits) { lastCarHits = status.carHits; say(`CLIMBER IMPACT · INTEGRITY ${status.integrity}%`, 1.6); }
        if (status.bossDead && !bossNotified) { bossNotified = true; say('TETHER CLEARED · ALL THE WAY HOME', 3); }
        if (cueUntil > 0 && elapsed >= cueUntil) { hud.setCallout(''); cueUntil = 0; }
        label.textContent = `U9 / ${runTime < 14 ? 'WEATHER' : runTime < 24 ? 'BLUE SKY' : runTime < 36 ? 'THIN AIR' : runTime < 54 ? 'VACUUM' : 'DOCK APPROACH'}`;
        car.textContent = `CAR ${'▮'.repeat(Math.ceil(status.integrity / 20))}${'▯'.repeat(5 - Math.ceil(status.integrity / 20))} ${status.integrity}%`;
        car.style.color = status.integrity <= 40 ? '#ed9256' : '#e0e3db';
        threat.textContent = runTime >= 36 && !status.bossDead ? `CONTACT IN ${Math.max(0, 52 - runTime).toFixed(1)}s` : `${Math.round(runTime / 60 * 100)}% OF ASCENT`;
        updateVisuals(dt, elapsed, runTime, game.state === 'running', camera, status);
      },
      dispose() { off.forEach((stop) => stop()); stopVisuals(); level.dispose(); telemetry.remove(); disposeVisuals(); game.dispose(); camera.far = oldFar; camera.fov = oldFov; camera.updateProjectionMatrix(); },
    };
  },
};
