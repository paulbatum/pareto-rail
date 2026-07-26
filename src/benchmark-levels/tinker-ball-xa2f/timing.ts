import { createMusicTime } from '../../engine/music-time';

export const TINKER_BALL_XA2F_BPM = 128;
export const TINKER_BALL_XA2F_TIME = createMusicTime(TINKER_BALL_XA2F_BPM, { stepsPerBar: 16 });

export const TINKER_BALL_XA2F_BARS = 32;
export const TINKER_BALL_XA2F_RUN_DURATION = TINKER_BALL_XA2F_TIME.bar(TINKER_BALL_XA2F_BARS);

export const TINKER_BALL_XA2F_MARKERS = {
  act1Start: TINKER_BALL_XA2F_TIME.bar(0),
  act2Start: TINKER_BALL_XA2F_TIME.bar(8),
  act3Start: TINKER_BALL_XA2F_TIME.bar(16),
  bossEntrance: TINKER_BALL_XA2F_TIME.bar(20),
  outroStart: TINKER_BALL_XA2F_TIME.bar(28),
} as const;

export const TINKER_BALL_XA2F_SECTIONS = [
  { name: 'Marble Clutter', fromBar: 0 },
  { name: 'Spool & Eraser Sweep', fromBar: 8 },
  { name: 'Melon Scale & Rulers', fromBar: 16 },
  { name: 'Glue Spill Core', fromBar: 20 },
  { name: 'Spotless Finish', fromBar: 28 },
] as const;
