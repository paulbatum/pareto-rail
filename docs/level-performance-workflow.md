# Level performance workflow

Use this workflow when a level is slow or needs a specific performance improvement. [Performance tools](perf-tools.md) owns the commands, flags, and report formats. [Visual tools](visual-tools.md) covers hardware rendering and image capture; [level authoring](level-authoring.md) covers rendering configuration and readiness gates.

## Define the target before changing code

Record the starting commit, scenario, hardware, output size, and success metric. Treat the intro, steady gameplay, and first-use hitches as separate cases. A fix for late gameplay does not establish an intro improvement.

Specify whether the goal concerns displayed frame intervals, CPU update/submission time, or GPU pass time. Measure these separately at the start:

| Measurement | What it answers | What it does not establish |
| --- | --- | --- |
| Frame intervals | How often the browser presents an opportunity to draw; includes pacing and stalls | The cost below the display refresh limit |
| CPU update and render submission | Time spent running gameplay and submitting rendering work | GPU execution time |
| GPU timestamps | Duration of timestamped render and compute passes | Complete frame time, including CPU work, presentation, and commands outside those passes |
| Headless performance gate | Resource growth and object/draw-call budgets | Native-resolution, full-postprocessing performance on the target GPU |

CPU and GPU work overlap; do not add their medians and call the sum frame time. If CPU submission already exceeds GPU execution, reducing GPU cost alone may barely change throughput. Establish the limiting work before choosing which part to optimize.

Agree on acceptable quality changes. Prefer cheaper versions of visible effects and terrain over deleting them: lower-resolution effect buffers, fewer samples, simpler shading, or lower-detail distant geometry. Record any change to MSAA or internal resolution; a 5K output does not prove that every pass rendered at 5K.

## Establish a reproducible baseline

1. Read the level's rendering configuration and update path before launching ablations. Find the active post stages, shadow casters, material families, and effects that fade or become inactive. Check prior evidence against the current commit rather than repeating every old experiment.
2. Use the existing GPU probe with a fixed seed, camera/time, full postprocessing, warmup, and repeated samples. Use its start-screen mode when the intro is the target. Keep shader compilation outside steady-state samples; measure startup separately when it matters.
3. Save a matching baseline image before editing. Record the actual adapter, drawing-buffer dimensions, DPR, effective scene MSAA, and timestamp sample counts. A browser viewport can include navigation outside the game canvas.
4. Compare CPU and GPU measurements with a moving run. A frozen probe isolates drawing cost but excludes updates and makes motion-blur samples coincide. It cannot establish moving performance or animation quality.
5. If repeated medians differ by more than 5%, investigate contention, clocks, compilation, or changing scene state before interpreting small differences.

Keep commands, raw reports, telemetry, images, and a short experiment ledger under `tmp/`. Each ledger row should name the hypothesis, source variant, measurement conditions, result, and keep/reject decision. Preserve enough evidence to reproduce the comparison without reconstructing a chat transcript.

## Control GPU contention and clock changes

Assign one owner to hardware rendering. Before each measurement, close that owner's other live game pages and stop its previous capture process. An unattended page can still render. Separate debugging ports prevent tools from closing each other's browsers; they do not prevent GPU contention. Never stop an unrelated browser or process to clear the GPU.

Parallelize source inspection and review, not GPU measurements. Avoid builds and other substantial CPU work during CPU timing. Keep code and the harness stable while a probe runs; hot reload or concurrent harness edits can invalidate the page or the measurement.

GPU timestamps measure duration at the clocks the GPU actually used. A lighter workload can trigger lower clocks and report a longer duration despite doing less work. High-resolution probes reduce this problem but do not eliminate it.

- Record core and memory clocks or power state when results drift. Alternate baseline and candidate runs under the same sampling regime.
- Report the full repeat range. If comparing a subset with matching clocks, label that subset and retain the other results; do not silently discard slower repeats.
- When display-capped runs hide throughput and provoke clock changes, a dedicated uncapped browser can provide a second controlled comparison. Apply identical launch settings to both variants and keep the ordinary capped run as the player-facing check.
- Do not normalize milliseconds by core frequency and treat the product as performance evidence. Memory bandwidth and other costs do not scale with core frequency alone.
- Do not change system-wide GPU power settings as an incidental benchmark step.

