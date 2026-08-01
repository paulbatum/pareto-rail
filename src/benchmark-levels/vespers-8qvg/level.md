# Vespers

A 60-second flight down the nave of a cathedral at night, while something is eating the light out of it. Flat black shapes come off the glass with a stolen pane's colour burning in their chest — the colour is the only reason you can see them at all. Kill one and the light goes back where it belongs: the window it stripped comes up again, and every window you win back stays lit for the rest of the run, so the deeper you fly the more the cathedral is burning with glass you put there. Past the middle the nave goes quiet; the finale breaks against the Devourer nested in the dead rose window at the west end.

## Visual language
Jewel light in a black room. Near-black stone piers, tiers of arcade and gallery stacked overhead, a floor of candles far below, ribbed vaults closing over — and lancet windows that start dead and relight one by one in deep cobalt, blood red, bottle green, and gold as you return their stolen light. Enemies are dark panes, hanging censers, processing choirs, and a tall herald pulpit, each carrying a burning colour core; the player's shot is a golden dart of light. The rose window holds every colour at once and ignites all of them the moment the Devourer dies.

## Musical language
80 BPM, no percussion at all — the music is the building's own organ. The run opens on a single held pedal note in A minor and lets the voices enter one at a time above it: cantus, counterpoint, chorale, a moving inner voice, then choir and bell weight for the swell. The quiet after the middle drops to one voice. The finale opens every stop and the one voice held back all night; when the rose ignites the minor turns major and the full organ rings. The player's locks, shots, and kills are organ voices — notes inside the polyphony, read from the live harmony on a hidden kill-melody lane, so a chained volley performs a real run.

## Mechanical signature
A 60-second run with a 3-point hull. Pane, censer, choir, and herald enemies move in distinct languages; heralds loose wisps of stolen light that must be shot down. Killing a pane returns its colour to the next dead window (30 in the nave) and it stays lit. The Devourer in the rose window seals its core behind six orbiting thorns; releasing the core early is denied, and the killing blow ignites the rose as the run ends.

## What to read
- `src/benchmark-levels/vespers-8qvg/index.ts`
- `src/benchmark-levels/vespers-8qvg/timing.ts`
- `src/benchmark-levels/vespers-8qvg/gameplay.ts`
- `src/benchmark-levels/vespers-8qvg/boss.ts`
- `src/benchmark-levels/vespers-8qvg/audio.ts`
- `src/benchmark-levels/vespers-8qvg/audio-voices.ts`
- `src/benchmark-levels/vespers-8qvg/visuals/index.ts`
- `src/benchmark-levels/vespers-8qvg/visuals/environment.ts`

## Status & notes
One-shot benchmark build. The organ registration, the quiet-section length, and the boss-wisp cadence are the knobs most likely to need human playtest tuning. Headless WebGPU is unavailable in this environment, so visual and audio quality need a real playtest; the sim, occlusion, and perf gates all pass.
