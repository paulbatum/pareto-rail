import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBattle } from './gameplay';
import { BPM, MARKERS, SECTIONS, TIME } from './timing';
import { createVisuals } from './visuals';

export const broadsideLevel: LevelDefinition = {
  id: 'broadside-63d6', title: 'Broadside',
  description: 'Launch from the flagship. Fly the crossfire. Break the enemy line.',
  bpm: BPM, markers: MARKERS,
  sections: SECTIONS.map(s => ({ name: s.name, time: TIME.bar(s.fromBar) })),
  post: {
    clearColor: 0x030714,
    bloom: { strength: 0.55, threshold: 0.85, radius: 0.25 },
    vignette: { inner: 0.45, outer: 1.3, strength: 0.38 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    const gameplay = createBattle(bus);
    const visuals = createVisuals(scene, camera, bus, gameplay.state);
    let elapsed = 0, runTime = 0, next = 0, calloutUntil = 0;
    const calls = [
      [0.1, 'FLIGHT CLEARED · GOOD HUNTING', 2.8],
      [7.5, 'THROUGH THE CROSSING', 2.1],
      [15, 'FRIENDLY BROADSIDE · STAY LOW', 2.7],
      [22.5, 'UNDER THEIR GUNS', 2.1],
      [30, 'THE EYE OF THE BATTLE', 2.5],
      [33.75, 'FLAGSHIP · STRIP THE SHIELD GENERATORS', 3],
      [43.125, 'ESCORTS INBOUND · COMING AROUND', 2.8],
      [46.875, 'DIVE INTO THE TRENCH · DESTROY THE POWER SYSTEMS', 3],
    ] as const;
    const say = (text: string, hold: number) => { hud.setCallout(text); calloutUntil = elapsed + hold; };
    const off = [
      bus.on('runstart', () => { runTime = 0; next = 0; calloutUntil = 0; hud.setCallout(''); }),
      bus.on('bossphase', e => {
        if (e.phase === 'exposed') say('SHIELD COLLAPSED · PREPARE THE SECOND PASS', 2.5);
        if (e.phase === 'destroyed') say('FLAGSHIP DESTROYED · THE LINE IS BREAKING', 5);
      }),
      bus.on('volley', e => { if (e.size === 6 && e.kills === 6 && calloutUntil < elapsed) say('SQUADRON CLEARED  +1200', 1.1); }),
    ];
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'Hold to charge · Sweep up to six targets · Release to fire\nCyan is your fleet. Cut the orange shield generators, then the core.',
      level: gameplay.level, visuals: visuals.factories,
    });
    return {
      update(dt, time) {
        elapsed = time;
        if (game.state === 'running') runTime += dt;
        game.update(dt);
        if (game.state === 'running') {
          while (next < calls.length && runTime >= calls[next][0]) {
            const [, text, hold] = calls[next++]; say(text, hold);
          }
          if (calloutUntil > 0 && elapsed > calloutUntil) { hud.setCallout(''); calloutUntil = 0; }
        }
        visuals.update(dt, elapsed, game.state === 'running', runTime);
      },
      dispose() { off.forEach(remove => remove()); gameplay.dispose(); visuals.dispose(); game.dispose(); },
    };
  },
};
