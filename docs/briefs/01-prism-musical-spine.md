# Engine brief 01: Prism musical spine consistency

Part 1 of the wishlist sequence (`docs/level-api-wishlist.md` records what remains outside these briefs). Read `AGENTS.md` and `docs/level-authoring.md` first. Standing rule: **the engine encodes contracts, never answers** — every section name, bar number, spawn position, voice choice, and timing value stays in the level. This brief makes Prism consistent with the musical spine now used by Crystal and Helios without changing the run.

## Problem

Prism now uses `createMusicTime` for mechanical spawn and run timing, but it still predates the shared score/arrangement shape. Its audio is scheduled directly inside `createBeatLevelAudio({ onStep })`, its sync metadata exposes only one broad `run` section, and player action sounds quantize against utility functions instead of a transport-anchored score. Crystal and Helios now have a more inspectable spine: named timing constants, `createScore`, `createArrangement`, arrangement section tracing, and player sounds that read musical position. Prism should adopt the same shape while staying compact.

## Deliverable 1: Prism timing and arrangement sections

Expand `src/levels/prism/timing.ts` from a single run section into named musical sections that are the source of truth for both audio and reports. Keep the exact current run duration and spawn times.

Suggested section names, not mandatory:

- `opening`
- `pulse`
- `shimmer`
- `bloom`
- `finale`

Requirements:

- The timing spine owns Prism BPM, steps-per-bar, timebase, duration, bars, markers, score sections, arrangement sections, and sync metadata.
- `trace:spawns -- --level prism --bars` should show meaningful Prism section names rather than one `run` bucket.
- Do not move any existing spawn unless explicitly choosing a visible/audio design change after the behavior-preserving pass.

## Deliverable 2: Prism score and arrangement spine

Refactor `src/levels/prism/audio.ts` so the backing music is scheduled through `createScore` and `createArrangement`, in the same architectural family as Crystal and Helios.

Requirements:

- Preserve the current compact musical identity: bells, low pulses, noise ticks, shimmer delay, and simple scale motion.
- Keep voice construction in place unless the file becomes unwieldy; this brief is about the spine, not creating leaf files for their own sake.
- The arrangement should emit section trace events so `npm run trace:audio -- --level prism` exposes sections.
- The resulting audio trace may change in structure because sections are newly traced, but note any intentional trace differences.

## Deliverable 3: transport-anchored player action audio

Move Prism lock, fire, kill, miss, and reject scheduling onto the score's musical position model where appropriate.

Requirements:

- Use `score.quantizePlayerAction()` for lock and fire sounds instead of raw `quantizeActionSfxTime`.
- Use `score.nextGridTime()` / `score.arrangementPositionAt()` for hit-like scheduled events where a grid snap is desired.
- Player sounds should read the live musical position instead of hard-coded global timing where practical.
- Preserve Prism's immediate reject/miss feel if delaying them would make feedback worse; document any deliberate escape hatch in a concise comment.

## Deliverable 4: lightweight kill lanes

Give Prism a minimal kill-lane equivalent so kills are musically authored rather than always ringing the same high bell.

Requirements:

- Keep it small. A one- or two-bar degree lane over the existing scale is enough.
- Kills in quick volleys should walk the lane instead of stacking on one note.
- The lane should remain consonant with Prism's simple harmonic language. If Prism keeps no formal chord progression, the lane can be written directly against its scale.

## Deliverable 5: gameplay timeline cleanup

Replace the mutable module-level `PRISM_WAVES` plus side-effectful `addFan()` construction with a pure timeline builder.

Requirements:

- Keep exporting `PRISM_TIMELINE` for trace tooling.
- Preserve `npm run trace:spawns -- --level prism --compare <baseline>` exactly.
- Continue authoring wave starts through `PRISM_TIME` / named markers; keep the 0.14-second fan stagger as an explicit seconds escape hatch if converting it would perturb the trace.

## Verification

Capture baselines before editing.

Required gates:

```sh
npm run trace:spawns -- --level prism --write /tmp/raild-prism-before.json
npm run trace:audio -- --level prism --write /tmp/raild-prism-audio-before.json
npm run trace:spawns -- --level prism --compare /tmp/raild-prism-before.json
npm run trace:spawns -- --level prism --bars
npm run trace:audio -- --level prism
npm run typecheck
npm run build
npm run check:scope -- prism
```

If `trace:audio --compare` is not exact because section trace events are newly emitted, inspect and summarize the intentional delta instead of weakening the tool.

## Out of scope

- Changing Prism visuals, rail shape, enemy motion, scoring, or run length.
- Making Prism as elaborate as Crystal or Helios.
- Refactoring Rezdle or Deluge.
- Engine transport changes or tempo maps.
