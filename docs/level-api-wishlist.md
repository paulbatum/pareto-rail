# Level-author API wishlist

Written by an agent asked to build a level to `docs/level-brief.md`, **before reading any level or engine source**. The point of this document is to record, uncontaminated by knowledge of what already exists, what APIs and tooling a level author would want in place to make a rich level cheap to build without capping its expressiveness.

What I knew when writing this (and nothing more):

- The brief itself, `AGENTS.md`, and the repo's directory/file names.
- File sizes of the current bar-setting level (`crystal`): ~3,800 lines across 16 files — roughly 950 lines of audio, ~2,000 of visuals and effects, ~700 of gameplay/spawn choreography, plus a small tuning JSON.
- From `AGENTS.md` and recent commit messages: `createLockOnRunner`, an event bus (`spawn`, `lock`, `fire`, `hit`, `kill`, `beat`, `runstart`, …), engine modules named `input`, `rail`, `scoring`, `music`, `spawn-patterns`, `post`, and the names `createBeatLevelAudio` and `createSpeedProfile`. Names only — I have not read their signatures or bodies.
- Existing tooling names: `scaffold`, `gallery`, `trace:spawns`, `snapshot`, `snapshot:gameplay`, `check:scope`.

So this is a wishlist, not a gap analysis. Some of it may already exist. The follow-up task is to read the code and report the overlap.

---

## 1. Where the cost actually is

3,800 lines for a 30–90 second level is the honest number, and it splits into three unequal kinds of work:

1. **Creative work that should stay expensive** — designing enemy silhouettes, composing the actual music, choreographing waves against phrases, tuning feel. An API that makes this "cheap" by making it declarative-with-defaults produces template levels, which the brief explicitly scores as a losing move.
2. **Plumbing that is identical in every level** — instanced-mesh matrix bookkeeping, object pooling, envelope/oscillator wiring in WebAudio, converting bar:beat to seconds, disposing GPU resources, event subscription/teardown, easing math, seeded RNG. This is where lines should be deleted from the author's budget.
3. **Verification work** — knowing whether the thing you can't see or hear (headless WSL2, no WebGPU) is actually good. Tooling here doesn't reduce authoring lines; it reduces *iterations wasted on a wrong guess*, which is the real cost center for an agent author.

The wishlist below targets (2) and (3) aggressively and deliberately leaves (1) alone. The organizing principle:

> **Combinators, not templates.** Every API should be a small function the author composes inside code they own, never a config schema the author fills in. The moment the engine has an opinion about what an enemy *is* beyond "a thing with a transform and a lifecycle," levels start converging.

A second principle:

> **One clock.** Music time (bars/beats at a tempo) should be the native coordinate for *everything* time-shaped: spawns, rail speed, effect timing, mix automation. The brief judges "musicality" — the run feeling scored rather than accompanied — and that property falls out almost for free when there is literally no other timeline to author against.

---

## 2. The transport: musical time as a first-class value

The single highest-leverage API. Everything else in this document consumes it.

```ts
// engine/transport
interface Transport {
  readonly bpm: number
  readonly beatsPerBar: number
  /** Current position in continuous beats since run start. */
  readonly beats: number
  readonly bar: number          // integer
  readonly beatInBar: number    // 0..beatsPerBar
  /** Convert between coordinate systems. */
  secondsAt(pos: MusicTime): number
  beatsAt(seconds: number): number
  /** Schedule a callback at an exact musical position (audio-clock accurate). */
  at(pos: MusicTime, cb: (audioTime: number) => void): Cancel
  /** Repeat every N beats with optional swing/offset. */
  every(beats: number, cb: (audioTime: number, count: number) => void, opts?: { offset?: number }): Cancel
  /** Next grid boundary at or after now — for quantizing player actions. */
  quantize(grid: number /* beats: 0.25, 0.5, 1 */): { pos: MusicTime; audioTime: number }
}

type MusicTime =
  | number                        // beats since start
  | { bar: number; beat?: number } // "bar 12, beat 2.5"
  | string                        // "12:2.5" shorthand for authoring density
```

Requirements that matter and are easy to get wrong:

