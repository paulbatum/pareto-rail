import { createMusicTime } from '../../engine/music-time';

// One authoritative clock. 96 BPM × 24 bars = exactly sixty seconds.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const bar = STRANDLINE_TIME.bar;

// The run, in bars. Chords change every two bars (D · Bm · G · A · D · …) so
// every set piece lands on a chord boundary.
export const STRANDLINE_BARS = {
  dim: 0, //        the strands are dark; only the pulse
  stir: 4, //       first glow climbs the strands
  swing: 6, //      the rail leaves the forest; a riser builds toward the bell
  bloom: 8, //      the bell fills the sky — the moon
  tide: 10, //      dive back into the strands, groove opens
  crown: 12, //     the parent
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  dim: STRANDLINE_BARS.dim,
  stir: STRANDLINE_BARS.stir,
  swing: STRANDLINE_BARS.swing,
  moon: [STRANDLINE_BARS.bloom - 0.25, 0],
  bloom: STRANDLINE_BARS.bloom,
  dive: [STRANDLINE_BARS.tide - 0.5, 0],
  tide: STRANDLINE_BARS.tide,
  crown: STRANDLINE_BARS.crown,
  parent: STRANDLINE_BARS.crown,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;

// Score sections drive the player's instruments (kill lanes, lock/fire timbre).
export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.dim },
  { index: 1, fromBar: STRANDLINE_BARS.stir, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.bloom, crossfadeBars: 0.5 },
  { index: 3, fromBar: STRANDLINE_BARS.tide, crossfadeBars: 0.5 },
  { index: 4, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 0.25 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'dim', fromBar: STRANDLINE_BARS.dim, toBar: STRANDLINE_BARS.stir },
  { name: 'stir', fromBar: STRANDLINE_BARS.stir, toBar: STRANDLINE_BARS.swing },
  { name: 'swing', fromBar: STRANDLINE_BARS.swing, toBar: STRANDLINE_BARS.bloom },
  { name: 'bloom', fromBar: STRANDLINE_BARS.bloom, toBar: STRANDLINE_BARS.tide },
  { name: 'tide', fromBar: STRANDLINE_BARS.tide, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.end },
] as const;

export const STRANDLINE_SPAWN_SYNC = {
  bpm: STRANDLINE_BPM,
  beatsPerBar: STRANDLINE_TIME.beatsPerBar,
  duration: STRANDLINE_DURATION,
  sections: STRANDLINE_RUN_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
