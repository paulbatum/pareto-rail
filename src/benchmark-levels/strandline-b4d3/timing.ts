import { createMusicTime } from '../../engine/music-time';

export const BPM = 96;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(24);
export const MARKERS = {
  firstLight: TIME.bar(1),
  greenMoon: TIME.bar(7),
  returnToTheStrands: TIME.bar(9),
  crown: TIME.bar(15),
  lastBrood: TIME.bar(17.75),
  release: TIME.bar(20),
  drifting: TIME.bar(23),
};
export const SECTIONS = [
  { name: 'In the strands', fromBar: 0, index: 0 },
  { name: 'A green moon', fromBar: 6, index: 1 },
  { name: 'Returning light', fromBar: 9, index: 2 },
  { name: 'The crown infestation', fromBar: 15, index: 3 },
  { name: 'A living sea', fromBar: 21, index: 4 },
];
