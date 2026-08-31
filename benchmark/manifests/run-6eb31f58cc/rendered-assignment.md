# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `thermal-ink-8448`
- Display title: `Thermal Ink`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/thermal-ink-8448/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id thermal-ink-8448 --title 'Thermal Ink'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Thermal Ink

Build a one-minute level that is one continuous boss fight with a giant mutant octopus in a drowned industrial harbor. The creature is already wrapped around wreckage, dragging cables through the water and sending smaller spawn from broken machinery. The rail circles, dives beneath its arms, and skims collapsing steel while the octopus turns to keep you in reach.

Normal vision is sodium-harbor murk: tobacco brown water, muddy ochre haze, rust-red metal, dirty cream paint, and hard industrial lamps burning through grit. Wrecked hulls, chains, pipes, and snapped cables form silhouettes. The octopus is an oily mass against them; its spawn are scavenger shapes made from flesh and harbor debris, attacking from the edges.

The octopus ejects dense clouds of oil-black ink across the route. Fly into one and normal sight is swallowed — lamps become dim stains and every enemy disappears. Activate infrared and the image snaps into a stark charcoal display: octopus and spawn blaze as white-hot silhouettes, vulnerable points burn as red signal cores, and drifting ink remains cold black. This is the fight's central rhythm: find the boss in normal murk, lose it in the ink, switch modes, strike through darkness, then return as the cloud thins. Infrared must feel like a decisive new sense, not a colored filter.

Score it with a slow industrial pulse, heavy bouncing synth bass, and sparse metallic percussion beneath one simple, haunting synth melody. In infrared the noise falls back and the melody turns brighter and sharply focused. Break the octopus down arm by arm until its central core is exposed; the last volley lands through a final ink blackout, and its thermal silhouette collapses as the harbor lamps return, level ends.

