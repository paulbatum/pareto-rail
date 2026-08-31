# Vespers

Fly the nave of a cathedral after midnight while flat black things peel the light out of its stained glass. Vespers is recognizable by its candle sea, stacked stone arcades, and four jewel colours burning in otherwise near-black space; by ear it is a minor organ procession that falls almost silent before the west rose window breaks open into D major.

## Visual language
Near-black piers, thin vault ribs, high lancet windows, and a receding floor of hundreds of small candles establish the enormous room without making the targets disappear. Wraiths are angular black wings with a cobalt, blood, bottle-green, or gold pane in the chest; lancets climb like inverted windows; bells swing through a pendulum arc. Each kill re-lights one of the side panes permanently, so the nave becomes more colourful as the flight goes deeper. The three-stage rose target is a nested black wheel in front of the dead west window. Its death ignites every rose segment at once and leaves the cathedral lit.

## Musical language
120 BPM, 16th-note transport, and a D-minor procession built from a two-bar chord cycle. The opening is a held pedal; choir enters next, then a slow cantus, then an answering upper voice and tolling bell weight. Bars 16–23 deliberately strip back to pedal and two sparse notes. Player locks, fire, hits, and kills are quantized notes from the current chord, with a hidden kill lane that turns a volley into a melodic run. The rose's final blow ducks the organ for a breath, then lands a D-major choir chord and high bell.

## Mechanical signature
A 60-second run across 50 targets: 22 floating wraiths, 14 ascending lancets, 13 swinging bells, and a three-stage rose boss. The first 16 bars teach wide sweeps through paired and fan-shaped formations, the middle swell culminates in a six-voice screen fill, and the eight-bar silence leaves only candles before the final west-wall approach. The rose takes seven locks across its three stages, with stage flashes and an exposed-core callout.

## What to read
- `src/benchmark-levels/vespers-4797/index.ts`
- `src/benchmark-levels/vespers-4797/gameplay.ts`
- `src/benchmark-levels/vespers-4797/audio.ts`
- `src/benchmark-levels/vespers-4797/visuals/index.ts`

## Status & notes
Showcase benchmark output. The runtime uses the shared lock-on runner, score/arrangement audio spine, procedural 5×7 START/REPLAY glyphs, and a self-contained cathedral scene. Snapshot captures use the best-effort headless fallback; a human WebGPU pass should check the black silhouettes at bloom 0, the gradual window recovery, the rose kill flash, and the reverb/organ balance on the quiet span.
