import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo. 112 BPM in common time: a bar is 15/7 s, so the
// 28-bar run lands on exactly 60.0 seconds and every phrase boundary below
// is a real seconds value the gameplay, visuals, and score all read.
export const BROADSIDE_BPM = 112;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR = BROADSIDE_TIME.barSeconds;

// The run in seven movements. Bars are zero-based arrangement bars.
export const BARS = {
  launch: 0, // catapult off the flagship deck
  gaps: 2, // banks and the barrel roll through the crossfire
  flank: 8, // high-speed run down the friendly cruiser's flank under its broadside
  eye: 12, // the quiet in the middle of the battle
  belly: 14, // under the enemy warship, raking its turrets
  flagship: 18, // shield-generator pass along the enemy flagship
  loop: 21, // the rail comes around the bow; escorts pour in
  trench: 22.5, // dive into the trenchwork for the power cores
  pullout: 25.5, // out of the trench and away, the whole battle in frame
  end: 28,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BARS.launch,
  gaps: BARS.gaps,
  roll: 6,
  flank: BARS.flank,
  eye: BARS.eye,
  belly: BARS.belly,
  flagship: BARS.flagship,
  loop: BARS.loop,
  trench: BARS.trench,
  pullout: BARS.pullout,
});

export const BROADSIDE_DURATION = BROADSIDE_TIME.bar(BARS.end);

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BARS.launch },
  { name: 'the gaps', fromBar: BARS.gaps },
  { name: 'flank run', fromBar: BARS.flank },
  { name: 'the eye', fromBar: BARS.eye },
  { name: 'belly run', fromBar: BARS.belly },
  { name: 'flagship', fromBar: BARS.flagship },
  { name: 'trench', fromBar: BARS.trench },
  { name: 'pull-out', fromBar: BARS.pullout },
] as const;

export const bar = BROADSIDE_TIME.bar;
