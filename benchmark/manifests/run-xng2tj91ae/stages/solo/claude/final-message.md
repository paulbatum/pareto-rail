Strandline is built and passes every gate. I couldn't see it in WebGPU or hear the mix here: WSL2's headless Chrome has no working WebGPU, and I can't listen. Everything visual below comes from the SwiftShader/WebGL fallback snapshots, so a human playtest is still needed.

**The run (96 BPM, 24 bars, exactly 60 s)**
- **Drift (0–10 s):** you enter low among the tentacle tips. The jellyfish is sick, the strands are dim, and the first parasites sit asleep on them behind START. Its heartbeat, a soft sub thump and water whoosh on every downbeat, is what the music is built on.
- **Kindling (10–20 s):** the forest wakes in a wave of light down every strand. The first full six-lock chance arrives on the bar-4 downbeat, joined by glass plucks and a soft kick.
- **Green Moon (20–27.5 s):** the rail swings out into open water and the camera turns to the bell. It fills the frame while six parasitic drifters circle its disc to a choir and chimes. Then the rail dives back in.
- **Upstream (27.5–37.5 s):** the full groove kicks in while the rail climbs to the crown.
- **The Crown (from 37.5 s):** the parent sits in a three-part web and pumps out broods one at a time. Kill a whole brood and the web section that fed it withers, silencing one layer of the parasite's sour drone. If any slip back, that section pumps again. Once the parent is bare, two six-lock volleys tear it loose.
- **Ending:** when it dies, its body tumbles away and light floods every strand. The camera pulls back until the whole animal is in frame, the music resolves into D major and a slow heartbeat, and the jellyfish drifts on. If the deadline at bar 22½ passes first, it stays sick and the music stays unresolved.

Parasites sit on real strands, and killing one sends a flash up its strand to the bell. Kills play a written melody per section, locks are droplets climbing the current chord, and passing close to a strand makes a soft, panned whoosh.

**Verified**
- `npm run typecheck` and `npm run build` pass.
- `check:floor` accepts it: 0 occlusion warnings, 0 performance failures, 0 audio-config failures. The geometry-growth gate initially failed; it now passes because each parasite's geometry is built once and shared.
- `check:benchmark-scope` against the baseline commit `bce6a97` passes; changes stay in the level directory, its gallery images, and the regenerated `docs/level-gallery.md`.
- Simulation: the perfect bot clears 81/81 with an S rank, the imperfect bot gets an A, and the no-fire bot dies to spores.
- A headless volume meter on the master output: master peaks stay at or below about −1.3 dBFS (the parent's hits clipped to +3.4 before I fixed them), and the music gets about 6 dB louder from the opening drift to the later sections.
- The fallback snapshots look right at bloom zero too.
- I added gallery images (title, the green moon as hero, the freed finale as overview) and filled in `level.md`.

**What a playtester should check first**
1. The swing out to the bell: whether the camera turn and the banking feel good in real WebGPU.
2. Whether the strand forest stays readable against the water with bloom at zero.
3. Whether the link between each brood and its web section reads during the fight.
4. The balance of the heartbeat pulse against the player's notes, and how each section's bell sound feels.
5. Whether the ~1.2 s landing of a six-shot volley feels like one phrase rather than sluggish.

For inspecting the good ending headlessly, `--debug-value freed` forces the parent's death at bar 20.5, and `visuals/inspect.ts` lines up every parasite for model snapshots. Nothing is committed yet.