**Mass Driver** is complete and committed at `src/benchmark-levels/mass-driver-rqki/`.

## The central idea

The camera crosses **exactly one accelerator coil per beat** for the entire run. Coil `n` is planted at `runProgress(n * beatSeconds)` — the rail parameter the camera occupies on that beat — so the identity holds by construction regardless of the speed curve. Because the curve only accelerates, the coils physically spread apart (5 → 14 units) while the strobe stays locked to the pulse. 144 BPM × 36 bars = exactly 60.000s = 144 beats = 144 coils.

The boss is a deadline, not a healthbar: six jammed interlocks × 3 HP = 18 hits = exactly three full six-lock volleys, against a charge that peaks at the muzzle bar regardless. Clear them and the gun fires; leave one and the barrel bursts (`damagePlayer(99)` → death, forced `—`).

## Verified

| Check | Result |
|---|---|
| `typecheck` / `build` | pass |
| `check:floor` | **all pass** — 5 kinds, full event coverage, 0 occlusion warnings, 0 perf failures, 0 centerness/distance warnings |
| `simulate` | perfect 79/79 → **S**; imperfect 64/79 → **A**; no-fire → dies at 56.68s. No dead-air gaps, 0 impossible moments under perfect |
| Audio trace | 144 beats, 139 coil hits, all six sections landing on their designed bars |

Three things the contact sheet caught and I fixed: conductors projected as a flat horizontal bar (moved to diagonals so they converge), the muzzle whited the frame out (now a moving band, not a global flash), and the charge tint never released after the muzzle (the ending now goes quiet).

## What needs human eyes

WebGPU can't render in this WSL2 environment — the snapshots above come from the tool's SwiftShader WebGL fallback, so **nothing here confirms the real frame or a single note of audio.** A playtester should check, in order:

1. **The coil strobe.** The whole level rests on passing a ring exactly on the beat feeling locked. If it reads as even slightly off, nothing else matters.
2. **The mix.** The barrel hum is a continuously-running oscillator whose pitch is the charge state — I've never heard it. Its level against the coil pulse is the most likely thing to be wrong.
3. **Bloom at 0 and at max.** I pulled bloom to 0.85 and the glow down after seeing a whiteout; that was tuned against a fallback renderer.
4. The muzzle exit at ~57s, and the letter panels on the attract screen (the glyph snapshot tool passes no character, so I couldn't capture them in isolation).

One note on scope: `check:scope` can't run here — it needs a `main` ref, which this checkout doesn't have. I verified the boundary by hand instead: `git status` shows changes only under `src/benchmark-levels/mass-driver-rqki/` plus the regenerated `docs/level-gallery.md`. `src/levels/index.ts` is untouched, per the directory-only contract.