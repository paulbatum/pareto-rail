import { createMusicTime } from '../../engine/music-time';

export const VESPERS_N3LY_BPM = 96;
export const VESPERS_N3LY_STEPS_PER_BAR = 16;
export const VESPERS_N3LY_TIME = createMusicTime(VESPERS_N3LY_BPM, {
  stepsPerBar: VESPERS_N3LY_STEPS_PER_BAR,
});

export const VESPERS_N3LY_BARS = {
  threshold: 0,
  procession: 4,
  theft: 9,
  silence: 13,
  return: 17,
  rose: 20,
  plenum: 21,
  end: 24,
} as const;

export const VESPERS_N3LY_MARKERS = VESPERS_N3LY_TIME.markers({
  threshold: VESPERS_N3LY_BARS.threshold,
  procession: VESPERS_N3LY_BARS.procession,
  theft: VESPERS_N3LY_BARS.theft,
  silence: VESPERS_N3LY_BARS.silence,
  return: VESPERS_N3LY_BARS.return,
  rose: VESPERS_N3LY_BARS.rose,
  plenum: VESPERS_N3LY_BARS.plenum,
  end: VESPERS_N3LY_BARS.end,
});

export const VESPERS_N3LY_RUN_DURATION = VESPERS_N3LY_MARKERS.end;

export const VESPERS_N3LY_RUN_SECTIONS = [
  { name: 'the pedal', fromBar: VESPERS_N3LY_BARS.threshold, toBar: VESPERS_N3LY_BARS.procession },
  { name: 'voices enter', fromBar: VESPERS_N3LY_BARS.procession, toBar: VESPERS_N3LY_BARS.theft },
  { name: 'the theft', fromBar: VESPERS_N3LY_BARS.theft, toBar: VESPERS_N3LY_BARS.silence },
  { name: 'the dark nave', fromBar: VESPERS_N3LY_BARS.silence, toBar: VESPERS_N3LY_BARS.return },
  { name: 'westward', fromBar: VESPERS_N3LY_BARS.return, toBar: VESPERS_N3LY_BARS.rose },
  { name: 'the dead rose', fromBar: VESPERS_N3LY_BARS.rose, toBar: VESPERS_N3LY_BARS.plenum },
  { name: 'lux aeterna', fromBar: VESPERS_N3LY_BARS.plenum, toBar: VESPERS_N3LY_BARS.end },
] as const;
