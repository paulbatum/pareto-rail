Skyhook is built at `src/benchmark-levels/skyhook-e34d/`, and `docs/level-gallery.md` is regenerated. Typecheck, build, and `check:floor` all pass. I haven't played it: WebGPU doesn't render headless here, so what it looks like on real hardware and how it sounds still need a human run-through. Nothing is committed.

**The level:** 128 BPM, 33 bars, about 62 s of play.
- **Camera:** it rides the climber looking up the tether, so the ribbon rises from the car's drive head (bottom of frame) to a vanishing point where the station waits.
- **The climb:** a rain-lashed launch pad with orange-and-white gantries falling away, a lightning storm, a whiteout punch through the cloud deck on the bar-8 downbeat, then sunlit blue over a cloud sea, indigo, and finally black with stars above and the planet's limb curving below. Everything is lit by the same sky-driven light.
- **Enemies:**
  - Kites: wind-riders that fly banking flocks along set paths.
  - Grapplers: dive at the car with a violet warning line and a proximity alarm, then bite.
  - Ticks: two-stage armor, crawl down the ribbon on the beat.
  - Sentinels: rise past the car and fire bolts you can shoot down.
- **Hull:** 5 points, shared by the car and the gunner.
- **Boss (the Descender):** latches on at bar 20 and climbs down one grip per beat, visibly getting bigger. Each of its four claws you shoot makes it slip back. The maw opens once the claws are gone (or at bar 26), and at bar 28¾ it lunges. If it reaches the car, the drive head bursts and the run ends. If you kill it, the husk tumbles away, the car sprints for the station, the approach lights chase, the iris opens, and the bay clamps go green: "DOCKED · 35,786 KM".
- **Score:** it follows the air. Wide, wet storm (pads, rain plucked from the chord, thunder on the same beats as the lightning), then a full band in the sunlight, dropping layers as the sky darkens. In vacuum it's a sub pulse, a thin drone, and the Descender's grip clanking down the tether as the only drum. The dock resolves to D major.
- **Your sounds are in the music:** locks climb the chord, kills walk a written melody, and your sounds get drier as the air thins until they're just dry tones and a hull thump.

**What I checked:**
- **Simulator:** the no-fire policy dies at 31 s. The perfect and imperfect policies both survive to the dock at rank B.
- **Floor gate:** zero occlusion warnings, performance within budget, spread and distance fine.
- **Screenshots:** from the snapshot tool plus a throwaway auto-play harness in the ignored `tmp/` folder, which is how I saw locks, shots, and kill effects.
- **Audio:** I metered the score bar by bar in headless Chrome. That found and fixed two real bugs: NaN pitches in the rain pattern and clipping in the boss finale. It now runs with no errors and peaks under 0 dBFS.

**Things to know:**
- **`check:scope` can't pass as written.** The script only knows `src/levels/<id>/`, so it lists every file in the assigned benchmark directory as out of scope. There's also no local `main` branch, so it needs `HEAD` as the base. Nothing outside the level directory changed except the gallery.
- **The level controls the camera's tilt** through its camera hook, keeping the player's edge-look on top. It also raises the camera's far plane to 4000 while loaded and restores it on exit.
- **After the Descender dies there's no more spawning** until the end, the "last stretch is clear" the theme asks for. The simulator reports it as a spawn gap from about 50–53 s to the end.

**What a playtester should check first:**
1. The overall mix. The deck-punch whoosh, the Descender's clanks getting louder, and the final chord matter most.
2. Whether the cloud-deck whiteout (bars 7.5–8) is too bright with bloom on.
3. Whether grappler bites feel fair, since the car and gunner share one hull.
4. That the boss clearly grows and reads as distinct in front of the station.

`?skyhookDebug=skip-descender` previews the dock without the boss.