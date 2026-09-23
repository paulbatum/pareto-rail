# Thermal Ink

One continuous minute against a giant mutant octopus wrapped on a capsized freighter in a drowned, sodium-lit harbor. You find it in the murk, lose it in its ink, and strike through the dark with a thermal sight that turns the world into a stark charcoal display — white-hot flesh, red signal cores, cold black ink. Four arms rise from the water to reach for the rail; sever them at their nodes, and it rears to bare the core for a last volley in a total blackout before the harbor lamps come back.

## Visual language
Two palettes for one harbor. Murk is tobacco water, ochre haze, rust-red steel, dirty cream paint, and hard sodium lamps with halos and glitter paths on the water; the creature is oily near-black with an oil-slick rim sheen and bile-gold eyeshine, its brood pale flesh bolted to scrap. Thermal is a grainy charcoal sensor display: every material carries a second, thermal answer on the GPU, so steel drops to cold greys, the creature and its brood blaze white with limb-cooled edges, and red survives only on vulnerable signal cores and the player's locks. Ink is oil-black world-space clouds from the outside and a swallowing screen pass from the inside; the player's instruments are mercury-vapor white-blue.

## Musical language
96 BPM, 24 bars, exactly 60 seconds, in D minor over A7 · Dm · B♭maj7 · Gm7, holding the A7 through the blackout and resolving to D major when the lamps return. A steam-hammer kick, a heavy bass side-chained so it bounces, sparse pipe clanks, chain rattles, sodium-lamp hum, and one haunting eight-bar melody that always plays in two voices: a hazy detuned murk voice and a dry, exact thermal voice. The sight chooses which you hear — in thermal the noise bus falls back and the melody focuses; blind in ink the whole score muffles. Locks climb the live chord, harpoons fire on the root, kills play written section lanes (struck pipes in murk, sonar pings in thermal), wounds on the creature ring an anvil that climbs as it dies, and set pieces (arm eruptions, ink jets, the crane, the blackout) are cued on the fight's clock.

## Mechanical signature
Hold-sweep-release lock-on with a 4-point hull. Holding the trigger inside ink snaps the thermal sight on (a scan wipe, a relay clack, a narrower FOV) and it stays on while the volley is in the air. Enemies: edge-crawling scrappers that hop perch to perch on the beat, cable-leech eels swimming sinuous S-curves, bell buoys that jet upward in pulses and spit homing ink barbs, four arm nodes (two stages each) that slam the rail if left alone, and a two-stage core that seals itself under folded arms after the first membrane breaks so the killing volley always lands in the final blackout. Kills made through the ink score half again.

## What to read
- `src/benchmark-levels/thermal-ink-mv8r/index.ts`
- `src/benchmark-levels/thermal-ink-mv8r/timing.ts`
- `src/benchmark-levels/thermal-ink-mv8r/gameplay.ts`
- `src/benchmark-levels/thermal-ink-mv8r/octopus.ts`
- `src/benchmark-levels/thermal-ink-mv8r/audio.ts`
- `src/benchmark-levels/thermal-ink-mv8r/visuals/index.ts`
- `src/benchmark-levels/thermal-ink-mv8r/visuals/materials.ts`
- `src/benchmark-levels/thermal-ink-mv8r/visuals/post-fx.ts`

## What to study here
The dual-sense material system in `visuals/materials.ts`: every surface is built with a murk answer and a thermal answer, and shared TSL uniforms (thermal level, ink veil, lamp power, body heat) choose between them on the GPU, so the sense switch is one number rather than a scene swap. Creature materials are shared across every instance, with hit/deny/charge reactions read per object through `onObjectUpdate`, which kept the heap flat. The camera gaze is gameplay, not decoration: `gameplay.ts` blends the rail direction toward the creature and re-applies the player's edge-look, and every enemy is choreographed in that view frame so waves land edge to edge while the octopus stays in world space. The tentacles are rebuilt every frame from a pure kinematic rig (`octopus.ts`) that gameplay and visuals both read.

Weaker ground: all visual tuning was done against SwiftShader snapshots, not a WebGPU playtest, and the mix was balanced by reasoning about gains rather than by ear.

## Status & notes
Inspection flags, passed as a comma-separated `--debug-value` to `snapshot:gameplay` (dev tools only): `thermal` holds the trigger so the sight engages in every cloud, `finale` fakes the killing blow at 52.5 s to capture the collapse and relight, `clean` suppresses hull-hit lens spatter. Example: `npm run snapshot:gameplay -- --level thermal-ink-mv8r --debug-value thermal,clean --time 17.5`. Markers: `ink` (bar 6), `crane` (bar 12), `mantle` (bar 16), `blackout` (bar 20), `lamps` (bar 22). Gallery images were captured with seed 424242: overview at 9.5/17.5/30.8/47 s, start at 2 s, hero at 53.2 s in thermal.
