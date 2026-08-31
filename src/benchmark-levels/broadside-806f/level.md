# Broadside

A sixty-second sortie across a fleet engagement: launch from an ice-white flagship, corkscrew through cruiser crossfire, ride a friendly ship’s eight-gun broadside, rake an obsidian underbelly, and break the enemy flagship in a shield pass followed by a trench dive. The last turn climbs out past the rupturing ship until the whole battle fits in frame.

## Visual language
A huge camera-relative nebula layers magenta clouds, gold arcs, and cold stars behind two unmistakable fleets. Friendly hulls are pale naval slabs with cyan seams, engines, and beam fire; enemy ships are near-black wedges cut with molten orange and crimson batteries. Kilometer-scale ships, local debris, screen-wide fighter braids, sequential broadside lances, a collapsing magenta shield, an incandescent trench, and a segmented flagship breakup carry the scale. SORTIE and RETURN use six armored 5×7 signal plaques; enemies, locks, denial, projectiles, and cores retain solid contrast with bloom disabled.

## Musical language
128 BPM, 32 bars, scored as procedural space opera in D minor: divisi synthetic strings, low brass, choir-like pads, timpani, and metal percussion accumulate with each push. The friendly broadside is an eight-cannon orchestral cascade; the eye of battle removes everything but two distant tones before brass and drums rebuild around the flagship. Player locks, volleys, hits, armor breaks, and kills are transport-quantized from live harmony, with written kill-melody lanes for every section. The last core ducks the battle into a D-major victory fanfare.

## Mechanical signature
A four-point hull and seven target roles across three primary swarm motions: paired skirmishers braid around the rail, needles cross the entire viewport in corkscrews, and armored bombers dive and peel. Enemy-belly turrets take repeat locks, while nine interceptable crimson flak shots fill the flagship pass. Phase one removes four two-lock shield generators; escorts then cover the turn into a trench where three exposed power systems end the flagship. Full six-target clears earn a formation bonus, and the summary records both boss phases, flak interceptions, and hull damage.

## What to read
- `src/benchmark-levels/broadside-806f/timing.ts`
- `src/benchmark-levels/broadside-806f/gameplay.ts`
- `src/benchmark-levels/broadside-806f/audio.ts`
- `src/benchmark-levels/broadside-806f/audio-voices.ts`
- `src/benchmark-levels/broadside-806f/visuals/index.ts`
- `src/benchmark-levels/broadside-806f/visuals/environment.ts`
- `src/benchmark-levels/broadside-806f/visuals/models.ts`

## Status & notes
Showcase build. Authored inspection markers: `engagement` (bar 4), `broadside` (bar 8), `underbelly` (bar 14), `eye` (bar 18), `flagship` (bar 20), `trench` (bar 27), and `victory` (bar 31). Human WebGPU playtest should first check the capital-ship scale during hard banks, bloom-zero generator and trench readability, and the mix transition into and out of the eye.
