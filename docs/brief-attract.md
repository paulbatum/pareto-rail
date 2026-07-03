# Brief: attract screen, letter-lock start/replay, pause menu

The game currently auto-starts a 30-second run on page load and restarts with R. This brief adds an attract/holding state with a lock-to-start mechanic, a pause menu, and a letter-based replay. The visual and audio layers have been rewritten since the scaffold — the architectural seam is unchanged and must be respected: **game logic emits events on the bus and calls visuals factories; it never builds meshes/materials or makes sound itself.**

## APIs already in place for you

- `setGlowLevel(level: 0..1)` and `getGlowLevel()` exported from `src/visuals` — one knob scaling the game's bloom.
- `audio.setMasterVolume(0..1)` / `audio.getMasterVolume()` on the object returned by `createAudio`. Both setters are safe to call before the AudioContext exists.
- The audio layer already boots in a low-energy ambient loop and switches to the full run arrangement on the `runstart` event, transitioning on a bar boundary of the same tempo grid — the seamless music transition is already handled. **Do not modify `src/audio/` internals**; only call the exported API.

## Feature 1: attract state ("holding pattern")

- On load the game does NOT start. New state before `running` (suggest `attract`). Camera parked at the start of the rail (u = 0), looking down the tunnel, with a very subtle idle motion (small sinusoidal position/look drift, a few cm — alive, not moving forward). Run timer, spawning, and HUD score/time are inactive; hide the score/time/locks HUD cells during attract (CSS class, not DOM removal).
- The word **START** floats ~20 units ahead of the camera: 5 individual letter targets in a horizontal row, comfortably spaced for sweeping. Each letter slowly oscillates its rotation (±0.15 rad, different phases) but stays legible.
- **Letters are lockable targets that flow through the existing event/visual machinery** so lock sounds, lock rings, and shatter effects all work unchanged:
  - Extend the `EnemyKind` union with `'letter'` and add an optional `letter?: string` to the relevant event payloads and to `createEnemyMesh(kind, letter?)`.
  - Add a placeholder letter builder in `src/visuals/letters.ts`: each glyph assembled from thin boxes on a coarse grid (5×7 bitmap or segment-style, your choice), single cyan additive material, merged into a Group. Set `group.userData.shardSpecs` to an array of `{ direction: unit Vector3, color: Color, size: number }` (one entry per box, direction = box offset normalized) — the existing kill-shatter reads exactly this. Keep it deliberately plain; it will be restyled later. Route `createEnemyMesh('letter', char)` to it.
- **Lock-to-start rule**: hold + sweep locks letters exactly like enemies. On release:
  - All 5 locked → the normal staggered homing volley fires at them; each letter shatters via the normal `hit`/`kill` flow (score does not count these). After the last letter dies plus ~0.8 s, the run starts (emit `runstart`, camera eases smoothly from parked into rail motion over ~1 s rather than teleporting).
  - Fewer than 5 locked → no shots are fired at letters; emit `unlock` for each and clear locks; count one failed attempt.
- **Tip popup**: after 3 failed releases, or 8 pointer-downs in attract without ever reaching 5 simultaneous locks, show a DOM tip overlay: `HOLD to charge — SWEEP across all five letters — RELEASE to fire`. Style with the existing CSS variables/aesthetic in `src/style.css`. Hide it the moment all 5 are locked. Don't show it again after a successful start (persist nothing; per-page-load is fine).

## Feature 2: Esc pause + settings

- Esc toggles pause in any state (attract, running, ended). While paused: game update frozen (no run-timer drift — beware `performance.now()` deltas), AudioContext suspended (guard for it not existing yet), overlay shown. Esc or a Resume button unpauses.
- Pause overlay (DOM, matching the HUD style): title, Resume, and two sliders:
  - **Volume** 0–100 → `audio.setMasterVolume(v/100)`
  - **Glow** 0–100 → `setGlowLevel(v/100)`
  - Both persist to `localStorage` and are applied on boot before the first frame.
- The OS cursor is hidden globally (`cursor: none`); make sure the pause overlay sets `cursor: auto` so sliders are usable.

## Feature 3: letter-lock replay

- On the end screen, replace "Press R to replay" with the word **REPLAY** — 6 letter targets, same mechanic: all 6 locked, release, they shatter, and a fresh run starts (existing reset path; straight into the run, not back to attract). Update the end-panel text to hint the mechanic instead of the R key (e.g. `LOCK ALL SIX TO REPLAY`). Keep the R key binding working as a hidden fallback.
- Note the end screen is currently a full-screen DOM overlay; the letters live in the 3D scene, so the panel must not block the view or the pointer — rework it into a compact banner (top or bottom) during the letters phase, or make the center transparent to pointer events. Your call, keep it clean.

## Constraints

- Max simultaneous locks stays 8; letters fit inside that.
- `npm run typecheck` and `npm run build` must pass. Do not commit.
- Keep game logic free of material/mesh construction (letters come from the visuals factory).
- Don't touch `src/visuals/` internals other than: the new `letters.ts`, the `createEnemyMesh` route for `'letter'`, and any type plumbing. The crystal/effect/tunnel code is hand-tuned; leave it.

## Report

What works, what's unverified (you cannot render WebGPU headlessly here — say so), any deviations.
