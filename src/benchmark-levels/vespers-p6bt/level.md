# Vespers

Night in an enormous cathedral, flown down the middle of the nave while something eats the light out of it. Every window in the building starts dark, because the things in here are wearing that light: flat black cut-outs off the glass, each with one stolen pane burning in its chest. Kill one and the colour goes home — the window it stripped comes back up, and its twin across the nave with it, and both stay lit for the rest of the run. Let one past and that pane is gone for good. The deeper you get, the more of the building is burning behind you, and the whole thing is scored by the cathedral's own organ.

## Visual language
Black stone and jewelled glass, with nothing in between. Compound piers, three stacked tiers of pointed openings, ribbed vaults closing overhead and a pavement of candles thirty metres below, all built from one instanced bay stamped thirty-three times down the nave. The only saturated colour in the frame is glass — cobalt, blood, bottle green, gold, violet — and it lands on the stone beside it as a wash and a shaft. Targets are flat black lancets, six-winged seraphs, swinging censers and crouched gargoyles, each ringed by the colour it took. Kills throw broken glass, a halo and a cross of light, and send a thread of colour running back across the nave to the window it came from. START and REPLAY are glazed the same way: 5×7 panes in lead came, set in a pointed arch.

## Musical language
88 BPM, D minor, and no percussion of any kind — the pulse is the counterpoint moving. One organ carries everything: a held pedal opens the level alone, the subject enters in the tenor at bar 2, the answer at bar 4, choir at 6, descant and bell at 8. The nave goes quiet at bar 12 for one voice over the pedal. Every player action is a stop on the same instrument — locks walk a flute up the mode, releasing is the swell shoe opening, and each kill sounds the note written at that step of a hidden two-bar melody lane, so a chained volley performs a real melodic run. One rank, the reed, is silent all night; it speaks for the first time when the rose window ignites, and the harmony turns major with it.

## Mechanical signature
A 63-second run on a 3-point hull across 198 relightable windows, with a speed profile that surges into the gallery, drops away for the hush and surges again into the west end. Shades peel off the wall and slide inward, seraphs hover and sink, censers swing a full pendulum every two beats in strict tempo, and gargoyles crouch then lunge down the nave spitting homing embers. The dead rose at the west end holds six of the colours it took: the heart cannot be locked while a single petal is still lit, and every stage the player breaks slams the shell shut for two and a half seconds of unlockable ember fire before it grinds open again. Rank is scored on kills, volley cleanliness and how much of the cathedral is alight at the end.

## What to read
- `src/benchmark-levels/vespers-p6bt/nave.ts`
- `src/benchmark-levels/vespers-p6bt/gameplay.ts`
- `src/benchmark-levels/vespers-p6bt/rose.ts`
- `src/benchmark-levels/vespers-p6bt/audio.ts`
- `src/benchmark-levels/vespers-p6bt/audio-voices.ts`
- `src/benchmark-levels/vespers-p6bt/visuals/index.ts`
- `src/benchmark-levels/vespers-p6bt/visuals/cathedral.ts`

## What to study here
The window economy is the idea worth stealing. A pure function in `nave.ts` maps any point in the nave to the pane nearest it, and both the runtime and the visuals subscribe to `spawn` and `kill` and call it independently — so a persistent, world-scale consequence for every kill and every miss costs one shared helper and no coupling between the two halves. It also gives the level an arc a scoreboard cannot: the room is measurably brighter at the end than it was at the start, and the player did that.

The building is worth reading for how cheap it is. One dressed bay, one pier bundle and one vault cell are each built once and instanced down the nave; 198 windows are four instanced meshes; everything dynamic rides on per-instance colour. The whole cathedral peaks at 250 draw calls with the boss fight on screen.

Two lessons came out of headless snapshots and are baked into `visuals/index.ts` and `cathedral.ts`. Additive quads with hard edges look fine at range and become a white rectangle across the entire frame when the camera passes within a metre of one, so every soft sprite here fades to black at its rim. And a large emissive surface — a lit lancet the player flies straight past — needs an explicit near-distance rolloff or it whites out the shot. Targets shrink out of frame as they are overtaken rather than smearing across it.

Weaker ground: the enemy bodies are deliberately flat and read as silhouettes rather than as objects, and the rose window's heart is a simpler shape than the window it sits in. The music has been verified structurally through `trace:audio` but never heard, so the balance between the organ and the player's stops is the first thing a playtester should judge.

## Status & notes
Built headless. `npm run typecheck`, `npm run build` and `npm run check:floor -- --level vespers-p6bt` pass; occlusion is clean across 73 targets and the performance gates pass with room to spare. WebGPU renders correctly under headless Chrome in this environment, so framing, palette and every set piece have been inspected as stills — but nothing here has been heard, and no human has flown it.

Inspection captures: `gallery` (densest act, bar 8), `hush` (the empty nave, 36s), `rose` (the fight in front of the west window, 52s).
