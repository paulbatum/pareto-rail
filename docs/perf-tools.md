# Performance tools

Use these when a level slows down over a run or when handing off a level that may create too many objects, geometries, or draw calls.

## Headless performance gate

```sh
npm run check:perf -- --level <level-id>
npm run check:perf -- --level rush --json snapshots/perf/rush.json
```

The tool boots the level through the gameplay snapshot harness with seeded randomness, immortal player mode, a fixed simulation step, a 640×360 default viewport, and the SwiftShader/WebGL software path. It advances the real runtime loop for the full run and samples once per simulated second:

- renderer draw calls and triangles;
- renderer geometry, texture, and exposed program or pipeline counts;
- total scene object count and `visible === true` object count;
- JavaScript heap retained after a forced collection, through Chrome DevTools Protocol when available;
- wall-clock milliseconds spent per stepped frame inside that second.

The default gates are intentionally aimed at growth and absurd budgets, not absolute SwiftShader frame time:

- late-run means are compared with seconds 2–5, with a default failure threshold of `1.35×` for draw calls, scene objects, visible objects, geometries, and textures;
- growth also has small absolute allowances so normal bounded warm-up does not fail when a level first reaches later enemy types: `64` draw calls, `128` objects, `512` geometries, and `8` textures;
- retained heap has a default `16 MB` allowance, measured as the late-window mean minus the seconds 2–5 mean;
- draw calls fail above `500` in any sampled frame;
- total scene objects fail above `5000` in any sample;
- stepped frame-time growth above `1.5×` is a warning, not a failure, because SwiftShader absolute timing is not representative of real WebGPU hardware.

### Render path

This gate stays on the software path by default, unlike the visual tools in `docs/visual-tools.md`, which default to the real WebGPU pipeline. Every gate above measures growth or an object budget, none of which the backend changes, and the frame-time warning ratio is calibrated against software timings. Staying there also keeps the gate runnable inside the benchmark entrant sandboxes, which cannot reach a GPU browser.

Pass `--gpu` when the frame column itself is the question — it samples the pipeline the game ships, and needs the setup described in `docs/visual-tools.md`.

### What the frame column measures

`--render` picks how the harness steps the run, and with it what the frame column means:

- `sample` (the software default) steps a whole second without rendering, renders once, and reports that render's CPU time. It is the cheapest mode on SwiftShader. The stepped second queues every compute dispatch the level made without a frame between them, and the render then waits for that queue, so a level with GPU particles reads tens of seconds on the sample after a busy second. That number is an artifact of this mode, not a frame the game shows.
- `all` renders every frame the same synchronous way and reports the per-second average, p95, p99, and maximum of the render's CPU time.
- `realtime` (the `--gpu` default) steps one frame per animation frame and reports the wall-clock time between frames, which is what a player sees: a GPU that falls behind, or a driver still compiling a pipeline the frame needs, shows up as one long frame. The display refresh caps the floor at about 16.7 ms, so read this mode for hitches (`maxFrameMs` in the JSON) rather than for the median.

The GPU browser compiles a render pipeline the first time a shader is drawn, in the GPU process, for 20 to 700 ms depending on the shader. The renderer's CPU time does not include it; the wall time between frames does. A level that spawns an enemy kind, disposes it, and spawns it again pays that compile on every wave unless it sets `render.retainShaders` (`docs/level-authoring.md`).

### Retained heap

The heap column is read after a forced collection at every sample, so it is what the run is still holding rather than wherever the allocation sawtooth happened to be. This matters more than it sounds: sampling the raw heap measures uncollected garbage as much as retention, and whether a collection fires near a sample depends on how busy that stretch of the level is. A level that goes quiet in its final seconds gives the collector no reason to run, ends its last sample at the top of a sawtooth, and reads as though it leaked tens of megabytes when it retained a fraction of that. Collecting first removes the question, and makes the reading repeatable to a tenth of a megabyte across runs.

Some retention across a run is normal and sometimes deliberate — a level whose premise is accumulation keeps what it accumulates. The allowance is set well above what the built-in levels use, so the gate catches an unbounded climb rather than a level that holds onto its own content.

### Authoring budget and gate margin

