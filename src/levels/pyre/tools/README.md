# Pyre level tools

Run from the repo root with `node`.

- `zfight.mjs` — static coplanar-face audit over the slab table: flags overlapping frame rectangles whose depths are within 1% of each other. See the depth rules on the `depth` field in `../visuals/composition.ts`.
- `verify2.mjs` — projects every slab's corners and flags outlines that miss their authored frame rectangle by more than 12 px.
- `slabs.json` — the slab table both tools read. It is a point-in-time export of the composition tables, not derived at run time: after changing masses in `composition.ts`, update the matching entries here by hand or the audits read stale data. The authoritative z-fight check is a `refcompare flicker` sweep (see `docs/visual-tools.md`), which needs no table.
