# Pyre

A frozen plain under an overhead megastructure, looking down into a sunken city that burns. The run opens held on that view, then arcs slowly around the front of the pit to show the massing from the flanks and from above.

## Visual language
Placeholder flats only. Every mass is a box in one unlit colour, flat-shaded per facet against a fixed key so a hundred-metre block reads as a solid rather than a card. Bloom and vignette are off so the massing is judged on its own.

## Musical language
TODO.

## Mechanical signature
TODO. The spawn timeline is a handful of placeholder targets that keep the runner exercised; they are deliberately absent from the window around `PYRE_HERO_TIME`.

## What to read
- `src/levels/pyre/visuals/world.ts` — every size and place in the world, in metres.
- `src/levels/pyre/visuals/terrain.ts` — construction only; lays the ground slabs and the pit.
- `src/levels/pyre/visuals/kit.ts` — the primitives: the disposal sink, facet shading with baked haze, and boxes.
- `src/levels/pyre/gameplay.ts` — the fly-around keyframes: each names a time, a camera position and a point to look at.
- `src/levels/pyre/camera-path.ts` — construction only; turns those keys into a rail, a time-to-progress curve, and the per-frame aim.

## Status & notes
Blockout stage, reset to its floor: a ground plane and one rectangular pit. Structures, lighting, materials, gameplay and audio are all still to come.

Two conventions the next layer depends on:

- **Ground is y = 0.** The pit runs negative; everything built on the plain runs positive. Nothing has to be rebased.
- **The hero pose is matched to the reference frame, not to the geometry.** `PYRE_HERO_EYE` and `PYRE_PIT.nearZ` together set where the horizon and the near rim land in frame; moving either moves the composition. The derivation is in the comment on `PYRE_HERO_EYE`.

The fly-around runs the full circuit around the pit, so anything added has to hold up from behind and from above — not only from the hero pose.
