import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo and one bar map, shared by the arrangement, the
// spawn timeline and the level definition. Vespers is 23 bars of 4/4 at 88 —
// a little over a minute — and the whole level is addressed in bars from here.

export const VESPERS_BPM = 88;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

export const VESPERS_BARS = {
  /** A pedal note in the dark. Nothing above it yet. */
  pedal: 0,
  /** The first manual voice enters over the pedal. */
  voice: 2,
  /** The answer, a fifth up: two-part counterpoint. */
  subject: 4,
  /** Choir weight underneath. */
  choir: 6,
  /** Descant, bell, full ranks — the loudest the nave gets before the rose. */
  gallery: 8,
  /** The nave goes quiet: one voice over the pedal, almost nothing on screen. */
  hush: 12,
  /** The voices come back one at a time and the dead rose comes out of the dark. */
  approach: 15,
  /** The rose fight. */
  rose: 16,
  /** Where the run ends if nothing has been broken open. */
  close: 22,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  pedal: VESPERS_BARS.pedal,
  voice: VESPERS_BARS.voice,
  subject: VESPERS_BARS.subject,
  choir: VESPERS_BARS.choir,
  gallery: VESPERS_BARS.gallery,
  hush: VESPERS_BARS.hush,
  approach: VESPERS_BARS.approach,
  rose: VESPERS_BARS.rose,
  roseEntrance: [VESPERS_BARS.rose, 0.5],
  close: VESPERS_BARS.close,
});

export const VESPERS_RUN_DURATION = VESPERS_TIME.bar(23);

export type VespersSection = 'nave' | 'subject' | 'gallery' | 'hush' | 'rose' | 'tutti';

/**
 * Where the *player's* instruments change voice. These lag the arrangement
 * where the backing does not turn over on the same bar, so a timbre handover
 * has cover to crossfade under.
 */
export const VESPERS_SCORE_SECTIONS = [
  { index: 'nave', fromBar: VESPERS_BARS.pedal },
  { index: 'subject', fromBar: VESPERS_BARS.subject, crossfadeBars: 2 },
  { index: 'gallery', fromBar: VESPERS_BARS.gallery, crossfadeBars: 2 },
  { index: 'hush', fromBar: VESPERS_BARS.hush, crossfadeBars: 1 },
  { index: 'rose', fromBar: VESPERS_BARS.rose, crossfadeBars: 1 },
  // Only reached by override, when the heart dies and every rank opens.
  { index: 'tutti', fromBar: VESPERS_BARS.close + 1 },
] as const satisfies ReadonlyArray<{ index: VespersSection; fromBar: number; crossfadeBars?: number }>;

export const VESPERS_RUN_SECTIONS = [
  { name: 'pedal', fromBar: VESPERS_BARS.pedal },
  { name: 'voice', fromBar: VESPERS_BARS.voice },
  { name: 'subject', fromBar: VESPERS_BARS.subject },
  { name: 'choir', fromBar: VESPERS_BARS.choir },
  { name: 'gallery', fromBar: VESPERS_BARS.gallery },
  { name: 'hush', fromBar: VESPERS_BARS.hush },
  { name: 'approach', fromBar: VESPERS_BARS.approach },
  { name: 'rose', fromBar: VESPERS_BARS.rose },
  { name: 'close', fromBar: VESPERS_BARS.close },
] as const;
