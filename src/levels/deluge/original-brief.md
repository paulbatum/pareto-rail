# Level brief: DELUGE (original, historical)

> Historical artifact: the brief Deluge was originally built from, preserved as-is.
> It is not maintained and may contradict current engine docs. Pending Deluge work
> is tracked in `docs/briefs/deluge-followups.md`.

Read `AGENTS.md`, `docs/level-authoring.md`, and `docs/level-brief.md` (the standing brief) before starting. All of the standing brief applies except where this document explicitly overrides it. Study `src/levels/helios/` closely — not to imitate it, but because it is the current quality bar and it exercises every engine contract you will need (variable speed profile, hostile shots, staged multi-hit enemies, a gated boss, debug targets, musical action audio). **Your job is to beat it.**

This level is a deliberate step change in quality above everything in the repo. Budget accordingly: iterate on feel, density, and mix until it is genuinely spectacular, not merely complete.

## Overrides of the standing brief

- **Duration: 150 seconds** (110 bars at 176 BPM; one bar = 240/176 ≈ 1.3636 s, so 110 bars = exactly 150.0 s). The standing brief's 30–90 s range is explicitly waived for this assignment.
- Register the level in `src/levels/index.ts` as the **second** entry (immediately after `crystal-corridor`). Do not reorder anything else.

## Theme

**DELUGE** — a rain-lashed neon megacity at night, mid-thunderstorm. The player is a hunted courier drone carrying something the city wants back. The run is one continuous escape: out of the storm ceiling, down the face of the skyline, through the avenue canyons, under the streets, through a live subway tube, out across a flooded canal, and finally up the security citadel with the city's hunter-gunship on you — ending by punching back up through the cloud deck into silent moonlight.

- Level id: `deluge`. Title: `Deluge`. Start word: `DELUGE`. Replay word: default `REPLAY`. Required glyphs: D, E, L, U, G, R, P, A, Y (plus any you use on signage).
- Palette: cold electric — rain-grey blacks and deep blue-slate for mass, **cyan and magenta neon** for signage and edge light, sodium-amber for the undercity, hazard-white for the security forces, one reserved color (acid green) that belongs to the boss alone. Keep HDR (>1) values on thin lines and small cores per the bloom gotcha; the level must stay fully legible with bloom at zero.

This palette and world must not resemble Crystal Corridor (violet cave crystal), Helios (gold/blood solar), or Prism Bloom. By ear it must not resemble them either — see Music.

## The thesis: proximity is speed

This level lives or dies on **perceived velocity**. The reference sensation is the Millennium Falcon inside the Death Star superstructure in Return of the Jedi: not open-space fast, but *tight* fast — massive structure passing within meters, gaps you thread, light sources strobing past faster than you can track. Every act must keep solid geometry close to the rail. Specific techniques, all of which you should use:

