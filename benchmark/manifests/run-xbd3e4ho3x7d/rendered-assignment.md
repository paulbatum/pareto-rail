# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `mass-driver-o9ok`
- Display title: `Mass Driver`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/mass-driver-o9ok/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id mass-driver-o9ok --title 'Mass Driver'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Mass Driver

Build a level where you're riding a payload down a huge orbital railgun. The whole thing is basically a tunnel of glowing accelerator rings and you pass through one ring exactly on every beat, so the speed and the music are the same thing. As the run goes on the rings get spaced further apart (you're accelerating) but you still hit them on the beat, and they glow hotter as you go faster. Hot here means electric, not fire: arc blue through violet toward blinding white. The gun is also the instrument - a bass hum that climbs in pitch across the whole run, under a locked, hypnotic pulse.

Enemies are defense drones threading between the coils.

Boss: the gun's safety mechanisms are jammed and the final firing charge is already building. You can hear it - rising hum, rings burning hotter, the whole tunnel ramping up. Blow up the jammed safety interlocks before the charge peaks. Clear them all in time and the gun fires, launching you out of the muzzle into open space at insane speed, everything goes quiet, level ends. Too slow and the charge has nowhere to go - the barrel blows with you in it.

