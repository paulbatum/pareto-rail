# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `vespers-dade`
- Display title: `Vespers`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/vespers-dade/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id vespers-dade --title 'Vespers'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Vespers

You fly the nave of a massive cathedral, at night, while something is eating the light out of it.

Every window in this place is lit from within, and the things in here take that light. They come off the glass as flat black shapes with a stolen pane's colour burning in their chest — that colour is the only reason you can see them at all. Kill one and the light goes back where it belongs: the window it stripped comes up again, and every window you win back stays lit for the rest of the run, so the deeper you fly, the more of the cathedral is burning with colourful stained glass you put there.

Build the world dark, enormous, and full: black stone piers, tiers of arcade and gallery stacked overhead, a floor of candles far below, ribbed vaults closing over you. The glass is the only saturated thing in the frame — deep cobalt, blood red, bottle green, gold — and it throws its colour onto the stone around it. Jewel light in a black room; keep the contrast enormous.

The music is the building's own organ. Open on a single held pedal note in a dark minor and let the voices enter one at a time above it — a real tune, in real counterpoint, the way an organ is actually played — with choir and bell weight for the swells, and one voice held back all night so the ending has somewhere to arrive. There is no percussion under any of this; the pulse is the counterpoint moving. The player's locks, shots, and kills are organ voices too — notes inside the polyphony.

Past the middle, the nave goes quiet: a long dark empty span, one voice, almost nothing on screen, so the finale has something to break.

Boss: the thing doing this is nested in the dead rose window at the west end, holding every colour it has taken. Break it open. When it dies the rose window ignites all at once — the biggest single event in the level — every rank of the organ opens, the minor turns major, and the run ends in a lit cathedral.

