# Engine brief 02: declarative voice specs

Part 2 of the wishlist sequence. Independent of brief 01. Read `AGENTS.md`, `docs/level-authoring.md`, and skim `src/engine/audio-kit.ts` first. Standing rules: **the engine encodes contracts, never answers**, and **no preset library** — named voices like "bass2" are convergence machines; the deliverable is a spec vocabulary with zero-cost custom voices. Retrofits are behavior-preserving.

## Problem

`playOscillatorVoice` is the right primitive but the wrong authoring altitude. Every pitched sound in a level is a hand-written invocation with explicit automation arrays — crystal's `audio.ts` (721 lines) and `audio-voices.ts` (228 lines) are dominated by this ceremony, and most invocations differ only in envelope numbers, filter cutoff, and send gains. The creative content is ~6 numbers per voice; the cost is ~25 lines per call site.

## Deliverable: a voice-spec layer over the existing primitives

A helper (suggest `src/engine/audio-voices.ts` or a section of `audio-kit.ts`) that turns a compact spec into a play function:

```ts
const pluck = voice({
  oscillators: [
    { type: 'square', gain: 1 },
    { type: 'sine', octave: -1, gain: 0.55 },   // the "body an octave below" idiom
  ],
  filter: { type: 'lowpass', cutoff: 2600 },
  envelope: { attack: 0.002, decay: 0.24, sustain: 0, release: 0.05 },
  sends: { delay: 0.45 },
});
// later, per note:
pluck.play(context, { time, midi, velocity, destination, cutoff: 3000 });  // per-call overrides
```

Requirements:

- Compiles down to the existing `playOscillatorVoice` / `playNoiseHit` calls — same automation shapes, same nodes, so retrofits can be audit-by-diff.
- Per-call overrides for anything a level currently varies per note (velocity, cutoff, decay, detune, frequency glide, send gains). If a level's existing sound needs an override the spec can't express, extend the spec rather than leaving a raw call behind — but raw `playOscillatorVoice` remains a legal escape hatch.
- Crossfade-friendly: crystal blends two acts' voices with complementary weights during section crossfades (see `killNote`). The layer must make "play this spec at weight w" natural so that idiom survives.
- Composes with `defineInstruments` tracing and the mix buses exactly as today. Voices defined inside `defineInstruments` bodies must trace identically.

## Retrofits

- **crystal** — rebuild `audio-voices.ts` voices and the mechanical parts of the inline event handlers (`killNote`, lock, fire, hit, reject, playerhit) on specs. The choreography decisions (which events play what, when, at what pitch) stay exactly as written.
- **helios** — same treatment for its voices leaf and handlers; it has a post-build drone, which may need a sustained-voice spec shape (attack/sustain without a scheduled stop) — add it if so.
- **prism** — survey; it uses raw primitives with a combined-volume mix. Convert what is mechanical.
- **rezdle** — optional.

Gates per level: `npm run trace:audio -- --level <id> --compare` must match exactly (baseline before editing). Be honest about coverage: inline event-handler sounds are not in the semantic trace, so for those the gate is (a) the refactor compiles to the same primitive calls — verify by reading the diff against the compiled output shapes, (b) `trace:audio --graph` before/after review where it helps, and (c) a human listen at the end. Say plainly in the report which sounds are trace-verified and which are ear-verified.

## Docs

Add the module to `docs/level-authoring.md`'s shared-code inventory and one sentence in "Musical action audio" pointing at the spec layer as the default way to build player-instrument timbres.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Any audible change; retuning any gain "while we're here."
- Event choreography — which events trigger which sounds is creative language and stays per level.
- Preset/named-voice libraries shared across levels.