- **Audio-clock authority.** The transport must be driven by `AudioContext.currentTime`, not `requestAnimationFrame`, and the render loop reads *from* it. Otherwise spawns drift against the music over a 90-second run and "musicality" quietly dies.
- **Lookahead scheduling.** `at()` must fire callbacks slightly *before* the musical instant with the exact `audioTime`, so sound can be scheduled sample-accurately and visuals can align to the same instant on the next frame.
- **Tempo changes.** Even a short level wants a ritardando into the final tableau or a half-time bridge. `MusicTime → seconds` must go through a tempo map, not a constant.

The existing `beat` event on the bus is presumably the broadcast form of this; the wishlist item is the *queryable, schedulable* form.

---

## 3. Music composition kit

~950 lines of the crystal level is audio. Most of the irreducible creative content there is *notes and patterns*; most of the reducible cost is *synthesis plumbing*. Wishlist: a three-layer kit where I own the top layer completely.

### 3.1 Voices (synthesis plumbing — engine's job)

```ts
// engine/audio/voices
interface VoiceSpec {
  osc: Array<{ type: OscillatorType | 'noise'; detune?: number; gain?: number; octave?: number }>
  filter?: { type: BiquadFilterType; cutoff: number | Envelope; q?: number }
  env: { attack: number; decay: number; sustain: number; release: number }
  fx?: Array<Reverb | Delay | Drive | Chorus>   // small fixed set, all procedural
}

function createVoice(ctx: AudioContext, spec: VoiceSpec, out: AudioNode): Voice
interface Voice {
  play(note: { pitch: Hz | NoteName; at: number; dur: number; vel?: number; glide?: number }): void
}
```

I want to describe a bass, a pad, a pluck, a metallic percussion hit in ~6 lines each and never touch `OscillatorNode` lifecycle, envelope click-avoidance, or voice-stealing myself. Crucially: **specs, not presets.** A library of named presets ("bass1", "pad2") is how every level ends up sounding the same. Give me the spec vocabulary and zero-cost custom voices.

### 3.2 Patterns and sections (the score — mine, but on rails)

```ts
// engine/audio/score
type Step = null | { note: NoteName | Degree; vel?: number; dur?: number }

interface Pattern {
  grid: number            // beats per step, e.g. 0.25 = 16ths
  steps: Step[]           // loops
}

interface Section {
  name: string            // 'intro' | 'build' | 'drop' | 'bridge' | 'outro' — my names
  bars: number
  harmony: ChordSymbol[]  // one per bar or per half-bar: ['Em', 'Em', 'Cmaj7', 'D']
  layers: Record<string, Pattern | PatternFn>  // keyed by voice name
}

function playScore(transport: Transport, sections: Section[], voices: Record<string, Voice>, opts?: {
  onSection?: (name: string, startBar: number) => void
}): ScoreHandle
```

Two properties matter more than the exact shape:

- **`Degree` notes resolve against the live harmony.** If a pattern says scale-degree 3 and the section is on Cmaj7, it plays E; when the harmony moves, the same pattern re-voices. This is what makes 90 seconds of music out of 30 lines of pattern data.
- **Section boundaries are queryable and emitted as events** (`sectionchange`), because spawn choreography wants to anchor to them ("the warden enters at the drop"), and tooling wants to print them.

### 3.3 Harmony state (the bridge to SFX)

```ts
interface HarmonyState {
  /** Current chord as playable pitches, voiced in a requested octave range. */
  chordAt(pos: MusicTime, octave?: [number, number]): Hz[]
  scaleAt(pos: MusicTime): Hz[]
  root(pos: MusicTime): Hz
}
```

The brief's "musical action audio" — player actions pitched from the live harmony, quantized to the transport — needs exactly this: SFX code asks "what notes are legal *right now*" and picks from them. Without a queryable harmony state, action audio degrades to fixed-pitch blips that clash the moment the chord changes.

### 3.4 Action SFX helper

```ts
// engine/audio/actions
function bindActionAudio(bus: EventBus, transport: Transport, harmony: HarmonyState, map: {
  lock?:  (n: LockEvent)  => SoundPlan   // e.g. arpeggio step: nth lock → nth chord tone
  fire?:  (n: FireEvent)  => SoundPlan
  hit?:   (n: HitEvent)   => SoundPlan
  kill?:  (n: KillEvent)  => SoundPlan
  reject?: () => SoundPlan               // rejected release — the brief requires audible response
}, opts?: { quantize?: { lock?: number; kill?: number } }): Cancel

type SoundPlan = { voice: Voice; pitch: Hz | Degree; vel?: number; when?: 'now' | 'quantized' }
```

