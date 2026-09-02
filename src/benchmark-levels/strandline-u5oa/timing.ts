import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_BPM = 120;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR = STRANDLINE_TIME.barSeconds; // 2.0 s
export const BEAT_SECONDS = STRANDLINE_TIME.beatSeconds; // 0.5 s

export const STRANDLINE_BARS = {
  /** Outer strands: ambient oceanic descent, clamped parasites waking. */
  descent: 0,
  /** Strand forest: dense glowing tentacles, skimmers weaving. */
  forest: 6,
  /** The wide swell: rail arcs wide to reveal the giant bell like an emerald moon. */
  swell: 14,
  /** The crown: parent organism embedded under the bell, shielded by web lattice. */
  crown: 20,
  /** Purification: parent falls, lattice collapses, camera pulls back, serene glow. */
  restoration: 26,
  /** Run finish. */
  end: 30,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers(STRANDLINE_BARS);
export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end; // 60.0 s

export const DESCENT_TIME = STRANDLINE_MARKERS.descent;
export const FOREST_TIME = STRANDLINE_MARKERS.forest;
export const SWELL_TIME = STRANDLINE_MARKERS.swell;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const RESTORATION_TIME = STRANDLINE_MARKERS.restoration;

export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.descent },
  { index: 1, fromBar: STRANDLINE_BARS.forest, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.swell, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.restoration },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'descent', fromBar: STRANDLINE_BARS.descent, toBar: STRANDLINE_BARS.forest },
  { name: 'forest', fromBar: STRANDLINE_BARS.forest, toBar: STRANDLINE_BARS.swell },
  { name: 'swell', fromBar: STRANDLINE_BARS.swell, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.restoration },
  { name: 'restoration', fromBar: STRANDLINE_BARS.restoration, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
