# Mass Driver

You are the payload. A 60-second ride down the barrel of an orbital railgun at 128 BPM — 32 bars to the muzzle, one glowing accelerator ring crossed on every beat. The rings space out as the charge accelerates you, but the crossing cadence never leaves the pulse: the speed and the music are the same object. At bar 24 the jammed safety interlocks reveal themselves on the payload collar; blow all six before the charge peaks at bar 30 and the gun fires you into silent open space — fail, and the barrel goes with you.

## Visual language
Electric heat, not fire: coil glow climbs arc blue through violet toward blinding white along the barrel and with the charge. Near-black gunmetal ring lattice with bus-bar struts, stars and a dim planet visible through the gaps, stray discharge arcs crackling between coils. Hostile drones are hazard amber; the jammed clamps add hazard chevrons and a seething warning-red jam light; player optics are the coldest cyan-white. Letters are charge-gauge segment readouts.

## Musical language
128 BPM techno — 32 bars is exactly 60 seconds. The gun is the instrument: a detuned bass hum whose root climbs a full octave (E–F#–G–A–B–C–D–E') across the run under a locked four-on-the-floor pulse, with a struck-coil chime marking every ring crossing. The charge section stacks a six-bar riser and a klaxon climbing a tone per bar; at bar 30 one enormous transient, then airless shimmer — the first silence in the level. Player actions snap to the transport and read the live climbing harmony; kills walk hidden melodic lanes whose register rises with the hum.

## Mechanical signature
A 60-second run with a 3-point hull and beat-locked ring geometry (ring k sits where the camera is at beat k). Weaver darts braid across the bore, stators crawl the coil wall circumferentially, twin-stage sentinel pods lob interceptable arc bolts, and six two-stage interlock clamps ride the collar from bar 22.5 — armor plate off, then the core. Clearing all six is the launch condition; the firing slam at bar 30 triples rail speed into a quiet two-bar coast. START/REPLAY are LAUNCH/RELOAD.

## What to read
- `src/levels/mass-driver-esvz/timing.ts`
- `src/levels/mass-driver-esvz/gameplay.ts`
- `src/levels/mass-driver-esvz/audio.ts`
- `src/levels/mass-driver-esvz/visuals/index.ts`
- `src/levels/mass-driver-esvz/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. typecheck, build, check:scope (vs branch baseline), simulate, occlusion, and perf gates verified in this environment; WSL2 cannot render WebGPU headless, so the visual mix and audio balance need a human playtest. First things to check: ring-glow readability with bloom at zero, interlock collar legibility during the charge, and whether the bar-30 launch slam-to-silence lands.
