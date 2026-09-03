# Strandline

Sixty seconds freeing a gigantic jellyfish from its infestation: thread the sunlit strand forest, glimpse the bell filling the view like a green moon, then climb to the crown and tear the brood-mother loose — and watch the whole animal drift on, every strand glowing clean.

## Visual language
Clear blue-green water melting into deep blue fog; a forest of procedural tentacle strands with green-gold tip light; translucent bells (two vista bells, one crown moon); light shafts and drifting motes. Parasites are sickly violet in seven silhouettes — clamped limpets, sweeping skimmers, needle darters, thorn bolts, brood clusters, lattice webs, the crowned parent. Letters are bioluminescent bone plaques ringed in living green.

## Musical language
120 BPM in D minor, 30 bars = exactly 60 seconds. The arrangement is the animal waking: heartbeat pulse and dim pad in the drift, shimmer droplets at each vista, soft kit in the thicket, full drive in the wake, a held-breath riser at the crown, dread pulse under the parent, and a warm D-major resolve. Locks climb D minor, fire is a pitched droplet, kills walk hidden per-act melody lanes, parent chips ring a growing bell, and the severance lands a ducked finale and a falling peal.

## Mechanical signature
A 60-second run with a 3-point hull: clamped limpets (hold), crossing skimmers, weaving darters that spit interceptable thorn bolts, and a staged parent — three brood waves each starve one web plate until the mother hangs bare for a six-lock tear-loose, followed by a long camera pullback. Full six-target clears earn a formation bonus.

## What to read
- `src/benchmark-levels/strandline-uzwm/index.ts`
- `src/benchmark-levels/strandline-uzwm/gameplay.ts`
- `src/benchmark-levels/strandline-uzwm/parent.ts`
- `src/benchmark-levels/strandline-uzwm/audio.ts`
- `src/benchmark-levels/strandline-uzwm/audio-voices.ts`
- `src/benchmark-levels/strandline-uzwm/visuals/index.ts`
- `src/benchmark-levels/strandline-uzwm/visuals/environment.ts`
- `src/benchmark-levels/strandline-uzwm/visuals/enemies.ts`

## Status & notes
Showcase build. Verified headless (typecheck, build, scope, floor: simulate/occlusion/perf, audio trace); WSL2 cannot render WebGPU headless, so the water grade, bell vistas, and the mix need a human playtest — check first that the vista swings read, the parent gating is legible, and the resolve pullback lands.
