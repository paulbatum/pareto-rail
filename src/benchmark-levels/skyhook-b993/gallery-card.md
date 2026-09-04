# Skyhook

A sixty-second ascent aboard a space-elevator climber: storm banks give way to blue air, a curved planet, and the silence of orbit. White panels, exposed steel and hazard orange frame the view. A huge industrial harvester descends the tether toward the car; clearing it earns a slow capture inside the station.

## Visual language
A visible deck with integrity lamps, twin tether ribbons, passing cable collars, low-poly cloud banks and falling debris establish the climb. The sky moves through storm grey, daylight blue, indigo and black. A procedurally colored globe and a thin atmospheric rim fall below the player. The station has segmented docking rings, solar outriggers and retracting doors. START and REPLAY are punched-grid letters on bolted equipment placards. Lock clamps, impact chips, peeling boss armor and six-shot recoil read without bloom.

## Musical language
120 BPM, thirty bars. Wide stereo add-nine harmony, soft bass, brushed percussion and a low ostinato inhabit the weather. Cloudbreak drops the upper percussion; thin air removes drums; orbit leaves only structural clamp knocks. Quantized locks follow the chord, and kills perform a written melodic lane above the backing register. Boss damage raises the pitch and weight of the player's instrument. Its death ducks the backing for a four-note resolution; two quiet docking bells fade before arrival.

## Mechanical signature
Sails bank through wind, pointed divers converge on the car, satellites orbit and launch interceptable shots, and three-pronged drills spiral toward the deck. The climber has eight integrity points independent of the pilot's five hull points. The six-stage tether harvester remains visible and gets closer throughout the fight. Failure to stop it destroys the climber. Killing it clears the final approach. Full six-lock volleys earn a score bonus; right-click supports lock undo.

## What to read
- `src/benchmark-levels/skyhook-b993/index.ts`
- `src/benchmark-levels/skyhook-b993/gameplay.ts`
- `src/benchmark-levels/skyhook-b993/audio.ts`
- `src/benchmark-levels/skyhook-b993/visuals/index.ts`
- `src/benchmark-levels/skyhook-b993/visuals/environment.ts`

## Status & notes
Directory-only benchmark level; automatically discovered through level.json. The active run lasts exactly 60 seconds. The shared grid-ramp shot timing and transport-snapped action audio are intentional. Inspection markers: weather 4s, cloudbreak 15s, blue 20s, thin 29s, harvester 36s, descent 45s, docking 56s, docked 59s. Human playtesting is still needed for the audio mix, pointer feel and full WebGPU postprocessing.