Every allowance above is the budget a level is **authored** to. A gate that decides a benchmark run allows `1.5×` that before it fails. A level between the two is reported as a warning, `⚠`, and passes:

- `✓` — inside the authoring budget.
- `⚠` — over the authoring budget, inside the margin a gate reserves. Worth fixing; it will not fail a run.
- `✗` — past the margin as well.

The two-tier bar exists because a single threshold makes an author's local check and the benchmark gate the same coin flip: a level parked just under the line passes locally and fails the gate, or the reverse, on nothing the author changed. Reserving the margin means the number an author is asked to meet is strictly tighter than the number that can end a run, so landing near the budget costs a warning instead of a result.

### Perf profiles

A perf profile is a named set of gate budgets. Pick one with `--perf-profile <name>`:

| Budget | `default` | `flagship` |
| --- | --- | --- |
| growth ratio | 1.35× | 1.6× |
| retained heap | 16 MB | 32 MB |
| draw calls, any sample | 500 | 1000 |
| scene objects, any sample | 5000 | 10000 |
| draw-call growth allowance | 64 | 128 |
| object growth allowance | 128 | 256 |
| geometry growth allowance | 512 | 1024 |
| texture growth allowance | 8 | 16 |

The `1.5×` gate margin applies to whichever profile is in force, so a `flagship` gate fails a run at 1500 draw calls.

A level asks for a profile by setting `perfProfile: 'flagship'` on its `LevelDefinition`. `check:perf` reads that field from the level and uses it when the command line names no profile, so `check:floor -- --level <id>` holds the level to the profile it declares. `--perf-profile` overrides the declared profile, and any single budget flag below overrides both.

Benchmark entrants are authored to `default`. The promotion tooling does not copy `perfProfile`, so a profile cannot travel with a benchmark level.

### Measuring the post chain

The gate renders with `fidelity=postless`, so bloom, motion blur, and any other post stage cost nothing in the numbers above. Pass `--fidelity full` to build the level's post chain instead. Combine it with `--gpu` to measure what the game ships:

```sh
npm run check:perf -- --level <level-id> --gpu --fidelity full
```

Read only the frame column from that run. The object and draw-call counts include the post chain's own passes, so they are not comparable with a `postless` run.

Useful overrides:

```sh
--growth-ratio 1.5
--heap-retention-mb 32
--max-calls 800
--max-objects 8000
--frame-growth-warn-ratio 2
--draw-call-growth-allowance 96
--object-growth-allowance 192
--geometry-growth-allowance 768
--texture-growth-allowance 16
--perf-profile flagship
--fidelity full
--dt 0.0166667
--seed 123
--no-fail
```

`npm run check:floor -- --level <level-id>` runs `check:perf` as a mandatory stage after the simulation and occlusion gates. It accepts `--perf-profile <name>`, forwards it to that stage, and prints the profile in force in its report header.

## Frame-time probe

`check:perf` samples one render per simulated second, so its frame column mixes steady-state cost with whatever compiled in that second. The probe separates them:

```sh
npm run perf:probe -- --level <level-id>
npm run perf:probe -- --level <level-id> --times 5,20,90 --frames 36 --detail
```

At each time (default: the midpoint of every section the level declares) the probe steps the level there, then steps and renders `--frames` frames back to back and reports, per time, the median CPU milliseconds inside the level update and inside the render call, the first render after the step, and the median GPU milliseconds of all render passes and of all compute dispatches, read from timestamp queries. It runs on the GPU browser at 1280x720 by default; `--software` takes the SwiftShader path, where the GPU columns mean nothing.

`--detail` prints every frame's render time with the renderer's pipeline and node-builder cache sizes. A frame whose sizes rise is a frame that compiled a shader; a size that falls and rises again across waves means the renderer evicted a shader and compiled it again (see `retainShaders` in `docs/level-authoring.md`).

Three knobs remove one cost at a time, so two runs attribute it: `--hide <names>` sets the named scene objects invisible, `--drop-stages <types>` leaves those post stage types out of the chain, and `--no-velocity` builds the chain without the velocity buffer. Repeat the baseline run: another process on the same GPU moves the medians by a millisecond.

