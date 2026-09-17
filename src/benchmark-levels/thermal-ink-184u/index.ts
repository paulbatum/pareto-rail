import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { THERMAL_INK_184U_BPM, createGameplay, fightFor } from './gameplay';
import { createVisuals } from './visuals';

export const thermalInk184uLevel: LevelDefinition = {
  id: 'thermal-ink-184u', title: 'Thermal Ink',
  description: 'Circle a mutant octopus in a drowned harbor. Switch infrared on with I or the sensor button to find white-hot flesh and red cores through cold black ink.',
  bpm: THERMAL_INK_184U_BPM,
  markers: { firstInk: 8.75, underArms: 25, lastArms: 38, finalBlackout: 54, returnOfLight: 58.5 },
  sections: [{ name: 'Harbor contact', time: 0 }, { name: 'Below the arms', time: 25 }, { name: 'Core exposure', time: 50 }],
  post: { clearColor: 0x49402a, bloom: { strength: 0.3, threshold: 0.85, radius: 0.15 }, vignette: { inner: 0.5, outer: 1.2, strength: 0.35 } },
  debugSelector: { queryParam: 'sensor', label: 'Sensor preview', options: [{ id: 'normal', title: 'Sodium vision' }, { id: 'infrared', title: 'Infrared' }, { id: 'ink', title: 'Ink blackout' }] },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const fight = fightFor(bus);
    const gameplay = createGameplay(bus, fight);
    const visuals = createVisuals(scene, camera, bus, fight);
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, level: gameplay, visuals: visuals.factories });
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;left:18px;bottom:68px;z-index:12;pointer-events:none;font:11px monospace;letter-spacing:1.8px;color:#e9d5a6;text-shadow:0 1px 3px #000;max-width:calc(100% - 36px)';
    const label = document.createElement('div');
    label.style.cssText = 'padding:7px 0;white-space:pre-line;line-height:1.7';
    const sensor = document.createElement('button');
    sensor.style.cssText = 'pointer-events:auto;border:1px solid #b9a575;background:#141615ed;color:#f5e4ba;padding:10px 15px;font:12px monospace;letter-spacing:1.5px;cursor:pointer;touch-action:manipulation';
    sensor.type = 'button';
    const toggle = () => { fight.infrared = !fight.infrared; fight.switches++; };
    const key = (e: KeyboardEvent) => { if (e.code === 'KeyI' && !e.repeat) { e.preventDefault(); toggle(); } };
    sensor.addEventListener('pointerdown', e => e.stopPropagation());
    sensor.addEventListener('click', e => { e.stopPropagation(); toggle(); sensor.blur(); });
    window.addEventListener('keydown', key);
    panel.append(label, sensor); canvas.parentElement?.append(panel);
    let previous = '';
    return {
      update(dt) {
        game.update(dt);
        if (debugValue === 'infrared') fight.infrared = true;
        if (debugValue === 'ink') fight.ink = Math.max(fight.ink, fight.running ? 1 : 0);
        visuals.update(dt);
        const state = fight.coreDead ? 'SIGNATURE LOST / HARBOR SECURED' : !fight.running ? 'THERMAL INK / HARBOR 09\nHold • sweep • release. Switch to infrared inside ink.' : fight.ink > 0.3 ? fight.infrared ? 'COLD INK / HOT TARGETS\nStrike the red cores.' : 'OPTICAL CONTACT LOST\nActivate infrared to reacquire.' : `ARM SEALS  ${8 - fight.dead.size} / 8\n${fight.dead.size === 8 ? 'CORE EXPOSED / final blackout incoming' : 'Sever the red arm nodes.'}`;
        if (state !== previous) { label.textContent = state; previous = state; }
        sensor.textContent = fight.infrared ? '[ I ]  INFRARED — ON' : '[ I ]  INFRARED — OFF';
        sensor.setAttribute('aria-pressed', String(fight.infrared));
        sensor.style.borderColor = fight.ink > 0.3 && !fight.infrared ? '#ff492f' : '#b9a575';
      },
      dispose() { window.removeEventListener('keydown', key); panel.remove(); game.dispose(); visuals.dispose(); },
    };
  },
};
