import { createMusicTime } from '../../engine/music-time';

// Strandline swims on a 96 BPM grid: one bar = 2.5 s, 24 bars = exactly the
// 60-second passage through the strands. The run's set pieces are bar
// boundaries first and places in the animal second — the rail swings wide of
// the forest on bar 8 and the bell fills the view, the crown arrives with the
// Matriarch at bar 15, and the last two bars belong to the freed jellyfish.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR = STRANDLINE_TIME.barSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  bloom: 4,
  reveal: 8,
  deep: 10,
  crown: 15,
  serene: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  bloom: STRANDLINE_BARS.bloom,
  reveal: STRANDLINE_BARS.reveal,
  deep: STRANDLINE_BARS.deep,
  crown: STRANDLINE_BARS.crown,
  serene: STRANDLINE_BARS.serene,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const REVEAL_TIME = STRANDLINE_MARKERS.reveal;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const SERENE_TIME = STRANDLINE_MARKERS.serene;

// Score sections: 0 drift, 1 bloom (the reveal lives inside it), 2 deep,
// 3 crown, 4 serene. Player-instrument handovers crossfade where the backing
// track does not turn over; the crown snaps because the music does.
export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.bloom, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.deep, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.crown },
  { index: 4, fromBar: STRANDLINE_BARS.serene, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.bloom },
  { name: 'bloom', fromBar: STRANDLINE_BARS.bloom, toBar: STRANDLINE_BARS.reveal },
  { name: 'reveal', fromBar: STRANDLINE_BARS.reveal, toBar: STRANDLINE_BARS.deep },
  { name: 'deep', fromBar: STRANDLINE_BARS.deep, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.serene },
  { name: 'serene', fromBar: STRANDLINE_BARS.serene, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
