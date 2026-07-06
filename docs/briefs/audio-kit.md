# Engine brief: audio-kit phase 2 — score, instruments, arrangement

Read `AGENTS.md` and `docs/level-authoring.md` first (especially "Musical action audio"). This is engine and refactor work, not a level task. It supersedes tasks 1 and 2 of `docs/briefs/spine-leaf-retrofits.md` (the crystal/helios audio splits); task C below amends that brief.

**Execution: three tasks, in order, each verified and reported separately. Do only the task you are asked to do.**

## Motivation

A level's audio module is currently ~1,000–1,300 lines, of which well under half are musical decisions. The rest is machinery that crystal and helios re-implement nearly verbatim: the mix-bus graph, a trace guard pasted into every instrument, transport-epoch grid math, chord/section/crossfade lookup, the kill-melody step walker, the trace harness, and — the worst offender — a step sequencer written as chains of modular-arithmetic conditionals (`if (step === 0 || step === 10) kick(...)`). For an agent authoring a new level, both writing and reading this costs tokens and invites subtle bugs (epoch anchoring, crossfade weighting) that took playtesting to find the first time.

Target: after this brief, a new level's audio spine is a few hundred lines that are almost entirely musical decisions — chord tables, pattern strings, voice parameters, event choreography — with the machinery imported.

## Guiding rules

- **The kit encodes contracts, never answers.** No default patterns, progressions, voices, gains, tempos, or section shapes in the engine. Every musical number stays in the level. (Same rule as the scaffold brief.)
- **Retrofits are behavior-preserving.** `npm run trace:audio -- --level <id> --compare` is the gate: the semantic event stream must be identical before and after (byte-identical `--verbose` output, or every difference individually explained in the report).
- Keep the API surface small and typed. Levels that want to bypass any helper and use raw `audio-kit` primitives still can; nothing existing may break.

## Task A — score kit, instrument registry, mix bus; pilot in prism

### A1. Mix-bus preset (`src/engine/audio-kit.ts`)

One call that builds the standard bus topology crystal and helios both hand-wire: master → compressor → destination, music/sfx input gains, a duck gain feeding music, an optional dotted-delay feedback send, an optional generated-impulse reverb send, a shared noise buffer. Something like:

```ts
const bus = createMixBus(context, {
  musicVolume, sfxVolume,
  compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
  delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2600 },   // optional
  reverb: { seconds: 2.4, decay: 2.6, level: 0.5 },               // optional
  noiseSeconds: 2,
});
// bus.master, bus.music, bus.sfx, bus.duck, bus.delaySend?, bus.reverbSend?, bus.noiseBuffer
// plus bus.setMusicVolume/setSfxVolume smoothing, and a duck helper (bus.duckAt(time, depth, recover))
```

All numbers come from the level. Support prism's simpler combined-volume shape (no music/sfx split) as an option so the pilot stays behavior-identical. Also lift helios's `makeImpulse` here as the reverb impulse generator.

### A2. Score context (new `src/engine/score.ts`)

The musical-position brain both levels copy. `createScore(config)` where the level supplies BPM, steps per bar, chord data, section boundaries, and crossfade windows; the score provides the derived queries. Must cover, because crystal and helios both need them:

