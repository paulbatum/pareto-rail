# Thermal Ink

Thermal Ink is a one-minute sodium-harbor boss fight: a rail dives through wrecked steel while a mutant octopus drags cables through brown water and feeds scavengers from broken machinery. Its signature is the sensory handoff — ink turns the harbor charcoal-black, then infrared makes the living shapes white-hot and their signal cores red.

## Visual language

Tobacco water, muddy ochre haze, rust-red hulls, dirty cream paint, and hard lamps establish the normal view. The octopus is an oily, suction-cupped mass wrapped around wreckage; arm plates, cable lashers, and angular machinery scavengers are separate target silhouettes. Ink clouds are cold-black clustered volumes. Infrared swaps the harbor to charcoal and keeps only heat legible: creatures become white-hot, cores burn red, and ink stays black.

## Musical language

108 BPM industrial pulse in D minor: a slow kick, bouncing filtered saw bass, sparse struck-metal percussion, and one four-note haunted melody. Ink drops thin the percussion and brighten the melody into a focused upper register. Locks, fires, hits, and kills are transport-quantized; kills read a live two-bar harmony lane so a clean volley plays the melody.

## Mechanical signature

Six two-stage arm plates form the continuous boss fight. Cable lashers throw interceptable homing bolts, scavengers cross the full screen in staggered arcs, and timed ink clouds force the thermal-vision rhythm. The core stays un-lockable until the arms are broken or the final phrase arrives, then the last four-bar blackout gives the exposed red signal core a deliberate finale window.

## What to read
- `src/benchmark-levels/thermal-ink-8448/index.ts`
- `src/benchmark-levels/thermal-ink-8448/gameplay.ts`
- `src/benchmark-levels/thermal-ink-8448/audio.ts`
- `src/benchmark-levels/thermal-ink-8448/visuals/index.ts`
- `src/benchmark-levels/thermal-ink-8448/visuals/environment.ts`
- `src/benchmark-levels/thermal-ink-8448/visuals/enemies.ts`

## What to study here

The level keeps its boss readable by putting target plates on the near side of a moving environment boss, and treats infrared as a material-language change rather than a screen tint. The six arm entries give repeated locks a clear narrative purpose, while the forced reveal time keeps an imperfect run from reaching the finale with no playable core.

## Status & notes

Showcase build for the thermal harbor brief. The snapshot renderer uses its best available fallback; a human WebGPU playtest should check the final blackout's white-hot contrast, the timing of bolt interception, and the mix balance between sub bass and the kill melody.
