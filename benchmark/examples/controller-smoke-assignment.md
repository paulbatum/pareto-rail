# Benchmark controller smoke rehearsal

This is a permanently ineligible controller smoke test. Exercise the normal directory-only level-authoring workflow, but do not design or polish an original level.

Read `AGENTS.md` and `docs/level-authoring.md` for the repository contracts that apply to your work.

## Level identity and scaffold

The assigned level id is `{{LEVEL_ID}}`. Start by running exactly:

```sh
npm run scaffold -- --mode benchmark --id {{LEVEL_ID}} --title '{{LEVEL_TITLE}}'
```

This must create `src/benchmark-levels/{{LEVEL_ID}}/` with its descriptor. Do not edit `src/levels/index.ts`, add a registry entry, or change files outside the assigned directory.

## Bounded adaptation

Use the built-in Prism Bloom implementation under `src/levels/prism/` as the base for the scaffolded level. Adapt Prism's source files into the assigned directory while preserving its existing rail, spawn choreography, enemy behavior, scoring, 30-second timing, procedural audio, runtime behavior, and controls.

Make one visible authored change: replace Prism's cool indigo, lime, violet, ice, and rose palette with the warm palette specified below. Update the assigned level id and title consistently in source, `level.json`, and `level.md`. Do not add content images, extend the duration, add mechanics, redesign models, edit Prism itself, or broaden the task into a polish pass.

Do not run snapshots or a human playtest. Once the assigned directory contains the adapted level and its required metadata, finish promptly; the controller will seal it and run the complete mechanical gate suite.

## Assigned variation

{{THEME}}
