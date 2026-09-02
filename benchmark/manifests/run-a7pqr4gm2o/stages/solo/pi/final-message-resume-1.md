The Speedsolve level is complete. Final state of the deliverable:

## `src/benchmark-levels/speedsolve-nfof/`

**The fight** — a 60-second (32 bars @ 128 BPM) boss duel with a colossal twisting puzzle cube riding a helical rail, so the camera genuinely revolves around it. Shooting glowing cells snaps layer rotations on the beat; each cleared face drops its nine tiles as loose cubies and exposes a two-lock machinery weakpoint; killing it swings the cube to the next face (early conquests compress the schedule). At bar 23 the shell *and* interior machinery fall away, leaving the naked gyro-core for a spin-up barrage across three stages — it bursts into candy-cube confetti on the final phrase boundary.

**Key fixes this session**
- Root-caused the invisible enemies: the engine's bloom config forwards positionally into three's `bloom(strength, radius, threshold)` — swapped the fields so the luminance cutoff lands correctly.
- Found and fixed the real occlusion bug: `installVisualEventHandlers` was never called in `createRuntime`, so spawn-claimed meshes kept their 0.001 scale-in start forever.
- Core was hidden inside the machinery box — the box now drops away with the last shell.
- Attract mode never runs per-frame updates, so the camera spawned inside the unpositioned cube; added `rig.poseAttract()` applied at wiring time.
- Cleared all target-occlusion warnings (swing-settle delays before new faces' targets arrive, later weakpoint emergence, less camera-ward debris velocity); darkened polyhedra bodies and core rings for silhouette contrast.

**Verification — all green**
- `typecheck` + `build` ✓ · `check:scope --level speedsolve-nfof` ✓ (all paths owned or shared-derived)
- Floor check: 0 occlusion warnings, 0 perf failures, 0 audio failures ✓
- Simulate: none-policy dies at 41s; perfect = WORLD RECORD 16.6k full clear; imperfect = SUB-60 survival; heatmap well-spread, avg engagement 27m
- `trace:audio`: layered arrangement verified (ratchets/snaps in solve, arp/hats/shakers at climax, riser+resolve at core)

**Showcase assets** — `public/level-content/speedsolve-nfof/{hero,overview,start}.png` rendered via the content-image workflow (hero at 18.8s: tilted cube with two live cell targets amid harassment; overview covers early fight → mid solve → late faces → naked core; start screen shows START letters over the posed cube), wired through `level.json` `contentImages`. `level.md` card written and `docs/level-gallery.md` regenerated.

Remaining human step: a WebGPU playtest to confirm snap-on-beat feel, face-drop/swing readability, and that the core burst lands on the musical resolution at bar 30.