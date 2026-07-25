import { thermalInkDensityAt } from './timing';

type ThermalState = {
  infrared: boolean;
  inkDensity: number;
  runTime: number;
  running: boolean;
  switchPulse: number;
};

const state: ThermalState = {
  infrared: false,
  inkDensity: 0,
  runTime: 0,
  running: false,
  switchPulse: 0,
};

export function resetThermalState() {
  state.infrared = false;
  state.inkDensity = 0;
  state.runTime = 0;
  state.running = false;
  state.switchPulse = 0;
}

export function updateThermalState(dt: number, runTime: number, running: boolean) {
  state.running = running;
  state.runTime = runTime;
  const targetInk = running ? thermalInkDensityAt(runTime) : 0;
  const response = 1 - Math.exp(-dt * (targetInk > state.inkDensity ? 4.8 : 2.6));
  state.inkDensity += (targetInk - state.inkDensity) * response;
  state.switchPulse = Math.max(0, state.switchPulse - dt * 2.8);
}

export function setInfrared(enabled: boolean) {
  if (state.infrared === enabled) return false;
  state.infrared = enabled;
  state.switchPulse = 1;
  return true;
}

export function toggleInfrared() {
  setInfrared(!state.infrared);
  return state.infrared;
}

export function thermalState() {
  return state as Readonly<ThermalState>;
}

