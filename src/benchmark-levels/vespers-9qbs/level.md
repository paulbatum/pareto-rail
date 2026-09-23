# Vespers

A night flight down the nave of a vast cathedral while something eats the light out of it. The creatures peel off the stained glass as flat black shapes with a stolen pane's colour burning in their chests; every kill sends that colour home along an arc, and the window it came from blazes and stays lit. The score is the building's own organ, a fugue that enters one voice at a time over a held pedal note. The run ends at the dead west rose: break the Thing nested in it and the rose ignites all at once, the minor key turns major, and the Tuba that was held back all night takes the tune.

## Visual language
Near-black stone lit only by candle bounce from a floor of flames far below, by iron coronae of candles hanging in the vault, and by the windows themselves: every lit window spills its jewel colour onto the piers and vault through a custom stone shader, and relit windows also throw a soft shaft. The only saturated colours are cobalt, blood red, bottle green and gold glass. The creatures are black silhouettes: lancet-winged moths, rosette tracery wheels, robed shades, swinging censers and talons. Each carries its stolen colour as a chest glow and a halo, so it reads against its own light. The player's marks (reticle, lock clamps, shots) are candle-flame gold. START and REPLAY are stained-glass panes set in lead.

## Musical language
96 BPM, 24 bars, D minor, no percussion. A held D pedal opens alone. Then alto, soprano (the tonal answer) and tenor enter with the fugue subject one at a time, and the pedal takes it for the swell, where choir and bells join. A tremulant flute carries the subject alone through the dark span. The subject then becomes a passacaglia ground under full plenum and reeds for the fight. Player actions are organ voices on the transport grid:
- Locks are a stopped flute climbing the sounding chord.
- Each shot is a pipe's chiff, and a volley's first shot sounds a pedal reed; a six-lock volley adds a plenum stab.
- Kills play a Cornet solo from per-section kill lanes, echoed an octave up by a glass chime a beat later, when the light lands in its window.
- The heart is a bell climbing the scale with each hit.

Killing it gives a beat of silence, then every rank opens in D major, the Tuba enters with the subject and the bells ring down in changes. If it survives, the piece ends back on the lone pedal D.

## Mechanical signature
A 60-second run with a 3-point hull:
- **Waves:** four ordinary kinds with distinct motion. Moths flutter in formations that trace the subject's contour, rosettes roll across the frame on the answer's notes, shades rise out of the aisles, and 2-HP censers swing on one-bar pendulums locked to the transport.
- **The boss:** eight 2-HP claws hold the last eight windows and throw shards of stolen glass that must be shot down. When all eight are gone, the heart tears loose, with three six-hit shells.
- **The deadline:** the heart gives up at bar 22 and sinks back into the glass.
- **Scoring:** the end card reports windows relit, whether the rose burns, and the hull.

## What to read
- `src/benchmark-levels/vespers-9qbs/index.ts`
- `src/benchmark-levels/vespers-9qbs/timing.ts`
- `src/benchmark-levels/vespers-9qbs/cathedral.ts`
- `src/benchmark-levels/vespers-9qbs/gameplay.ts`
- `src/benchmark-levels/vespers-9qbs/boss.ts`
- `src/benchmark-levels/vespers-9qbs/music.ts`
- `src/benchmark-levels/vespers-9qbs/audio.ts`
- `src/benchmark-levels/vespers-9qbs/visuals/index.ts`

## What to study here
One idea runs through every layer: light is taken and given back. Each spawn claims a specific window at timeline-build time (`cathedral.ts`), so the visuals always know which window a creature drained and which one to relight. The stone never uses scene lights. Its node material sums a small array of window "light slots" that the visuals spine refills every frame from whichever windows are lit near the camera (`visuals/architecture.ts`, `visuals/index.ts`).

The score is written as data in `music.ts`, in minor. The finale does not switch tracks: a pitch-class rewrite (F→F♯, B♭→B, C→C♯) turns the same counterpoint into D major from the beat after the heart dies. That is why the ending can start on any beat and still be the same piece.

Weaker ground: the boss-section figuration is generated from the harmony table rather than hand-written, so bars 15–22 are more mechanical than the exposition. The architecture is a repeated bay module, and it shows on long straight stretches.

## Status & notes
Debug previews for snapshots and playtesters (`?rose=burn` and so on, or `--debug-value burn` with `snapshot:gameplay`):
- `burn`: ignites the rose at bar 19.
- `lit`: relights each window shortly after its creature appears.
- `heart`: tears the heart loose at bar 16.
- `autoplay`: a perfect-aim pilot that plays the run through the real pointer path.

Inspection markers: `swell` (bar 8), `quiet` (bar 12), `rose` (bar 15), `deadline` (bar 22).
