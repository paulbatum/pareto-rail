import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BPM, createGameplay, createLife } from './gameplay';
import { createVisuals } from './visuals';

export const strandline8839Level: LevelDefinition = {
  id: 'strandline-8839', title: 'Strandline',
  description: 'Unweave a violet infestation inside a living cathedral of sunlit water. Free the crown, and let the giant drift on.',
  bpm: BPM,
  markers: { strands: 5, greenMoon: 23, return: 30, crown: 40, release: 55 },
  sections: [{ name: 'In the strands', time: 0 }, { name: 'Green moon', time: 20 }, { name: 'The crown', time: 40 }, { name: 'Drift on', time: 52.5 }],
  post: { clearColor: 0x07536e, bloom: { strength: 0.34, threshold: 0.85, radius: 0.35 }, vignette: { inner: 0.35, outer: 1.1, strength: 0.23 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    const life = createLife();
    const level = createGameplay(bus, life);
    const visuals = createVisuals(scene, camera, bus, life);
    let calloutUntil = 0, chapter = 0, shownWebs = 0;
    const say = (message: string, hold = 2.3) => { hud.setCallout(message); calloutUntil = life.time + hold; };
    const subscriptions = [
      bus.on('runstart', () => { chapter = 0; shownWebs = 0; say('STRANDLINE • A LIVING OCEAN', 2.8); }),
      bus.on('bossphase', e => {
        if (e.phase === 'exposed') say('THE PARENT IS BARE • TEAR IT LOOSE');
        if (e.phase === 'destroyed') say('EVERY STRAND, ALIVE', 3.8);
      }),
      bus.on('runend', () => hud.setCallout('')),
    ];
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'Hold • sweep the violet parasites • release to free the strands. Clear all three broods to expose the crown.',
      level, visuals: visuals.factories });
    return {
      update(dt, elapsed) {
        game.update(dt); visuals.update(dt, elapsed);
        if (!life.running) return;
        if (life.time > calloutUntil) hud.setCallout('');
        if (chapter === 0 && life.time >= 20) { chapter++; say('THE GREEN MOON', 2); }
        if (chapter === 1 && life.time >= 39.5) { chapter++; say('THE CROWN • CLEAR THE BROODS', 3); }
        const webs = life.broods.filter(n => n >= 3).length;
        if (webs > shownWebs) { shownWebs = webs; if (webs < 3) say(`${webs} / 3 BROOD WEBS SEVERED`, 1.6); }
      },
      dispose() { game.dispose(); level.dispose(); visuals.dispose(); subscriptions.forEach(unsubscribe => unsubscribe()); },
    };
  },
};