## Running two render tools at once

Every render tool opens the Windows browser on one debugging port and stops it by that port when it finishes, so two tools on the default port kill each other's browser. Set `PARETO_CAPTURE_PORT=<port>` in the environment of one of them to give it a browser of its own.

The tools drive a run through one CDP call, which puppeteer abandons after its protocol timeout (180 seconds by default). A level that runs GPU compute on the software backend can need longer; set `PARETO_PROTOCOL_TIMEOUT_MS=<milliseconds>` or pass `--protocol-timeout <seconds>` to `check:perf`, `check:occlusion`, or `check:floor`.

## Real-hardware playtest overlay

In dev builds (`npm run dev`) the overlay is on by default, in the top-left corner; pass `perf=0` to turn it off. In production builds it is off unless requested with `perf=1`:

```text
http://localhost:5173/?level=rush&perf=0
https://<deployed>/?level=rush&perf=1
```

Outside dev builds, no recorder or overlay is created without `perf=1`.

The overlay records frame delta times into preallocated buffers and samples counters once per second. It displays current frames per second, the worst frame in the current second, a five-second sparkline, and current draw calls. When the renderer was constructed with `trackTimestamp: true`, the overlay also reads `renderer.info.render.timestamp` and shows GPU milliseconds beside the draw calls; without timestamp tracking that reading stays hidden and the JSON report carries `gpuMs: null`. Press the `perf json` button to download a JSON report at any time; on `runend` the overlay only logs the summary, it never downloads on its own.

The JSON report contains per-second frame buckets with average, p95, p99, and max frame milliseconds, plus the renderer and scene counters, level id, run duration, drawing-surface size, the adapter the browser handed the renderer, user agent, and timestamp. GPU milliseconds are recorded whenever the overlay is on, because the renderer is constructed with `trackTimestamp` in that case.

The overlay also prints a compact `console.table` summary for quick comparison during playtests.

### Knobs

These query parameters change what the GPU is asked to draw, so a playtest on slow hardware can tell a level's cost apart from the cost of the surface it is drawn on. They apply in any build, and whichever were in force are recorded in the report, the console summary and the downloaded filename:

| parameter | effect |
|---|---|
| `scale=<0.25-2>` | multiplies the device pixel ratio |
| `msaa=0` | builds the renderer without multisampling |
| `post=0` | renders the scene straight to the canvas, with no post chain |
| `shadows=0` | drops the shadow pass |
| `hide=<names>` | takes named scene objects out of the frame; an unknown name is an error |

```text
https://<deployed>/?level=spillway&perf=1&scale=0.5
https://<deployed>/?level=spillway&perf=1&post=0&hide=terrain
```

### Perf sweep

One knob per run answers one question, and a run costs a playthrough. The `perf sweep` button beside `perf json` prices everything in a single sitting: it cycles through configurations in short blocks for about half a minute, so every configuration samples the same parts of the run, then downloads a report giving each one a median GPU millisecond figure and its delta from the baseline. The delta is what removing that one thing saved.

The configurations are discovered from the scene, so no level declares a list: the post chain, the shadow pass, the heaviest named groups, and the heaviest named materials. Groups are the axis a geometry or culling fix is made on; materials are the axis a fragment-cost fix is made on. A group and a material covering the same meshes are priced once. A level gets useful names out of this only if its groups and materials are named — see `src/game/perf-sweep.ts` for how they are chosen.

Three things to know when reading a sweep.

A positive delta — a configuration slower than the baseline — is usually real, not noise. Hiding an opaque object reveals what was behind it, and those fragments now get shaded. So a level where hiding the water makes the frame slower is telling you it is overdraw-bound and that what sits behind the water is expensive per pixel. It also means a negative delta is a lower bound on what that object costs, never an upper one.

GPU timestamps lag the frame that produced them, so each block discards its first frames; that is why the sweep holds a configuration rather than alternating per frame.

On hardware fast enough to hit the frame cap, every configuration reports the same frame milliseconds and the deltas fall into the noise. Run a sweep on the hardware that is actually slow, and during a real run rather than on the intro screen — the camera sits somewhere unrepresentative there, and every number is relative to what is on screen.
