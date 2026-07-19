import { createMusicTime } from '../../engine/music-time';

// BROADSIDE — 128 BPM, 32 bars = exactly 60 seconds. One bar = 1.875 s.
// The run launches off the friendly flagship, crosses a full fleet engagement,
// and ends at the enemy flagship on the far side:
//
//   launch     bars  0– 3   Off the deck; the battle opens up.
//   melee      bars  4– 7   First swarm waves between the fleets.
//   surge      bars  8–11   Dense crossfire; gunboats arrive.
//   broadside  bars 12–15   High-speed run down a friendly cruiser's flank
//                           while its broadside ripples overhead on the beat.
//   eye        bars 16–19   The eye of the battle: wreck field, near silence.
//   belly      bars 20–23   Under an enemy warship, raking its belly turrets.
//   flagship   bars 24–27   Shield-generator pass along the enemy flagship.
//   interlude  bars 28–29   Around the bow; escorts pour in.
//   trench     bars 30–31   Trench dive into the power cores; victory theme.
//   end        bar  32      60.0 s — the pull-out.

export const BROADSIDE_BPM = 128;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR = BROADSIDE_TIME.barSeconds;
export const BROADSIDE_BEAT = BROADSIDE_TIME.beatSeconds;
export const BROADSIDE_STEP = BROADSIDE_TIME.stepSeconds;

export const BROADSIDE_BARS = {
  launch: 0,
  melee: 4,
  surge: 8,
  broadside: 12,
  eye: 16,
  belly: 20,
  flagship: 24,
  interlude: 28,
  trench: 30,
  end: 32,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BROADSIDE_BARS.launch,
  melee: BROADSIDE_BARS.melee,
  surge: BROADSIDE_BARS.surge,
  broadside: BROADSIDE_BARS.broadside,
  eye: BROADSIDE_BARS.eye,
  belly: BROADSIDE_BARS.belly,
  flagship: BROADSIDE_BARS.flagship,
  interlude: BROADSIDE_BARS.interlude,
  trench: BROADSIDE_BARS.trench,
  end: BROADSIDE_BARS.end,
});

export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;

// Score sections: player-voice timbres and kill lanes crossfade on these.
export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.launch },
  { index: 1, fromBar: BROADSIDE_BARS.melee, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.broadside, crossfadeBars: 1 },
  { index: 3, fromBar: BROADSIDE_BARS.eye, crossfadeBars: 1 },
  { index: 4, fromBar: BROADSIDE_BARS.belly, crossfadeBars: 1 },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_BARS.launch, toBar: BROADSIDE_BARS.melee },
  { name: 'melee', fromBar: BROADSIDE_BARS.melee, toBar: BROADSIDE_BARS.surge },
  { name: 'surge', fromBar: BROADSIDE_BARS.surge, toBar: BROADSIDE_BARS.broadside },
  { name: 'broadside', fromBar: BROADSIDE_BARS.broadside, toBar: BROADSIDE_BARS.eye },
  { name: 'eye', fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.belly },
  { name: 'belly', fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship },
  { name: 'flagship', fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.interlude },
  { name: 'interlude', fromBar: BROADSIDE_BARS.interlude, toBar: BROADSIDE_BARS.trench },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.end },
] as const;

export const bar = BROADSIDE_TIME.bar;

// ---- the broadside cannon ripple --------------------------------------------
// Shared by the audio arrangement (booms) and the environment (muzzle flashes
// and tracer streaks): during the broadside run the friendly cruiser's eight
// guns ripple one per eighth note, with full eight-gun volleys at bars 12 & 14.

export const BROADSIDE_GUN_COUNT = 8;

export type CannonShot = { time: number; gun: number; volley: boolean };

export function broadsideCannonSchedule(): CannonShot[] {
  const shots: CannonShot[] = [];
  const seen = new Set<string>();
  const push = (time: number, gun: number, volley: boolean) => {
    const key = `${time.toFixed(4)}:${gun}`;
    if (seen.has(key)) return;
    seen.add(key);
    shots.push({ time, gun, volley });
  };
  for (let barIndex = BROADSIDE_BARS.broadside; barIndex < BROADSIDE_BARS.eye; barIndex += 1) {
    for (let step = 0; step < BROADSIDE_STEPS_PER_BAR; step += 2) {
      const ripple = ((barIndex - BROADSIDE_BARS.broadside) * BROADSIDE_STEPS_PER_BAR + step) / 2;
      push(BROADSIDE_TIME.step(barIndex, step), ripple % BROADSIDE_GUN_COUNT, false);
    }
  }
  for (const volleyBar of [BROADSIDE_BARS.broadside, BROADSIDE_BARS.broadside + 2]) {
    for (let gun = 0; gun < BROADSIDE_GUN_COUNT; gun += 1) push(BROADSIDE_TIME.bar(volleyBar), gun, true);
  }
  return shots.sort((a, b) => a.time - b.time);
}
