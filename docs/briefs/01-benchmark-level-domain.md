# 01 — Separate the benchmark level domain

## Objective

Represent built-in levels and generated benchmark levels as different application domains. Built-in levels remain curated game content. Benchmark levels are discoverable generated outputs and are the only levels eligible for ranking.

## Required design

Use separate source roots:

```text
src/levels/                 # Built-in levels
src/benchmark-levels/       # Promoted benchmark outputs
```

Keep the built-in registry human-maintained. Do not add one shared mutable registry entry per benchmark output. Instead, implement one permanent benchmark registry module that discovers level directories through Vite's `import.meta.glob` support.

Each benchmark level must have a lightweight descriptor, preferably `level.json`, containing at least its public level id and title. Load descriptors eagerly for menus and catalogs while keeping full level modules lazy.

## Work

1. Define typed built-in and benchmark catalog entry types. Their distinction must not be an optional convention.
2. Add the permanent benchmark discovery module under `src/benchmark-levels/`.
3. Associate each discovered descriptor with the corresponding lazy `index.ts` loader.
4. Validate at startup or build time that:
   - descriptor ids match directory names;
   - every descriptor has exactly one module;
   - every module has a descriptor;
   - loaded `LevelDefinition` ids and titles agree with descriptors; and
   - no id or alias collides with a built-in level.
5. Compose both domains in the application shell without erasing their type or origin.
6. Present built-in and benchmark levels as separate groups in ordinary browsing UI.
7. Ensure ranking code can request benchmark entries without filtering a mixed list.
8. Update gallery generation so benchmark cards do not depend on hand-edited registry entries. Preserve a clear built-in/benchmark distinction in generated documentation.
9. Add focused tests for discovery, validation, collisions, and lazy loading.

## Constraints

- Preserve the existing built-in registry API where practical.
- Do not eagerly bundle every benchmark level merely to obtain metadata.
- Do not infer ranking eligibility from names, themes, or an optional `kind` field.
- Keep procedural-asset constraints intact.
- Do not migrate existing generated levels in this brief; establish and test the destination first.

## Verification

- `npm run typecheck`
- `npm run build`
- Existing built-in level tests and floor checks still pass.
- A small fixture benchmark directory is discovered without editing a central registry.
- Removing its descriptor or module produces a clear validation failure.
- Duplicate built-in/benchmark ids produce a clear validation failure.

## Done when

A benchmark level can be added or removed solely by adding or removing its self-contained directory, and the application still knows that it is benchmark output rather than built-in content.
