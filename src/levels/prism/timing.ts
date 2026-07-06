import { createMusicTime } from '../../engine/music-time';

export const PRISM_BPM = 96;
export const PRISM_STEPS_PER_BAR = 16;
export const PRISM_TIME = createMusicTime(PRISM_BPM, { stepsPerBar: PRISM_STEPS_PER_BAR });
export const PRISM_RUN_DURATION = PRISM_TIME.bar(12);

export const PRISM_SPAWN_SYNC = {
  bpm: PRISM_BPM,
  beatsPerBar: PRISM_TIME.beatsPerBar,
  duration: PRISM_RUN_DURATION,
  sections: [
    { name: 'run', fromBar: 0, toBar: 12 },
  ],
};
