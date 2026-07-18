# Broadside

Launch from an ice-white flagship into a fleet engagement backlit by a vast magenta-and-gold nebula. Capital ships drift like continents while the fighter rail snaps through their crossfire, races under a friendly cruiser broadside, skims an enemy belly, and drives all the way into the opposing flagship's exposed trenchwork.

## Visual language
Ice-white friendly hulls with cyan engines and fire oppose obsidian enemy slabs scored by molten-orange seams, crimson optics, and red point defense. Kilometer-scale procedural cruisers sit at wild angles throughout the volume; dozens of cyan and crimson firing lanes stitch across them. Swarm craft use three clearly different silhouettes, shield generators open in staged petals, and the trench's power systems burn gold-orange against black armor. The magenta-and-gold nebula remains the backlight and the faction colors remain functional even with bloom disabled.

## Musical language
120 BPM procedural space opera in D minor: divisi-style saw strings, broad synthesized horns, brass punches, timpani, noise cymbals, and a restrained choir. Orchestration swells with each fleet push, falls to choir and distant horn in the two-bar eye, rebuilds for the flagship, accelerates in the trench, then resolves to a radiant D-major-sixth victory call. Locks, volleys, hits, stages, and kills are transport-quantized; kill chains follow authored melodic lanes in the live harmony, while boss breaks duck the orchestra for rising brass confirmations.

## Mechanical signature
A 60-second, four-hull fleet crossing with lateral interceptor knots, orbiting two-lock bombers, high/low skiff rakes, corkscrewing escorts, and interceptable point-defense bolts. The flagship fight begins with four sequential three-lock shield generators under point-defense fire, turns through two escort spirals after the shield falls, then dives onto three staged power cores. Full six-kill salvos earn a formation bonus, and the result tracks shields, cores, bolt interceptions, and hull damage.

## What to read
- `src/benchmark-levels/broadside-b3fk/index.ts`
- `src/benchmark-levels/broadside-b3fk/gameplay.ts`
- `src/benchmark-levels/broadside-b3fk/audio.ts`
- `src/benchmark-levels/broadside-b3fk/audio-voices.ts`
- `src/benchmark-levels/broadside-b3fk/visuals/index.ts`
- `src/benchmark-levels/broadside-b3fk/visuals/environment.ts`
- `src/benchmark-levels/broadside-b3fk/visuals/models.ts`

## Status & notes
Built as a showcase from the Broadside benchmark assignment. Inspection markers: `melee` (bar 4), `broadside` (bar 9), `enemyBelly` (bar 13), `eye` (bar 16), `flagship` (bar 18), `secondPass` (bar 25), `trench` (bar 26), and `victory` (bar 29). A human WebGPU pass should first verify capital-ship scale and silhouette readability, the friendly broadside crossing overhead, the eye's musical contrast, and core visibility inside the final trench.
