# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `purse-pursuit-tahr`
- Display title: `Purse Pursuit`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/purse-pursuit-tahr/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id purse-pursuit-tahr --title 'Purse Pursuit'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Purse Pursuit

Build a level where a motorcycle gang just snatched your purse and you want it back. Your buddy drives; you're hanging out the passenger window shooting, and the whole level is the chase - a city highway at night, lanes and guardrails, overpasses, taillights streaming past, working forward through the gang toward the boss who has your purse. Sell the lean-out-the-window feel: the car's flank and mirror in frame, the road surface tearing by close underneath, the camera swaying with lane changes. This one runs fun, not gritty - streetlight amber strobing overhead, the city skyline glowing past the barriers, chrome flash off the bikes - a pop music video, not a crime drama. The purse itself is a vivid blue, and that blue is the level's signature color: keep it rare in the world so it reads instantly whenever the purse is on screen. The music is fast, glossy electropop with a big hook, and it should feel like the chase soundtrack, hitting harder as you get deeper into the gang.

Enemies are the gang riders - weaving between cars, swinging in close, dropping back to harass you - with distinct rider flavors as the chase escalates.

Boss: the gang boss on a heavy bike, purse strap flapping from a shoulder. The boss doesn't just ride - they fight back with thrown weapons: bombs lobbed onto the road, spike clusters scattered across lanes, whatever forces your buddy to swerve and you to shoot things down before they land. Wear the bike down through the barrage, and when it finally blows, the purse sails out of the fireball in glorious slow arc, you catch it, the music peaks, and the car pulls away triumphant - level ends.

