# Broadside

Launch from a friendly flagship into a sixty-second fleet engagement. Fly between cruisers, pass beneath a friendly broadside, attack enemy belly turrets, and cross a brief quiet region before striking the enemy flagship.

## Visual language
Ice-white friendly ships carry cyan engines and cyan artillery. Obsidian enemy hulls carry orange seams and crimson fire. A procedural magenta-and-gold nebula backlights twenty capital ships at different headings and elevations. Armored hull ribs, bridges, gun batteries, engine banks, and running lights distinguish the ships from the small fighters. The final attack follows an orange-lit trench between armored walls. Destroying all three power systems starts a chain of explosions; the camera then pulls back to show both fleets.

The player uses cyan naval optics, six reticle charge marks, and procedural 5×7 START/REPLAY plaques. Lock brackets, expanding impact rings, ejecta, artillery flashes, and camera recoil provide feedback without requiring bloom.

## Musical language
128 BPM, 32 bars, exactly 60 seconds. Procedural detuned strings, short bowed-string figures, filtered brass, tuned timpani, and noise cymbals form a space-opera arrangement. A four-bar brass theme returns during the broadside and trench attack. Bars 16–19 reduce the arrangement to soft strings and isolated notes; the final two bars resolve into D major.

Locks and releases quantize to the transport and use the current harmony. Kills play notes from written section-specific melodic sequences. Full six-target volleys duck the backing mix briefly and add a low cannon impact. Shield collapse and flagship destruction trigger separate musical accents.

## Mechanical signature
Five hull points; 64 authored targets plus interceptable crimson shells. Swept-wing interceptors bank laterally, three-fin helix fighters corkscrew, and twin-pod bombers drift slowly while charging shells. Two-hit belly turrets precede three four-hit shield generators. All generators must be destroyed before the three four-hit power systems become lockable. Unfinished power systems destroy the player at the bar-30 deadline. A full six-kill volley earns a 600-point bonus.

The rail covers roughly four kilometers with alternating banks, a fast flank pass, a belly pass, and a trench dive. Rail-paced fighter spawns preserve targeting time at this speed. Boss targets use extended targeting windows. The successful run reserves the final bars for the fleet-wide pullback.

## What to read
- `src/benchmark-levels/broadside-86kh/index.ts`
- `src/benchmark-levels/broadside-86kh/gameplay.ts`
- `src/benchmark-levels/broadside-86kh/audio.ts`
- `src/benchmark-levels/broadside-86kh/audio-voices.ts`
- `src/benchmark-levels/broadside-86kh/visuals/index.ts`
- `src/benchmark-levels/broadside-86kh/visuals/models.ts`

## Status & notes
Inspection markers: `launch`, `crossfire`, `broadside`, `belly`, `eye`, `shields`, `escorts`, `trench`, and `victory`. The perfect simulation clears the flagship and finishes the run; doing nothing loses hull to enemy shells. Human WebGPU review should check target readability at zero bloom, the belly turrets’ relation to the capital hull, orchestral balance, and the final fleet pullback. Automated snapshots cannot establish real-time play feel or perceived audio quality.
