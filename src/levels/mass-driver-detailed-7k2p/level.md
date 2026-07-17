# Mass Driver

You are the payload inside an orbital railgun: 112 accelerator rings arrive one per beat while the barrel climbs from cold breech-blue to a white-hot safety deadline. Six jammed interlocks hold the frame rim at peak charge; clear them and bar 28 throws the barrel away into silent space, or leave one standing and containment ruptures around you.

## Visual language
Near-black gunmetal, thin arc-blue conductors, volt-violet ion edges, and ignition-white cores carry the electrical heat ramp. Downbeat coils have deep collars and diagonal housings; sparse barrel panels and four conductor rails keep the tunnel dimensional with bloom disabled. Coils, needle-threaders, stave-caged capacitors, unstable arc lightning, and heavy crossed interlocks share machined facets but read by silhouette and motion. Hazard amber appears only on the boss clamps and warnings. CHARGE and RELOAD use procedural stencil plates, while the six-segment reticle becomes a literal breech gauge.

## Musical language
128 BPM minimal techno in E minor, exactly 32 bars. The Em–Em–C–D spine grows from sparse injection pulses through four-on-floor drive, clap-and-acid overdrive, and the boss's Em–F Phrygian klaxon. A detuned saw-and-sub railgun hum rises continuously for 52.5 seconds and is cut dead on the shot; a huge E-major pad then leaves glassy delays and a subsiding sub pulse in open space. Player actions quantize to the live transport, change timbre by section, and chained kills walk authored melodic lanes; interlock confirmations climb until the sixth releases the clamp sequence.

## Mechanical signature
A three-hull, 60-second variable-speed run with one physically spaced coil crossing on every quarter note. Wall-riding coil ranks alternate with counter-rotating threader helices and four-hit capacitors before six three-hit station-keeping interlocks arrive in two rim ranks. Firing coils and two interlocks launch lockable, interceptable arc bolts. The bar-28 downbeat is a hard deadline and a roughly-threefold speed surge; S rank requires all six interlocks cleared in time as well as a high score and near-total clear.

## What to read
- `src/levels/mass-driver-detailed-7k2p/timing.ts`
- `src/levels/mass-driver-detailed-7k2p/gameplay.ts`
- `src/levels/mass-driver-detailed-7k2p/audio.ts`
- `src/levels/mass-driver-detailed-7k2p/audio-voices.ts`
- `src/levels/mass-driver-detailed-7k2p/visuals/index.ts`
- `src/levels/mass-driver-detailed-7k2p/visuals/environment.ts`
- `src/levels/mass-driver-detailed-7k2p/visuals/models.ts`

## Status & notes
Showcase build. Authored inspection markers: `stage1` (bar 4), `stage2` (bar 12), `warning` (bar 19), `interlock` (bar 20), and `shot` / `muzzle` (bar 28). A human WebGPU playtest should first verify exact audible/visual ring phase, bloom-zero interlock contrast against the charge disc, the balance of the rising hum beneath the acid and klaxon layers, and whether the successful shot's hard whiteout-to-silence contrast feels sufficiently physical.
