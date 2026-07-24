**Skyhook** is built at `src/benchmark-levels/skyhook-k5rw/` — no registry edits, no engine changes.

## What it is

A 60-second vertical climb. The rail *is* the tether: it rises steeply and leans forward just enough to keep the camera's up-vector well conditioned, so rail-relative spawn authoring (x = screen-right, y = screen-up) works unchanged even though the world runs upward. 128 BPM × 32 bars = exactly 60.000 s.

- **Weather (0–15 s)** — storm grey, rain streaks, wind-riding kites, tether debris falling past.
- **Cloud deck (15 s)** — a real speed kick on the downbeat, a grey whiteout, then blue sky.
- **Above (15–26 s)** — thinning air, shrikes that pace the car then ram it, the first vacuum limpets.
- **The Descender (26–48 s)** — a tether-walker latches on ~170 m up and is on screen for the rest of the run, growing as it closes. Four grapnels must break before its core is lockable; at bar 25.5 it reaches the car and takes two hull points.
- **Dock (49–60 s)** — the tether goes clear, the camera tips over to look back down at the planet, then the station collar takes the climber and everything stops.

Enemies going for the car matter as much as ones going for you: shrikes ram the climber, limpets clamp the cable and grind through it, and each limpet spits one interceptable slug at the gunner on the way.

## Notable decisions

- **The sky is a table.** One keyframe list on altitude drives horizon/zenith/fog/stars/cloud/streak-length/planet size together. Stars live in the sky shader; the planet is a camera-anchored proxy sized each frame, because a real one can't fit inside the engine's 500-unit far plane.
- **The score loses a layer per section** because the air does — wind bed and wide reverb down low, a struck-panel snare above the deck, no reverb at all in vacuum, one sine beacon decelerating to silence at the top. The player's own instrument follows the same arc.
- Locking paints an enemy hazard orange — the climber's paint. That's the only colour change in the level.

## Verified

`typecheck`, `build`, and `check:floor -- --level skyhook-k5rw` all pass with **zero warnings** (7 enemy kinds, full event coverage, 0 occlusion warnings, 0 perf gate failures, 44 m avg kill distance, well-spread heatmap). Simulation: perfect 56/69 rank A with an untouched hull; imperfect 39/69 rank B.

Three real bugs found and fixed along the way, worth knowing about:
- `sampleRailFrame`'s `(right, up, tangent)` basis is **left-handed**, so `setFromRotationMatrix` on it produces a garbage rotation. The station was landing behind its seat. Fixed locally with `lookAt` / `setFromUnitVectors`.
- The shared post pass in `src/engine/post.ts` forwards `bloom.threshold`/`bloom.radius` to `BloomNode` in the **opposite order** (`bloom(node, strength, radius, threshold)`). On a dark level that's invisible; on a sunlit sky it blows the whole frame white. This level's cut-off therefore lives in the `radius` field, with a comment saying so.
- The runner aims the camera at `runProgress + 0.025` clamped to 1, so a profile reaching exactly 1 gives a zero-length look direction on the last frame — a 70° snap on a vertical rail. `skyhookRunProgress` stops a whisker short.

## Needs human eyes

WebGPU can't render here; everything visual above is from the tool's SwiftShader WebGL path, and **audio was only verified structurally** (I traced the arrangement — sections, densities and the layer-shedding arc are correct — but nobody has heard it). `check:scope` reports the level directory as out of scope, which is expected: it only allows `src/levels/<id>/`, and this protocol mandates `src/benchmark-levels/`.

Playtest order I'd suggest: the deck punch at 15 s, the Descender's approach 26→48 s (is the closing gap legible as menace?), the docking look-back at ~54 s, and the mix — specifically whether the vacuum section's dryness lands as tension rather than as something being broken.