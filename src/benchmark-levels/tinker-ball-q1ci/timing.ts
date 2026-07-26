import { createMusicTime } from '../../engine/music-time';

export const TINKER_BALL_Q1CI_BPM = 128;
export const TINKER_BALL_Q1CI_STEPS_PER_BAR = 16;
export const TINKER_BALL_Q1CI_TIME = createMusicTime(TINKER_BALL_Q1CI_BPM, {
  stepsPerBar: TINKER_BALL_Q1CI_STEPS_PER_BAR,
});

// Thirty-two common-time bars at 128 BPM land exactly on the requested minute.
export const TINKER_BALL_Q1CI_RUN_DURATION = TINKER_BALL_Q1CI_TIME.bar(32);

export const TINKER_BALL_Q1CI_MARKERS = TINKER_BALL_Q1CI_TIME.markers({
  marbleRun: 0,
  spoolParade: 8,
  heavyLifting: 16,
  spillEntrance: 24,
  cleanSweep: 30,
  finish: 32,
});

export type TinkerBallSectionName =
  | 'marble-run'
  | 'spool-parade'
  | 'heavy-lifting'
  | 'the-spill'
  | 'clean-sweep';

export const TINKER_BALL_Q1CI_SCORE_SECTIONS: ReadonlyArray<{
  index: TinkerBallSectionName;
  fromBar: number;
  crossfadeBars?: number;
}> = [
  { index: 'marble-run', fromBar: 0 },
  { index: 'spool-parade', fromBar: 8, crossfadeBars: 1 },
  { index: 'heavy-lifting', fromBar: 16, crossfadeBars: 1 },
  { index: 'the-spill', fromBar: 24 },
  { index: 'clean-sweep', fromBar: 30 },
];

export const TINKER_BALL_Q1CI_RUN_SECTIONS: ReadonlyArray<{
  name: string;
  fromBar: number;
  toBar?: number;
}> = [
  { name: 'MARBLE RUN', fromBar: 0, toBar: 8 },
  { name: 'SPOOL PARADE', fromBar: 8, toBar: 16 },
  { name: 'HEAVY LIFTING', fromBar: 16, toBar: 24 },
  { name: 'THE GLUE SPILL', fromBar: 24, toBar: 30 },
  { name: 'CLEAN SWEEP', fromBar: 30, toBar: 32 },
];
