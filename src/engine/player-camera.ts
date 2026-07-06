export type PlayerCameraSettings = {
  edgeLookDegrees: number;
  edgeRollDegrees: number;
  edgeDeadZone: number;
};

const DEFAULT_SETTINGS: PlayerCameraSettings = {
  edgeLookDegrees: 5,
  edgeRollDegrees: 5,
  edgeDeadZone: 0.5,
};

let settings: PlayerCameraSettings = { ...DEFAULT_SETTINGS };

export function getPlayerCameraSettings(): PlayerCameraSettings {
  return { ...settings };
}

export function setPlayerCameraSettings(next: Partial<PlayerCameraSettings>) {
  settings = {
    edgeLookDegrees: clampFinite(next.edgeLookDegrees ?? settings.edgeLookDegrees, 0, 16),
    edgeRollDegrees: clampFinite(next.edgeRollDegrees ?? settings.edgeRollDegrees, 0, 10),
    edgeDeadZone: clampFinite(next.edgeDeadZone ?? settings.edgeDeadZone, 0, 0.5),
  };
}

export function defaultPlayerCameraSettings(): PlayerCameraSettings {
  return { ...DEFAULT_SETTINGS };
}

function clampFinite(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