1. **Near-miss framing.** Girders, skyway undersides, pipe bundles, gantry arches, and tunnel ribs pass within 3–8 units of the camera, above and beside it, continuously. The camera rides exactly on the rail (`curve.getPointAt(runProgress)`, look-ahead +0.025), so author clearances against the rail directly. Nothing should ever clip the camera, but the ceiling of the subway tube should feel like it is shaving the paint.
2. **Beat-locked spatial frequency.** Place repeating structure at intervals the player crosses in musical time: in the subway tube, one lit ring per half-bar at cruise; girder shadows in the avenue on the bar. The environment becomes the metronome — when the music doubles, the strobing doubles. Derive spacing from the speed profile (`railU(time)`) so this actually lands; do not eyeball it.
3. **Variable speed profile.** Use the Helios technique (piecewise speed factors integrated into an `easeRunProgress` table — the *technique* is engine-adjacent math, not level imitation). Cruise in act 1 around 0.6×, spike hard at Streetfall (drop 1) and again into the Under (drop 2), hold the tunnel at the run's max, ease for the boss, final sprint on the outro climb. Acceleration moments must land exactly on musical drops.
4. **Rain as speed lines.** Procedural rain (instanced streaks or line segments recycled in a camera-local volume) whose streak angle tilts from near-vertical when slow to near-horizontal at tunnel speed — the rain itself reports velocity. In the tunnel, replace rain with strobing wall-light streaks and dripping-water sparkle at the ribs.
5. **Storm haze = far plane.** The camera far plane is 500 (set in `src/main.ts`; you cannot change it). Embrace it: heavy exponential fog / scene-fade in the level's materials makes the storm read as weather while hiding the cull. Distant city reads as haze-diffused window-glow, not geometry.
6. **Post kick.** Use `composeOutput` for a radial speed blur driven by a module-scope uniform (the authoring doc has the exact pattern), plus a brief chromatic/white flash on the two drops and lightning. Keep it subtle at cruise, hard on the drops.
7. **Camera language.** Use `updateCameraEffects` to bank/roll the camera into the rail's curvature (a few degrees, velocity-proportional) and add a low-amplitude speed tremble in the tunnel. Do not change FOV; do not fight the engine's edge-look.

## Structure — 110 bars / 150 s, five movements

Author one authoritative `DELUGE_BPM = 176` and a `bar()` helper; every timestamp below is in bars. Fine-tune boundaries to your arrangement, but drops must be geometry + music + speed striking together.

**Act 1 — Freefall (bars 0–16, 0–21.8 s).** Above the storm: moonlit cloud deck, antenna spires and stratosphere-tower crowns piercing through, aircraft-warning strobes. The rail dives along a tower face, through the cloud layer (a real volumetric-feeling transition — layered translucent shells or noise-faded planes), and the city resolves below in the rain. Sparse, atmospheric music; first gnat swarms and a billboard drone teach locking. The city revealed below the clouds should be the first "whoa" of the run.

**Drop 1 — Streetfall (bar 16).** Pull out of the dive between two towers into the avenue canyon at street-canyon level. Speed spike, full arrangement in, lightning strike silhouetting the skyline on the downbeat.

**Act 2 — The Avenue (bars 16–40, 21.8–54.5 s).** The grand canyon of the city: sheer building faces with instanced window grids, animated neon signage in the level's own glyph alphabet, holo-billboards, cross-street skyways and girder bridges whipping overhead, streams of traffic lights crossing at multiple depths. One landmark set piece mid-act: a colossal municipal hologram (pick one animal — e.g. a koi or heron swimming through the rain between towers) that the rail passes close beneath. Security responds: interceptor wedges merge into your lane, wall turrets deploy from building faces, dropvans unfold and spill gnats. Choreography escalates in two-bar cadences.

**Drop 2 — The Under (bar 40).** The avenue floor opens ahead (a ramp/breach set piece); dive below street level. Second speed spike, arrangement filters down dark and rolling.

**Act 3 — The Tube (bars 40–64, 54.5–87.3 s).** The tightest, fastest passage of the game. Stacked expressway undersides with support columns strobing past, then into a live subway tube: lit rings on the half-bar, cable bundles sagging along the walls, junction chambers where the tube widens for a breath and squeezes again. Set piece: **a passing train** — a wall of lit windows and doppler roar blasting past on the parallel track within a few units. Enemies here must respect the corridor: turret rings on the tube walls, gnats threading the bore, holo-barriers (see roster) forcing target-priority decisions at maximum speed. Exit: burst out of a tunnel mouth low across a flooded canal, black water mirroring smeared neon (fake the reflection — mirrored dim light-dots/streaks under the waterline; no real reflections), rain hammering the surface.

