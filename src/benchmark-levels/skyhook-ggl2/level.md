# Skyhook

A 64-second climb up a space elevator, riding the climber car from the weather to the station. The sky does all the colouring — storm grey down in the deck, sunlit blue above it, indigo as the air thins, black at the top with stars above and the planet curving away below — while the hardware stays utilitarian white paneling and hazard orange. Recognisable at a glance by the whole world falling away beneath a lit tether, and by ear from a soundtrack that starts wide and warm and *loses layers* as it climbs, until the boss up top is scored by almost nothing at all.

## Visual language
White paneling, hazard orange and dark steel; nothing neon. A lit tether with hazard rung-ticks runs up the middle of the climb, debris streaks downward past the car, a cloud deck the car punches through, a planet curving away far below, and a docking station that swells with light and swallows the car at the end. The player owns a cold ice-white reticle, locks and shots that read against every sky, and locks that charge ice → white → hazard so a full charge looks like ignition.

## Musical language
120 BPM in D, 32 bars = the exact 64-second climb. The arrangement runs backwards from a build: widest and warmest down in the weather, shedding a layer at every altitude until the Descent is just a low tolling bell and a drone — so the player's own guns are the loudest melodic voice up top. Locks, shots, hits and kills snap to the transport and read the live D–G–Bm–A harmony; kills walk hidden per-section lanes so a clean volley plays a melody. The Descender gets its own escalating drone and a conclusive resolve to D as the station takes the car and everything goes quiet.

## Mechanical signature
A 5-point car hull. Wind-riding kites and drifting mines down in the weather; vacuum-hardened husks that lunge and fire up top; hazard-orange grapnels that ignore the player and go straight for the car — kill them before they latch on. The boss, the Descender, latches onto the tether high above and climbs down toward the car the whole fight, getting bigger; put it out before it arrives or it tears at the hull, then dock into the station.

## What to read
- `src/benchmark-levels/skyhook-ggl2/gameplay.ts`
- `src/benchmark-levels/skyhook-ggl2/descender.ts`
- `src/benchmark-levels/skyhook-ggl2/audio.ts`
- `src/benchmark-levels/skyhook-ggl2/visuals/index.ts`

## Status & notes
Built headless (typecheck, build, floor gate, simulator). WebGPU cannot render in this WSL2 environment, so the visual/audio mix needs a human playtest — look first at the cloud-deck break (bar 8), the star/indigo thinning (bar 16), and the Descender coming down the tether (bars 20–29) into docking.
