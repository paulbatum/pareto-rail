**Skyhook is complete** — a 60-second climb up a space-elevator tether at `src/levels/skyhook-snxd/`, registered in the picker, with every automated gate green.

## What was built

**The climb (128 BPM × 32 bars = exactly 60 s).** The level is one straight 64° ribbon: launch in grey storm murk with rain and wind-riding enemies, punch the cloud deck on the bar-8 drop into sunlit blue, thin to indigo at bar 16, and fight the boss in starfield black before the station swallows the car for a near-silent A-major dock. The whole sky script (background, fog, stars, sun, planet drop-away, atmosphere rim) is keyed to rail progress computed from the musical bars, so the palette turns exactly on the phrase boundaries.

**Defending the car.** The white/hazard-orange climber car rides the tether ahead of the camera and the 3-point hull is its integrity: sappers swoop in, latch onto its flanks, and drill on a visible strobing lamp timer unless pried off. Five enemy kinds with distinct motion grammars (swooping gliders, updraft-riding sprites that stall and fall, car-latching sappers, thruster-hopping vacuum spikers with telegraphed railgun bolts, a two-stage tether-crawling breaker), plus interceptable debris bolts.

**The Lamprey.** It slams onto the tether at bar 19 — you hear the hull-shaking impact and see it the whole fight, hand-over-hand ratcheting down the line, growing from a speck to a house. Three grip claws gate its staged core (it flinches, swings wide, and comes back meaner); at bar 29 it reaches the car and tears a hull point off every 1.8 s until it dies or you do. Kill it and the carcass falls the whole height of the sky.

**The score is an altimeter.** Wide wind-bedded pads and four-on-the-floor low, stripped half-time glass in the stratosphere, near-vacuum for the boss (sub pulses, hull ticks, a low dread motif over Am–B♭–Am–E), dock latch and chimes at the top. All player actions snap to the transport and read the live chord; kills walk hidden per-act melody lanes; boss chips escalate audibly; the maw kill ducks the mix and lands a cable-twang severance figure.

## Verified
- `typecheck`, `build`, `check:scope -- skyhook-snxd HEAD`, and **`check:floor` all pass with zero warnings** (occlusion 0, perf 0, audio 0, spread/distance 0, full event coverage).
- Simulation: perfect policy 56/56 kills → rank S; seeded imperfect 51/56 → A; no-fire dies to the drills and the Lamprey deadline, as intended.
- `trace:audio` confirms the layer-stripping arrangement and the 58.7 s dock latch; gameplay snapshots (SwiftShader) confirm the storm murk, the color arc, the tether/station composition, and the boss descent.

Iteration highlights: fixed a left-handed `makeBasis` that was silently mangling the tether/car orientation, worked around the shared post pipeline's swapped bloom threshold/radius parameters (which was blooming the whole day sky white), rescaled the boss descent so the fight starts at bar 22 rather than compressing into the last 10 seconds, and re-seated the camera *above* the tether after finding the car occluded the upper-left target lane.

## Needs human eyes (WSL2 can't render WebGPU)
First things to check in a real playtest: the cloud-deck punch at bar 8 (flash + surge + fog clearing), tether/car readability with **bloom at zero**, the Lamprey descent reading as "it's getting closer," sapper drill-lamp urgency, the final mix balance (especially the near-silent boss act — it should feel tense, not empty), and the attract screen letters against the storm.