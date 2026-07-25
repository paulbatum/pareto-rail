# Vespers

Night in the nave of an enormous cathedral while flat black thieves eat the light out of it. Every window starts dark; every thief burns with one stolen pane's colour, and killing it streams that colour home — the window relights and stays lit for the rest of the run, so the deeper you fly, the more of the building burns with stained glass you put there. The soundtrack is the cathedral's own organ: a pedal point, voices entering one at a time in counterpoint, no percussion anywhere, and one trumpet rank held back all night for the moment the rose window ignites and the minor turns major.

## Visual language
Black stone piers, arcade and gallery arches, ribbed vaults, and a candle sea far below; jewel light in a black room. The only saturated things in frame are stained glass — cobalt, blood red, bottle green, gold, amethyst — in ~140 instanced windows that relight kill by kill, in the thieves' chest-cores, and in the dead rose window that the boss ignites sector by sector. Letters are little stained-glass windows in lancet arches; kills stream their colour back to a real window in the world.

## Musical language
72 BPM, D minor, 18 bars = exactly 60 seconds. Organ counterpoint over a held pedal — procession, voices, descant, full plenum with choir and bells, a one-voice quiet span, a walking-pedal Vigil, an apex scale on the dominant. Kills read per-section melody lanes pitched from the live harmony, locks climb a flute scale, fire is a chord-rooted chiff; the finale ducks the mix, turns the third major, and finally lets the en chamade trumpet speak.

## Mechanical signature
A 60-second run with a 3-point hull. Wisps sink toward the candles, moths cross the nave, gargoyles pounce and spit interceptable gloom bolts, censers swing on chains and take two hits. The Vigil holds the rose window: six petal targets shield a two-stage heart via a release filter (locked heart shots turn away in gold while petals live), and the stage break summons three echo petals before the heart is bare again. Heart death ignites the rose and cascades light down every window the player could not save.

## What to read
- `src/benchmark-levels/vespers-t5xw/timing.ts`
- `src/benchmark-levels/vespers-t5xw/gameplay.ts`
- `src/benchmark-levels/vespers-t5xw/vigil.ts`
- `src/benchmark-levels/vespers-t5xw/audio.ts`
- `src/benchmark-levels/vespers-t5xw/visuals/index.ts`
- `src/benchmark-levels/vespers-t5xw/visuals/environment.ts`

## What to study here
The window-relight economy: enemies are assigned real windows at spawn (`assignWindowNear`), kills stream light home and the ignition is permanent, misses leave that window dark all run — the end-of-run cathedral is a scoreboard you can see. The whole cathedral renders in a handful of draw calls (all panes one InstancedMesh, all glows one, all tracery one merged LineSegments). The boss seal runs entirely through `validateRelease` rather than lockability, so a blocked volley reads as "shielded" instead of a dead reticle.

## Status & notes
One-shot benchmark build. Simulation: perfect policy clears 64/64 with the Vigil down (~rank S threshold), imperfect seed 1 ranks S; the 39–43.5s gap is the authored quiet span. Headless WSL2 cannot render WebGPU, so final visual/audio quality needs a human playtest: check the bloom-off legibility of the black thieves against the fog, the pane-ignition readability at distance, and the organ mix balance in the plenum.
