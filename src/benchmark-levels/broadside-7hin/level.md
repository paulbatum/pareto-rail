# Broadside

Sixty seconds inside a running fleet engagement: launch off a friendly flight deck, thread a wreck-gap corkscrew, swing out for an open-water broadside against a flanking cruiser, dive through the eye of battle, then ride the enemy flagship's keel — knock out its shield generators, and fly its exposed power conduit trench to burn the ship from within.

## Visual language
Deep-space indigo with a violet-and-ember nebula backdrop; every capital ship is a procedurally lofted octagonal hull with glowing seam strips, running lamps, and faction-coded burners (ice-cyan friendly, crimson hostile). Player fire reads cold blue-white; enemy fire and shield tech read magenta and crimson. The flagship's trench is cut into its keel with gantry posts and arch lamps, and the finale flashes white-gold as the ship breaks up.

## Musical language
128 BPM orchestral-synth anthem in D minor (Dm–B♭–F–C) over 32 bars: timpani and snare drive the launch, a brass-style horn line carries the broadside, and cannon salvos fire on the downbeats. The eye of battle drops to near-silence with a heartbeat pulse before the finale fanfare, which ducks the mix and rings a cymbal peal when the flagship dies. Kill chimes retune to the live chord, and lock/fire/kill SFX snap to the 32nd-note grid.

## Mechanical signature
Four enemy grammars — straight-line darts, sine-weaving weavers, strafing gunships, and rooted twin-barrel batteries — plus interceptable crimson bolts. The flagship fight is gated in two phases: three shield generators (two-stage) and point-defense turrets first; once all generators fall, shields drop ("SHIELDS DOWN" callout), and three one-hit conduits in the keel trench become lockable. Releasing a conduit early is rejected with a shield-flash warning. A clean six-lock volley pays a 500-point bonus; ranks run ENSIGN to GRAND ADMIRAL (requires ~95% clear and no damage).

## What to read
- `src/benchmark-levels/broadside-7hin/index.ts`
- `src/benchmark-levels/broadside-7hin/gameplay.ts`
- `src/benchmark-levels/broadside-7hin/flagship.ts`
- `src/benchmark-levels/broadside-7hin/audio.ts`
- `src/benchmark-levels/broadside-7hin/visuals/index.ts`
- `src/benchmark-levels/broadside-7hin/visuals/ships.ts`

## Status & notes
Showcase build. Sections: launch (bars 0–4), wreck-gap corkscrew (4–12), broadside flank run (12–18), eye of battle (18–24), flagship assault (24–28), conduit finale (28–32). Simulation: perfect policy clears 109/109 at GRAND ADMIRAL; occlusion, perf, and floor gates pass. WebGPU visuals and final mix still require a human playtest.
