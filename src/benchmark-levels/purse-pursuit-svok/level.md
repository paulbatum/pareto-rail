# Purse Pursuit

A motorcycle gang just took your purse. Your buddy drives; you are hanging out of the passenger window with the car's sill under your ribs and the wing mirror shaking on its stalk, and the whole level is the chase — sixty seconds of six-lane city highway at night, streetlights strobing amber overhead, tail lights streaming past, the skyline burning pink beyond the barriers. It runs fun rather than gritty: this is a pop music video, not a crime drama. The world is amber, red, chrome and hot pink, and exactly one thing in it is blue — the purse on the boss's shoulder.

## Visual language
Near-black tarmac under warm sodium light. Six lanes of broken white dash tear past a metre below the camera; W-beam guardrails, gooseneck lamp posts and concrete overpasses slide across the frame as the road sweeps. Slammed civilian coupes stream red ahead of you; the skyline is slab towers with amber and pink windows behind a haze the colour of city glow. The player's own car frames the lower-left of the shot — window sill, roof rail, A-pillar, mirror — and lags a beat behind your head, so the bodywork leans after you do. Gang riders are four distinct silhouettes: a low tucked sport bike, a raked chopper with ape-hangers and an upright rider, a slab-wide tourer wearing panniers, and a dirt bike airborne off an overpass abutment with the rider standing on the pegs. The boss is a chromed cruiser in four bolt-on plates with the purse swinging on a chain strap. Player fire is pink-white tracer; the reticle is a six-blade rev counter that fills one blade per lock and runs pink through amber to redline. START and REPLAY are FLOOR! and AGAIN!, spelled in sodium lamp cells on chrome-channelled gantry plates.

## Musical language
128 BPM glossy electropop in B minor / D major — 32 bars that land on exactly sixty seconds — with a hard sidechain pump under a four-on-the-floor chorus. A detuned engine drone sits beneath the whole track and its filter follows the authored speed curve, so the car is audibly in the band. The structural idea is that **the hook is the player's instrument**: the lead synth states an eight-bar topline once, in the chorus, and after that the tune only returns when the player earns it — the chorus kill lane is the hook's own contour in degrees, transposed into whatever chord is live, so a chained six-kill volley performs the topline. The verse lane is a calm stepwise arch, the boss lane is wide interval leaps over a doubled harmonic rhythm, and the payoff lane lives at the top of the register. Locks climb a D major pentatonic, one rung per blade on the rev counter; fire, panel chips and boss clangs are all transport-quantised and pitched from the live chord. Boss hits ratchet in brightness and gain with damage, each chrome plate coming off ducks the mix for a two-note klaxon, and the kill drops everything into a long sub, a full D major stack and the hook's top note ringing out.

## Mechanical signature
A 60-second, four-point-bodywork run on a rail-paced highway with an authored speed curve that eases out of the kerb, floors it on the chorus drop, backs off through the breakdown and pulls away clean at the end. Four rider grammars: weavers braid the lane grid, swingers arc in off the shoulder and press right against the flank before peeling out, haulers pump forward and back in the middle distance and kick a spike cluster loose once they are inside harassing range, and flyers arc over the top of the frame off overpass abutments. The gang boss holds station ahead and alternates authored exposure windows, when its chrome is lockable, with barrages, when it drops back into your lane untargetable and throws lobbed satchel bombs and scattered spike clusters — bombs home on the windscreen and must be shot down, spikes are nailed to the tarmac and the road delivers them. Four plates, eighteen locks. Kill it and the purse sails out of the fireball on a long slow arc, you catch it, and the frame turns blue for the only time in the level.

## What to read
- `src/benchmark-levels/purse-pursuit-svok/timing.ts`
- `src/benchmark-levels/purse-pursuit-svok/tuning.ts`
- `src/benchmark-levels/purse-pursuit-svok/gameplay.ts`
- `src/benchmark-levels/purse-pursuit-svok/boss.ts`
- `src/benchmark-levels/purse-pursuit-svok/audio.ts`
- `src/benchmark-levels/purse-pursuit-svok/visuals/index.ts`
- `src/benchmark-levels/purse-pursuit-svok/visuals/environment.ts`
- `src/benchmark-levels/purse-pursuit-svok/visuals/cockpit.ts`

## Status & notes
Built to the standing brief from the Purse Pursuit theme assignment. Inspection markers: `chase` (bar 4), `hook` (bar 12, the chorus drop), `breakdown` (bar 20, boss tail light sighted), `bossEntrance` (bar 22), and `payoff` (bar 30).

Verified headless in this environment: typecheck, build, benchmark scope, simulation across all policies (no dead-air gaps, full event coverage, 103/105 kills and rank A under the perfect policy, ~24 m average destruction distance), target occlusion, and the performance gates (peak draw calls well inside the 500 budget), plus an audio structure trace. WSL2 cannot render WebGPU headless, so the real frame and the whole mix still need a human playtest.

First things for a playtester to check: whether the cockpit's lag reads as leaning out of a moving car rather than as a HUD overlay; whether the sodium strobe overhead is exciting rather than fatiguing at chorus speed; whether the purse reads instantly as the only blue thing on screen, both on the boss's shoulder and in the catch; and whether a chained six-kill volley in the chorus is audibly the song's hook.
