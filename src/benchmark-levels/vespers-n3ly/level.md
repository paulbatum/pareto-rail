# Vespers

Fly a black cathedral at night while flat thieves tear jewel light out of its stained glass. Every target carries one stolen colour in its chest; every kill returns that light to the nearest window permanently, so a successful run paints the nave behind the player before the dead west rose ignites.

## Visual language
Enormous near-black stone, stacked arcades and gallery rails, rib vaults, a candle sea far below, and saturated cobalt, blood, bottle-green, and gold glass as the only strong colour. Enemies are planar black church-shapes readable by the stolen pane burning in their chest. The middle four bars cross a deliberately blind span; the ending reverses the contrast in one rose-window ignition.

## Musical language
96 BPM without percussion. A two-bar D pedal opens alone; tenor, alto, moving bass, choir weight, and bells enter one at a time as independent organ lines. The dark nave strips the score back to a solitary flute stop. Locks, fire, hits, and the hidden kill lane are all pitched organ voices in the live harmony. The soprano rank and D major are withheld until the Devourer dies, when the full plenum and bells open together.

## Mechanical signature
A 60-second processional with pane-wraith glides, descending candle-eaters, orbiting choristers, stately vigils, a long sparse nave, and a rose-window boss. Six stolen rose lobes must be destroyed to expose a ten-lock, two-stage Devourer core. Window theft and restoration are mapped per enemy and persist for the run.

## What to read
- `src/benchmark-levels/vespers-n3ly/index.ts`
- `src/benchmark-levels/vespers-n3ly/gameplay.ts`
- `src/benchmark-levels/vespers-n3ly/timing.ts`
- `src/benchmark-levels/vespers-n3ly/audio.ts`
- `src/benchmark-levels/vespers-n3ly/visuals/index.ts`
- `src/benchmark-levels/vespers-n3ly/visuals/environment.ts`
- `src/benchmark-levels/vespers-n3ly/visuals/enemies.ts`

## What to study here
The environment makes core combat state spatial and persistent: `visuals/environment.ts` owns a field of individually stateful procedural lancets, while `visuals/index.ts` assigns each spawned thief its nearest lit pane and restores that same pane on kill. `audio.ts` demonstrates a score whose dramatic promise is conditional: the major harmony and withheld soprano literally do not exist unless the boss dies.

## Status & notes
Named captures: `silence` (the blind nave), `rose` (boss entrance), and `plenum` (conditional full-cathedral ending). The SwiftShader capture path is only a fallback; final bloom balance, organ mix, and boss timing require a human WebGPU playtest.
