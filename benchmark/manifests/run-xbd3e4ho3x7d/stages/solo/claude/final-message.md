Done. Here's the handoff.

## Mass Driver — `src/benchmark-levels/mass-driver-o9ok/`

**The idea, stated once:** the coils are seated at `ringU(n) = runProgress(n × beatSeconds)` — the same rail easing the camera uses. So "you pass through one ring exactly on every beat" is true *by construction* at any speed, and the coil spacing widening from ~9 to ~35 units across the run **is** the acceleration, not a decoration of it. The visual strobe is a Gaussian in run time around each coil's own beat, so it can never drift from the music. Nothing listens for a `beat` event to do it.

### What I verified

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run build` | pass |
| `npm run check:floor -- --level mass-driver-o9ok` | **all passed, 0 warnings** |
| Perf gates | all 9 pass (Helios fails 2 of these) |
| Target occlusion | 0 warnings across 101 targets |
| Spawn centerness/distance | 0 warnings (Helios has 2) |
| Event coverage | nothing unfired |
| Sim — perfect | 76/80 kills, rank A, gun fires, 0 hull loss |
| Sim — imperfect | 54/80, rank B |
| Sim — no-fire | dies 56.27s: barrel breach, exactly as designed |
| Audio trace | 120 coil ticks at 1/beat, 5 sections on the right bars, genuine silence after the shot |
| Git scope | only the level directory + regenerated `docs/level-gallery.md` |

Duration is 60.000s — 32 bars at 128 BPM, so the run ends on a phrase boundary rather than near one.

### Bugs the tooling caught, and what they were

- **The gun never fired in simulation.** The phase clock was in the level runtime, but `simulate` drives `gameplay.ts` directly. Moved it onto the `updateCameraEffects` runner hook — gameplay now owns it, and the runtime injects only the cosmetic half.
- **A lucky darter hit let you survive a barrel breach.** The interlock despawned after one `damagePlayer` call, which the engine's invulnerability window could swallow. It now keeps asking every frame.
- **The shot was silent under the trace harness** because `fireTheGun` bailed on a null hum. Guarded the hum calls instead of the whole figure.
- **Geometry churn:** each spawn built fresh geometries. Hoisted to shared module-scope specs with same-tint-role parts merged — geometry growth went 19.3× → 2.2×, heap 1.54× → 1.29×.

### Two judgement calls I'd flag

**Engagement contracts: 51/76 pass, 25 fail.** These are bore-wall targets — anything at radius ~15 exits the frame sideways before the camera overtakes it, so it's structurally short of the checker's "lockable until overtaken" model. I confirmed this is a model mismatch, not a fixable authoring error: *shortening* leads made the ratio worse (47 → 44), because the exit happens at a fixed distance from the camera. I restored the leads that produced the best actual play numbers. Not a gate, but you should know the number isn't 76.

**Brightness at the charge peak.** 56s hits 0.65 luminance — the muzzle blowing white about a second before the shot. I pulled this back twice (coil charge lift 1.9 → 0.5, bloom 1.15 → 0.95, threshold 0.58 → 0.7) and it's now deliberate rather than accidental, but it's the thing most likely to need another notch down on real hardware.

### Needs human eyes

**This environment cannot render WebGPU** — everything visual above came from headless SwiftShader/WebGL stills, and **nothing has been heard at all.** Priorities for a playtest:

1. **The coil strobe** — one flash per kick, no drift, across the whole run. It's the entire premise; if it reads as anything other than locked, the level fails.
2. **The charge phase (41–56s)** — legibility of the four interlocks against the whiteout, and whether 15 seconds to clear them is tense or frustrating.
3. **The shot** — bar 30 should be a hard cut to near-silence with a held open voicing. On paper the trace shows the drop; whether it lands as a *release* is a listening question.
4. **The barrel hum climbing 37 Hz → muzzle** — the one element I have no way to evaluate headlessly.