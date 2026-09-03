All gates pass. **Strandline** (`strandline-uzwm`) is complete and submitted.

## What was built

A 60-second run (120 BPM, 30 bars exactly) freeing a gigantic jellyfish from its parasites:

- **Arc** — Drift through the strand forest (clamped limpets) → wide swing revealing the bell → denser thicket (detaching skimmers, first darters) → green-moon vista breath → the colony wakes (darters spitting interceptable thorn bolts) → crown riser → **the Parent**: a brood-mother behind 3 webbing plates that pumps brood waves; each wave cleared starves one plate until it withers, leaving the parent bare for a 6-lock tear-loose → resolve pullback (camera drifts back, FOV widens, water warms) with the crown bell looming like a green moon.
- **7 enemy kinds, distinct silhouettes + motion**: clamped pulsing limpets (hold), swept-wing skimmers (full-width crossings), needle darters (weave + readable charge-up sting), homing thorn bolts, orbiting broods, lattice web plates, the crowned parent.
- **Music**: D minor aqueous score that gains layers as the animal wakes (heartbeat → shimmer droplets → soft kit → full drive → dread pulse → D-major resolve), transport-quantized locks/fires, chord-following chips, 5 hidden kill-melody lanes, an escalating parent bell, and a ducked severance finale with falling peal.
- **Visuals**: procedural strand forest, 3 vista bells, root tendrils, light shafts, camera-following motes/sun/gradient-dome atmosphere, violet-vs-green-gold palette discipline, bioluminescent RELEASE/RETURN plaques, full event choreography (spawn/lock/unlock/fire/hit/stage/kill/miss/shielded/beat/reject).

## Verified headless

- `typecheck`, `build`, `check:floor` (**ACCEPT** — 0 occlusion warnings, 0 perf failures, 0 audio failures, full event coverage, no centerness/distance warnings), `check:benchmark-scope` (valid, 15 paths), `gallery` regenerated; tree touches only the level dir + gallery.
- `simulate`: no dead-air gaps; perfect 71/73; imperfect earns **S** (parent killed); no-fire death pressure calibrates with crystal. `trace:audio`: 622 events, 120 beats, riser/vista layering confirmed.
- Self-reviewed 7 snapshots (2/6/14/30/38/50/58s + start screen): this caught and fixed a dark-void backdrop (fog color now matches clear color + gradient dome added), bells re-sited high/off-axis, root tendrils thinned out of the arena, strands cleared from spawn sightlines, shared geometries for the perf gate.

## Needs human WebGPU playtest (WSL2 can't render WebGPU here)

1. Vista swings (bars 6, 14) — do the bells fill the view then release?
2. Parent gating legibility — does "kill broods → webs wither → tear it loose" read mid-fight?
3. Resolve pullback + mix balance (pad/water vs. kill lane), and bloom-at-zero target contrast.