**Act 4 — The Vulture (bars 64–104, 87.3–141.8 s).** Rising out of the canal basin, the security citadel ahead — and the city's hunter-gunship, **the VULTURE**, drops out of the clouds. It owns acid green: its running lights, its shots, its searchlight. The rail spirals up the citadel's superstructure (still threading gantries and scaffold — the boss arena keeps the proximity thesis) while the Vulture flies the chase backwards ahead of you, Falcon-chase style. Fight in two phases:

- **Phase 1 (≈ bars 64–84):** Two wing rotor-pods, each a staged multi-hit target (`hitStages`), guard it while it strafes across the rail, sweeps its searchlight (telegraph), fires bolt volleys, and deploys interceptors. Pods shear off individually with real debris payoff; losing both forces it down to close hover.
- **Phase 2 (≈ bars 84–104):** Crippled and furious, it opens its ventral cannon to charge a beam that would end the run. The exposed cannon core is lockable **only during charge windows** (gate with the live `lockable` flag), three windows aligned to musical phrases, escalating audio-visual charge each time. Between windows it lashes with flak bursts. Killing the core must be the biggest scheduled moment of the level: music ducks for a breath, the finale figure lands on the grid, and the Vulture careens into a mega-billboard in a shower of glyph sparks. If the player fails all three windows, the beam fires — heavy (not instant-lethal) damage — and a shorter fourth window offers a last chance.

**Outro — Ceiling (bars 104–110, 141.8–150 s).** No targets. Full-throttle climb up and out through the cloud deck you fell through two and a half minutes ago; rain thins, the storm drops away below, moonlight and silence-adjacent ambient outro. Let the player breathe; roll the end panel out of that calm.

## Enemy roster

At least these six kinds (plus hostile shots), each with a distinct silhouette *and* motion. All security hardware shares a design language (matte dark chassis, hazard-white lights, thin neon edges) so the roster reads as one police force, distinct from the city's cyan/magenta.

- **Gnat** — palm-sized rotor drone. Swarm-boid weave: loose flocks that drift and re-form around a rail anchor rather than holding a fixed lattice. Fodder, 1 HP. The bread of every act.
- **Interceptor** — wedge-shaped pursuit bike with a rider silhouette. Merges into a lane beside the rail, paces you (matching apparent speed — sells velocity better than anything), then strafes across your bow while firing bolts. 1 HP, high value.
- **Turret** — deploys out of environment surfaces (building face, tube ring): unfolds with a telegraph, tracks, fires. Anchored to structure — never floats. 2 HP.
- **Holo-barrier** — a glowing hard-light lattice spanning part of the route ahead, visible far out, growing fast. Shoot it out (it shatters into pixels) or thread the gap; the lattice face damages on contact (`damagePlayer` on pass). `countsTowardTotal: false`. This is the pure speed-threat enemy — in the tube it is the level's signature panic.
- **Dropvan** — armored carrier that unfolds mid-air and spills gnats (`spawnEnemy` at runtime). Staged multi-hit: armor panels (stage 1) then exposed core (stage 2).
- **Bolt / flak** — lockable hostile shots via `src/engine/hostile-shot.ts` helpers, `countsTowardTotal: false`.
- **Vulture parts** — rotor pods (staged), cannon core (lock-gated), per the boss design.

Spawn choreography is yours, but author it against the arrangement (spawn-pattern helpers + bar timestamps), keep the two drop transits clear of targets, and make wave shapes readable as designed moments: escorts flanking a dropvan, a barrier forcing you to hold a volley, an interceptor pair crossing scissors on a phrase boundary.

## Music and sound

**Drum & bass at 176 BPM**, fully procedural Web Audio. This is the sound of the level's speed: rolling breaks, a reese bass, cold pads, arpeggios that belong to the neon. No other level sounds remotely like this. Arrangement mirrors the acts: atmospheric intro (pads, sparse kick, and let the *rain itself* be an instrument — filtered noise that is both weather and texture); full break from drop 1; darker, low-passed and rolling in the tube (open the filter as the tunnel mouth approaches); half-time menace then neuro-aggression for the Vulture with an escalating boss voice per the crystal lessons; beatless ambient outro above the clouds.

