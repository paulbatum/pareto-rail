import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { BPM, MARKERS, SECTIONS, TIME } from './timing';
import { createRescueState } from './world';
import { createVisuals } from './visuals';

export const strandlineLevel: LevelDefinition = {
  id: 'strandline-b4d3',
  title: 'Strandline',
  description: 'Free a moon-sized jellyfish. Follow its luminous strands to the parasite at its crown.',
  bpm: BPM,
  markers: MARKERS,
  sections: SECTIONS.map(({ name, fromBar }) => ({ name, time: TIME.bar(fromBar) })),
  post: {
    clearColor: 0x115f78,
    bloom: { strength: 0.48, threshold: 0.78, radius: 0.22 },
    vignette: { inner: 0.4, outer: 1.2, strength: 0.32 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen }) {
    const state = createRescueState();
    const feel = createCameraFeel(camera);
    const gameplay = createStrandlineGameplay(bus, state);
    const visuals = createVisuals(scene, camera, bus, state, feel);
    let now = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const say = (text: string, duration = 2.6) => { hud.setCallout(text); calloutUntil = now + duration; };
    const cues = [
      { time: 0.3, text: 'STRANDLINE  /  bring back the light', duration: 3.8 },
      { time: 14.8, text: 'Something immense is breathing', duration: 3.5 },
      { time: 23, text: 'Follow the light to its crown', duration: 3 },
      { time: 37.6, text: 'Kill the broods. Their webbing will die.', duration: 4.5 },
    ];
    const off = [
      bus.on('runstart', () => { nextCallout = 0; calloutUntil = -1; feel.restore(); }),
      bus.on('bossphase', ({ phase }) => {
        if (phase === 'exposed') say('THE PARENT IS BARE  /  tear it loose', 3.8);
        if (phase === 'destroyed') say('FREE', 3.2);
      }),
      bus.on('volley', ({ size, kills }) => { if (size === 6 && kills === 6 && state.time < 36) say('A CURRENT OF LIGHT  +750', 1.5); }),
    ];
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: 'Hold and sweep every letter, then release. In the strands: chain up to six parasites. Right-click undoes a lock.',
      level: {
        ...gameplay,
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          feel.setFovOffset(state.freedAt >= 0 ? -3 : state.time > 15 && state.time < 22 ? -2 : 0);
          feel.update(context.dt);
        },
      },
      visuals: visuals.factories,
    });
    return {
      update(dt, elapsed) {
        now = elapsed;
        game.update(dt);
        if (game.state === 'running') {
          while (nextCallout < cues.length && state.time >= cues[nextCallout].time) {
            const cue = cues[nextCallout++]; say(cue.text, cue.duration);
          }
        }
        if (calloutUntil > 0 && now >= calloutUntil) { hud.setCallout(''); calloutUntil = -1; }
        visuals.update(dt, elapsed);
      },
      dispose() { off.forEach((fn) => fn()); game.dispose(); visuals.dispose(); feel.dispose(); },
    };
  },
};
