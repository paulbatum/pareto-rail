# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle over exactly sixty seconds. The gun is the instrument: the run is scored to a locked 128 BPM minimal-techno pulse in E minor, and the payload crosses one glowing accelerator ring on every quarter-note beat — the beat grid is the level's unit of distance as well as time. Two-thirds in, a klaxon announces that the gun's six safety interlocks have jammed across the bore, and the shot fires on the downbeat of bar 28 whether or not you are ready.

## Visual language
Electric, not fire. A near-black void and cold gunmetal structure; everything the gun accelerates runs up one electrical heat ramp — arc blue, through volt violet, to a blinding near-white — while the player's own kit (reticle, locks, shots) stays ion white and arc blue. 113 beat-spaced accelerator rings run the barrel, downbeat rings a touch larger and carrying four coil-housing lugs; four conductor rails gradient down the bore; a scattered rib wall sits just outside the drones' reach; a shell of streaks rides the camera and blazes past the muzzle. Hazard amber is strictly reserved for the jammed interlocks, the charge warnings, and denial. START and REPLAY are CHARGE and RELOAD, cut as stencil plates off the gun housing, and the reticle is a six-segment breech charge gauge that lights one segment per lock.

## Musical language
128 BPM locked minimal techno in E minor; 32 bars is exactly 60 seconds. The main loop is Em–Em–C–D two bars per chord, the boss bars switch to Em–F–Em–F for the flat-II Phrygian dread, and the muzzle resolves to one sustained E major bloom — the whole run is minor, the release is major. Underneath everything a persistent detuned bass hum, the gun spooling up, climbs from E1: up a fourth by the middle, up an octave by the interlocks, then an accelerating rise into the charge peak before the shot cuts it dead in a heartbeat. Player actions are notes in that score: locks walk up the live lead by lock count, kills read hidden per-section melody lanes so a chained volley performs a real run, and lock, fire, and kill timbres crossfade section by section from glassy at the breech to dark reverb-heavy saws at the interlocks. Each interlock destroyed plays a climbing confirmation one note longer than the last; reject is a breaker trip, a dead low minor second falling into the floor.

## Mechanical signature
A 60-second run with a 3-point hull and a strictly accelerating rail that surges roughly threefold on the bar-28 downbeat. Wall-riding coil sentries slide around the bore rim and some rear back to loose interceptable arc bolts; needle threaders corkscrew across the full frame in counter-rotating pairs; two-stage capacitor banks shed six insulator staves before their core is exposed. The finale is a boss on a hard musical deadline: six hazard-striped interlock clamps hold station at the frame rim through the last eight bars, and any clamp still standing when the gun fires deals a lethal hit. Clear all six and the shot throws you cleanly out of the muzzle into silent open space; fail and the barrel detonates with you inside it. S rank requires the gun to have actually fired.

## What to read
- `src/benchmark-levels/mass-driver-detailed-om6f/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-om6f/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-om6f/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-om6f/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-om6f/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified headless with typecheck, build, benchmark scope, and the floor gate (simulation, target occlusion, performance, audio configuration), plus the audio trace. WSL2 cannot render WebGPU headless, so the real frame and the mix still need a human playtest. First things to check by hand: that ring crossings land audibly and visibly on the beat, that the bar-28 shot lands as the single biggest moment in the run, and that the six interlocks stay legible against the growing charge glow. Wall-riding coils deliberately leave the lock frustum in the last quarter of their approach — being overtaken at the bore rim is their exit — so the engagement report shows short windows for them by design.
