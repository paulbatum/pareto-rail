# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `broadside-b4kd`
- Display title: `Broadside`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/broadside-b4kd/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id broadside-b4kd --title 'Broadside'`.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Broadside

Build a level where you launch off the deck of your own flagship into the middle of a full fleet engagement - kilometer-long cruisers on both sides slugging it out in no neat formation, swarms of small craft knotted through the gaps between them. You fly the gaps: hard banks and corkscrews through the crossfire, a long high-speed run down a friendly cruiser's flank as its broadside lights off overhead, then along the belly of an enemy warship, raking its turrets as you pass. The capital ships are vast and slow while you're quick and small - that contrast is the speed. The whole battle is backlit by a huge magenta-and-gold nebula, so every hull reads as a silhouette rimmed in colored light, and the sides read by color: your fleet ice-white with cyan engine glow and cyan fire, the enemy obsidian streaked with molten orange, firing crimson. Score it like space opera: full orchestra, brass and strings over timpani, swelling with each push and dropping to near silence in the eye of the battle. The run carries you across the whole engagement toward the enemy flagship on the far side.

Enemies are the swarm craft - fast, small, coming in waves off the enemy carriers.

Boss: the enemy flagship, in two phases. First a close-range pass along its hull, taking out its shield generators one by one while its point defense fills the space around you; the shield falls, escorting fighters pour in, and you fight through them as the rail comes around for the second pass; then a dive into its trenchwork to destroy the exposed power systems at its core. When the last one blows, the camera pulls out - past the breaking flagship, past both fleets, the whole battle in frame as the enemy line burns and scatters, the score landing on the victory theme - won, level ends.

