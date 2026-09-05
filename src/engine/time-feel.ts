/**
 * Hit-stop and slow motion for the gameplay clock.
 *
 * The level owns the split between real time and game time. Each frame it
 * passes the real `dt` through `scaleDt` and hands the result to the runner:
 *
 *   game.update(feel.scaleDt(dt));
 *   updateVisuals(dt);   // visuals and audio keep the real dt
 *
 * The runner's own clock (`worldTime` in lock-on-runner.ts) advances by the dt
 * it receives, and every planned fire and impact is a `worldTime` appointment.
 * The music transport runs on the AudioContext clock, which never pauses. So
 * every second of game time removed by a freeze lands every later shot that
 * many seconds late against the beat. A projectile already in flight re-solves
 * its speed each frame from the remaining `worldTime`, so it still arrives on
 * its appointment in game time; only the alignment to the music slips.
 *
 * `hitStop` therefore clamps its duration to `HIT_STOP_MAX_SECONDS` (80 ms).
 * At 140 bpm a sixteenth note is 107 ms, so a single full freeze keeps the next
 * quantized shot inside the step it was aimed at. `slowMo` has no clamp: a
 * level that slows time for a second accepts that shots fired during that
 * second drift off the grid by up to the removed time.
 */

export type TimeFeel = {
  /**
   * Run game time at `scale` for `seconds` of real time. `seconds` is clamped to
   * `HIT_STOP_MAX_SECONDS`. A hit-stop requested during another hit-stop keeps
   * the longer remaining time rather than adding to it, so a volley of kills
   * cannot stack past the ceiling.
   */
  hitStop(seconds: number, scale?: number): void;
  /**
   * Run game time at `scale` for `seconds` of real time, replacing any slow
   * motion already running.
   */
  slowMo(seconds: number, scale: number): void;
  /**
   * Advance the real-time timers by `dt` and return the game-time dt for this
   * frame. Call once per frame.
   */
  scaleDt(dt: number): number;
  /** Game seconds per real second over the most recent `scaleDt` frame. 1 when nothing is active. */
  readonly scale: number;
  /** Whether a hit-stop or slow motion is still running. */
  readonly active: boolean;
  /** Cancel every running effect. Call on run start and run end. */
  reset(): void;
};

export const HIT_STOP_MAX_SECONDS = 0.08;

export function createTimeFeel(): TimeFeel {
  let hitStopRemaining = 0;
  let hitStopScale = 0;
  let slowMoRemaining = 0;
  let slowMoScale = 1;
  let currentScale = 1;

  function hitStop(seconds: number, scale = 0) {
    const duration = Math.min(HIT_STOP_MAX_SECONDS, finiteOr(seconds, 0));
    if (duration <= 0) return;
    if (duration >= hitStopRemaining) {
      hitStopRemaining = duration;
      hitStopScale = clampScale(scale);
    }
  }

  function slowMo(seconds: number, scale: number) {
    const duration = finiteOr(seconds, 0);
    if (duration <= 0) return;
    slowMoRemaining = duration;
    slowMoScale = clampScale(scale);
  }

  // Integrate the scale across the frame: the scale is piecewise constant with
  // steps where the hit-stop and the slow motion end, so a frame that outlives
  // an effect runs at full speed for the remainder instead of a whole extra frame.
  function scaleDt(dt: number) {
    const realDt = Math.max(0, finiteOr(dt, 0));
    const cuts = [0, Math.min(hitStopRemaining, realDt), Math.min(slowMoRemaining, realDt), realDt].sort((a, b) => a - b);
    let gameDt = 0;
    for (let i = 0; i < cuts.length - 1; i += 1) {
      const span = cuts[i + 1] - cuts[i];
      if (span <= 0) continue;
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      let scale = 1;
      if (mid < slowMoRemaining) scale = slowMoScale;
      // A freeze always wins over slow motion for the time it covers.
      if (mid < hitStopRemaining) scale = Math.min(scale, hitStopScale);
      gameDt += span * scale;
    }
    hitStopRemaining = Math.max(0, hitStopRemaining - realDt);
    slowMoRemaining = Math.max(0, slowMoRemaining - realDt);
    currentScale = realDt > 0 ? gameDt / realDt : 1;
    return gameDt;
  }

  function reset() {
    hitStopRemaining = 0;
    slowMoRemaining = 0;
    currentScale = 1;
  }

  return {
    hitStop,
    slowMo,
    scaleDt,
    reset,
    get scale() {
      return currentScale;
    },
    get active() {
      return hitStopRemaining > 0 || slowMoRemaining > 0;
    },
  };
}

function clampScale(scale: number) {
  const value = finiteOr(scale, 0);
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function finiteOr(value: number | undefined, fallback: number) {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}
