# Pyre

A frozen plain under an overhead megastructure, looking down into a sunken city that burns. The run opens held on that view — a near-black gateway in the hottest part of the block field, framed by a leaning dark monolith on the left and a pale stone group on the right — then arcs slowly around the front of the basin to show the massing from the flanks and from above.

## Visual language
Placeholder flats only. Every mass is a box, a beam or a square cone in one unlit colour, chosen for the value and rough hue that region reads at. Bloom and vignette are off so the massing is judged on its own.

## Musical language
TODO.

## Mechanical signature
TODO. The spawn timeline is a handful of placeholder targets that keep the runner exercised; they are deliberately absent from the window around `PYRE_HERO_TIME`.

## What to read
- `src/levels/pyre/frame.ts` — the reference-frame camera, and the projection that turns a frame rectangle plus a depth into world geometry.
- `src/levels/pyre/visuals/composition.ts` — the authored massing: every element as a frame rectangle, a depth and a flat colour.
- `src/levels/pyre/visuals/environment.ts` — construction only; solves each mass onto its authored outline.
- `src/levels/pyre/gameplay.ts` — the fly-around keyframes: each names a time, a camera position and a point to look at.
- `src/levels/pyre/camera-path.ts` — construction only; turns those keys into a rail, a time-to-progress curve, and the per-frame aim.

## Status & notes
Blockout stage. Geometry, scale and framing only; lighting, materials, gameplay and audio are all still to come.

Authoring runs through the frame projection rather than hand-placed world coordinates. Two consequences are worth knowing before editing:

- A mass thicker than its outline is wide cannot be fitted to that outline, because its side face alone overruns it. Keep thickness well under the world width of the element, or push the element further away.
- Layer order is by depth, not by build order. An element authored at a shallower depth covers one authored deeper, however late it is added.
- A mass's front face sits exactly at its authored depth, so two overlapping masses at the same depth fight. `node src/levels/pyre/tools/zfight.mjs` audits every overlapping pair and exits non-zero on a collision — run it after adding or moving a mass.

The fly-around is bounded on purpose. Geometry authored to a single frame reads as a shell from behind or from directly overhead, so the sweep stays in front of the basin and under about fifty units of altitude, where the megastructure and sky still sit behind the subject. Widening that range needs geometry the hero frame never sees.
