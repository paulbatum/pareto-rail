Skyhook is complete and every headless gate passes. The level lives at `src/benchmark-levels/skyhook-2j6o/` with the regenerated gallery card; nothing outside that directory and `docs/level-gallery.md` changed.

**What was verified**

- `npm run typecheck` and `npm run build` pass.
- `npm run check:floor -- --level skyhook-2j6o` passes: zero occlusion warnings, zero performance gate failures, zero audio configuration failures. One advisory warning remains: average destruction distance is 51 m against a 45 m warning threshold. Helios sits at 59 m, so this is in line with the reference.
- Simulation: the perfect policy clears all 75 targets including the Tetherjack, no impossible moments. The imperfect policy survives at rank A. A passive player dies at 55 s to limpet bites and the boss, which is the intended threat.
- A headless score trace confirms the arrangement thins as designed: rain, kick, snare, hats, pad, bass and plucks in the weather; snare and thunder gone above the deck; kick, pad width and hats gone in vacuum; bells, a tick and a sine pedal at the dock.
- `npm run check:scope` cannot pass as written. The script only whitelists `src/levels/<id>/` and there is no local `main` ref. Against HEAD it lists only the benchmark directory as out of scope, which the directory-only contract requires.

**The level**

A 60-second, 32-bar climb at 128 BPM up a straight rail pitched 20 degrees beside a white tether with orange collars. The sky is a camera-centred dome plus a backdrop disc that turns from cloud tops into the planet's limb, with a real cloud deck punched through at bar 8. Enemies: wind-riding kites, hull-clamping limpets that chew the deck until pried off, bolt-spitting squalls, vacuum mites that dash in rigid lines, and armored sentinels. The Tetherjack latches at bar 18.5 and lurches down one downbeat at a time; its claws become targets in range, killing them exposes the two-stage core, and reaching the deck starts tearing the hull. The station iris opens on its death, and the car decelerates into the bay to two resolving bells.

**Structural decisions worth knowing**

- The boss is driven by an invisible "brain" entity behind the camera that spawns the claws and core as targets only when engageable. Stand-in meshes draw it the rest of the time. This fixed the simulator stalling on unlockable targets and keeps destruction distances honest.
- Enemy meshes are built once as merged, cached templates, and shaded body panels are shared per colour and tint state. That took the heap slope gate from a coin flip to a wide margin.
- Sky and fog colours are authored dark in linear space because the renderer displays them through the sRGB transfer, and the bloom high-pass passes full colour above its threshold.

**What still needs human eyes**

Headless Chrome cannot render WebGPU here, so all visual and audio judgement came from SwiftShader stills under `tmp/snaps/` and the semantic trace. A playtester should look first at the storm murk and lightning, the white-out and speed kick through the deck at bar 8, how large and menacing the Tetherjack reads from bar 20, bloom levels on the white deck and the sun, and the mix balance of the beds, thuds, kill lanes and dock bells.