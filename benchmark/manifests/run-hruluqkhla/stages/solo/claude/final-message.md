**Vespers** is built at `src/benchmark-levels/vespers-9qbs/`, with gallery images in `public/level-content/vespers-9qbs/`. Typecheck, build and the full `check:floor` all pass: 0 occlusion, performance, centerness or reticle warnings. I have not seen it in WebGPU or heard it. Headless Chrome here can't render WebGPU, and I have no way to listen.

**What's in it**
- **World:** a black stone nave with arcade, gallery and clerestory, ribbed vaults, a floor of candles far below and hanging candle chandeliers. The flight climbs into a lantern crossing on the swell, sinks toward the candles for the dark span, and hovers in front of the dead west rose.
- **Light:** every creature peels off a specific window, drains it, and carries its colour in its chest. A kill sends that colour home along an arc; the window blazes, throws its colour onto the stone and down a soft shaft, and stays lit.
- **Music:** a 96 BPM, 24-bar organ piece in D minor, exactly 60 s, with no percussion.
  - A held pedal D opens alone, then alto, soprano and tenor enter with a fugue subject one at a time.
  - The pedal takes the subject for the swell, with choir and bells. A tremulant flute plays it alone through the dark span, and it becomes a repeating bass line for the boss.
- **Player sounds:** locks climb the current chord on a flute, shots are pipe chiff plus a pedal reed, and a full six-lock volley adds a big chord stab. Kills play a solo melody drawn from the harmony, echoed a beat later by a glass chime as the window relights.
- **Boss:** eight claws, then a thorned heart with three six-hit shells. Killing it gives a beat of silence, then the rose ignites, a wave of light runs back down the nave, the music turns major, and the held-back Tuba plays the subject. If the heart survives to 55 s it sinks back into the glass and the piece ends on the lone pedal D.

**How I checked it**
- **Simulation:** the perfect policy clears 58/58 and burns the rose at about 47 s; every event type fires.
- **Visuals (WebGL fallback snapshots):** I tuned stone contrast, shafts, the ignition and the finale with them. With post-processing off, every target stays legible as a black silhouette against its own halo.
- **Audio:** I rendered the run offline in headless Chrome. There's no clipping, loudness follows the intended arc (pedal alone about −21 dB up to the finale about −14 dB), and player sounds sit 5–7 dB under the music. I used the spectrum to trim excess sub-bass. The actual timbres (organ, choir, bells) are unheard.
- **Scope:** `npm run check:benchmark-scope` couldn't run because it imports `scripts/benchmark/protocol.mjs`, which isn't in this checkout. I checked with git instead: only the two directories above are new.

I added debug previews because snapshots can't shoot: `?rose=autoplay` plays the whole run with perfect aim, and `burn`, `lit` and `heart` fake single moments. They're listed in `level.md`.

**For the human playtest, in this order**
1. **Organ tone and mix:** the choir might be buzzy and the high soprano runs in bars 17–22 might be shrill.
2. **Ignition timing:** whether the rose's ignition lands on the same beat as the music's major-key chord.
3. **Finale brightness:** the settled lit cathedral in real WebGPU bloom. The fallback renderer may differ.
4. **Boss difficulty:** eight 2-hit claws plus an 18-hit heart before 55 s, while shooting down thrown glass shards.
5. **Stone lighting cost:** the stone shader sums 16 window lights per pixel, so check it on a weaker GPU.