The classic win: six locks walk up the current chord as an arpeggio, and the full-volley release lands a root-position stab *on the next eighth*. That's maybe 15 lines with this API and ~150 without it. The mapping functions are mine (expressiveness preserved); the quantize-and-schedule machinery is not.

### 3.5 Mix bus

```ts
function createMixer(ctx: AudioContext, buses: string[]): Mixer
interface Mixer {
  bus(name: string): AudioNode
  duck(target: string, by: string, opts: { amount: number; release: number }): void  // sidechain
  automate(bus: string, param: 'gain' | 'cutoff', points: Array<[MusicTime, number]>): void
  master: AudioNode  // respects the shell's player-volume setting
}
```

"Sits in the mix rather than on top of it" is a mixing property: SFX routed through the same buses as music, ducked under the kick, sharing a master limiter. Every level needs the same ~80 lines of gain-graph plumbing; it should be one call.

---

## 4. Rail authoring

```ts
// engine/rail
function createRail(spec: {
  /** Control points; Catmull-Rom or similar through them. */
  points: Vec3[] | ((t: number) => Vec3)
  /** Roll along the path — banking into turns, barrel moments. */
  roll?: Array<[t: number, radians: number]> | ((t: number) => number)
  /** Where the camera looks: ahead-along-rail by default, overridable per span. */
  look?: Array<{ from: MusicTime; to: MusicTime; target: Vec3 | 'ahead' | ((t: number) => Vec3) }>
  closed?: boolean
}): Rail

interface Rail {
  pose(distance: number): { position: Vec3; forward: Vec3; up: Vec3 }
  /** Frame at a normalized parameter, for placing scenery. */
  poseAt(t: number): Frame
  length: number
}

// Speed as a function of musical time — the run's pacing IS the arrangement's pacing.
function createSpeedProfile(segments: Array<{ at: MusicTime; speed: number; ease?: Ease }>): (pos: MusicTime) => number
```

The name `createSpeedProfile` appears in a commit message, so something like the last function exists. The full wish: rail *shape* also cheap to author (control points + roll), with a stable moving frame (no roll flips at inflection points — parallel transport, not naive Frenet), and **`poseAt` exposed for scenery placement** so environment code can scatter geometry in rail-relative coordinates ("6 units left of the track for bars 8–16") instead of world coordinates guessed by trial and error.

---

## 5. Spawn choreography

The brief demands choreography "against the soundtrack, not evenly spaced filler." So the authoring surface should make the musical anchoring *the syntax*, not a discipline:

```ts
// engine/choreography
function timeline(transport: Transport, waves: Wave[]): TimelineHandle

interface Wave {
  at: MusicTime | { section: string; bar?: number }   // 'the drop, bar 2' — names from my score
  spawn: SpawnGroup | SpawnGroup[]
  label?: string                                       // shows up in trace tooling
}

interface SpawnGroup {
  kind: string                    // my enemy kind id
  count: number
  /** Where they appear, in rail-relative space at spawn time. */
  placement: Placement
  /** Stagger successive spawns musically: every 16th, every beat… */
  stagger?: number                // beats between individuals
  /** Opaque bag passed through to my enemy logic. */
  params?: Record<string, unknown>
}

// A small pattern vocabulary I can extend with plain functions:
type Placement =
  | { arc: { radius: number; from: Deg; to: Deg; distance: number } }
  | { line: { from: RailRelVec3; to: RailRelVec3; distance: number } }
  | { ring: { radius: number; distance: number; phase?: Deg } }
  | ((i: number, n: number) => RailRelVec3)            // escape hatch is a lambda, always
```

Notes:

- `{ section: 'drop' }` anchoring means re-arranging the music re-anchors the choreography. This single feature converts "iterate on the mix" from a two-file surgery into a one-file edit.
- `stagger` in beats gives spawn *entrances* rhythm for free — a wave of eight arriving on successive 16ths reads as a drum fill.
- The engine (which apparently has `spawn-patterns`) should own placement math and stagger scheduling; it should **not** own enemy motion after spawn. Placement is geometry; motion is character.