- **Epoch anchoring:** the score is told the transport's real first-step time (`score.setEpoch(time)`) and an arrangement start step (`score.restartArrangement(stepIndex, {align: 'bar' | 'step'})` — crystal aligns to the next bar, helios restarts on the next step).
- `nextGridTime(time, gridSixteenths)` and `quantizePlayerAction(time)` honoring `getActionSfxQuantization()` on the epoch-anchored grid (see the authoring doc's "Musical action audio" — this exact math is a documented playtest lesson; keep it).
- `arrangementPositionAt(time)`, `barAt(position)`.
- **Harmony:** `chordAt(position)` from a level-supplied chord table, with support for alternate chord sets over bar ranges (helios's boss chords), and `leadSetAt(position)` (arp + octave-up, or a level-supplied derivation).
- **Sections:** level supplies `[{index, fromBar, crossfadeBars?}]`; score provides `sectionMixAt(position)` returning `{from, to, t}` and `sectionLayers(mix)` returning weighted `[section, weight]` pairs. Must support a **dynamic override** (crystal forces section 2 the moment the Warden spawns regardless of bar — e.g. `score.overrideSection(index)` / `clearOverride()`).
- **Kill-lane walker:** the monotonic step allocator both levels copy (each kill takes at least the step after the previous; reset on runstart), plus lane lookup: level supplies per-section lanes of degrees, score returns `{step, time, midi}` for the next kill.
- A small `lerp`/voice-blend helper for crossfading numeric voice params between sections.

### A3. Instrument registry (`src/engine/audio-kit.ts` or a sibling module)

Kill the per-instrument trace boilerplate. Levels declare instruments once; the registry wraps each with the trace guard and the null-context guard:

```ts
const inst = defineInstruments({ trace, context: () => ctx }, {
  kick(play, time: number, vel: number) { /* synthesis body only */ },
  ...
});
inst.kick(time, 1); // when tracing: records { name: 'kick', ... } and returns; else plays
```

Exact shape is yours to design; requirements: trace records carry the instrument name and its numeric/enum args keyed sensibly (match what levels currently record so traces stay comparable), the synthesis body gets a non-null context handed to it, and a level instrument definition shrinks to just its synthesis code.

### A4. Trace harness helper

The ~30-line `traceXAudio` export every level repeats (sink, noop bus, metadata, `traceRun`) becomes one helper in `src/engine/audio-trace.ts`, parameterized by level id, BPM, step seconds, and the audio factory.

### A5. Pilot: retrofit `src/levels/prism/audio.ts`

Move prism onto A1–A4 with zero behavior change (`trace:audio -- --level prism --compare` identical; prism keeps its combined-volume behavior). Prism has no sections or kill lanes — that's fine; the pilot proves the bus, registry, and harness, and shows the smallest-level ergonomics.

### A6. Scaffold and docs

- Update the scaffold generator's `audio.ts` template to build on the new helpers (still silent, still decision-free).
- Update `docs/level-authoring.md`: list `score.ts` in the shared-code inventory and compress the "Musical action audio" bullets that are now kit behavior into pointers at the kit (the *lessons* stay; the hand-rolled implementations stop being the recommended path).

## Task B — arrangement DSL; retrofit helios

### B1. Arrangement DSL (new `src/engine/arrangement.ts`)

A declarative, strudel-inspired replacement for hand-written `scheduleStep` if-chains. Design it against `src/levels/helios/audio.ts`'s scheduler — the hardest case in the repo — and make sure crystal's is also fully expressible (task C uses it). Scope it thin: pattern strings, function escape hatches, and one-shots. **No** full mini-notation parser (no nesting, no euclidean rhythms, no polymeter).

Required capabilities, all demonstrated by the helios retrofit:

- **Sections by bar range**, ordered, named. Section starts emit the trace `section` records (replacing helios's `recordSection`). The if/else bar router disappears.
- **Hit patterns as strings**: one char per step, `.` = rest, other chars mapped to velocities by a level-supplied map (e.g. `hits('K.........K.....', {K: 1}, (t, vel) => kick(t.time, vel))`). Pattern length must be a multiple of steps-per-bar; multi-bar patterns cycle.
- **Function tracks** for what strings can't say: `(t) => ...` receiving a context with at least `{bar, barInSection, step, position, time, chord}` — build ramps (`0.28 + bar * 0.04`), bar-parity ghost notes, velocity rolls, bass step-maps keyed off the live chord.
- **One-shots**: fire at a specific bar/step within a section (risers, impacts, crashes, full-bar snare rolls).
- **Multiple arrangements per level** (ambient vs run) with a mode switch.

Choose bar addressing (absolute vs section-relative), document it in the module, and be consistent. The test of the design is the diff: helios's scheduler as data should be **no longer than the if-chains it replaces and dramatically easier to read** — a reader should see the drum grid.

### B2. Retrofit `src/levels/helios/audio.ts`

Move helios onto everything from tasks A and B. While you're restructuring, follow the spine/leaf convention: arrangement, harmony, section structure, voice parameter tables, and event choreography stay in the spine (`audio.ts`); synthesis bodies may move to a leaf (`audio-voices.ts` or similar) if it genuinely helps reading — don't force it. `trace:audio -- --level helios --compare` gates the whole thing. Update helios's `level.md` "what to read" pointers if files move.

## Task C — retrofit crystal; close out

- Retrofit `src/levels/crystal/audio.ts` the same way. Crystal is the flagship landing level: be conservative; where the kit and crystal disagree, crystal's current output wins and the kit gets the option it's missing.
- Amend `docs/briefs/spine-leaf-retrofits.md`: mark tasks 1 and 2 superseded by this brief (leave task 3, deluge, as-is with a note that its audio retrofit should use the new kit and needs `trace:audio` coverage added first).
- Final pass over `docs/level-authoring.md` so the documented authoring path for a new level's audio is: mix bus + score + instruments + arrangement, with raw `audio-kit` primitives as the escape hatch.

## Verification (every task)

- `npm run typecheck` and `npm run build`.
- `npm run trace:audio -- --level <id> --compare` for each retrofitted level (capture the baseline before touching the level).
- `npm run check:scope` is not the gate here (engine work is in scope by design), but level diffs must stay inside `src/levels/<id>/` per level.
- Report line counts before/after for each retrofitted `audio.ts` — the token-efficiency claim should be visible in the numbers.

## Out of scope

- Deluge and rezdle audio (deluge needs trace coverage first; rezdle opts out of most of this machinery by design).
- Any audible change anywhere. If a retrofit would sound better with a tweak, note it in the report; do not make it.
- Visual or gameplay code.
