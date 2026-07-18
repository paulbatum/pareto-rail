# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle over exactly sixty seconds. The gun is the instrument: the run is scored to a locked 128 BPM minimal-techno pulse in E minor, and the payload crosses one glowing accelerator ring on **every quarter-note beat** — the beat grid is the level's unit of distance as well as its unit of time. The gun only ever speeds up, the rings burn from arc blue through violet toward blinding white, and on the downbeat of bar 28 it fires whether or not you are ready.

## Visual language

Electric, not fire. Near-black void and cold gunmetal structure; everything the gun accelerates runs hot up one electrical heat ramp — arc blue → volt violet → blinding near-white. 113 accelerator rings, one per beat, are placed at the exact rail parameter the camera occupies on that beat, so each crossing flashes the ring just passed, pre-glows the next, and throws a heat-coloured shockwave on the beat by construction; downbeat rings are larger, deeper, and carry four coil-housing lugs. Four conductor rails run the whole barrel at the diagonals, gradient blue-to-violet and pulsing with the kick. A dense shell of camera-riding ion streaks scrolls faster the faster the gun runs and is slammed by the post-shot surge.

Every hostile is machined from one facet vocabulary — gunmetal fills, thin bright edges, a small hot core — so a single tint pass drives closing, locked, denied, and hit states, and silhouette alone carries identity with the bloom slider at zero. **Hazard amber is strictly reserved** for the jammed interlocks, the charge warnings, denial, and the detonation. The player's own kit stays ion white and arc blue. CHARGE and RELOAD are stencil plates off the gun housing: shallow gunmetal cell grids with a crisp routed edge. The reticle is the breech charge gauge — six arc segments light one per lock, climbing the lock gradient, the sixth ignition-white.

## Musical language

128 BPM, 32 bars, exactly 60.000 seconds. Main loop Em–Em–C–D; the interlock bars switch to Em–F–Em–F for the ♭II Phrygian dread; the muzzle resolves to a single sustained E major bloom. Underneath everything a persistent hum — the gun spooling up — climbs from E1 up a fourth by the middle, up an octave by the interlocks, then accelerates into the charge peak, and **the shot cuts it dead in a heartbeat**. The transport is re-zeroed on the run downbeat so ring crossings and quarter notes can never drift apart.

The player is the soloist: locks walk the live lead by lock count, kills read hidden per-section melodic lanes so a chained volley performs a real run, and lock/fire/kill timbres crossfade across five section voicings — glassy at the breech, tight and square in stage 1, bright saws in stage 2, dark and reverb-heavy at the interlocks, quiet and hall-drenched at the muzzle. Each interlock destroyed plays a climbing confirmation one note longer than the last; the sixth ducks the mix for a beat, lands an impact and a high chord stab, and falls away. A reject is a breaker trip — a dead low minor second falling into the floor.

## Mechanical signature

A 60-second run with a 3-point hull and a strictly accelerating speed profile that surges roughly threefold on the bar-28 downbeat. Five hostile kinds: wall-riding coil sentries that slide around the bore circumference and telegraph arc bolts; needle threaders that corkscrew across the full frame width in counter-rotating pairs; two-stage capacitor banks whose six insulator staves shear off to expose the core; interceptable ball-lightning arcs that re-randomize their wire shells every frame; and six hazard-striped interlock clamps that station-keep a constant lead ahead of the camera so they can never be overtaken. Clear all six before the gun fires and the shot throws you cleanly out of the muzzle into silent open space; leave even one and the barrel detonates with you inside it. S rank requires the gun to have actually fired.

## What to read
- `src/benchmark-levels/mass-driver-detailed-om5e/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-om5e/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-om5e/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-om5e/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-om5e/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Inspection markers: `stage1` (bar 4), `stage2` (bar 12), `klaxon` (bar 19), `interlock` (bar 20), `chargeCritical` (bar 26), `shot` (bar 28), and `muzzle` (bar 28:2). Verified headless — typecheck, build, benchmark scope, simulation across all policies, target occlusion, and the performance gates. WSL2 cannot render WebGPU headless, so the real frame and the mix still need a human playtest: check first that ring crossings feel exactly on the beat, that the bar-28 shot lands as the biggest moment in the run, and that the six interlocks stay readable against the growing charge glow.