---

## 6. Enemy authoring

This is the area where over-helping does the most damage, so the wish is narrow: kill the bookkeeping, keep the behavior.

### 6.1 Instanced flocks without matrix math

```ts
// engine/flock
function createFlock<T>(opts: {
  geometry: BufferGeometry
  material: Material
  max: number
  /** Per-instance authored state, allocated on spawn. */
  init: (seed: number) => T
  /** The author's motion brain — full freedom, runs every frame. */
  update: (state: T, inst: InstanceHandle, dt: number, t: TransportSnapshot) => void
}): Flock<T>

interface InstanceHandle {
  position: Vec3; quaternion: Quat; scale: Vec3   // write these; engine composes the matrix
  color?: Color                                    // per-instance color if material supports it
  kill(style?: string): void                       // triggers death → pooling, not disposal
}
```

Everything I've done with `InstancedMesh` involves the same 60 lines of dummy-object/matrix/needsUpdate/swap-remove ceremony. `update` receiving a `TransportSnapshot` (beats, beat phase, section name) means motion can be composed against the music — enemies that pulse on the beat or reorient at bar lines — without every enemy file re-deriving beat phase.

### 6.2 Motion combinators (optional sugar, plain functions)

```ts
// engine/motion — every one of these is a pure function I could write myself;
// having them saves ~15 lines each and invites *composition*:
orbit(center, radius, radPerBeat)
weave(axis, amplitude, beatsPerCycle, phase)
approach(target, speedFn, arrive?)
hoverJitter(amplitude, freq, seed)
lerpAlong(curve, beatsTotal, ease)
// composed:
const motion = add(approach(railAhead(20), speed), weave(up, 1.5, 2, seed))
```

Explicitly **not** a behavior-tree or state-machine framework. Plain `(state, dt, t) => Vec3` combinators compose in userland and never constrain what an enemy can be.

### 6.3 Lock-target contract

Whatever `createLockOnRunner` needs from an enemy should be one small interface (`aimPoint(): Vec3`, `alive: boolean`, `onLock/onUnlock/onHit/onKill` hooks or bus events keyed by id) so any object — instanced flock member, hand-built boss hierarchy, a destructible piece *of the environment* — can be made targetable. The expressiveness test: "can I lock onto a chunk of the scenery mid-run?" should be yes without engine changes.

---

## 7. Geometry and material kit

The visual identity budget (~2,000 lines in crystal) is mostly legitimate creative spend, but three helpers cut real cost:

### 7.1 Parametric silhouette helpers

```ts
// engine/geo
lathe(profile: Vec2[], segments, opts?)                  // vases, hulls, spires
tube(path: Curve3, radiusFn: (t) => number, segments)    // tendrils, rails, horns
extrudeStrokes(strokes: Vec2[][], depth, bevel?)         // flat emblems → 3d
shardCluster(opts: { count; length: Range; radius: Range; seed })  // generic spiky mass
scatterOnSurface(geo, count, seed): Array<{ pos; normal }>
merge(...geos)                                           // one draw call per enemy kind
```

All returning plain `BufferGeometry` so they compose with hand-written geometry freely. The test for inclusion: would three unrelated levels each have written it? (`lathe`/`tube`/`merge`: yes.)

### 7.2 Palette as the single source of visual truth

```ts
// engine/palette
function createPalette(spec: {
  base: Hex; accent: Hex; hot: Hex; ambient: Hex        // level's whole identity in 4 values
}): Palette

interface Palette {
  color(name: PaletteName, opts?: { hdr?: number }): Color   // hdr: 3 → ×3 over 1.0 for bloom
  standard(name, opts?): MeshStandardMaterial                 // shared, cached
  emissive(name, intensity): Material
  fogMatched(name): Color                                     // pre-mixed toward fog for distance
}
```

The `hdr` knob encapsulates the AGENTS.md gotcha (bloom wants >1 values, big bright areas white out): the palette can clamp/warn when a large-area material requests high HDR. Cohesion — the top judged criterion — is largely "everything drew from one palette," so making the palette the *convenient* path makes cohesion the default.

### 7.3 Glyph/letter builder

