# Thermal Ink

One continuous sixty-second boss fight against a giant mutant octopus in a drowned industrial harbor. The rail circles its lair, dives beneath its hanging arms, and skims collapsing steel while the creature turns to keep you in reach. Its weapon is ink: dense black clouds swallow normal sight, your thermal sensors snap in, and the fight becomes a stark charcoal display — octopus and spawn blazing white-hot, vulnerable points burning as red signal cores, the ink itself staying cold black.

## Visual language
Normal sight is sodium-harbor murk: tobacco-brown water, ochre haze, rust-red metal, dirty cream paint, hard lamps burning through grit. Wrecked hulls, chains, pipes and snapped cables form silhouettes; marine snow drifts through everything. The octopus is an oily near-black mass wearing its wreck — rusted plates half-sunk in flesh — with pale lamp-lit eyes. The player's own tech is sea-glass: the one cold-moving thing in a warm world, legible in both displays. When ink closes over the camera the whole world drops into the thermal grade: charcoal background, white-hot silhouettes, red signal cores, faint scanline shimmer.

## Musical language
96 BPM industrial pulse in D minor over a descending lament (Dm–C–Bb–A), with heavy rubber kick, inharmonic harbor-metal clank, bouncing sub bass, and one haunting plucked melody. While the camera is inside ink the noise falls back — drums, clatter and bass mute — and the same melody returns an octave up on a bright square pluck. Player actions snap to the transport and read the live harmony; kills walk hidden sequencer lanes so clean volleys play melodic runs. The finale ducks the mix for a conclusive figure, and the lamps return on the level's only major chord.

## Mechanical signature
Ink is the fight's rhythm. Clouds are scheduled on phrase boundaries and drift across the route; fly into one and enemies vanish from normal sight, the thermal display engages automatically (snapping on, relaxing off), and the arrangement thins to match. The boss is one animal: six lockable arms (2 hits each) hang off its sockets; strip them all before the enrage and it regenerates a fresh set once for its final stand; break those and the mantle valves hinge open on a red core (6 hits) — which answers with the final ink wall, so the last volley lands in the dark. Hatchlings spit homing ink gobs you can intercept; buoy-mines close armored until their shell strips.

## What to read
- `src/benchmark-levels/thermal-ink-v1d2/gameplay.ts` — rail, speed profile, spawn choreography, ink-state plumbing
- `src/benchmark-levels/thermal-ink-v1d2/octopus.ts` — boss state machine: pose, arms, regeneration, exposure, blackout
- `src/benchmark-levels/thermal-ink-v1d2/audio.ts` + `audio-voices.ts` — score, sections, kill lanes, thermal mix switch
- `src/benchmark-levels/thermal-ink-v1d2/visuals/index.ts` — tint system (murk ↔ thermal), event choreography
- `src/benchmark-levels/thermal-ink-v1d2/visuals/environment.ts` — the drowned harbor

## Status & notes
Built as a benchmark entrant against the standing brief. Verified headless: typecheck, build-independent floor gates (performance growth, occlusion, audio config), no-fire/perfect/imperfect simulations (S rank reachable, core kill lands inside the final blackout), spawn trace, and gameplay snapshots under SwiftShader. Not yet verified by human playtest: actual WebGPU rendering of the thermal grade, bloom balance at zero, mix loudness, and whether the ink/thermal transition feels as decisive in motion as it does on paper.
