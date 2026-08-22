All gates pass. The level is complete — final summary:

## `broadside-7hin` — Broadside: done

**Root cause of the stuck boss fight (found & fixed):** the `runstart` handler reset `armed = false` (so boss spawns were ignored all run) and cleared `conduitEntries`, so killing all generators never fired `dropShields`. Also, every capital ship's placement time had been authored in bars but interpreted as seconds — the flagship sat mid-run instead of at the finale. Both fixed.

**Other fixes this session**
- Geometry-leak perf gate: enemy records now dispose meshes/materials on kill/miss; lock brackets share one ring geometry + cached materials (`visuals/index.ts`)
- Occlusion (14 warnings → 0): pulled gap-canyon ships out to ±31/∓32, moved the broadside cruiser to right +19, kept broadside opposition on the open left, bunched escort waves into the shields-down moment with short leads, and trimmed the trench to hug the dive (54.8–59.45s); dropped a stray bar-28.75 dart wave that flew into the trench approach
- Rank gates tightened: GRAND ADMIRAL now requires score ≥ 14000, ≥ 95% clear, and no damage
- Wrote `level.md` identity card, generated the three content images (hero = generator fight at 48.8s), wired `contentImages` in `level.json`, regenerated the gallery

**Final verification**
| Gate | Result |
|---|---|
| `npm run typecheck` / `build` | ✓ |
| Simulate — perfect | **109/109 kills, 15953 pts, GRAND ADMIRAL**, 0 impossible moments |
| Simulate — imperfect (seed 1) | 103/109, VICE ADMIRAL (clean rank separation) |
| Simulate — none | survives 60s, 3 player hits |
| Occlusion | 0 warnings |
| Performance gates | all 9 ✓ (geometry growth 2.0× vs 512 allowance) |
| Audio config / trace | 0 failures; 1026 events, cannon salvos, heartbeat, finale fanfare |
| Benchmark scope | valid (10 paths) |
| `check:floor` | **All floor checks passed** |

Directory contains only `src/benchmark-levels/broadside-7hin/` (+ its `public/level-content/broadside-7hin/` images); `src/levels/index.ts` untouched. Remaining human step: a real WebGPU playtest for final visual/audio polish.