```ts
// engine/glyphs
function buildWord(word: string, opts: {
  stroke: (from: Vec2, to: Vec2) => BufferGeometry   // my visual language decides what a stroke IS
  letterHeight: number; spacing?: number
}): Group
```

Engine owns a stroke-segment font table for A–Z (the legibility floor); I own what a stroke looks like — a crystal shard, a neon tube, a chain of cubes. START/REPLAY legibility stops being a risk while the letters still belong to the level.

---

## 8. Effects toolkit

Every satisfying rail shooter needs the same five effect *species*; their *skins* are per-level. Wishlist: pooled species with skin injection, plus declarative event binding.

```ts
// engine/fx
const burst = createBurstPool({
  max: 64,
  make: () => myShardMesh(),                         // skin: mine
  over: (m, life01, seed) => { /* my animation */ }, // motion: mine
})
burst.spawn(at: Vec3, opts?)

createTrailPool(...)     // ribbon/streak following a moving point
createShockwave(...)     // expanding ring/shell, one shader I don't write
createBeam(...)          // instant or swept tracer from A to B
createFlash(...)         // brief additive sprite/point light

// Declarative binding — the level's "reactivity table" in one visible place:
bindEffects(bus, {
  spawn: e => portalRipple.spawn(e.position),
  lock:  e => reticlePulse(e.target),
  kill:  e => { burst.spawn(e.position, { power: e.combo }); shock.spawn(e.position) },
  miss:  e => dimVignettePulse(),
  reject: () => { shake(0.2); thud() },
})
```

Plus two camera-feel primitives with built-in safety:

```ts
shake(intensity, opts?)        // trauma-model, auto-decay, clamped
kickFov(deltaDeg, decayBeats)  // release-volley punch
```

The brief's floor requires visual responses to seven event types; `bindEffects` makes the completeness of that table *inspectable* — by me and by tooling (§10.5).

---

## 9. Environment scaffolding

```ts
// engine/environment
scatterAlongRail(rail, {
  every: Meters | ((i) => Meters),
  offset: (i, seed) => RailRelVec3,        // lateral/vertical placement, my distribution
  make: (i, seed) => Object3D | InstanceOf<Flock>,
  cull: { behind: 20, ahead: 400 }         // recycling window — engine's job
})

gradientSky(stops: Array<[elevation01, Color]>)          // procedural dome, fog-consistent
fogRamp(transport, points: Array<[MusicTime, { color; density }]>)  // atmosphere follows the arrangement
```

`scatterAlongRail` with recycling is the biggest one: every tunnel/canyon/field level re-implements "infinite scenery that spawns ahead and despawns behind." `fogRamp` keyed to MusicTime is a cheap, high-cohesion trick — the world literally darkens into the bridge.

---

## 10. Tooling wishlist

Ranked by expected iteration savings for an agent that cannot see or hear its own level (headless WSL2, no WebGPU, no speakers).

### 10.1 Offline audio render + analysis (highest value, most wished-for)

```bash
npm run render:audio -- --level <id> [--from bar:0 --to bar:32] [--out out.wav]
```

Renders the level's soundtrack (and optionally scripted action-SFX at their timeline moments) through an `OfflineAudioContext` to a WAV, then emits:

- **Waveform PNG** and **spectrogram PNG** — I can *see* a dead frequency range, a clipping master, a drop that doesn't drop, a lock-arpeggio buried under the pad.
- **Stats**: integrated LUFS, true peak, per-bus RMS over time, silence spans.
- **Onset alignment check**: detected onsets vs. the transport grid — did my scheduled notes actually land on the grid?

Music is half the judged surface and currently the *least* verifiable part headlessly. This tool converts "compose blind, pray at playtest" into a real feedback loop. It only needs the audio module to accept an injected `(Offline)AudioContext` — a cheap constraint worth imposing on the audio API design (§3).

### 10.2 Headless run simulation

```bash
npm run simulate -- --level <id> [--policy perfect|greedy|random] [--seed n]
```

Runs transport + timeline + enemy updates + a scripted player policy without rendering, and outputs a machine-readable run log plus assertions:

