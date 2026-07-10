# Downpour

Downpour is a 60-second nocturne for a hunted courier: a rain-slashed plunge from tower rooflines into sodium undercity, through a flooded canal, and up through the storm ceiling with the hunter-gunship in pursuit.

## Visual language
Rain-grey towers and blue-slate structure rush close to the rail. Cyan/magenta window strips and signage cut through the weather, sodium amber marks the undercity, and acid green is reserved for the hunter alone. Security hardware is hard-edged, readable white.

## Musical language
176 BPM drum and bass: sparse rain-pad prelude, rolling breaks for both descents, a half-time hunter phrase, and a near-silent cloudbreak. Locks, volleys, impacts, kills, misses, damage, and rejected releases are all voiced from the same wet electrical palette.

## Mechanical signature
Four silhouettes with four motion grammars: swooping courier interceptors, braced wall turrets, canal-skating skiffs, and a staged hunter-gunship. Two rail-speed drops land on musical downbeats; the final gunship encounter resolves into the release above the clouds.

## What to read
- `src/levels/downpour-hlht/index.ts`
- `src/levels/downpour-hlht/gameplay.ts`
- `src/levels/downpour-hlht/audio.ts`
- `src/levels/downpour-hlht/visuals/index.ts`

## Status & notes
Inspection captures: `firstDrop` (towerfall), `secondDrop` (canal descent), `hunt` (gunship phase), and `release` (cloudbreak). Human playtest should first check that rain remains readable with bloom at zero and that the green gunship never gets lost against city lights.
