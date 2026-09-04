import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BOSS_TIME, CLIMBER_HULL, DURATION, SKYHOOK_B993_BPM, createSkyhookDesign } from './gameplay';
import { createSkyhookVisuals } from './visuals';

export const skyhookB993Level: LevelDefinition = {
  id: 'skyhook-b993', title: 'Skyhook',
  description: 'Ride a space-elevator climber from storm to starlight. Defend the car. Clear the tether. Come home to silence.',
  bpm: SKYHOOK_B993_BPM,
  markers: { weather: 4, cloudbreak: 15, blue: 20, thin: 29, harvester: 36, descent: 45, docking: 56, docked: 59 },
  sections: [{ name: 'Weather', time: 0 }, { name: 'Cloudbreak', time: 14 }, { name: 'Thin air', time: 28 }, { name: 'Harvester', time: 36 }, { name: 'Dock', time: 54 }],
  post: { clearColor: 0x273843, bloom: { strength: 0.22, threshold: 0.9, radius: 0.1 }, vignette: { inner: 0.55, outer: 1.1, strength: 0.32 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    const originalFar = camera.far, originalFov = camera.fov; camera.far = 6000; camera.updateProjectionMatrix();
    const design = createSkyhookDesign(bus);
    const visuals = createSkyhookVisuals(bus, scene, camera);
    let time = 0, nextCue = 0, calloutUntil = -1, active = false, lastHits = 0;
    const cues: Array<[number, string, number]> = [
      [0.1, 'SKYHOOK  /  CLIMB AUTHORIZED', 2.5],
      [6.8, 'DIVERS TARGET THE CAR — INTERCEPT', 2.5],
      [13.6, 'CLOUD DECK', 2], [18, 'ABOVE THE WEATHER', 2.5],
      [25, 'ATMOSPHERE THINNING', 2.5],
      [32, 'MASS DETECTED ON THE TETHER', 2.5],
      [BOSS_TIME, 'HARVESTER  /  STOP ITS DESCENT', 3],
      [54.2, 'STATION CAPTURE  /  BRAKING', 2],
      [58.4, 'DOCKED  /  WELCOME HOME', 1.6],
    ];
    const say = (text: string, duration: number) => { hud.setCallout(text); calloutUntil = time + duration; };
    const telemetry = typeof document.createElement === 'function' ? document.createElement('div') : null;
    if (telemetry) {
      telemetry.style.cssText = 'position:fixed;left:22px;bottom:26px;z-index:7;pointer-events:none;color:#e0e3db;font:11px/1.8 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;text-shadow:0 1px 4px #000;padding:10px 14px;border-left:2px solid #c97832;background:linear-gradient(90deg,#172129b8,transparent);white-space:pre';
      document.body.appendChild(telemetry);
    }
    const bossPanel = typeof document.createElement === 'function' ? document.createElement('div') : null;
    if (bossPanel) {
      bossPanel.style.cssText = 'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:7;pointer-events:none;color:#e5dfcc;text-align:center;font:11px/1.7 ui-monospace,monospace;letter-spacing:.2em;text-shadow:0 1px 4px #000;white-space:pre';
      document.body.appendChild(bossPanel);
    }
    const off = [
      bus.on('runstart', () => { time = 0; nextCue = 0; active = true; lastHits = 0; calloutUntil = -1; }),
      bus.on('runend', () => { active = false; hud.setCallout(''); }),
      bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') say('TETHER CLEAR  /  DOCKING CORRIDOR OPEN', 3); }),
    ];
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'Hold + sweep to lock. Release to fire. Right-click undoes locks. Protect the climber from orange-nosed divers.',
      level: { ...design.level, updateCameraEffects({ runTime }) { visuals.cameraEffects(runTime); } },
      visuals: visuals.factories,
    });
    return {
      update(dt, elapsed) {
        if (active) time = Math.min(DURATION, time + dt);
        game.update(dt);
        if (active) {
          if (calloutUntil >= 0 && time >= calloutUntil) { hud.setCallout(''); calloutUntil = -1; }
          while (nextCue < cues.length && time >= cues[nextCue][0]) { const cue = cues[nextCue++]; say(cue[1], cue[2]); }
          if (design.state.carHits > lastHits) { lastHits = design.state.carHits; say(`CLIMBER IMPACT  /  INTEGRITY ${design.state.carHull} OF ${CLIMBER_HULL}`, 1.5); }
        }
        visuals.update(dt, elapsed, time, active, design.state);
        if (telemetry) {
          const altitude = time < 14 ? 2 + time * 0.7 : 12 + ((time - 14) / 46) ** 2.2 * 35774;
          const layer = time < 14 ? 'TROPOSPHERE' : time < 28 ? 'STRATOSPHERE' : time < 36 ? 'EXOSPHERE' : time < 58 ? 'ORBITAL APPROACH' : 'CAPTURE COMPLETE';
          telemetry.style.display = active ? 'block' : 'none';
          telemetry.textContent = `${layer}\nALT ${altitude.toFixed(0).padStart(5, '0')} KM   ↑\nCLIMBER ${'▰'.repeat(design.state.carHull)}${'▱'.repeat(CLIMBER_HULL - design.state.carHull)}`;
          telemetry.style.borderColor = design.state.carHull <= 3 ? '#bd5332' : '#c97832';
        }
        if (bossPanel) {
          bossPanel.style.display = active && time >= BOSS_TIME && !design.state.bossDead ? 'block' : 'none';
          bossPanel.textContent = `TETHER HARVESTER   ${Math.max(0, 53.5 - time).toFixed(1)}s TO IMPACT\n${'━'.repeat(Math.ceil(design.state.bossRemaining / 2))}${'┄'.repeat(18 - Math.ceil(design.state.bossRemaining / 2))}\nCLAMP ${design.state.bossStage + 1} / 6`;
        }
      },
      dispose() { off.forEach(fn => fn()); telemetry?.remove(); bossPanel?.remove(); game.dispose(); visuals.dispose(); camera.far = originalFar; camera.fov = originalFov; camera.updateProjectionMatrix(); },
    };
  },
};