- **Pressure curve**: targetable enemies over time, plotted against sections. Instantly shows dead air (>N beats with nothing to shoot) and impossible walls.
- **Completability**: can the `perfect` policy kill everything? What does `greedy` leak? Run-length actually within 30–90s?
- **Event coverage**: which of `spawn/lock/unlock/fire/hit/kill/miss/reject` never fired during a full run (⇒ an unbound or untested reaction).
- Diffable output so a spawn-timeline refactor can be verified timeline-preserving (the existing `trace:spawns --compare` suggests this partially exists; the wish is to extend it from *spawn times* to *simulated outcomes*).

### 10.3 The director's report

```bash
npm run report:sync -- --level <id>
```

One text artifact merging both timelines — the score's sections/harmony on one axis, spawns/waves on the other:

```
bar  section   harmony  spawns                     notes
 8   build     Em       arc×6 skitters (16th stagger)
12   build     Cmaj7    —                          ⚠ 4 bars, no spawns
16   drop      Em       ring×8 + warden            wave 'drop-hit'
```

Choreography-against-music is a judged criterion, and this is the cheapest possible way to *check* it without playing. It falls out nearly free if spawn anchors are MusicTime/section-based (§5).

### 10.4 Gameplay snapshots at musical moments

The existing `snapshot:gameplay --times` takes seconds; the wish is `--at bar:beat` and `--at section:drop`, plus a `--sheet phrase-boundaries` preset that samples every section start automatically. Also a **bloom-zero pair mode**: every capture rendered twice (slider at player default and at zero) side by side, since bloom-zero legibility is a hard floor requirement I otherwise can't check.

### 10.5 Floor linter

```bash
npm run check:floor -- --level <id>
```

Static + simulated checks against the brief's floor, so I don't burn a human playtest on a checklist item:

- ≥3 enemy kinds registered; each has distinct geometry *and* distinct update fn (heuristic: not the same function reference).
- Reaction table covers all required events (statically inspectable if `bindEffects`/`bindActionAudio` exist, §8/§3.4).
- `beat` events emitted; run length in range (from simulation); `level.md` filled; gallery regenerated.

### 10.6 Dev overlay + time scrub

In-browser (for the human playtester, and for me via gameplay snapshots): a toggleable overlay showing `bar:beat | section | alive: n | last events…`, and a `?start=bar:16` URL param that fast-forwards transport, spawn timeline, and score to a given bar so iteration on the drop doesn't cost 40 seconds of intro per attempt. The fast-forward requirement is another cheap constraint on API design: timeline and score must both be able to *seek*, which follows naturally if they're pure functions of transport position.

### 10.7 Voice audition page

Like the existing `/dev` gallery but for sound: a page listing the level's voices and action-SFX with play buttons and the rendered waveform of each. Paired with 10.1 it lets a human give precise feedback ("the kill sound, third one") instead of "the audio feels off."

---

## 11. Anti-wishlist

Things that would *reduce* line count and are still wrong here:

- **A level config schema / parameterized level factory.** AGENTS.md already forbids turning a level into a template; the same applies to the engine growing one. The 3,800 lines of crystal are mostly *identity*; the goal is to cut the ~1,200 lines of plumbing hiding inside them, not to make the next level a 300-line config.
- **Named preset libraries** (voice presets, enemy archetypes, effect styles). Presets are convergence machines. Specs and combinators only.
- **A generic "juice" autopilot** (auto screen-shake on kill, auto hit-flash). Feel is judged; defaults would homogenize it. Primitives with no default bindings.
- **Engine-side difficulty scaling.** Choreography is authored, per the brief.

---

## 12. Priority order

If only some of this can exist, in order of leverage for the *next* level build:

1. Transport with schedulable musical time + queryable harmony (§2, §3.3) — everything else keys off it.
2. Offline audio render + analysis (§10.1) — biggest verifiability hole today.
3. Voice/pattern/section composition kit (§3.1–3.2) — biggest line-count sink today.
4. Action-SFX quantize/pitch helper (§3.4) — highest judged-points-per-line.
5. Headless simulation + pressure curve (§10.2) — kills blind choreography iteration.
6. Flock/instancing wrapper (§6.1) — second-biggest line sink.
7. Effects pools + declarative binding (§8).
8. Director's report (§10.3) and musical-moment snapshots (§10.4).
9. Palette (§7.2), glyphs (§7.3), scatterAlongRail (§9).
10. Floor linter (§10.5), dev overlay/scrub (§10.6), audition page (§10.7).
