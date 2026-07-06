import { createMusicTime } from '../../engine/music-time';

export const CRYSTAL_BPM = 126;
export const CRYSTAL_STEPS_PER_BAR = 16;
export const CRYSTAL_TIME = createMusicTime(CRYSTAL_BPM, { stepsPerBar: CRYSTAL_STEPS_PER_BAR });

export const CRYSTAL_BARS = {
  run: 0,
  warmup: 2,
  claps: 4,
  gameplayAct2: 5,
  openHats: 6,
  playerAct2: 7,
  drive: 8,
  preWarden: 14,
  wardenFill: 16,
  playerWarden: 18,
  finale: 21,
} as const;

export const CRYSTAL_MARKERS = CRYSTAL_TIME.markers({
  run: CRYSTAL_BARS.run,
  warmup: CRYSTAL_BARS.warmup,
  claps: CRYSTAL_BARS.claps,
  gameplayAct2: [CRYSTAL_BARS.gameplayAct2, 1],
  openHats: CRYSTAL_BARS.openHats,
  playerAct2: CRYSTAL_BARS.playerAct2,
  drive: CRYSTAL_BARS.drive,
  preWarden: CRYSTAL_BARS.preWarden,
  wardenFill: CRYSTAL_BARS.wardenFill,
  bossEntrance: [CRYSTAL_BARS.wardenFill, 2.36],
  playerWarden: CRYSTAL_BARS.playerWarden,
  finale: CRYSTAL_BARS.finale,
});

export const CRYSTAL_RUN_DURATION = CRYSTAL_TIME.bar(23, 2.5);

export const CRYSTAL_SCORE_SECTIONS = [
  { index: 0, fromBar: CRYSTAL_BARS.run },
  { index: 1, fromBar: CRYSTAL_BARS.playerAct2, crossfadeBars: 2 },
  { index: 2, fromBar: CRYSTAL_BARS.playerWarden, crossfadeBars: 2 },
] as const;

export const CRYSTAL_RUN_SECTIONS = [
  { name: 'bar-0', fromBar: CRYSTAL_BARS.run, toBar: 1 },
  { name: 'bar-1', fromBar: 1, toBar: CRYSTAL_BARS.warmup },
  { name: 'warmup', fromBar: CRYSTAL_BARS.warmup, toBar: CRYSTAL_BARS.claps },
  { name: 'claps', fromBar: CRYSTAL_BARS.claps, toBar: CRYSTAL_BARS.openHats },
  { name: 'open-hats', fromBar: CRYSTAL_BARS.openHats, toBar: CRYSTAL_BARS.drive },
  { name: 'drive', fromBar: CRYSTAL_BARS.drive, toBar: CRYSTAL_BARS.preWarden },
  { name: 'pre-warden', fromBar: CRYSTAL_BARS.preWarden, toBar: CRYSTAL_BARS.wardenFill },
  { name: 'warden-fill', fromBar: CRYSTAL_BARS.wardenFill, toBar: CRYSTAL_BARS.finale },
  { name: 'finale', fromBar: CRYSTAL_BARS.finale },
] as const;

export const CRYSTAL_SPAWN_SYNC = {
  bpm: CRYSTAL_BPM,
  beatsPerBar: CRYSTAL_TIME.beatsPerBar,
  duration: CRYSTAL_RUN_DURATION,
  sections: CRYSTAL_RUN_SECTIONS.map((section) => ({
    name: section.name,
    fromBar: section.fromBar,
    ...('toBar' in section ? { toBar: section.toBar } : {}),
  })),
};
