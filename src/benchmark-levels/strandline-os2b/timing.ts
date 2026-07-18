import { createMusicTime } from '../../engine/music-time';

// Strandline breathes at 96 BPM: one bar is 2.5 s and 24 bars is exactly the
// 60-second swim. The run's beats are bar boundaries first and set pieces
// second — the strand forest opens at bar 4, the rail swings wide and the bell
// clears the murk at bar 8, the deep braid closes over you at bar 10, the
// parent is found at the crown on bar 15, and the last two bars are the animal
// drifting on with the camera falling away from it.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR = STRANDLINE_TIME.barSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  bloom: 4,
  openWater: 8,
  deep: 10,
  braid: 12,
  crown: 15,
  purge: 18,
  serene: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  bloom: STRANDLINE_BARS.bloom,
  openWater: STRANDLINE_BARS.openWater,
  deep: STRANDLINE_BARS.deep,
  braid: STRANDLINE_BARS.braid,
  crown: STRANDLINE_BARS.crown,
  purge: STRANDLINE_BARS.purge,
  serene: STRANDLINE_BARS.serene,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const OPEN_WATER_TIME = STRANDLINE_MARKERS.openWater;
export const DEEP_TIME = STRANDLINE_MARKERS.deep;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const SERENE_TIME = STRANDLINE_MARKERS.serene;

// Player-instrument voicing sections. The handovers crossfade because the
// backing arrangement does not turn over at the same instant — except the
// crown, where the music and the fight change together.
export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.bloom, crossfadeBars: 2 },
  { index: 2, fromBar: STRANDLINE_BARS.deep, crossfadeBars: 2 },
  { index: 3, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.serene, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.bloom },
  { name: 'bloom', fromBar: STRANDLINE_BARS.bloom, toBar: STRANDLINE_BARS.openWater },
  { name: 'open-water', fromBar: STRANDLINE_BARS.openWater, toBar: STRANDLINE_BARS.deep },
  { name: 'deep', fromBar: STRANDLINE_BARS.deep, toBar: STRANDLINE_BARS.braid },
  { name: 'braid', fromBar: STRANDLINE_BARS.braid, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.purge },
  { name: 'purge', fromBar: STRANDLINE_BARS.purge, toBar: STRANDLINE_BARS.serene },
  { name: 'serene', fromBar: STRANDLINE_BARS.serene, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
export const beats = STRANDLINE_TIME.beats;
