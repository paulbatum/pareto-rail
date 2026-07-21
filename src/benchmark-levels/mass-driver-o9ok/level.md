# Mass Driver

A 60-second ride on a payload being fired down an orbital railgun. The barrel is a tunnel of accelerator coils and the payload crosses exactly one coil on every beat, so the tempo and the speed are the same fact stated twice. As the run accelerates the coils pull apart — around 9 units between them at the breech, 35 at the muzzle — while still landing on the beat, and they burn from arc blue through indigo and violet toward white. Underneath it all runs one continuous barrel hum that climbs in pitch for the whole minute. The gun is the instrument.

## Visual language
Electric, never fire: arc blue, indigo, violet and blinding white on gun steel, with amber reserved entirely for the defence drones so the thing trying to stop you is always the odd colour out. Six-fold geometry throughout — segmented coils, hex sentries, hex lock clamps, and a hex reticle whose breech jaws close one notch per lock. Discharge arcs earth every lock and kill to the bore wall, sparks fly dead straight in vacuum and are washed backward by the payload's own speed, and the letters of LOAD and RELOAD are capacitor plates on breech panels.

## Musical language
128 BPM techno in D minor; 32 bars is exactly 60 seconds. A coil tick fires on every beat — the ring you are passing through — over a locked, deliberately unchanging four-on-the-floor. The barrel hum climbs from a 37 Hz idle to a scream at the muzzle, and when the safeties jam a firing-charge whine appears above it whose pitch and level are the countdown. Locks walk the live chord, kills read a hidden 32-step melodic lane, and a clean six discharges the capacitor bank as a real cadence.

## Mechanical signature
Variable rail speed that more than quadruples across the run, with coils seated from the same easing so the one-per-beat rule holds by construction. A 3-point hull against sentries that orbit the bore and splay outward as they close, weavers that thread the gap between two coils straight through the middle, armoured bulwarks, and homing darters you can shoot down. The finale is four jammed safety interlocks holding station ahead of the payload while the charge builds: clear them before it peaks and the gun fires you out of the muzzle into silence; miss one and the barrel goes with you inside it.

## What to read
- `src/benchmark-levels/mass-driver-o9ok/timing.ts`
- `src/benchmark-levels/mass-driver-o9ok/gameplay.ts`
- `src/benchmark-levels/mass-driver-o9ok/audio.ts`
- `src/benchmark-levels/mass-driver-o9ok/visuals/index.ts`
- `src/benchmark-levels/mass-driver-o9ok/visuals/rings.ts`

## Status & notes
Built headless: WebGPU cannot render in this environment, so composition was checked through gameplay snapshots on the SwiftShader fallback and the score through a semantic audio trace (120 coil ticks, one per beat, stopping exactly at the muzzle bar). Never heard or played by a human. A playtester should watch the coil strobe first — it should read as one flash per kick with no drift — then the charge phase, which is the brightest stretch of the run and the most likely to need pulling back on real hardware.
</content>
