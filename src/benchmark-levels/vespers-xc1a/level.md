# Vespers

Sixty seconds down the nave of a cathedral at night while something eats the light out of it. Every enemy is a flat black shape with a stolen pane of stained glass burning in its chest; every kill sends that colour home, and the window it came from stays lit for the rest of the run, so the deeper you fly the more of the building is burning with glass you put there. It ends in front of the dead rose window, and if you kill the thing nested in it, the rose ignites and the organ turns major.

## Visual language
Black stone piers, arcade and gallery tiers, ribbed vaults, a floor of three thousand candles far below. Cobalt, blood, bottle green, gold, and violet glass are the only saturated things in the frame; lit windows throw their colour onto the stone through vertex-coloured spill. Lancet-shaped shades, flapping moths, censers on chains, petal shards, and a black iris for the eye; stained-glass letters in lead; a rose-window reticle whose six petals fill one per lock.

## Musical language
72 BPM chorale prelude in D minor, all organ, no percussion: a held pedal, then tenor, alto, and soprano entering two bars apart in real counterpoint, choir and tubular bells for the swell, a single voice for the quiet, a tolling bell and walking pedal under the rose. Locks are 4' flute notes climbing the bar's harmony, fire is a pedal-reed thump on the chord root, kills walk a hidden two-bar melody lane per section, and the killing blow opens every rank in D major with the trumpet held back until then.

## Mechanical signature
A 60-second run, 3-point hull, variable speed that rushes the dark empty span and slows to a hover before the rose. Shades hover in formations, moths cross in arcs, censers swing one bar per period and throw cinders at the low point. The rose boss: eight orbiting petals gate a two-stage eye that sinks into the glass when wounded, throws a second ring and dark shards, and ignites the whole window when it dies.

## What to read
- `src/benchmark-levels/vespers-xc1a/timing.ts`
- `src/benchmark-levels/vespers-xc1a/gameplay.ts`
- `src/benchmark-levels/vespers-xc1a/eater.ts`
- `src/benchmark-levels/vespers-xc1a/audio.ts`
- `src/benchmark-levels/vespers-xc1a/audio-voices.ts`
- `src/benchmark-levels/vespers-xc1a/visuals/index.ts`
- `src/benchmark-levels/vespers-xc1a/visuals/environment.ts`

## What to study here
The window registry in `visuals/environment.ts`: every claimable window is a vertex range in one merged glass mesh, one merged spill mesh, and a list of stone vertices it can tint, so seventy windows relighting costs a handful of draw calls. Enemies claim a window ahead of them on spawn (preferring their own colour), kills fly a streak back to it, misses leave it dark, and the rose ignition runs a wave of light back down the nave. The audio spine shows a chorale built from written note lists per bar with a runtime-triggered major coda instead of a fixed-bar section.

## Status & notes
One-shot build. Headless WebGPU is unavailable in the build environment; visual and audio quality need a human playtest. Inspection markers: `swell` (bar 8), `quiet` (bar 10), `bossEntrance` (bar 12).
