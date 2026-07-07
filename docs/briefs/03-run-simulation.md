# Tooling brief 03: headless run simulation and floor checks

Part 3 of the wishlist sequence. Benefits from brief 01 (bar-labelled output) but does not require it. Read `AGENTS.md`, `docs/level-authoring.md`, and `src/engine/lock-on-runner.ts` before designing. This brief is a tool; levels change only where they have incidental browser coupling that blocks headless execution, and those changes are behavior-preserving.

## Problem

An agent building a level cannot play it. `trace:spawns` shows when enemies spawn but not what a run *feels* like: whether there is dead air, whether a wall of enemies is uninterceptable, how the authored duration feels once motion and despawns play out, or whether some required event never fires at all. Today those questions burn a human playtest each.

## Deliverable 1: `npm run simulate -- --level <id>`

Drive a level's gameplay headlessly — real timeline, real `updateEnemy`, a synthetic camera advancing along the rail via the level's `easeRunProgress` — with a scripted player policy, and report on the run.

Design note, decide early: the honest way to simulate lock/fire/volley rules is to reuse the runner, not re-implement it. Assess whether `createLockOnRunner` can run under Node/jsdom with stub canvas/HUD/scene (it is scene-graph math plus DOM input; three.js itself runs fine headless). If it can, drive it with synthetic pointer state. If it can't without contortions, extract the pure targeting/volley core so both share it — engine changes for that extraction are in scope, but must be refactor-only with the game verified unchanged (typecheck, build, and a human spot-playtest of one level).

Policies: `none` (nothing fires — measures spawn pressure and natural despawns), `perfect` (locks everything lockable as soon as eligible, releases full volleys), and a `--seed`ed imperfect one (reaction delay, capped locks per second). Determinism required: same seed, same log.

Report, per run: machine-readable event log plus a summary —

- **Pressure curve**: lockable targets on screen over time (per bar, if brief 01 has landed), flagging spawn-free gaps longer than a threshold and impossible moments (more simultaneous must-kill targets than volleys available).
- **Outcome**: kills/missed/total, score, rank, run length, player-hull events under each policy.
- **Event coverage**: which of `spawn / lock / unlock / fire / hit / kill / miss / reject / stage / volley / playerhit` never fired across the policy suite — an unexercised reaction is untested authoring.

## Deliverable 2: `npm run check:floor -- --level <id>`

A thin checklist runner over the simulation plus static checks, mirroring `docs/level-brief.md`'s floor: ≥3 enemy kinds actually spawned, `beat` events emitted, a `reject` observed under a policy that forces one, `level.md` present and non-template, gallery regenerated. Exit nonzero with a readable list of failures. This does not judge quality — it catches floor misses before a human is asked to look.

## Level updates

Run the tool against **crystal, helios, prism**, and optionally **rezdle**. Where a level's gameplay module reaches for browser globals in a way that blocks headless execution, fix the coupling in the level (gate: `trace:spawns --compare`, typecheck, build, `check:scope`). Record each level's simulation summary in the report so we have baselines — anything surprising in those numbers (a dead-air gap, an event that never fires) gets *reported*, not fixed; gameplay changes are their own future task.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Audio rendering or analysis of any kind.
- Rebalancing any level based on what the simulation reveals.
- Visual output; this tool prints text and writes logs.
