# Strandline

Strandline plunges the player into the sunlit, abyssal depths of an alien ocean to liberate a titanic bioluminescent jellyfish from a virulent parasite colony. The 60-second rail winds through a luminous forest of trailing tentacles, weaving between massive strands of glowing green-gold tissue before banking wide into open water where the animal's colossal bell fills the entire sky like a radiant green moon. The visual language contrasts the serene, oceanic emeralds, cyans, and ambers of the host organism against the sickly, necrotic violets and toxic magentas of the clinging parasites. Procedural Web Audio synchronizes the pulse of the ocean with the player's actions, pacing the journey from a slow, ambient oceanic drift into an energetic rhythmic ascent, culminating in a dramatic battle at the crown to shatter the parasite webbing and tear the broodmother loose.

## Visual language

- **Atmosphere**: Clear turquoise and cyan shallows shading into deep oceanic navy in the abyss, pierced by angled sunlit god-rays and drifting marine snow motes.
- **The Host Organism**: A gigantic scyphozoan jellyfish featuring a translucent dome umbrella, glowing radial canals, 4 golden horseshoe gonads, and over 50 trailing bioluminescent tentacle strands that undulate with traveling waves of green-gold light.
- **The Infestation**: Parasites rendered in sharp, barbed, necrotic purples and glowing magenta cores: bulbous clamped polyps, winged skittering mantis mites, armored spore spitters, and the massive segmented broodmother parent at the crown.
- **Feedback & Glyphs**: START and REPLAY glyphs constructed from 5×7 bioluminescent cellular cushions with radiant membrane edges. Kills dissolve parasites into violet chitin shards and releasing fountains of golden healing bubbles.
- **Post-Processing**: Depth-dependent underwater color grading, subtle oceanic caustic shimmer, and a toxic violet edge vignette on player damage.

## Musical language

- **Tempo & Form**: 96 BPM (2.5 seconds per bar, 24 bars = exactly 60.0 seconds) structured across five distinct sections: Shallows, Deep Forest, Crown Ascent, Boss Encounter, and Serenity.
- **Harmony**: Rich oceanic chords moving from mysterious D minor/F major through chromatic parasite tension (Dm – Ebdim7 – Bb7) before resolving into radiant D major serenity (Dsus4 – Dmaj9 – Gmaj9 – D).
- **Instruments**: Deep 808-style underwater sub bass, warm detuned analog pads, crystalline water bells, and crisp hydrodynamic transients.
- **Melodic Kill Lanes**: Chained volleys sample authored melodic kill lanes, transforming consecutive hits into fluid aquatic harp arpeggios that retune dynamically with the active harmony.
- **Boss Voice**: Pounding four-on-the-floor sub pulses, stinging resonant parasite stabs, and an explosive low-end gong upon liberating the crown.

## Mechanical signature

- **Rail Choreography**: Three-dimensional slalom threading between glowing tentacle strands, opening up for a breathtaking panoramic view of the bell at bar 9 before surging upward through the central oral arms.
- **Broad Screen Spread**: Enemies utilize wide lateral and vertical screen space, encouraging energetic reticle sweeps and active targeting rather than screen-center clumping.
- **Multi-Stage Threats & Hazards**: Armored spitters launch lockable homing spore hazards that threaten the player's 4-point hull if not intercepted in flight.
- **Boss Mechanics**: The crown parasite is initially shielded by four rotating lattice web nodes; destroying the webbing collapses the shield, exposing the multi-stage core for rapid-fire liberation.
- **Grand Pullback Outro**: Upon defeating the parent organism, the rail eases into a gentle drift as the camera pulls back to reveal the entire, pristine creature drifting serenely into the sunlit deep.

## What to read

- `src/benchmark-levels/strandline-d9p1/index.ts` — Runtime setup, camera rig, and narrative HUD callouts.
- `src/benchmark-levels/strandline-d9p1/gameplay.ts` — 3D rail spline, speed curve, enemy choreography, and boss mechanics.
- `src/benchmark-levels/strandline-d9p1/audio.ts` — Score definition, harmonic progression, transport scheduling, and melodic kill lanes.
- `src/benchmark-levels/strandline-d9p1/visuals/index.ts` — Visual factories, reticle, projectiles, and event handlers.
- `src/benchmark-levels/strandline-d9p1/visuals/jellyfish.ts` — Procedural giant jellyfish geometry and tentacle wave animation.

## Status & notes

- 60.0s target duration verified (24 bars at 96 BPM).
- All 3+ enemy kinds implemented with distinct silhouettes and distinct motion paths.
- Procedural audio, custom 5x7 bioluminescent glyphs, and responsive visual event handling fully wired.
