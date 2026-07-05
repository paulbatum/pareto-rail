import { quantizeToGrid } from './music';

export type ActionSfxQuantizationSettings = {
  enabled: boolean;
  /** Grid size measured in 32nd notes. */
  gridThirtyseconds: number;
};

const DEFAULT_GRID_THIRTYSECONDS = 1; // 32nd note

const settings: ActionSfxQuantizationSettings = {
  enabled: true,
  gridThirtyseconds: DEFAULT_GRID_THIRTYSECONDS,
};

export function getActionSfxQuantization() {
  return { ...settings };
}

export function setActionSfxQuantization(next: Partial<ActionSfxQuantizationSettings>) {
  if (next.enabled !== undefined) settings.enabled = next.enabled;
  if (next.gridThirtyseconds !== undefined) settings.gridThirtyseconds = Math.max(1, Math.round(next.gridThirtyseconds));
}

export function quantizeActionSfxTime(time: number, thirtysecondSeconds: number) {
  if (!settings.enabled) return time;
  const gridSeconds = thirtysecondSeconds * settings.gridThirtyseconds;
  return quantizeToGrid(time, gridSeconds);
}
