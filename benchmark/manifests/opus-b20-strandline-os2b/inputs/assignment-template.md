# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `{{LEVEL_ID}}`
- Display title: `{{LEVEL_TITLE}}`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/{{LEVEL_ID}}/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id {{LEVEL_ID}} --title '{{LEVEL_TITLE}}'`.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

{{THEME}}
