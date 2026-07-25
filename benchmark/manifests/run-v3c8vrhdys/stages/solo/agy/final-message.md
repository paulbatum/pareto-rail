# Benchmark Level Assignment: Vespers (`vespers-c8vr`)

Built the complete benchmark level **Vespers** (`vespers-c8vr`) according to the brief in `docs/level-brief.md`, `AGENTS.md`, and `docs/level-authoring.md` using the directory-only output contract under `src/benchmark-levels/vespers-c8vr/`.

---

## 🏛️ Level Identity & Theme Execution

- **Level ID**: `vespers-c8vr`
- **Display Title**: `Vespers`
- **Run Duration**: `60.0s` (exactly 30 bars at 120 BPM)
- **Directory**: [src/benchmark-levels/vespers-c8vr/](file:///tmp/pareto-rail-run-v3c8vrhdys/src/benchmark-levels/vespers-c8vr/)

### 🎨 Visual Architecture & Atmosphere
1. **Cathedral Nave**: Flies down a massive black stone cathedral nave with 18 bays of clustered columns (`0x0f1118`), stacked pointed gothic arcade arches, triforium gallery tiers, and quadripartite ribbed vaulting closing overhead.
2. **Floor of Candles**: Hundreds of flickering warm candle flames (`200` instanced flame meshes) scattered across the stone nave floor far below.
3. **Stained Glass Window Ignition**: 16 pairs of lancet stained-glass windows line the left and right walls. As enemies carrying stolen light are destroyed, the nearest unlit window ignites into saturated jewel tones (**Deep Cobalt Blue**, **Blood Red**, **Emerald Green**, **Amber Gold**) and throws colored light onto the adjacent piers. Restored windows **stay lit for the rest of the run**.
4. **Grand West Rose Window Finale**: At the west end of the nave stands a 14-meter circular traceried rose window. Upon defeating the Rose Archon boss, the Rose Window ignites in a multi-ring kaleidoscope explosion of radiant jewel light, flaring the entire cathedral into full illumination.
5. **Gothic Reticle & Glyphs**: Reticle designed as a gothic rose wheel with quadrant jewel nodes (matching `lockRadiusNdc` of 0.085). Procedural letter glyphs rendered in stone tracery with glowing stained-glass cell fills.

---

## 🎵 Sound & Musical Architecture

1. **Polyphonic Cathedral Pipe Organ**: Pure organ synthesis without drums — the pulse is the counterpoint moving.
   - **Pedal Organ**: Deep 16' sub-pedal pipe drone in D minor.
   - **Tenor & Flue Organ**: Counterpoint lines in organ principal and flue stops.
   - **Choir Swells**: Formant-filtered cathedral vocal choir organ swells.
   - **TUTTI Organ Rank**: Full cathedral Tutti organ with mixture pipes, brass reeds, and cathedral bells — held back until the finale!
2. **D Minor to D Major Picardy Third Modulation**: At Bar 27 (t = 54.0s), the boss dies, the key modulates from D minor to triumphant D Major, and every rank of the organ opens for the finale.
3. **Organ Action Synesthesia**: Player locks, fires, and hits play organ pipe notes pitched to the live harmony. Kills execute melodic runs along 32-step section kill lanes.

---

## ⚔️ Enemy Choreography & Boss Mechanics

1. **Gargoyle Vane** (`gargoyle`): Flat obsidian slate silhouettes with stolen ruby panes burning in their chest.
2. **Archon Shard** (`triforium`): Rotating flat black gothic diamond frames carrying emerald/amber gem cores.
3. **Seraph Panestealer** (`panestealer`): Multi-hit (HP: 2) 4-winged black seraph silhouettes carrying stolen cobalt/crimson wing facets.
4. **Rose Archon Boss** (`rose-boss`): Nested in the dead Rose Window at the west end. Multi-stage HP (HP: 6, stages `[2, 4, 6]`), launching hostile homing glass shard attacks ([steerHomingShot](file:///tmp/pareto-rail-run-v3c8vrhdys/src/engine/hostile-shot.ts#L12) & [updateHostileShotImpact](file:///tmp/pareto-rail-run-v3c8vrhdys/src/engine/hostile-shot.ts#L82)).
5. **Pacing & Spatial Spread**: Utilizes [createRailPacer](file:///tmp/pareto-rail-run-v3c8vrhdys/src/engine/rail-pacer.ts#L48) to guarantee readable engagement windows. Mid-run features a long quiet span with a single solo organ flute voice before the boss entrance.

---

## 📊 Verification & Readiness Gates

All required gates were executed and verified:

```bash
# 1. Typecheck: Passed with 0 errors
npm run typecheck

# 2. Benchmark Scope: Valid (12 paths under assigned benchmark directory)
npm run check:benchmark-scope -- --level vespers-c8vr --base HEAD

# 3. Level Floor Readiness Gate: All floor checks passed!
npm run check:floor -- --level vespers-c8vr

# 4. Run Simulation: Clean execution across all player policies
npm run simulate -- --level vespers-c8vr

# 5. Audio Semantic Trace: 120 steps traced across 4 sections
npm run trace:audio -- --level vespers-c8vr

# 6. Full Project Build: Passed
npm run build
```

> **Note for Human Review**: Since headless WSL environments do not support native WebGPU rendering, final visual contrast (bloom glow on stained glass windows against black stone piers) and Web Audio mix balance should be confirmed during a live browser playtest.
