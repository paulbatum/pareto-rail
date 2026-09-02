# Broadside

Launch off the catapult flight deck of the flagship *Aegis Prime* directly into a titanic fleet engagement between kilometer-long battlecruisers slugging it out across the void. You fly the gaps: hard banks and corkscrews through crisscrossing heavy turbolaser fire, a long high-speed flank run down a friendly dreadnought as triple-turret batteries loose blinding cyan broadsides overhead, then a tense low-altitude run skimming the obsidian belly of an enemy warship raking its defense turrets. The run culminates in a two-phase assault against the enemy command flagship: first shattering its four dorsal shield generator pylons through a curtain of point defense and escort fighters, then plunging down into the glowing trenchwork to detonate its core fusion reactors. When the final reactor blows, the camera pulls wide to reveal the shattering flagship, the breaking enemy line, and the whole fleet engagement backlit by a vast magenta-and-gold nebula.

## Visual language
High-contrast space opera silhouettes backlit by an immense procedural magenta-and-gold nebula. Factions read instantly by color: the friendly fleet in ice-white armor plate with cyan engine glow and cyan plasma fire; the enemy armada in obsidian dark hulls with glowing molten orange thermal seams and crimson weapons fire. Kilometer-scale capital ships frame the rail, exchanging broadside salvoes across the void with volumetric beam flashes, while fast interceptor swarms weave between the hulls. Legible procedural military beacon glyphs guide the catapult launch (`LAUNCH`) and post-run debrief (`REPLAY`). Full readability and silhouette contrast are maintained even with bloom disabled.

## Musical language
120 BPM space opera orchestral score in D minor with heroic modal shifts (Bbmaj7, Gm7, Neapolitan Ebmaj7, and a soaring victory resolution in D major). Scored dynamically across six movements: a tense launch countdown with timpani rolls; a pounding battle march with driving staccato strings, marching snare cadence, and heroic brass countermelodies; dropping to eerie near-silence during the dreadnought belly run with distant horn echoes and tense pedal strings; roaring brass triplets and timpani for the flagship shield assault; urgent syncopated rhythms during the trench dive; and a triumphant full-orchestral victory fanfare as the flagship splits. All player actions (locks, volleys, hits, and melodic kill runs) are transport-quantized and retuned live from the harmonic score.

## Mechanical signature
A 60-second rail-shooter showcase with variable speed profiling, 4-pip hull integrity, and six distinct target kinds: agile delta-wing interceptors weaving in sine-wave formations, heavy strafing gunships deploying crimson flak bolts, surface defense turrets tracking the camera from capital ship hulls, staged multi-hit shield generator pylons, and exposed core power reactors. Multi-lock volleys reward full 6-lock releases with cascading score multipliers and soaring melodic runs.

## What to read
- `src/benchmark-levels/broadside-fkio/timing.ts`
- `src/benchmark-levels/broadside-fkio/gameplay.ts`
- `src/benchmark-levels/broadside-fkio/audio.ts`
- `src/benchmark-levels/broadside-fkio/visuals/index.ts`
- `src/benchmark-levels/broadside-fkio/visuals/capital-ships.ts`

## Status & notes
Showcase benchmark build. First human pass should verify the contrast and silhouette read against the nebula backdrop with bloom slider at zero, the weight of the catapult launch kick, the audio drop-to-silence in the dreadnought belly run, and the grand camera pullout as the flagship splits.
