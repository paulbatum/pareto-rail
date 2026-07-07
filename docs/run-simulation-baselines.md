# Headless run simulation baselines

Generated with `npm run simulate -- --level <id>` at seed 1 and `dt=1/60` after adding the headless runner tools.

## Crystal Corridor

- Duration: 45.0s at 126 BPM.
- None: 0/67 counted kills, 54 counted misses, rank `—`, died at 28.60s; pressure peak 14; no long spawn-free gaps.
- Perfect: 63/67 counted kills, 4 counted misses, score 8562, rank A; pressure peak 12; no long spawn-free gaps.
- Imperfect: 60/67 counted kills, 7 counted misses, score 8149, rank A; pressure peak 11; no long spawn-free gaps.
- Forced reject: reject observed; died at 39.10s.
- Coverage note: `stage` did not fire in this suite.

## Helios

- Duration: 120.0s at 172 BPM.
- None: 0/125 counted kills, 121 counted misses, rank `—`, died at 91.33s; pressure peak 13; long gap around 78.5–85.0s.
- Perfect: 118/125 counted kills, 7 counted misses, score 22147, rank A; pressure peak 10; long gap around 77.0–85.0s.
- Imperfect: 117/125 counted kills, 8 counted misses, score 26578, rank S; pressure peak 8; long gaps around 78.0–85.0s and 102.5–119.5s.
- Forced reject: reject observed; died at 91.37s.
- Coverage note: all tracked event types fired. `check:floor` intentionally reports Helios as over the 30–90s floor at 120s.

## Prism Bloom

- Duration: 30.0s at 96 BPM.
- None: 0/41 kills, 41 misses, score 0, rank D; pressure peak 10; no long spawn-free gaps.
- Perfect: 41/41 kills, 0 misses, score 4901, rank S; pressure peak 5; no long spawn-free gaps.
- Imperfect: 38/41 kills, 3 misses, score 4914, rank S; pressure peak 8; no long spawn-free gaps.
- Forced reject: reject observed; 0/41 kills, 41 misses.
- Coverage note: `stage` and `playerhit` did not fire in this suite.

## Rezdle

- Duration: 60.0s at 84 BPM.
- None: 0/51 kills, 51 misses, score 0, rank D; pressure peak 17; no long spawn-free gaps.
- Perfect: 0/51 kills, 51 misses, score 0, rank D; pressure peak 18; no long spawn-free gaps.
- Imperfect: 0/51 kills, 51 misses, score 0, rank D; pressure peak 17; no long spawn-free gaps.
- Forced reject: reject observed; 0/51 kills, 51 misses.
- Coverage note: the generic lock policies do not form valid words, so `fire`, `hit`, `kill`, and `volley` did not fire.
