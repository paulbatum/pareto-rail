# Prism Warm Palette

A warm luminous recolor of the glassy prism rail. The same short flight through fan waves of gates, comets, and echoes, lit now like an ember at dusk: a deep umber-and-burgundy void, amber and coral targets, warm cream at every hot core, and gold climbing through the lock count as a volley builds.

## Visual language
Deep umber/burgundy base and starfield, amber and coral prism ribs and targets, warm cream cores and letters, and hot ember for rejected releases, misses, and kills. Lock progression runs amber → gold → cream. HDR intensities are unchanged from the source, so thin highlights bloom without washing out the frame. Spiral, zipper, and bloom target motion and procedural grid letters are preserved.

## Musical language
96 BPM, compact bell and low-pulse material, shimmer delay, simple scale motion, and lock, fire, hit, kill, miss, and reject sounds pitched from the live harmony. Audio is unchanged from the source level.

## Mechanical signature
A ~30-second run with three enemy kinds, fan-built waves, spiral/zipper/bloom offsets, and per-kind scoring. Geometry, motion, gameplay, and timing are preserved from Prism Bloom; only the palette and identity change.

## What to read
- `src/benchmark-levels/prism-warm-palette-w6fq/index.ts`
- `src/benchmark-levels/prism-warm-palette-w6fq/gameplay.ts`
- `src/benchmark-levels/prism-warm-palette-w6fq/audio.ts`
- `src/benchmark-levels/prism-warm-palette-w6fq/visuals.ts`

## What to study here
A disciplined recolor: a single palette block at the top of `visuals.ts` (umber, amber, coral, cream, ember, gold) drives every mesh, effect, and event pulse, and a shared `LOCK_RAMP` carries the gold lock-count progression. Geometry, motion, timing, and audio are held fixed so the warm variant reads as the same level under a different light.

## Status & notes
Recolor of Prism Bloom per the "Prism Warm Palette" theme. Palette values and identity changed only; geometry, motion, gameplay, timing, and audio preserved. WebGPU cannot render headless in this environment — final warmth, bloom restraint, and legibility at bloom 0 need a human WebGPU playtest.
