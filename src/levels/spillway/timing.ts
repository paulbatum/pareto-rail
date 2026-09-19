import { createMusicTime } from '../../engine/music-time';

export const SPILLWAY_BPM = 132;
export const SPILLWAY_STEPS_PER_BAR = 16;
export const SPILLWAY_TIME = createMusicTime(SPILLWAY_BPM, { stepsPerBar: SPILLWAY_STEPS_PER_BAR });
export const SPILLWAY_BAR = SPILLWAY_TIME.barSeconds;

// The run's set pieces, in bars. 70 bars at 132 BPM is about 127 seconds.
export const SPILLWAY_BARS = {
  upper: 0, // wide calm pool at the head of the gorge; the walker wades away downstream
  narrows: 8, // walls close in, first rapids, winch pods on the cliffs
  chute: 20, // the river drops down a cascade: first speed kick
  whitewater: 22, // full rapids; the rail passes under the walker's belly
  reservoir: 36, // the gorge opens onto the long reservoir; the dam at the far end
  dam: 42, // the walker climbs onto the dam and sets its claws in the gates
  boss: 44, // fight at the dam crest: legs, then the core
  breach: 58, // the gates give way; the music drops out; the camera turns
  spillway: 60, // the flood carries you over the spillway and down the chute
  valley: 66, // open sunlit water, everything slows and goes quiet
  end: 70,
} as const;

export const SPILLWAY_MARKERS = SPILLWAY_TIME.markers(SPILLWAY_BARS);
export const SPILLWAY_DURATION = SPILLWAY_MARKERS.end;

export const SPILLWAY_RUN_SECTIONS = [
  { name: 'upper', fromBar: SPILLWAY_BARS.upper, toBar: SPILLWAY_BARS.narrows },
  { name: 'narrows', fromBar: SPILLWAY_BARS.narrows, toBar: SPILLWAY_BARS.chute },
  { name: 'chute', fromBar: SPILLWAY_BARS.chute, toBar: SPILLWAY_BARS.whitewater },
  { name: 'whitewater', fromBar: SPILLWAY_BARS.whitewater, toBar: SPILLWAY_BARS.reservoir },
  { name: 'reservoir', fromBar: SPILLWAY_BARS.reservoir, toBar: SPILLWAY_BARS.dam },
  { name: 'dam', fromBar: SPILLWAY_BARS.dam, toBar: SPILLWAY_BARS.boss },
  { name: 'boss', fromBar: SPILLWAY_BARS.boss, toBar: SPILLWAY_BARS.breach },
  { name: 'breach', fromBar: SPILLWAY_BARS.breach, toBar: SPILLWAY_BARS.spillway },
  { name: 'spillway', fromBar: SPILLWAY_BARS.spillway, toBar: SPILLWAY_BARS.valley },
  { name: 'valley', fromBar: SPILLWAY_BARS.valley, toBar: SPILLWAY_BARS.end },
] as const;

export const bar = SPILLWAY_TIME.bar;
