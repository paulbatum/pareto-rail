**Broadside** is built at `src/benchmark-levels/broadside-b7tm/` — 5,356 lines across a spine/leaf split, exactly 60.0 s (36 bars @ 144 BPM).

## What's there

**The run** — launch off your own flagship's catapult trough (bars 0–4), thread the crossfire in hard banks (4–11), a full authored 360° corkscrew in the one deliberately empty window (11–12), a flat-out run down a friendly cruiser's flank while its broadside fires overhead (12–18), under an enemy warship raking its turret line (18–23), the enemy flagship's dorsal spine and six shield generators (23–28), the hangars emptying (28–30), the trench dive to three power cores (30–34), and a pull-out into the whole battle in frame (34–36).

**The rail is generated from the score.** Control point *i* is authored at run time *tᵢ* and placed at the distance the speed profile puts the camera at that moment, so set pieces are addressed in bars and the speed curve physically re-spaces the battle. Camera roll is a second authored curve on the same clock.

**Boss** — two phases with a real stake: six two-hit generators on a zigzag of pylons, then three two-stage cores. Cores stay lockable throughout, but until every generator is dead the shield eats those shots via `validateRelease`, emitting the engine's `shielded` event so the block gets its own violet language instead of a generic rejection.

**Score** — full synthesised orchestra in D minor: detuned saw strings, a brass stack with a filter blat and pitch scoop, tuned timpani, gran cassa, snare, tam-tam, choir, cymbal swells. Dynamics carry the arc, including the drop to near silence under the warship at bar 18. Locks/volleys/chips/kills are transport-quantised and pitched from the live chord; each kill plays its step's note from a per-act horn lane, and the orchestra's own horns start doubling the player's line from the third kill in a chain.

## Verified headless

`typecheck`, `build`, `check:benchmark-scope`, and the full `check:floor` (simulation across all four policies, target occlusion, headless performance, audio config, gallery) all pass. Simulation: perfect 106/108 rank A with zero hull hits; imperfect 79/108 rank B; the no-fire policy dies at 46 s, so intercepting flak is load-bearing. Kill spread covers the full frame, 44.5 m average destruction distance, 6.8 % off-screen. `trace:audio` shows 1,004 scheduled events across 8 sections; `trace:spawns` reports 108 authored entries.

Three things I found and fixed via the tools that a reader should know about: the engine's camera far plane is 500, so the sky and the whole fleet had to live inside that shell; `hostileShotAimPoint`'s 62 %-of-depth lead never converges at this camera speed, so flak uses a level-owned near-canopy aim with the shared steering and impact model around it; and incoming rounds whited out the frame at impact until they were given proximity scaling.

## Needs a human

WSL2 can't render WebGPU, so the snapshots above are SwiftShader/WebGL — colour, bloom and the mix are unconfirmed. First things to check by eye and ear: the bar-12 corkscrew reading as a roll rather than a glitch; the friendly broadside landing on the downbeat (the gunnery is entirely `beat`-driven and never appears in headless snapshots, since the snapshot harness doesn't create audio); the bar-18 drop to near silence feeling like the eye of the battle; and the violet shield block being unmistakably different from an ordinary rejection.