# Level brief

This is the standing brief for building a new level. It is handed to an implementing agent together with a theme. Read `AGENTS.md` and `docs/level-authoring.md` before starting; they define the module layout, the runner contract, and the boundaries this brief assumes.

## Assignment

Build a complete level under `src/levels/<id>/` and register it in `src/levels/index.ts`. Within the shared lock-on mechanics you own everything: the rail, the spawn choreography, the enemy kinds and their motion, scoring, the entire visual language (environment, enemies, letter glyphs, effects), and the entire soundtrack and sound design. All of it procedural.

Study the existing levels and the engine before you start — for the contracts they exercise, and to know what your level must *not* resemble.

## Theme

_Filled in per assignment. One or two sentences naming the level's world and mood._

## Effort

This is a showcase piece, not a prototype or a proof of concept. Polish is the point: a visitor should play your level for thirty seconds and want to play it again. Budget real time for iteration on feel — enemy motion, effect timing, and the mix are where levels are won, not in the first working version.

## Hard constraints

- Use `createLockOnRunner`. Do not build a bespoke runtime or modify the engine.
- Touch only `src/levels/<id>/` plus one registry line. `npm run check:scope -- <id>` must pass.
- No imports from other levels' directories.
- `npm run typecheck` and `npm run build` must pass.

## The floor

Every level must have, at minimum:

- At least three enemy kinds with distinct silhouettes and distinct motion — different shapes moving the same way don't count.
- A spawn timeline choreographed against the soundtrack, not evenly spaced filler.
- Legible START/REPLAY letter glyphs (see the glyph guidance in `docs/level-authoring.md`).
- A composed soundtrack that emits `beat` events, plus sound design for locks, fire, hits, and kills that sits in the mix rather than on top of it.
- A visual and audio response to rejected releases, plus visual responses to the core gameplay events: `spawn`, `lock`, `unlock`, `fire`, `hit`, `kill`, and `miss`.
- Full playability and legibility with the player's bloom slider at zero.
- A run length between 30 and 90 seconds — your call within that range, shaped to the music.

## What gets judged

Your output will be compared against levels built by other agents from this same brief. Meeting the floor does not score points; it avoids losing them. Judges reward:

- **Cohesion** — palette, geometry, motion, and sound feel like one idea, not a collection of features.
- **Musicality** — the run feels scored rather than accompanied; downbeats and phrase boundaries mean something on screen, and player actions land inside the music (quantized to the transport, pitched from the live harmony) rather than sitting on top of it as generic SFX. See "Musical action audio" in `docs/level-authoring.md`.
- **Game feel** — locking is tactile, volleys land with weight, a full 6-lock release feels like an event.
- **Choreography** — waves read as designed moments with build and payoff, not a stream of targets.
- **Distinctiveness** — the level is recognizable at a glance and by ear as its own thing. Imitating an existing level's visual or musical language is a losing move.

## Handoff

Report what you verified and what still needs human eyes. Use the visual inspection tools in `docs/visual-tools.md` to capture model snapshots, gameplay stills, and thumbnail sheets when useful. If your environment cannot render WebGPU, say so plainly and describe what a playtester should look at first — visual and audio quality can only be confirmed by a human run-through.
