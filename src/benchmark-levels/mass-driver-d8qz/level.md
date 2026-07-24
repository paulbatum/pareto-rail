# Mass Driver

A 60-second ride on a payload down the bore of an orbital railgun. The barrel is a tunnel of accelerator rings and the camera crosses exactly one of them on every beat, so the tempo and the speed are the same fact: as the payload accelerates the rings spread further apart and burn hotter, but the pulse never changes. Hot here is electric — arc blue through violet to blinding white — and the gun is also the band, a bass hum climbing three octaves under a locked four-on-the-floor.

## Visual language
A black bore ringed with 121 glowing accelerator coils, one per beat, placed at the rail position the camera occupies on that beat. Conductor stripes and charge pulses run the barrel wall toward a muzzle that starts as a pinprick of starlight. Defence drones, needle lances and armoured coil sentries are amber over matte casing — the only warm things in a cold machine — while the reticle, locks and shots are plasma white-cyan. Locks throw a jagged arc from the sight to the target; kills come apart into their own plating. The six jammed safety interlocks are fault-red clamps riding a wheel across the bore.

## Musical language
128 BPM in A minor, 32 bars, eight arrangement sections. A kick fires on every beat for the entire run because a kick *is* a ring pass. Underneath it one continuous rail hum glides from A0 to A3 and becomes the muzzle scream. Player actions are written into the score: locks and shots snap to the transport and read the live chord, kills walk hidden two-bar melodic lanes, and the interlock phase adds a per-bar siren that doubles in rate as the firing charge climbs.

## Mechanical signature
Rail-paced targets inside a clear bore that no ring ever occludes. Drones orbit the bore in wheels and are dragged toward the axis as they close, so a full six-lock sweep is a circle rather than a line. Lances cut tapering chords; sentries creep in, telegraph, and fire interceptable homing bolts against a 3-point hull. The finale is a hard timer: six two-stage interlocks must all be blown before the charge peaks at bar 28. Clear them and the gun fires, spinning the payload out of the muzzle into silence; miss one and the barrel goes instead, with you in it.

## What to read
- `src/benchmark-levels/mass-driver-d8qz/timing.ts`
- `src/benchmark-levels/mass-driver-d8qz/gameplay.ts`
- `src/benchmark-levels/mass-driver-d8qz/audio.ts`
- `src/benchmark-levels/mass-driver-d8qz/visuals/index.ts`
- `src/benchmark-levels/mass-driver-d8qz/index.ts`

## Status & notes
Benchmark entry built to the standing level brief. Verified headless: typecheck, build, simulation (98 counted targets, all 92 engagement contracts passing), target occlusion, performance and the floor gate. Two engine defaults are inherited deliberately: `validateRelease`, because the level's release rule is the shape of the sweep and the countdown rather than a filter on what may fire, and `allowLockUndo`, because a locked pulse should never invite a take-back. WebGPU cannot render in this environment, so the frame itself, the mix and the feel of the ring pulse still need a human playtest.
Inspection captures: `fault` (interlock cage, bar 20), `launch` (charge peak, bar 28).
