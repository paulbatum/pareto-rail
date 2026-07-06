export type SpeedKey = readonly [time: number, factor: number];

export type SpeedProfileOptions = {
  samples?: number;
};

export function createSpeedProfile(keys: readonly SpeedKey[], duration: number, options: SpeedProfileOptions = {}) {
  if (keys.length === 0) throw new Error('createSpeedProfile requires at least one speed key');
  const samples = options.samples ?? 1200;
  if (!Number.isFinite(samples) || samples <= 0) throw new Error('createSpeedProfile samples must be positive');

  function speedAt(time: number) {
    const t = clamp(time, 0, duration);
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return lerp(v0, v1, (t - t0) / Math.max(0.0001, t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  }

  const table = [0];
  let sum = 0;
  const dt = duration / samples;
  for (let i = 1; i <= samples; i += 1) {
    const mid = (i - 0.5) * dt;
    sum += speedAt(mid) * dt;
    table.push(sum);
  }
  const total = table[samples];
  const easeTable = table.map((value) => value / total);

  function runProgress(time: number, runDuration = duration) {
    const t = clamp(time / runDuration, 0, 1) * samples;
    const index = Math.min(samples - 1, Math.floor(t));
    return lerp(easeTable[index], easeTable[index + 1], t - index);
  }

  return { speedAt, runProgress };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
