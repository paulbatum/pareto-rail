import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BPM, MARKERS, createBattleState, createGameplay } from './gameplay';
import { createVisualWorld, setEnemyDenied, setEnemyLocked, setReticleActive } from './visuals';

export const broadside5qecLevel: LevelDefinition = {
  id: 'broadside-5qec', title: 'Broadside',
  description: 'Launch into a fleet engagement. Fly the crossfire, break the flagship shields, and dive into its heart.',
  bpm: BPM, markers: MARKERS,
  sections: Object.entries(MARKERS).map(([name, time]) => ({ name, time })),
  post: { clearColor: 0x080613, bloom: { strength: 0.65, threshold: 0.9, radius: 0.2 }, vignette: { inner: 0.4, outer: 1.1, strength: 0.45 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    camera.far = 30000; camera.near = 0.15; camera.updateProjectionMatrix();
    const state = createBattleState();
    const gameplay = createGameplay(bus, state);
    const world = createVisualWorld(scene, bus, state);
    let t = 0, elapsed = 0, calloutUntil = 0, next = 0;
    const callouts = [
      [0.2, 'LAUNCH — ALL WINGS, ENGAGE'], [7.5, 'CROSSFIRE — THREAD THE FLEET'],
      [15, 'FRIENDLY BROADSIDE — KEEP LOW'], [22.5, 'ENEMY BELLY — RAKE THE BATTERIES'],
      [28.125, 'THE EYE OF THE BATTLE'], [31.875, 'FLAGSHIP — FOUR SHIELD GENERATORS'],
      [43.125, 'ESCORT WINGS — COMING AROUND'], [46.875, 'TRENCH RUN — DESTROY THREE POWER SYSTEMS'],
      [56.25, ''],
    ] as const;
    const say = (text: string, hold = 2.3) => { hud.setCallout(text); calloutUntil = elapsed + hold; };
    const off = [
      bus.on('runstart', () => { t = 0; next = 0; say(''); }),
      bus.on('bossphase', ({ phase }) => { if (phase === 'exposed') say('SHIELD COLLAPSED — CORE ACCESS OPEN', 2.8); if (phase === 'destroyed') say('FLAGSHIP BREAKING — FLEET VICTORIOUS', 5); }),
    ];
    const game = createLockOnRunner({ scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'Hold to acquire up to six targets. Release for a volley. Cut all four shield generators, then the three power systems.',
      level: gameplay,
      visuals: { createEnemyMesh: world.createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh: world.createProjectileMesh, createReticle: world.createReticle, setReticleActive },
    });
    return {
      update(dt, total) {
        elapsed = total;
        if (game.state === 'running') {
          t += dt;
          while (next < callouts.length && t >= callouts[next][0]) {
            const text = callouts[next][1];
            say(text || (state.victory ? 'THE ENEMY LINE BREAKS' : 'FLAGSHIP SURVIVED — WITHDRAW'), 2.5); next++;
          }
        }
        if (elapsed > calloutUntil) hud.setCallout('');
        game.update(dt); world.update(dt, t, camera, total);
      },
      dispose() { off.forEach((f) => f()); game.dispose(); world.dispose(); },
    };
  },
};
