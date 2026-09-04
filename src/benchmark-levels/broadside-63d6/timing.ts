import { createMusicTime } from '../../engine/music-time';

export const BPM = 128;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32);
export const SECTIONS = [
  { name: 'Flight deck', fromBar: 0 },
  { name: 'The crossing', fromBar: 4 },
  { name: 'Broadside', fromBar: 8 },
  { name: 'Under the guns', fromBar: 12 },
  { name: 'Eye of the battle', fromBar: 16 },
  { name: 'Break the shield', fromBar: 18 },
  { name: 'Coming around', fromBar: 23 },
  { name: 'Into the trench', fromBar: 25 },
  { name: 'A sky worth saving', fromBar: 29 },
];
export const MARKERS = {
  launch: TIME.bar(1), crossing: TIME.bar(6), broadside: TIME.bar(9),
  belly: TIME.bar(13), eye: TIME.bar(17), generators: TIME.bar(20),
  escort: TIME.bar(23.5), trench: TIME.bar(27), victory: TIME.bar(31),
};
