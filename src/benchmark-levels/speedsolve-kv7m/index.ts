import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import { BPM, MARKERS } from './timing';
import { createVisuals } from './visuals';
import { createShowcaseDriver } from './showcase';

export const speedsolveKv7mLevel: LevelDefinition = {
  id: 'speedsolve-kv7m', title: 'Speedsolve',
  description: 'Six colors. Sixty seconds. Shoot a colossal puzzle cube into perfect time.',
  bpm: BPM, markers: MARKERS,
  sections: [
    { name: 'Rose / Detent', time: 0 }, { name: 'Tangerine / Ratchet', time: MARKERS.orange },
    { name: 'Lemon / Escapement', time: MARKERS.yellow }, { name: 'Mint / Flywheel', time: MARKERS.green },
    { name: 'Azure / Index', time: MARKERS.blue }, { name: 'Lilac / Overclock', time: MARKERS.violet },
    { name: 'Naked core', time: MARKERS.nakedCore }, { name: 'Last barrage', time: MARKERS.lastBarrage },
  ],
  post: { clearColor: 0xdce6ec, bloom: { strength: 0.16, threshold: 1.1, radius: 0.14 }, vignette: { inner: 0.55, outer: 1.2, strength: 0.18 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, debugValue }) {
    const level = createSpeedsolveGameplay(bus);
    const visual = createVisuals(scene, camera, bus, level.fight, canvas);
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'HOLD + SWEEP EVERY LETTER · RELEASE TO START\nShoot lit squares to turn. Break each exposed spindle. Intercept incoming shapes. Right-click undoes a lock.',
      level, visuals: visual.factories,
    });
    const showcase = debugValue === 'showcase' ? createShowcaseDriver(canvas, camera, bus, visual.targets) : null;
    let previousFace = -1, previousCleared = 0, calloutUntil = 0, spindleAnnounced = -1;
    const off = bus.on('runstart', () => { previousFace = -1; previousCleared = 0; spindleAnnounced = -1; calloutUntil = 0; });
    return {
      update(dt, elapsed) {
        showcase?.update(game.state === 'running');
        game.update(dt); visual.update(dt, elapsed);
        if (game.state !== 'running') return;
        const fight = level.fight;
        let callout = '';
        if (fight.face !== previousFace) { previousFace = fight.face; callout = fight.face === 0 ? 'ANY LIT SQUARE ADVANCES THE SOLVE' : `FACE ${fight.face + 1} · KEEP THE RHYTHM`; }
        if (fight.time >= fight.fallenAt[fight.face] && spindleAnnounced !== fight.face) { spindleAnnounced = fight.face; callout = 'FACE SOLVED · BREAK THE SPINDLE'; }
        if (fight.cleared !== previousCleared) { previousCleared = fight.cleared; if (fight.cleared === 6) callout = 'SIX FACES DOWN · CORE SPIN-UP'; }
        if (callout) { hud.setCallout(callout); calloutUntil = fight.time + 1.4; }
        else if (calloutUntil > 0 && fight.time > calloutUntil) { hud.setCallout(''); calloutUntil = 0; }
      },
      dispose() { off(); showcase?.dispose(); game.dispose(); level.dispose(); visual.dispose(); },
    };
  },
};
