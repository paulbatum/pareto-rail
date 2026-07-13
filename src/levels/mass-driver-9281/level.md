# Mass Driver

Ride a payload through the kilometer-long throat of an orbital railgun. Every accelerator coil crosses the cockpit on the beat, even as the widening gaps and climbing electrical hum reveal impossible acceleration; the final safety chamber turns that hypnotic certainty into a four-interlock deadline and a binary launch-or-burst finish.

## Visual language
Near-black vacuum steel, deep dormant cobalt, arc blue, ultraviolet, and small white-hot electrical cores. The tunnel is 129 procedural accelerator rings laid directly onto the authored speed curve, tied together by longitudinal barrel conductors and a radial muzzle crown. A camera-relative hexagonal payload nose and two slim shoulder clamps anchor the lower frame; twelve charge cells walk from cyan through violet to white as the firing deadline approaches. Defense drones borrow the same coil, clamp, blade, and capacitor geometry; sentinels launch caged arc-bolts that visibly brake against the cockpit. Success tears the tunnel away into procedural star streaks, while failure twists and overcharges the barrel violet-white. Letters, reticle, projectiles, lock pulses, armor breaks, hull impacts, and rejected releases remain geometric and readable with bloom disabled.

## Musical language
120 BPM, 32 bars, and one pitched coil impulse on every quarter-note crossing. A locked electronic pulse and sub-bass motor sit beneath a railgun hum that rises monotonically by more than twenty-two semitones from breech to muzzle; phase lock adds a second bass strike, overdrive fills the sixteenth grid with high-voltage ticks, and the critical phrase spits filtered arc noise around the player’s harmony-quantized lock, fire, hit, and kill notes. Sentinel volleys and interlock activations land on exact beats. Interlock hits climb as the safety array opens. The successful firing charge ducks the mix into a long clean discharge and near-silence; an uncleared array answers with a short unstable burst.

## Mechanical signature
A 64-second, three-hull run with four primary motion grammars: coil-orbiting weavers, full-width crossing switchblades, armored radial sentinels, and four staged safety interlocks. Sentinels fire eight interceptable homing arc-bolts through the shared impact-braking model. The interlocks enter together at the charge warning but phase-enable across the final phrase; 60.0 seconds is a hard safety deadline, followed by either four seconds of launch velocity or barrel rupture. Full six-target clears earn a 9281-point payload bonus, and the run summary records safeties, bolt interceptions, hull hits, and the final outcome.

## What to read
- `src/levels/mass-driver-9281/index.ts`
- `src/levels/mass-driver-9281/gameplay.ts`
- `src/levels/mass-driver-9281/audio.ts`
- `src/levels/mass-driver-9281/audio-voices.ts`
- `src/levels/mass-driver-9281/visuals/index.ts`
- `src/levels/mass-driver-9281/visuals/environment.ts`
- `src/levels/mass-driver-9281/visuals/enemies.ts`

## Status & notes
Showcase build. Authored inspection moments: `phaseLock` (bar 6), `overdrive` (bar 14), `critical` (bar 24), and `muzzle` (bar 30). Automated checks cover duration, simulation outcomes, audio structure, target distribution, occlusion, performance, type safety, and production build; a human WebGPU playtest should first verify that beat-ring crossings feel exact, the late white-hot coils do not wash out the interlocks, and the successful launch’s sudden quiet lands with enough contrast.
