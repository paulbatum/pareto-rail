# Engine brief: beat-level audio wiring helper and speed-profile helper

Read `AGENTS.md`, `docs/level-authoring.md`, and `docs/briefs/audio-kit.md` first. This finishes the job the audio-kit brief started (deliverable 1) and lifts one more copied technique into the engine (deliverable 2). Same guiding rule: **the engine encodes contracts, never answers** — every musical and motion number stays in the level. Same gate: retrofits are behavior-preserving.

## 1. Beat-level audio wiring helper

After the audio-kit retrofits, every beat-driven level's `audio.ts` still opens with ~100 lines of identical plumbing: step transport creation, `createLevelAudioKit` callback wiring, mix-bus construction, score epoch setting, the fake-context `traceRun` body, the trace-guarded `scheduleBeat`, and the runstart/runend mode flip. None of it is a musical decision. Bundle it into one composition entry point (working name `createBeatLevelAudio`) in `src/engine/audio-kit.ts` or a sibling module, so a level's audio file reduces to: data tables, instrument definitions, arrangements, and event choreography.

The helper must absorb, with level-supplied values where levels currently differ:

- Transport + scheduler wiring (stepSeconds from BPM; `scheduleAhead`, `schedulerMs`, `startDelay`, `volumeScale` as options — the current common values may be defaults since they are shared contract, not musical answers).
- Mix-bus construction from a level-supplied `MixBusOptions`, volume-change plumbing, and disposal. Provide a post-build hook receiving `(context, mix)` for level extras (helios builds its rumble drone there).
- Score epoch anchoring on context creation and transport start.
- Beat emission every 4 steps with the trace guard. **Careful:** crystal numbers beats from the absolute transport index while helios numbers them from arrangement position — the helper must support both (a small option or callback), and the trace compare will catch any slip.
- The ambient/run mode flip: level supplies per-mode schedule callbacks (or arrangements), the helper owns the mode state, `runstart` arrangement restart with level-chosen `'bar' | 'step'` alignment, and `runend`. Level hooks for run-state resets (crystal clears the Warden override and core ids; helios resets the heart ids) — e.g. `onRunStart`/`onRunEnd` callbacks that run in addition to the built-in behavior.
- The standardized `traceRun` body, including the run-state reset hook, so the trace harness composes with it.

Retrofit all three kit levels — prism, helios, crystal — onto the helper. Capture each level's trace baseline (json + verbose) from the current tree before editing; `npm run trace:audio -- --level <id> --compare` must match exactly for all three. Prism has no score or arrangement modes in the same shape — if the helper needs an option or two to cover it, add them; if covering prism would contort the design, leave prism as-is and say so in the report rather than forcing it.

Update the scaffold generator's `audio.ts` template to use the helper, and the audio path sentence in `docs/level-authoring.md`. Scaffold check: scaffold a temp id, `npm run typecheck`, delete it and its registry line.

## 2. Speed-profile helper

`src/levels/helios/gameplay.ts` hand-rolls piecewise speed keys, a normalized-integral ease table, and `heliosRunProgress` (~50 lines). The deluge brief tells authors to copy the technique, which is the sign it belongs in the engine. Add a small module (new `src/engine/speed-profile.ts`, or `rail.ts` if it genuinely fits there):

```ts
const profile = createSpeedProfile(SPEED_KEYS, DURATION, { samples: 1200 });
profile.speedAt(time);          // piecewise-linear factor
profile.runProgress(time, duration?); // normalized integral, table-interpolated
```

Levels keep the keys. Match helios's exact semantics (clamping, midpoint sampling, table size as an option defaulting to helios's 1200) and retrofit helios's `gameplay.ts` to use it, keeping its exported `speedFactorAt` / `heliosRunProgress` signatures working for its other modules.

Verification for the retrofit:

- Numeric equivalence: sample the old and new `speedFactorAt` and `heliosRunProgress` at ≥1,000 points across [0, duration] in a throwaway script and require exact (or within 1e-12) agreement. Delete the script afterwards.
- `npm run trace:spawns -- --level helios --compare` (timeline must be untouched).
- `npm run snapshot:gameplay -- --level helios --thumbnails 8` before and after; the sheets must match (camera position depends on the easing, so this exercises the change end to end).

Docs: add the module to the shared-code inventory in `docs/level-authoring.md`, and mention it in the runner-contract paragraph where `easeRunProgress` is described.

## Verification (whole brief)

`npm run typecheck`, `npm run build`, the per-retrofit gates above. Report before/after line counts for the three audio spines and helios's gameplay.

## Out of scope

- Deluge and rezdle.
- Any audible, visual, or motion change.
- Player-instrument event choreography (lock/kill/volley handlers) — that similarity is creative language, not machinery; leave it per level.
