# Vespers

A nocturnal rail-shooter flight through the cavernous nave of a gothic cathedral, winning back the jewel light of its stained glass windows from flat black shadow creatures to the counterpoint of a cathedral pipe organ.

## Visual language

Pitch-black gothic stone architecture: massive compound piers, pointed arcade arches, stacked triforium galleries, and ribbed ceiling vaults high overhead, rising above a vast sea of candlelit warmth on the stone floor far below. The only saturated elements in the frame are the vivid jewel-toned stained glass panes — deep cobalt, blood red ruby, emerald green, and radiant gold.

Shadow creatures emerge from the dark glass as flat black silhouettes, distinguishable only by the stolen jewel pane burning in their chest. Slaying an enemy releases its stolen light in a brilliant focused ray that returns to the cathedral wall, igniting the stripped stained glass window and casting glowing colored light onto the surrounding stone columns. Restored windows remain illuminated for the rest of the run, progressively transforming the dark cathedral into a radiant jewel-lit sanctuary. At the climax, defeating the Oculus Eater in the dead Rose Window ignites the entire monumental rosette in a blinding kaleidoscopic burst of color.

## Musical language

Scored entirely for the cathedral's own pipe organ in pure procedural counterpoint (96 BPM). Opening on a deep held 16' Subbass pedal note in D minor, voices enter one by one above it: first a lyrical Flûte Harmonique subject, followed by a fugal Great Principal 8' countermelody. The climax of the nave swells with ethereal Vox Humana choir resonance and resonant Carillon bell strikes.

Past the midpoint, the nave goes reverently quiet — a solitary flute intoning over a low pedal drone in the vast stone void. At the west end, an intense chromatic toccata accompanies the boss encounter, before resolving in a triumphant D Major Picardy third chord as all ranks (including the held-back Trompette & Bombarde reeds) open in full Tutti when the Rose Window ignites.

The player's locks, fires, hits, and kills are integral organ voices in the polyphony: locks sound as delicate Positif pipe chiffs ascending the harmony, while kills trigger virtuoso solo reed stop notes from the score's live Kill Lane.

## Mechanical signature

- **Dynamic Stained Glass Light Restoration**: Kills cast focused light rays back into dark windows, permanently winning back the cathedral's light.
- **Polyphonic Organ Solos**: Quantized melodic kill lanes let chained player volleys perform seamless solo organ counterpoints within the live harmonic progression.
- **Architectural Multi-Tier Spacing**: Enemy choreography swoops between high clerestory windows, mid-arcade tiers, and vaulted ceilings across the full screen space.
- **The Rose Window Climax**: Multi-stage boss battle featuring orbiting stained-glass petal shields and an exposed chromatic core, culminating in the West Rose Window ignition.

## What to read

- `src/benchmark-levels/vespers-j7xp/index.ts`
- `src/benchmark-levels/vespers-j7xp/gameplay.ts`
- `src/benchmark-levels/vespers-j7xp/audio.ts`
- `src/benchmark-levels/vespers-j7xp/visuals/index.ts`
- `src/benchmark-levels/vespers-j7xp/visuals/environment.ts`
- `src/benchmark-levels/vespers-j7xp/visuals/enemies.ts`
- `src/benchmark-levels/vespers-j7xp/visuals/effects.ts`
- `src/benchmark-levels/vespers-j7xp/visuals/letters.ts`

## Status & notes

- Clean floor gate pass: 61.25s duration, 3 distinct enemy kinds + multi-stage boss + lockable hazards, full-screen spatial spread, 5x7 gothic stained-glass glyphs.
- Tested with headless simulation, occlusion checks, and performance benchmarks.
