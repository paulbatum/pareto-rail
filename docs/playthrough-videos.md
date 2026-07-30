# Playthrough videos

Records a promotional video of a level: the real game, in a real browser, played from
start to finish by an autoplay policy, with its procedural soundtrack on the audio track.

**This is a promotional capture tool, not part of level building or benchmarking.** No
level needs a video, nothing here feeds scoring, ranking, or review, and an agent
building or reviewing a level should never run it. For inspecting a level's visuals
while working on it, use the snapshot tools in `docs/visual-tools.md` instead.

## Requirements

Recording drives a GPU browser on the Windows side, the same setup the snapshot tools
need — see the requirements in `docs/visual-tools.md`. It also needs `ffmpeg` on the path.

The recorder serves the production build and rebuilds automatically when `dist/` is
missing. Pass `--build` to force a rebuild after changing the game.

## Recording

```sh
npm run capture:playthrough -- --level crystal-corridor
npm run capture:playthrough -- --level <id> --resolution 1080p
npm run capture:playthrough -- --level <id> --dry-run     # play and report, write nothing
npm run capture:playthrough -- --help
```

Videos are written to `F:\Recordings\Pareto Rail` when that drive is mounted and to
`tmp/` otherwise; `--out` overrides both. Files are named
`<level_id>_playthrough_<yyyymmdd_hhmmss>_<resolution>.mp4`, with the policy in the name
when it is not the default, so takes accumulate instead of overwriting each other.
Intermediate video and audio always stay on the Linux filesystem, because
writing them across the Windows mount is roughly fifteen times slower and a real-time
capture cannot afford a slow write path.

The tool launches the browser, plays the level, stops at the end card, joins the audio,
and shuts the browser down. It reports the frame count, any dropped frames, and the
run's score and rank.

## How it plays

The default `volley` policy plays for the lock-on mechanic. It slides the sight to the
nearest unlocked target from wherever the sight already is, banking locks until it holds
a full six, and only then releases. The movement is speed-limited rather than
instantaneous, so it reads as a hand crossing the screen and picks up whatever it passes.
This suits both scoring, since kills in a full volley pay a large multiplier, and
footage, since enemies stay on screen long enough to be seen.

Three knobs shape it: `--speed` (how fast the sight travels), `--max-hold` (how long it
will sit on a partial volley before firing anyway), and `--grace` (how long it waits for
another target before releasing what it has). Faster and more patient settings produce
bigger volleys; slower and twitchier ones produce more constant fire.

The simulator's two reference styles are also available through `--policy perfect` and
`--policy imperfect`, for comparison footage. They are the styles `npm run simulate`
uses; they aim for kills rather than for large volleys and make less of the mechanic.

The player survives the run by default so a recording cannot be cut short; pass
`--mortal` for an honest run.

## Frames and audio

Frames are taken directly from the game's draw loop, because the browser's compositor
commits far fewer frames than the game renders — around 45 a second at 1080p on the
reference machine, against a solid 60 from the draw loop. `--frames compositor` selects
the compositor as the source instead, which is close to 60 at 720p and well short of it
at 1080p; it exists as a fallback and a comparison, not as a recommendation.

Video is encoded on the GPU's hardware H.264 encoder as the run happens, and streamed to
disk rather than held in memory. The soundtrack is captured by tapping the audio graph,
which is left unconnected from the speakers, so recording is silent on the machine doing
it.

Two consequences of capturing the canvas: the score, hull, and other interface elements
are drawn as page overlays and do **not** appear in the video, and the recorder puts the
game into its own fullscreen mode so the frame is exactly 16:9 rather than inset by the
site navigation.

## What is not guaranteed

Recordings are not reproducible frame for frame. The game runs in real time and its frame
timing varies slightly between takes, so the same level, policy, and seed will give a
similar but not identical run, and scores move by a few hundred points between takes. If
an exactly repeatable recording is ever needed, that would require driving the game on a
fixed timestep rather than in real time.
