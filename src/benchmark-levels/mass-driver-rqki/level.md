# Mass Driver

Sixty seconds strapped to a payload inside an orbital railgun, riding the bore
out toward the muzzle. The level is built on one claim: the camera crosses
exactly one accelerator coil on every beat of the run, for all 136 of them. The
speed curve only accelerates, so the coils physically spread apart as the run
goes on while the strobe stays locked to the pulse — you watch yourself speed up
without the tempo ever changing. Under all of it sits a single barrel hum that
runs the entire minute and never retriggers, climbing in pitch as the firing
charge builds. The gun is the instrument.

## Visual language
Two colour families that never mix. The gun is electric — arc blue climbing
through violet to blinding white as the coils are driven harder — carried on
thin instanced filaments, two unbroken conductor rails down the bore, and a dark
vertex-shaded barrel wall. Everything hostile is a fault light in sodium amber
and warning red: steel drones with fault-lit cores, homing lances, and six
jammed hexagonal interlocks. Kills earth themselves to the wall with a jagged
arc. START/REPLAY are breech-console readouts, lit cells hot inside an
always-present dark 5×7 grid so they stay sharp at any bloom setting.

## Musical language
144 BPM, 36 bars, exactly 60 seconds, and a locked hypnotic pulse: one coil hit
per beat for the whole run. The same two-chord minor vamp is transposed up at
each act boundary — D, E, G, A — so the minute is one enormous rising line, and
the barrel hum's pitch tracks it as the literal charge state. Locks walk the
live pentatonic lead set as a run into the release, kills play a hidden per-act
melody lane, and clearing the last interlock ducks the mix and runs that scale
clean up into the muzzle.

## Mechanical signature
A 60-second run on a 3-point hull with wall-patrolling sentries, bore-crossing
weavers, armoured clamps that screw inward off a coil, and interceptable lances.
The boss is a deadline, not a healthbar: six jammed safety interlocks at three
hit points each — exactly three full six-lock volleys — against a charge that
peaks at the muzzle bar no matter what. Clear them and the gun fires, launching
the payload into open space. Leave one and the barrel bursts with you inside it.

## What to read
- `src/benchmark-levels/mass-driver-rqki/timing.ts`
- `src/benchmark-levels/mass-driver-rqki/gameplay.ts`
- `src/benchmark-levels/mass-driver-rqki/breech.ts`
- `src/benchmark-levels/mass-driver-rqki/audio.ts`
- `src/benchmark-levels/mass-driver-rqki/visuals/index.ts`

## Status & notes
Built headless: WebGPU cannot render in this environment, so the coil strobe,
the muzzle exit, and the mix all need a human playtest to confirm.
