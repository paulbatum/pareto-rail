import { Color } from 'three';

export const MAX_LOCKS = 6;

export const DEFAULT_LOCK_GRADIENT = [
  new Color(0.28, 0.92, 1.0),
  new Color(1.0, 0.25, 0.86),
  new Color(1.0, 0.72, 0.24),
] as const;

export function colorForLockCount(
  lockCount: number,
  palette: readonly Color[] = DEFAULT_LOCK_GRADIENT,
  maxLocks = MAX_LOCKS,
) {
  if (palette.length === 0) return new Color(1, 1, 1);
  if (palette.length === 1 || maxLocks <= 1) return palette[0].clone();

  const t = clamp01((lockCount - 1) / (maxLocks - 1));
  const scaled = t * (palette.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(palette.length - 1, lower + 1);
  return palette[lower].clone().lerp(palette[upper], scaled - lower);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
