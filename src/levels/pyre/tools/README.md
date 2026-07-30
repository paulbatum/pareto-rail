# Pyre level tools

Audits over pyre's authored mass tables. Run with `node` from anywhere:

```sh
node src/levels/pyre/tools/zfight.mjs
node src/levels/pyre/tools/verify2.mjs
```

- `read-masses.mjs` — parses the `Slab[]` tables out of `../visuals/composition.ts`. Both audits read the source directly, so neither can report a clean tree that is not the tree.
- `zfight.mjs` — flags overlapping frame rectangles whose depths are within 0.8% of each other, and exits non-zero. A mass's front face lands exactly at its authored depth, so an overlapping pair at the same depth draws twice and fights. See the depth rules on the `depth` field in `../visuals/composition.ts`.
- `verify2.mjs` — solves every mass the way the level does, projects its corners, and flags any whose outline misses its authored frame rectangle by more than 12 px.

Both see only the tables: they know nothing about the instanced fields, the terrain plates, or the edge shells. Confirm the frame itself with a `refcompare flicker` sweep over two captures a small step apart (`docs/visual-tools.md`) — that remains the authoritative z-fight check.
