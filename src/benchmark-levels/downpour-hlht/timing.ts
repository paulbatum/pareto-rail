import { createMusicTime } from '../../engine/music-time';

export const DOWNPOUR_BPM = 176;
export const DOWNPOUR_TIME = createMusicTime(DOWNPOUR_BPM, { stepsPerBar: 16 });
export const DOWNPOUR_BARS = { prelude: 0, firstDrop: 10, undercity: 18, secondDrop: 28, hunt: 36, release: 42, end: 44 } as const;
export const DOWNPOUR_MARKERS = DOWNPOUR_TIME.markers(DOWNPOUR_BARS);
export const DOWNPOUR_DURATION = DOWNPOUR_MARKERS.end;
export const DOWNPOUR_SECTIONS = [
  { name: 'storm ceiling', fromBar: 0, toBar: 10 }, { name: 'towerfall', fromBar: 10, toBar: 18 },
  { name: 'undercity', fromBar: 18, toBar: 28 }, { name: 'canal drop', fromBar: 28, toBar: 36 },
  { name: 'hunter climb', fromBar: 36, toBar: 42 }, { name: 'above the weather', fromBar: 42, toBar: 44 },
] as const;
