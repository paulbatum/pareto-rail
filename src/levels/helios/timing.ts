import { createMusicTime } from '../../engine/music-time';

export const HELIOS_BPM = 172;
export const HELIOS_STEPS_PER_BAR = 16;
export const HELIOS_TIME = createMusicTime(HELIOS_BPM, { stepsPerBar: HELIOS_STEPS_PER_BAR });
export const HELIOS_BAR = HELIOS_TIME.barSeconds;

export const HELIOS_BARS = {
  intro: 0,
  build: 8,
  gate: 16,
  shift: 32,
  corona: 40,
  reveal: 56,
  bossEntrance: 60,
  boss: 64,
  outro: 80,
  end: 86,
} as const;

export const HELIOS_MARKERS = HELIOS_TIME.markers({
  intro: HELIOS_BARS.intro,
  build: HELIOS_BARS.build,
  gate: HELIOS_BARS.gate,
  shift: HELIOS_BARS.shift,
  corona: HELIOS_BARS.corona,
  reveal: HELIOS_BARS.reveal,
  bossEntrance: HELIOS_BARS.bossEntrance,
  boss: HELIOS_BARS.boss,
  outro: HELIOS_BARS.outro,
  end: HELIOS_BARS.end,
});

export const HELIOS_DURATION = HELIOS_MARKERS.end;
export const GATE_TIME = HELIOS_MARKERS.gate;
export const CORONA_TIME = HELIOS_MARKERS.corona;
export const REVEAL_TIME = HELIOS_MARKERS.reveal;
export const BOSS_TIME = HELIOS_MARKERS.bossEntrance;
export const DROP3_TIME = HELIOS_MARKERS.boss;

export const HELIOS_SCORE_SECTIONS = [
  { index: 0, fromBar: HELIOS_BARS.intro },
  { index: 1, fromBar: HELIOS_BARS.gate, crossfadeBars: 2 },
  { index: 2, fromBar: HELIOS_BARS.corona, crossfadeBars: 2 },
  { index: 3, fromBar: HELIOS_BARS.boss, crossfadeBars: 2 },
] as const;

export const HELIOS_RUN_SECTIONS = [
  { name: 'intro', fromBar: HELIOS_BARS.intro, toBar: HELIOS_BARS.build },
  { name: 'build', fromBar: HELIOS_BARS.build, toBar: HELIOS_BARS.gate },
  { name: 'drop-1', fromBar: HELIOS_BARS.gate, toBar: HELIOS_BARS.shift },
  { name: 'shift', fromBar: HELIOS_BARS.shift, toBar: HELIOS_BARS.corona },
  { name: 'drop-2', fromBar: HELIOS_BARS.corona, toBar: HELIOS_BARS.reveal },
  { name: 'breakdown', fromBar: HELIOS_BARS.reveal, toBar: HELIOS_BARS.boss },
  { name: 'boss', fromBar: HELIOS_BARS.boss, toBar: HELIOS_BARS.outro },
  { name: 'outro', fromBar: HELIOS_BARS.outro, toBar: HELIOS_BARS.end },
] as const;

export const HELIOS_SPAWN_SYNC = {
  bpm: HELIOS_BPM,
  beatsPerBar: HELIOS_TIME.beatsPerBar,
  duration: HELIOS_DURATION,
  sections: HELIOS_RUN_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};

export const bar = HELIOS_TIME.bar;
