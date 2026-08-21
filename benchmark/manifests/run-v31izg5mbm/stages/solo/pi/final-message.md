The assignment is complete and fully verified. Final state:

## Deliverable

`src/benchmark-levels/vespers-1izg/` — **Vespers**, a ~64s benchmark level, directory-only contract honored (the working tree contains exactly this one new directory; no registry or shared-file edits).

## Final verification (re-run this session, all green)

- **`npm run typecheck`** — clean
- **`npm run build`** — passes (catalog validation, no-tracked-PNG, bundle budget 114.6 kB vs 152 kB limit)
- **`npm run check:floor -- --level vespers-1izg`** — **ALL PASSED**: 0 occlusion warnings, 0 perf failures, 0 audio failures, 0 reticle/word warnings; one soft warning (33.9% center kill concentration — the boss legitimately owns center; failure threshold is 70%)
- **`npm run simulate`** — 7 enemy kinds, 70 spawns, no dead-air gaps, perfect policy 59/70 kills / rank B (heart survives, matching the crystal reference's behavior), imperfect policy lands A-rank
- **`trace:audio` / `trace:spawns`** — voice entries (pedal 0s → flute 6.5s → principal 11.8s → tune 17.2s → choir+bell 22.9s → riser 54.3s) and spawn range (4.3–49.8s) land as authored
- **Snapshots** — nave arcade, shade/watcher/censer silhouettes, dead rose, boss fight, and START/REPLAY leaded-glass glyphs all read correctly

## Key design points

- **Relight mechanic**: all 46 wave enemies each carry a specific pane; killing one relights that exact window permanently; end screen reports "Windows relit n/28" (ordering bug fixed — gameplay tracks window carriers in its own set)
- **The Devourer**: 6 spokes → 4 petals requiring one linked `validateRelease`-swept volley → 6-lock heart; partial petal rings are denied with a shake; heart death ignites the rose, relights everything, ducks the mix, and turns the minor major
- **Organ score**: four voices entering over 6 bars, real counterpoint, feast swells, a genuine two-voice silence at bars 14–16, tutti D major with picardy at bar 21; all player SFX transport-quantized organ voices in the live harmony
- **Run length**: 22 bars + held half-bar (64.3s) so the boss window is generous and the ignition's major chord rings

## Remaining human step

A WebGPU playtest for colour/bloom/mix balance — headless can't render WebGPU and the snapshot tools auto-expose. Playtest priorities are documented in `level.md` (first relight, the silence, the petal-ring denial, the ignition).