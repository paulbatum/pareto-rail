# Engine brief: visual-kit

**Status: hold — do not execute until the scaffold/convention work (authoring-scaffold brief) has landed.**

## Goal

Create `src/engine/visual-kit.ts`: the visuals counterpart to `src/engine/audio-kit.ts`. Every level currently rewrites the same visual bookkeeping — the kit absorbs the mechanics while leaving every aesthetic decision with the level.

## Motivation

Audio-kit worked: Crystal and Deluge contain zero raw Web Audio node calls, and levels became cheaper to write and less buggy without sounding alike. Visuals have the same shape of duplication with no shared home. It is also a bug factory: dispose leaks and splice-while-iterating errors recur per level.

## Method — harvest, don't design

1. Inventory the duplicated bookkeeping in `src/levels/crystal/visuals/`, `src/levels/helios/visuals/`, and `src/levels/deluge/visuals.ts`. Candidates observed:
   - an enemy-record map keyed by `enemyId`, synced to bus events (`spawn`/`lock`/`unlock`/`hit`/`kill`/`miss`), including the pending-mesh handshake between `createEnemyMesh` and the `spawn` event;
   - a transient-effect pool: short-lived objects registered with an update function and a lifetime, ticked per frame, removed and disposed on expiry;
   - additive/HDR material setup ceremony (transparent + AdditiveBlending + depthWrite false + color);
   - attach/detach lifecycle for per-enemy adornments (lock rings and the like) where the level supplies the mesh factory and the kit owns add/remove/dispose.
2. Design the API from that inventory. **Only hoist a mechanic that appears in at least two levels.** Anything seen once stays in its level.
3. Pilot: retrofit **prism** (the smallest level) to use the kit. Do not retrofit crystal, helios, or deluge — that is separate work.

## Hard constraints

- The kit must have **no aesthetic fingerprint**: no default colors, geometries, sizes, curves, or timings. It manages lifecycles; levels supply every mesh, material, and number.
- No behavior change in prism beyond the refactor. Verify with `npm run snapshot:gameplay -- --level prism --thumbnails 8` before and after and compare.
- Levels remain free to ignore the kit entirely; it is a convenience, not a contract. Do not thread it through `lock-on-runner`.
- `npm run typecheck` and `npm run build` must pass.

## Documentation

Add the kit to the shared-code list in `docs/level-authoring.md` with a two-or-three-line description. Do not add usage tutorials; the source and prism are the reference.
