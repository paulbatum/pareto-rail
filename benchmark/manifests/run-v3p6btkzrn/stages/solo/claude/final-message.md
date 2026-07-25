**Vespers** is built and green across every gate. `src/benchmark-levels/vespers-p6bt/` is the only touched path — no registry edit, no shared-code change.

## What it is

A 62.7-second flight down the nave of a black cathedral at night. All 198 windows start dark because the things in here are wearing that light — flat black cut-outs off the glass with one stolen pane burning in the chest. **Kill one and the colour goes home**: the window it stripped comes back up, its twin across the nave with it, and both stay lit for the rest of the run. Miss one and that pane is gone permanently. `detailsForRun` reports `Windows relit n/198`, and `rankForRun` gates S on it.

Five movements, addressed in bars from `timing.ts`: pedal (bars 0–3) → subject (4–7) → gallery (8–11, densest) → **hush** (12–14, three targets in eleven seconds, the camera lifting into the vault) → the rose fight (16–23). A speed profile surges into the gallery, drops the floor out at the hush, and surges again into the west end.

Seven kinds, four distinct motions: shades peel off the wall and slide inward; seraphs hover and sink with counter-turning wing ranks; **censers swing a full pendulum every two beats in strict tempo** — the metronome you can see; gargoyles crouch then lunge, spitting homing embers. The boss is the dead rose window: the heart can't be locked while a petal still burns, and every stage break slams the shell shut for 2.6 s of unlockable ember fire.

Audio is one organ, no percussion anywhere — a held pedal alone, then tenor subject (bar 2), answer (4), choir (6), descant and bell (8), voices written as scale degrees so they retune with the harmony. Locks walk a flute up the mode, firing is the swell shoe opening, and kills sound a hidden two-bar melody lane per section. **The reed rank never speaks until the rose ignites**, at which point the lead set turns major and a separate tutti arrangement takes over on the next bar line.

## Verified

`typecheck`, `build`, `check:floor` (occlusion clean across 73 targets; perf 250 draw calls of a 500 limit; no centerness/distance/reticle warnings; full event coverage) and `trace:audio` (535 scheduled events; pitches and voice registers inspected). Simulation: perfect 66/73 with no hull loss, imperfect 61/73 rank A, no-fire dies at 36.7 s. I inspected the whole run as stills including a bloom-off pass.

`check:benchmark-scope` could not run — it imports `scripts/benchmark/protocol.mjs`, which does not exist in this checkout. I verified scope by hand instead: `git status` shows only the level directory.

## For a playtester

**Nothing here has been heard.** Judge the balance between the organ and the player's stops first — particularly whether the mixture kill voice in the gallery and rose sections sits inside the counterpoint or on top of it, and whether the flute locks are audible at all under the descant.

Then: the ignition. It is the level's biggest event and the hardest thing to tune blind — I pulled it back three times because the whole nave coming up at once was washing the frame white. The 1-second flash may still be too much on real hardware. After that, watch the hush (bars 12–15) for whether five seconds of near-empty nave reads as intentional or as the level breaking, and the gargoyle lunge at close range, which fills a third of the frame in red.