# Pyre

A frozen plain under an overhead megastructure, looking down into a sunken city that burns. The run opens held on that view, then arcs slowly around the front of the pit to show the massing from the flanks and from above.

## Visual language
Unlit and authored under AgX: baked per-facet shading against a fixed key, procedural TSL surfaces from the engine kit (stone towers, the molten pit floor), the engine height haze carrying the cold veil and the warm column, and emissive slit cards for windows, stars, and the blue sun. The vista is a one-direction stage built around the reference frame in `tmp/inspiration/pyr_1080.jpg`: dark pyramid inside a red halo, framing crag towers, overhead megastructure, terraced plate ground, burning trench.

## Musical language
TODO.

## Mechanical signature
TODO. The spawn timeline is a handful of placeholder targets that keep the runner exercised; they are deliberately absent from the window around `PYRE_HERO_TIME`.

## What to read
- `src/levels/pyre/visuals/world.ts` — every size and place in the world, in metres.
- `src/levels/pyre/visuals/terrain.ts` — construction only; lays the ground slabs and the pit.
- `src/levels/pyre/visuals/kit.ts` — the primitives: the disposal sink, facet shading, and boxes. Aerial perspective comes from the engine height haze (`PYRE_HAZE` in `world.ts`), not from the kit.
- `src/levels/pyre/gameplay.ts` — the fly-around keyframes: each names a time, a camera position and a point to look at.
- `src/levels/pyre/camera-path.ts` — construction only; turns those keys into a rail, a time-to-progress curve, and the per-frame aim.

## Status & notes
Vista stage: massing, haze, tone, and first materials are in — pyramid, crag towers (stone via `visuals/stone.ts`), megastructure, town band, trench lining with lit slits, molten floor, instanced tile field, star cards and the blue sun. Verified across the fly-around by contact sheet; perf, build, and bundle gates pass.

Still to come, in rough order of visual leverage: pyramid face detail (the reference carries a dense emissive speckle gathered into vertical chains — see the Blender scene's `streak_emit` notes at `/home/pbatum/vibes/blender/build_scene.py`), molten light spill on the trench rims, deck machinery detail near the hero eye, moss speckle on flat tops, then the real gameplay pass (spawn design beyond placeholders) and procedural music/SFX.

Two conventions the next layer depends on:

- **Ground is y = 0.** The pit runs negative; everything built on the plain runs positive. Nothing has to be rebased.
- **The hero pose is matched to the reference frame, not to the geometry.** `PYRE_HERO_EYE` and `PYRE_PIT.nearZ` together set where the horizon and the near rim land in frame; moving either moves the composition. The derivation is in the comment on `PYRE_HERO_EYE`.

The fly-around holds the front hemisphere — the composition is a one-direction stage (sky wall behind, megastructure converging frontward), so nothing needs to hold up from behind, but everything must survive the front arc's range of heights and flanks, including looking down into the pit.
