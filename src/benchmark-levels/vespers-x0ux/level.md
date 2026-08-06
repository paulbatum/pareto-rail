# Vespers

A black-stone cathedral at night, flown from the candle floor through dark arcades toward a dead west rose. Flat shadows carry the colours they stole from the glass; every kill restores a pane, so the nave slowly becomes a lit room. Vespers is recognizable by its jewel windows, black silhouettes, and the organ-like sound of a player-made counterpoint.

## Visual language

Near-black piers, pointed ribs, high gallery windows, a distant candle floor, and a west rose window form a deep vertical nave. Cobalt, blood red, bottle green, and gold are reserved for stained panes and their small reflections. Wisp diamonds, winged gargoyles, hooded cowls, and the rose's concentric tracery are procedural silhouettes that remain readable without bloom. Glass rings, lead lines, pane cracks, extinguishing sparks, and a full-window gold burst carry the event language.

## Musical language

A 72 BPM, sixteen-step organ score lasts exactly eighteen bars (sixty seconds). A held D-minor pedal opens alone; reed voices and a high choir enter through the arcade, then recede into a long dead-span with one lonely line. The rose passage leans on a flattened sixth before the final D-major return. There is no percussion: organ tones, choir pads, pipe attacks, chime partials, and the player's quantized locks, shots, hits, and kill-lane melody make the pulse.

## Mechanical signature

Three ordinary enemy roles occupy different motion languages: wisps sway, gargoyles cross the nave on a wingbeat arc, and cowls orbit their anchors. Wide upper/lower fan formations teach sweeping, while the middle goes intentionally sparse. At the west end a dead rose shell is broken open to expose a hidden oculus; its two-note break and killing volley ignite the cathedral, while a delayed pulse punishes hesitation. The run uses a three-point hull and gives full volleys a musical score bonus.

## What to read
- `src/benchmark-levels/vespers-x0ux/index.ts`
- `src/benchmark-levels/vespers-x0ux/gameplay.ts`
- `src/benchmark-levels/vespers-x0ux/audio.ts`
- `src/benchmark-levels/vespers-x0ux/visuals/index.ts`

## Status & notes

A complete benchmark entrant authored without external assets. The mechanical and headless gates are intended to be checked with `simulate`, `check:occlusion`, `check:perf`, and `check:floor`; human WebGPU playtesting should focus on the rose's depth/readability, bloom-off target contrast, the audio mix, and whether the final major chord has enough space to ring.
