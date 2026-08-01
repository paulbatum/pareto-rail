import { createMusicTime } from '../../engine/music-time';

// VESPERS — a 60-second flight down the nave of a cathedral at night.
//
//   80 BPM, one bar = 3.0 s, 20 bars = 60 s exactly. The music is the
//   building's own organ: no percussion at all, the pulse is the
//   counterpoint moving. The run is scored in four movements:
//
//   Bars 0–8   (0–24s)    The Opening — a single held pedal note, and the
//                         voices enter one at a time above it.
//   Bars 8–10  (24–30s)   Swell 1 — choir and bell weight, the densest
//                         counterpoint so far.
//   Bars 10–12 (30–36s)   The Settle — the voices hold, the nave builds.
//   Bars 12–15 (36–45s)   The Quiet — a long dark empty span: one voice,
//                         almost nothing on screen.
//   Bars 15–16 (45–48s)   The Rebuild — the voices return.
//   Bars 16–20 (48–60s)   The Finale — the Devourer in the dead rose window;
//                         the one voice held back all night finally enters;
//                         when it dies the rose ignites, the minor turns
//                         major, and the run ends in a lit cathedral.

export const VESPERS_BPM = 80;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

export const VESPERS_BARS = {
  run: 0,
  cantus: 1,
  counter: 2,
  chorale: 4,
  moving: 6,
  swell: 8,
  settle: 10,
  quiet: 12,
  rebuild: 15,
  finale: 16,
  end: 20,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  run: VESPERS_BARS.run,
  cantus: VESPERS_BARS.cantus,
  counter: VESPERS_BARS.counter,
  chorale: VESPERS_BARS.chorale,
  moving: VESPERS_BARS.moving,
  swell: VESPERS_BARS.swell,
  settle: VESPERS_BARS.settle,
  quiet: VESPERS_BARS.quiet,
  rebuild: VESPERS_BARS.rebuild,
  bossEntrance: VESPERS_BARS.finale,
  finale: VESPERS_BARS.finale,
  end: VESPERS_BARS.end,
});

export const VESPERS_RUN_DURATION = VESPERS_TIME.bar(VESPERS_BARS.end);

// Player-instrument sections. The arrangement changes more often than these:
// the player's *timbre* (the organ stop the player's volleys sound) only
// changes with cover at four registration points.
export const VESPERS_SCORE_SECTIONS = [
  { index: 0, fromBar: VESPERS_BARS.run },
  { index: 1, fromBar: VESPERS_BARS.swell, crossfadeBars: 2 },
  { index: 2, fromBar: VESPERS_BARS.quiet, crossfadeBars: 1 },
  { index: 3, fromBar: VESPERS_BARS.finale, crossfadeBars: 1 },
] as const;

export const VESPERS_RUN_SECTIONS = [
  { name: 'pedal', fromBar: 0, toBar: 1 },
  { name: 'cantus', fromBar: 1, toBar: 2 },
  { name: 'counter', fromBar: 2, toBar: 4 },
  { name: 'chorale', fromBar: 4, toBar: 6 },
  { name: 'moving', fromBar: 6, toBar: 8 },
  { name: 'swell', fromBar: 8, toBar: 10 },
  { name: 'settle', fromBar: 10, toBar: 12 },
  { name: 'quiet', fromBar: 12, toBar: 15 },
  { name: 'rebuild', fromBar: 15, toBar: 16 },
  { name: 'finale', fromBar: 16, toBar: 20 },
] as const;

export const VESPERS_SPAWN_SYNC = {
  bpm: VESPERS_BPM,
  beatsPerBar: VESPERS_TIME.beatsPerBar,
  duration: VESPERS_RUN_DURATION,
  sections: VESPERS_RUN_SECTIONS.map((section) => ({
    name: section.name,
    fromBar: section.fromBar,
    ...('toBar' in section ? { toBar: section.toBar } : {}),
  })),
};

export const bar = VESPERS_TIME.bar;