A high-resolution desktop test helps rank changes. It does not emulate an integrated GPU or establish phone performance. Keep claims limited to the tested adapter and scenario.

## Choose experiments that can affect the target

Measure a few major costs before tuning small details. State the expected saving and the remaining gap before each experiment. If removing an entire effect saves much less than the gap, optimizing that effect alone cannot meet the target. Several useful changes can still combine, but measure the combination rather than adding isolated savings.

Use ablations to answer a specific question:

- **Material shading:** flatten the material while retaining geometry and depth coverage. Hiding an opaque mesh exposes surfaces behind it and does not isolate its shader cost.
- **Post stage:** drop that stage to estimate its total contribution, then test reduced resolution, sample count, or intermediate copies while keeping the effect visible.
- **Shadows:** distinguish caster submission, shadow-map drawing, and shadow sampling. Changing a filter does not test draw-call reduction. Disabling shadows can also disable effects that consume the shadow map.
- **CPU submission:** inspect draw counts and update work before changing fragment shaders. Batching compatible geometry or reducing distant caster detail addresses different work from lowering texture samples.

Use one-variable candidates until the cause is clear. Alternate baseline and candidate, then test the retained combination. Keep only savings that exceed baseline variation and justify their quality or maintenance cost. A suspected expensive operation may already be cached; reject a plausible optimization when measurements show no useful gain.

Timebox setup problems and groups of experiments. For example, report after two or three candidates or ten minutes, including failures and the remaining gap. Give background commands a deadline and inspect their completion promptly. Distinguish command runtime, observed interaction time, and unattended gaps; a long gap in a transcript is not evidence of a long computation.

Use explicit source variants or commits for A/B tests. Restore only the files the experiment owns, and verify which variant is active. Avoid broad stash swaps or a second writer changing the measured files. Once instrumentation works, optimize the level rather than continually expanding the harness.

## Check visual and renderer correctness early

Compare matching images after the first meaningful candidate, before building more changes on top of it. Inspect normal viewing size as well as native-pixel crops. Then inspect motion: stills miss aliasing shimmer, temporal artifacts, blur gaps, and unstable shadow edges. Use `agent-browser` for live browser verification and follow the WSL GPU-browser skill when applicable.

Check composition, brightness, silhouette, water highlights, depth boundaries, and representative gameplay—not just the intro. Retain the recognizable effect when reducing its quality. Human playtesting remains the final check for visual feel and audio.

Read compositing semantics before skipping a faded effect. Zero intensity is only a no-op if the blend makes it one; changing pass execution can expose an existing darkening or alpha contribution. Also test the effect becoming visible again.

Keep level-specific quality compromises opt-in in shared code. Test unaffected defaults and explicit user overrides. A renderer setting can change shader types as well as texture allocation: MSAA changes, for example, can change depth-texture binding types. Reallocating attachments is not proof that cached shaders remain compatible. Follow the engine's supported lifecycle, and exercise resize, recreation, and disposal on real WebGPU.

## Validate, land, and report

During iteration, use the narrow measurement and targeted tests. Run the required typecheck, build, and applicable level gates on the final retained code rather than after every hypothesis. Passing the headless gate does not replace full-postprocessing hardware evidence. Update the existing tool documentation and tests when changing a diagnostic or configuration contract.

Before committing:

- Remove rejected prototypes and unused diagnostic switches.
- Verify that the retained code matches the measured candidate and that normal defaults still work.
- Confirm the actual canvas size, effective quality settings, and absence of browser rendering errors.
- Check representative gameplay and any changed renderer lifecycle, not just a frozen intro.
- Stop only the browsers and servers the investigation owns; preserve useful evidence under `tmp/`.

Report baseline and candidate medians, tail values, repeat variation, conditions, visible compromises, validation results, and commits. Keep frozen GPU savings, moving GPU savings, and actual frame-interval improvement separate. State whether the original target was met.

Stop when the agreed result is sufficient or the owner asks to land. Do not start another optimization to improve a headline number. If another bottleneck remains, identify it as follow-up work rather than silently broadening the task.