Follow every lesson in "Musical action audio" (`docs/level-authoring.md`): epoch-anchored quantization honoring `getActionSfxQuantization()`, lock/fire/hit/kill pitched from the live harmony, kills playing a hidden melodic lane so chained volleys perform runs, register space reserved for the player, boss damage voice escalating with a scheduled finale. Emit `beat` events; thunder lands on phrase boundaries (choreographed with visible lightning, never random against the grid). Rejected releases get a two-note "denied" klaxon consonant with the current harmony plus a reticle glitch and static-flash on the denied targets.

## Visual quality bar

Everything procedural, WebGPU-only, and *dense*. The judges' first thirty seconds must read as a generational jump in richness:

- Instanced window grids with varied per-window warm/cold/dark states and occasional flicker; neon edge outlines on tower silhouettes; animated glyph signage (marquee scroll, buzz-flicker) reusing the level's letter system — signage makes the glyph requirement a *world-building feature*.
- Traffic light-streams at several depths; sweeping searchlights; aircraft strobes; lightning that actually illuminates (a timed directional/ambient swell + skyline silhouette flash), synced to the score.
- Weather everywhere: rain volume around the camera, drip sparkle in the tube, hammered rings on the canal surface, cloud shells at both ceiling transitions.
- Event language: distinct spawn materialization, lock latch + tether, fire tracers, hit sparks, kill payoffs (drones burst into brief neon debris + a ring), miss/despawn fade, playerhit screen response beyond the engine's red flash (interference jitter fits the drone fantasy).
- Attract/START mode: the camera drifts on a rooftop ledge in the rain above the glittering city while DELUGE hangs in the air — it should look like a poster.

**Performance is a feature.** InstancedMesh / merged geometry for everything repeated (windows, girders, tube rings, rain, traffic); recycle camera-local systems instead of allocating; keep per-frame allocation near zero and draw calls low (aim ≲150). Target smooth 60 on mid-range hardware. The city must feel enormous while staying within the 500-unit far plane budget via the storm haze.

## Scoring, rank, feel

- `playerHealth: 5` (the tube and boss are dangerous; dying to a barrier you never saw is failure of authoring, not difficulty).
- Score kills by kind; pay volleys like Helios does (full 6-lock perfect volley is the signature play and should feel/sound like one); `scoreForHit` pays armor chips.
- `detailsForRun`: hull remaining, barriers shattered, and a Vulture line (downed / escaped, which window).
- Rank thresholds S–D requiring the Vulture kill + high clear rate for S. Tune so a first blind run lands C/B and an S demands mastery.
- Provide a `debugSelector` with `?debugEnemy=` targets (gnat, interceptor, turret, barrier, dropvan, vulture) like Helios's, so enemies can be tuned in isolation.

## Constraints and verification

- Use `createLockOnRunner`. Do not modify `src/engine/`, `src/main.ts`, or other levels. Touch only `src/levels/deluge/` plus the one registry entry. `npm run check:scope -- deluge` must pass.
- `npm run typecheck` and `npm run build` must pass.
- Use `npm run snapshot:gameplay -- --level deluge --thumbnails 12` and targeted `--sheet --times` captures at the drops, tube, canal, and boss to check composition yourself; capture model snapshots of the Vulture and enemy roster. Note: gameplay snapshots run a WebGL fallback, so treat them as composition checks, not final image quality.
- `npm run trace:spawns` / `trace:audio` have per-level registration in `scripts/` which is out of scope for you — skip them if they don't work for `deluge` without edits outside your scope.
- Headless WebGPU does not work in this environment; end by reporting what you verified and a concrete playtest checklist for a human (what to look at, at which timestamps).

## Handoff

Report: what you built (act by act), what you verified and how, known rough edges, and the human playtest checklist. Do not commit.
