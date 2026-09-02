import { createMusicTime } from '../../engine/music-time';

// Strandline runs on an organic 96 BPM pulse:
// 1 beat = 0.625 s, 1 bar (4 beats) = 2.50 s.
// 24 bars = exactly 60.00 seconds.
//
// Musical and visual arc:
// - Bars 0..6 (0.0s - 15.0s): Act 1 - Shallows & Outer Strands. Gentle oceanic drift, lone polyps latched onto strands.
// - Bars 6..12 (15.0s - 30.0s): Act 2 - Deep Forest & Bell Vista. Rail winds into the strand thicket; bar 9 swings wide to reveal the colossal bell like a green moon!
// - Bars 12..18 (30.0s - 45.0s): Act 3 - The Crown Ascent. Threading oral arms, fast skittering mites and heavy spore spitters.
// - Bars 18..22 (45.0s - 55.0s): Act 4 - The Crown Parasite (Boss). Parent organism shielded behind its web lattice and broods.
// - Bars 22..24 (55.0s - 60.0s): Act 5 - Serenity & Grand Pullback. Clean tentacles pulse with golden light; animal drifts on.

export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR = STRANDLINE_TIME.barSeconds;
export const STRANDLINE_STEP = STRANDLINE_TIME.stepSeconds;

export const STRANDLINE_BARS = {
  launch: 0,
  forest: 6,
  vista: 9,
  ascent: 12,
  boss: 18,
  serenity: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  launch: STRANDLINE_BARS.launch,
  forest: STRANDLINE_BARS.forest,
  vista: STRANDLINE_BARS.vista,
  ascent: STRANDLINE_BARS.ascent,
  boss: STRANDLINE_BARS.boss,
  serenity: STRANDLINE_BARS.serenity,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end; // exactly 60.0s
export const FOREST_TIME = STRANDLINE_MARKERS.forest;
export const VISTA_TIME = STRANDLINE_MARKERS.vista;
export const ASCENT_TIME = STRANDLINE_MARKERS.ascent;
export const BOSS_TIME = STRANDLINE_MARKERS.boss;
export const SERENITY_TIME = STRANDLINE_MARKERS.serenity;

export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.launch },
  { index: 1, fromBar: STRANDLINE_BARS.forest, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.ascent, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.boss, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.serenity, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'shallows', fromBar: STRANDLINE_BARS.launch, toBar: STRANDLINE_BARS.forest },
  { name: 'forest', fromBar: STRANDLINE_BARS.forest, toBar: STRANDLINE_BARS.ascent },
  { name: 'ascent', fromBar: STRANDLINE_BARS.ascent, toBar: STRANDLINE_BARS.boss },
  { name: 'crown-boss', fromBar: STRANDLINE_BARS.boss, toBar: STRANDLINE_BARS.serenity },
  { name: 'serenity', fromBar: STRANDLINE_BARS.serenity, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
