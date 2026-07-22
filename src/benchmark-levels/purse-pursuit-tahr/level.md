# Purse Pursuit

Sixty seconds hanging out of a getaway car's passenger window, fighting forward through a motorcycle gang on a city freeway at night. Amber streetlights strobe over chrome, red tail lamps stream between the lanes, and one vivid blue purse stays visible on the boss until it flies out of the final fireball and into your hand.

## Visual language
Night-plum sky, near-black asphalt, chrome bikes, hot-pink gang optics, red tail lights, and amber street furniture create a glossy pop-video freeway. A camera-riding red car door, passenger window, buddy's arm, and side mirror hold the lower-right frame while the road tears past close underneath. Vivid blue is reserved entirely for the purse and its recovery trail. The three ordinary rider classes have separate silhouettes—lean scramblers, low swept sport bikes, and broad pannier-heavy bruisers—before the boss arrives on an oversized black heavy bike.

## Musical language
128 BPM electropop: four-on-the-floor kick, syncopated saw bass, claps, bright delay plucks, and a large six-note hook that arrives with the denser traffic and intensifies for the boss. Every lock and volley snaps to the transport and reads the live D-minor harmony; chained kills play written melodic lanes. Boss stages answer with rising lead calls, the explosion ducks the track, and the purse catch resolves the hook into D major.

## Mechanical signature
A 60-second, six-hull freeway chase with full-width weaving scouts, swoopers that cut in from beyond the window, braking armored bruisers, and a three-stage 18-lock gang boss. The boss throws alternating bombs and two-hit spike clusters onto authored lanes; both can be shot before landing, while misses damage the car. The destruction sequence throws the blue purse through a camera-relative slow arc into the passenger window as the car pulls away.

## What to read
- `src/benchmark-levels/purse-pursuit-tahr/index.ts`
- `src/benchmark-levels/purse-pursuit-tahr/timing.ts`
- `src/benchmark-levels/purse-pursuit-tahr/gameplay.ts`
- `src/benchmark-levels/purse-pursuit-tahr/audio.ts`
- `src/benchmark-levels/purse-pursuit-tahr/visuals/index.ts`
- `src/benchmark-levels/purse-pursuit-tahr/visuals/environment.ts`
- `src/benchmark-levels/purse-pursuit-tahr/visuals/models.ts`

## Status & notes
Built to the Purse Pursuit benchmark assignment as a showcase. Authored inspection markers: `slipstream` (bar 4), `crossTraffic` (bar 9), `overpass` (bar 15), `bossEntrance` (bar 23), `purseFlight` (bar 29), and `victory` (bar 30). A human WebGPU pass should first check the lean-out camera/car composition, bomb landing readability, the blue purse arc, and whether the boss hook lands above the dense freeway mix.
