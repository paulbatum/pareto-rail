import { createMusicTime } from '../../engine/music-time';

// One continuous boss fight, scored to twenty-four bars at a slow industrial
// 96 BPM: a bar is 2.5s and the run is exactly 60.000s of six four-bar phrases.
// Every gameplay beat in this level — ink blackouts, arm reveals, the core
// exposure — is authored in bars here so gameplay, audio, and visuals all read
// the same clock.
export const THERMAL_INK_BPM = 96;
export const THERMAL_INK_STEPS_PER_BAR = 16;
export const THERMAL_INK_TIME = createMusicTime(THERMAL_INK_BPM, { stepsPerBar: THERMAL_INK_STEPS_PER_BAR });

export const THERMAL_INK_BARS = {
  run: 0,
  /** Bass and the harbour pulse arrive; the creature stirs. */
  pulse: 2,
  /** Full kit. The first arm uncoils and the fight is on. */
  engage: 4,
  /** First ink cloud: the teaching blackout. */
  inkA: 6,
  /** Murk returns, heavier. Arms start spitting darts. */
  surge: 8,
  gather: 10,
  /** Second ink cloud, longer and denser. */
  inkB: 12,
  swarm: 14,
  crush: 16,
  /** Shell splits; the core is about to be reachable. */
  expose: 19,
  /** Final blackout — the last volley lands through it. */
  inkC: 20,
  /** Lamps return over the collapsing silhouette. */
  collapse: 22.5,
} as const;

export const THERMAL_INK_RUN_DURATION = THERMAL_INK_TIME.bar(24);

export const THERMAL_INK_MARKERS = THERMAL_INK_TIME.markers({
  pulse: THERMAL_INK_BARS.pulse,
  engage: THERMAL_INK_BARS.engage,
  inkA: THERMAL_INK_BARS.inkA,
  surge: THERMAL_INK_BARS.surge,
  inkB: THERMAL_INK_BARS.inkB,
  swarm: THERMAL_INK_BARS.swarm,
  crush: THERMAL_INK_BARS.crush,
  expose: THERMAL_INK_BARS.expose,
  inkC: THERMAL_INK_BARS.inkC,
  collapse: THERMAL_INK_BARS.collapse,
});

export const THERMAL_INK_RUN_SECTIONS = [
  { name: 'descent', fromBar: THERMAL_INK_BARS.run, toBar: THERMAL_INK_BARS.pulse },
  { name: 'pulse', fromBar: THERMAL_INK_BARS.pulse, toBar: THERMAL_INK_BARS.engage },
  { name: 'engage', fromBar: THERMAL_INK_BARS.engage, toBar: THERMAL_INK_BARS.inkA },
  { name: 'ink-a', fromBar: THERMAL_INK_BARS.inkA, toBar: THERMAL_INK_BARS.surge },
  { name: 'surge', fromBar: THERMAL_INK_BARS.surge, toBar: THERMAL_INK_BARS.gather },
  { name: 'gather', fromBar: THERMAL_INK_BARS.gather, toBar: THERMAL_INK_BARS.inkB },
  { name: 'ink-b', fromBar: THERMAL_INK_BARS.inkB, toBar: THERMAL_INK_BARS.swarm },
  { name: 'swarm', fromBar: THERMAL_INK_BARS.swarm, toBar: THERMAL_INK_BARS.crush },
  { name: 'crush', fromBar: THERMAL_INK_BARS.crush, toBar: THERMAL_INK_BARS.inkC },
  { name: 'ink-c', fromBar: THERMAL_INK_BARS.inkC, toBar: THERMAL_INK_BARS.collapse },
  { name: 'lamps-return', fromBar: THERMAL_INK_BARS.collapse },
] as const;

// Player-instrument voicing acts. The backing arrangement does not turn over at
// bars 8 or 16, so both handovers crossfade; the level's one hard switch is the
// core exposure, where the music turns over with it.
export const THERMAL_INK_SCORE_SECTIONS = [
  { index: 0, fromBar: THERMAL_INK_BARS.run },
  { index: 1, fromBar: THERMAL_INK_BARS.surge, crossfadeBars: 2 },
  { index: 2, fromBar: THERMAL_INK_BARS.expose, crossfadeBars: 2 },
] as const;

export type InkWindow = { from: number; to: number; peak: number };

/**
 * The octopus ejects three clouds across the fight. `from`/`to` bracket the
 * dense core of each cloud; the envelope below rolls on fast (the cloud hits
 * you) and thins slowly (you fly out the far side).
 */
export const THERMAL_INK_WINDOWS: readonly InkWindow[] = [
  { from: THERMAL_INK_BARS.inkA, to: THERMAL_INK_BARS.inkA + 1.7, peak: 0.94 },
  { from: THERMAL_INK_BARS.inkB, to: THERMAL_INK_BARS.inkB + 2.0, peak: 0.97 },
  { from: THERMAL_INK_BARS.inkC, to: THERMAL_INK_BARS.collapse - 0.35, peak: 1 },
];

const INK_ATTACK_BARS = 0.32;
const INK_RELEASE_BARS = 0.85;

/** Authored ink density at an arrangement bar, in 0..1. */
export function inkAtBar(bar: number): number {
  let density = 0;
  for (const window of THERMAL_INK_WINDOWS) {
    if (bar <= window.from - INK_ATTACK_BARS || bar >= window.to + INK_RELEASE_BARS) continue;
    const rise = smoothstep((bar - (window.from - INK_ATTACK_BARS)) / INK_ATTACK_BARS);
    const fall = 1 - smoothstep((bar - window.to) / INK_RELEASE_BARS);
    density = Math.max(density, window.peak * Math.min(rise, bar <= window.to ? 1 : fall));
  }
  return density;
}

/** Authored ink density at a run time in seconds. */
export function inkAtTime(seconds: number): number {
  return inkAtBar(seconds / THERMAL_INK_TIME.barSeconds);
}

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
