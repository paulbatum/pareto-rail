**Mass Driver** is built at `src/benchmark-levels/mass-driver-detailed-om5e/` (13 files, directory-only contract — no registry edit).

## The core idea, made structural

128 BPM × 32 bars = exactly 60.000 s, so the run's 128 quarter notes are also its accelerator rings. Ring *k* is placed at the rail parameter the camera occupies at beat *k*, so **crossings land on the beat by construction**, not by a timer chasing the music. Because the speed curve is a normalized integral and only ever rises, ring spacing physically widens down the bore — the acceleration is real distance covered.

The one thing that could break that is transport phase: the audio transport free-runs during attract, so the run would start on an arbitrary phase. `onRunStart` re-zeroes the transport and score epoch at the run downbeat.

## What I verified

| Check | Result |
|---|---|
| `typecheck`, `build` | pass |
| `check:floor` | **all pass** — 5 kinds, no missing events, 0 occlusion warnings, 0 perf failures, 0 centerness/distance warnings |
| `check:benchmark-scope` (vs `5305d89`) | valid, 16 paths |
| `simulate` | perfect 93/100, **S**; imperfect 70/100, **A**; no-fire detonates at 52.52 s |
| `trace:audio` | **128 beat events** in 60 s; section boundaries land on their bars |
| Visual | model snapshots per enemy + letters, gameplay sheets across the whole arc |

## Bugs I found and fixed while building

I ran a review pass and fixed all ten findings. The four that mattered most:

- **The deadline was dodgeable.** A single `damagePlayer` at bar 28 could be swallowed by the engine's post-hit invulnerability window — take an arc bolt at 51.9 s and you'd survive with interlocks standing. Now the clamp is kept alive and hammered (parked behind the camera so it can't be locked), bounded to 1.2 s so it can't loop.
- **Ring tubes weren't a ratio.** `TorusGeometry(1, 0.3)` scaled 12× gave 3.6-unit-thick donuts: 88 occlusion warnings, some targets 100% hidden.
- **The muzzle field was past the camera far plane** (500 units), so the payoff section rendered black. It's now a camera-riding rig — which is also just the correct way to model an infinitely distant sky.
- **Threaders flew outside the barrel wall.** Fixing it properly meant rotating each drone's crossing axis per wave, so a wave still fans across the whole frame from inside a 12-unit bore.

## What needs human eyes

WSL2 can't render WebGPU headless — the snapshot tool falls back to SwiftShader, so **the real frame and the entire mix are unconfirmed**. In priority order:

1. **Do ring crossings feel exactly on the beat?** This is the level's one non-negotiable and the thing I could only verify structurally.
2. **Does the bar-28 shot land as the biggest moment?** Speed spike, whiteout, FOV kick, hum cut, and E-major bloom all fire together; I can't hear whether they're balanced.
3. **Mix balance** — particularly the climbing hum under the arrangement, and whether the per-section player timbres crossfade cleanly.
4. Bloom at zero, and the interlocks against the charge glow in the last bar and a half.

One design note worth a second opinion: the imperfect sim policy clears the interlocks roughly 1 in 2 runs. I read that as correct tension for a hard deadline, but a playtester may find it harsh.