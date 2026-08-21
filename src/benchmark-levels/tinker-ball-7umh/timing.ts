import { createMusicTime } from '../../engine/music-time';

export const TINKER_BPM = 128;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, { stepsPerBar: TINKER_STEPS_PER_BAR });

export const TINKER_BARS = {
  run: 0,
  marbleGroove: 2,
  skitterers: 4,
  firstSnappers: 7,
  scaleTennis: 10,
  walkers: 12,
  mortars: 15,
  scaleMelon: 18,
  preSpill: 20,
  spillBoss: 22,
  spillCoreBreak: 26,
  spillHeart: 27,
  finale: 30,
  end: 32,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  run: TINKER_BARS.run,
  marbleGroove: TINKER_BARS.marbleGroove,
  skitterers: TINKER_BARS.skitterers,
  firstSnappers: TINKER_BARS.firstSnappers,
  scaleTennis: TINKER_BARS.scaleTennis,
  walkers: TINKER_BARS.walkers,
  mortars: TINKER_BARS.mortars,
  scaleMelon: TINKER_BARS.scaleMelon,
  preSpill: TINKER_BARS.preSpill,
  spillBoss: TINKER_BARS.spillBoss,
  spillHeart: TINKER_BARS.spillHeart,
  finale: TINKER_BARS.finale,
  end: TINKER_BARS.end,
});

export const TINKER_RUN_DURATION = TINKER_TIME.bar(TINKER_BARS.end); // Exactly 60.00s

export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: TINKER_BARS.run },
  { index: 1, fromBar: TINKER_BARS.scaleTennis, crossfadeBars: 1 },
  { index: 2, fromBar: TINKER_BARS.spillBoss, crossfadeBars: 1 },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'marble-intro', fromBar: TINKER_BARS.run, toBar: TINKER_BARS.skitterers },
  { name: 'marble-clutter', fromBar: TINKER_BARS.skitterers, toBar: TINKER_BARS.scaleTennis },
  { name: 'tennis-rush', fromBar: TINKER_BARS.scaleTennis, toBar: TINKER_BARS.scaleMelon },
  { name: 'melon-approach', fromBar: TINKER_BARS.scaleMelon, toBar: TINKER_BARS.spillBoss },
  { name: 'the-glue-spill', fromBar: TINKER_BARS.spillBoss, toBar: TINKER_BARS.finale },
  { name: 'spotless-coast', fromBar: TINKER_BARS.finale, toBar: TINKER_BARS.end },
] as const;

export const bar = (bars: number, beat = 0) => TINKER_TIME.bar(bars, beat);
export const step = (bars: number, stepInBar = 0) => TINKER_TIME.step(bars, stepInBar);
