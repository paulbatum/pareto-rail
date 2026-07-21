# Mass Driver

Sixty seconds strapped to a payload falling down the bore of an orbital railgun that is already firing. The barrel is a tunnel of accelerator rings, and you pass through exactly one ring on every beat — for the whole run, without exception. As the payload accelerates the rings spread further and further apart and burn hotter, arc blue through violet to blinding white, but they still land on the beat, so speed and tempo are the same fact. Under it all, one continuous capacitor hum climbs two octaves. At bar 32 the gun fires and everything stops.

## Visual language
A dark octagonal bore of plate and busbar, lit only by its own accelerator rings. Ring heat is the level's clock: arc blue at the breech, violet mid-barrel, blinding white at the muzzle, with the ramp baked into the wall's vertex colours so the far end of the tunnel is visibly hotter than the near end even with bloom at zero. Acid green is reserved for defence drones and nothing else; red belongs only to the jammed interlocks and the firing charge; the player's reticle, locks, and slugs are cold ice-white. Kills earth into the nearest ring as a jagged arc. Past the muzzle: no fog, no barrel, stars.

## Musical language
144 BPM in C minor, 36 bars = exactly 60 seconds. A kick and a metallic coil strike land on every single beat from bar 0 to bar 32 — never syncopated, never dropped, because that pulse *is* the ring you just crossed; the coil brightens on the same ramp the rings do. Beneath it a continuous charge hum glides from MIDI 26 to 50 and opens its filter as it climbs. A resonant 16th sequence supplies the hypnosis, a phrygian Db arrives with the jam, and an accelerating charge counter beeps once a bar and then eight times a bar as the overload peaks. Locks and shots quantize to 16ths on the transport and are pitched from the live chord; kills walk a hidden per-section melodic lane, so a chained volley plays a real melody over the pulse. At bar 32 the pulse simply stops and the charge is released into an open pad.

## Mechanical signature
A 3-point hull on a rail whose progress easing is the normalized integral of an always-climbing speed curve — that integral is what makes the ring-per-beat contract exact rather than approximate. Four defence silhouettes with four motion grammars: hex sentries walking the bore wall, needle skimmers corkscrewing nose-on, twin-rotor weavers cutting the full width of the tunnel, and armoured arcnodes that swing off the wall into your path. The capacitor bank refuses to discharge on a single lock unless that lock is an incoming round, so sweeping is mandatory. The finale is four jammed safety interlocks at the compass points of the barrel, closing inward as an eight-bar firing charge builds: clear them and the gun fires and launches you into silent open space; miss the window and the charge has nowhere to go.

## What to read
- `src/benchmark-levels/mass-driver-rqki/timing.ts`
- `src/benchmark-levels/mass-driver-rqki/barrel.ts`
- `src/benchmark-levels/mass-driver-rqki/gameplay.ts`
- `src/benchmark-levels/mass-driver-rqki/interlocks.ts`
- `src/benchmark-levels/mass-driver-rqki/audio.ts`
- `src/benchmark-levels/mass-driver-rqki/visuals/index.ts`
- `src/benchmark-levels/mass-driver-rqki/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme. Verified in this environment by typecheck, build, simulation (perfect run reaches S at 60.0 s with 87/95 kills; the no-fire run dies to the barrel breach at 53.4 s; full gameplay event coverage), target occlusion (clean across 95 targets), and the headless performance gates. WebGPU cannot render headlessly under WSL2, so the visuals and the mix have not been seen or heard by a human. A playtester should check first that ring crossings read as landing on the beat, that the bore stays legible with the bloom slider at zero, and that the acid-green drones never get lost against violet rings in the second half.
</content>
