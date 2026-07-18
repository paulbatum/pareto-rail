# Broadside

A sixty-second flight from the catapult of an ice-white flagship to the molten heart of the enemy line. Capital ships drift like moving terrain while the player banks through their crossfire, skims a friendly six-gun broadside, rakes an enemy belly, and makes two passes over an obsidian flagship before the whole battle pulls into view.

## Visual language
Ice-white allied silhouettes with cyan engine light and cyan lances face obsidian enemy hulls cut by molten-orange seams and crimson flak. A huge magenta-and-gold procedural nebula backlights the fleet. Small craft use sharp wing, three-arm spiral, heavy bomber, and crown-escort silhouettes; the flagship carries four shield irises over a ribbed trench and three caged power cores. DEPLOY and RETURN are naval signal plaques built from readable 5×7 light cells.

## Musical language
144 BPM space opera: layered synthetic strings, filtered brass choirs, timpani, cymbal noise, and a written harmonic progression swell with each push. The friendly broadside lands one ship-scale hit per bar, then the orchestra nearly disappears in the eye of battle before returning faster and higher for the flagship. Locks and volleys quantize to the transport and live harmony; chained kills perform authored melodic lanes, shield breaks call brass, and the final bar resolves into a victory fanfare.

## Mechanical signature
An exactly 60-second four-hull run with lateral interceptors, corkscrewing spiral craft, armored surge bombers, belly turrets, escort fighters, and interceptable crimson flak. The boss is a real two-pass encounter: destroy four two-lock shield generators under point-defense fire, survive the escort turn, then dive the trench and break three two-stage power cores. A six-target volley earns a formation bonus.

## What to read
- `src/benchmark-levels/broadside-b6ej/timing.ts`
- `src/benchmark-levels/broadside-b6ej/index.ts`
- `src/benchmark-levels/broadside-b6ej/gameplay.ts`
- `src/benchmark-levels/broadside-b6ej/audio.ts`
- `src/benchmark-levels/broadside-b6ej/visuals/index.ts`
- `src/benchmark-levels/broadside-b6ej/visuals/environment.ts`
- `src/benchmark-levels/broadside-b6ej/visuals/models.ts`

## Status & notes
Showcase build. Authored inspection markers: `friendlyBroadside` (bar 10), `enemyBelly` (bar 16), `eyeOfBattle` (bar 22), `flagshipPass` (bar 26), `trenchDive` (bar 33), and `victoryPullback` (bar 35). Human WebGPU playtest should first confirm capital-ship scale, bloom-zero silhouette separation, the readability of shield-to-trench boss gating, and the orchestral/flak balance.
