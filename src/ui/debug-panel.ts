import {
  getActionSfxQuantization,
  getShotDelaySettings,
  setActionSfxQuantization,
  setShotDelaySettings,
  type ShotDelayPattern,
} from '../engine/action-sfx-quantization';
import {
  defaultPlayerCameraSettings,
  getPlayerCameraSettings,
  setPlayerCameraSettings,
} from '../engine/player-camera';
import type { LevelDebugSelector } from '../engine/types';

const CAMERA_EDGE_LOOK_KEY = 'pareto-rail-debug-camera-edge-look-degrees';
const CAMERA_EDGE_ROLL_KEY = 'pareto-rail-debug-camera-edge-roll-degrees';
const CAMERA_EDGE_DEAD_ZONE_KEY = 'pareto-rail-debug-camera-edge-dead-zone';

const GRID_OPTIONS = [
  { label: 'Immediate', enabled: false, gridThirtyseconds: 4 },
  { label: '32nd note', enabled: true, gridThirtyseconds: 1 },
  { label: '16th note', enabled: true, gridThirtyseconds: 2 },
  { label: '8th note', enabled: true, gridThirtyseconds: 4 },
  { label: 'Quarter note', enabled: true, gridThirtyseconds: 8 },
  { label: 'Half note', enabled: true, gridThirtyseconds: 16 },
  { label: 'Bar', enabled: true, gridThirtyseconds: 32 },
] as const;

type TimingPreset = {
  sfxEnabled: boolean;
  sfxGridThirtyseconds: number;
  shotGapThirtyseconds: number;
  releaseShare: number;
  pattern: ShotDelayPattern;
  gridRampGapGrowthThirtyseconds: number;
};

type DebugPanelLevel = {
  id: string;
  bpm: number;
  debugSelector?: LevelDebugSelector;
  urlParams?: URLSearchParams;
  /** Mounts the perf readout at the top of the panel body instead of leaving it floating. */
  mountPerfReadout?: (host: HTMLElement) => void;
};

const OLD_PRESET: TimingPreset = {
  sfxEnabled: true,
  sfxGridThirtyseconds: 1,
  shotGapThirtyseconds: 1,
  releaseShare: 1,
  pattern: 'linear',
  gridRampGapGrowthThirtyseconds: 0,
};

const LINEAR_PRESET: TimingPreset = {
  sfxEnabled: true,
  sfxGridThirtyseconds: 1,
  shotGapThirtyseconds: 2,
  releaseShare: 0.35,
  pattern: 'linear',
  gridRampGapGrowthThirtyseconds: 0,
};

const DEFAULT_PRESET: TimingPreset = {
  sfxEnabled: true,
  sfxGridThirtyseconds: 1,
  shotGapThirtyseconds: 2,
  releaseShare: 0.75,
  pattern: 'grid-ramp',
  gridRampGapGrowthThirtyseconds: 2,
};

export function installDebugPanel(level: DebugPanelLevel) {
  if (!import.meta.env.DEV) return undefined;

  const thirtysecondSeconds = 60 / level.bpm / 8;
  /* The perf readout sits outside the <details> so it stays visible while the panel is collapsed. */
  const panel = document.createElement('div');
  panel.className = 'debug-panel';
  level.mountPerfReadout?.(panel);

  const details = document.createElement('details');
  details.className = 'debug-panel-details';
  details.open = false;
  panel.append(details);

  const summary = document.createElement('summary');
  summary.textContent = 'Debug';
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'debug-panel-body';
  details.append(body);

  const levelReadout = document.createElement('div');
  levelReadout.className = 'debug-panel-readout';
  levelReadout.textContent = `Level: ${level.id}`;
  body.append(levelReadout);

  if (level.debugSelector) body.append(createDebugModeSection(level, level.debugSelector));
  body.append(createCameraSection());

  const timingSection = document.createElement('section');
  timingSection.className = 'debug-panel-section';
  const timingHeading = document.createElement('h3');
  timingHeading.textContent = 'Timing';
  timingSection.append(timingHeading);

  const presets = document.createElement('div');
  presets.className = 'debug-panel-presets';
  const defaultButton = button('Default');
  const linearButton = button('Linear');
  const oldButton = button('Old');
  presets.append(defaultButton, linearButton, oldButton);

  const patternText = document.createElement('div');
  patternText.className = 'debug-panel-readout';

  const { label: gridLabel, text: gridText, input: gridInput } = range('0', `${GRID_OPTIONS.length - 1}`, '1');
  const { label: gapLabel, text: gapText, input: gapInput } = range('0', '8', '1');
  const { label: splitLabel, text: splitText, input: splitInput } = range('0', '100', '5');
  const { label: growthLabel, text: growthText, input: growthInput } = range('0', '4', '1');

  const help = document.createElement('p');
  help.textContent = 'Default doubles the shot grid per shot and adapts to the level tempo so no grid period exceeds about 1.9s. Disabled sliders do not affect the active preset.';

  timingSection.append(presets, patternText, gridLabel, gapLabel, splitLabel, growthLabel, help);
  body.append(timingSection);
  document.body.append(panel);

  let activePattern: ShotDelayPattern = 'linear';

  function render() {
    const option = GRID_OPTIONS[Number(gridInput.value)] ?? GRID_OPTIONS[0];
    const shotGapThirtyseconds = Number(gapInput.value);
    const releaseShare = Number(splitInput.value) / 100;
    const growthThirtyseconds = Number(growthInput.value);
    gridText.textContent = `SFX snap grid: ${option.label}`;
    gapText.textContent = shotGapThirtyseconds === 0
      ? 'Shot delay unit: off'
      : `Shot delay unit: ${shotGapThirtyseconds} × 32nd (${Math.round(shotGapThirtyseconds * thirtysecondSeconds * 1000)}ms)`;
    splitText.textContent = `Delay split: release ${Math.round(releaseShare * 100)}% / travel ${Math.round((1 - releaseShare) * 100)}%`;
    growthText.textContent = `Grid-ramp gap growth: ${growthThirtyseconds} × 32nd (${Math.round(growthThirtyseconds * thirtysecondSeconds * 1000)}ms)`;
    setDisabled(gapLabel, gapInput, activePattern === 'grid-ramp');
    setDisabled(growthLabel, growthInput, activePattern !== 'grid-ramp');
    patternText.textContent = labelForPattern(activePattern);
  }

  function apply() {
    const option = GRID_OPTIONS[Number(gridInput.value)] ?? GRID_OPTIONS[0];
    setActionSfxQuantization({
      enabled: option.enabled,
      gridThirtyseconds: option.gridThirtyseconds,
    });
    setShotDelaySettings({
      gapThirtyseconds: Number(gapInput.value),
      releaseShare: Number(splitInput.value) / 100,
      pattern: activePattern,
      gridRampGapGrowthThirtyseconds: Number(growthInput.value),
    });
    render();
  }

  function applyPreset(preset: TimingPreset) {
    activePattern = preset.pattern;
    gridInput.value = `${optionIndexFor(preset.sfxEnabled, preset.sfxGridThirtyseconds)}`;
    gapInput.value = `${preset.shotGapThirtyseconds}`;
    splitInput.value = `${Math.round(preset.releaseShare * 100)}`;
    growthInput.value = `${preset.gridRampGapGrowthThirtyseconds}`;
    apply();
  }

  function initializeFromStore() {
    const shotDelay = getShotDelaySettings();
    const sfx = getActionSfxQuantization();
    activePattern = shotDelay.pattern;
    gridInput.value = `${optionIndexFor(sfx.enabled, sfx.gridThirtyseconds)}`;
    gapInput.value = `${shotDelay.gapThirtyseconds}`;
    splitInput.value = `${Math.round(shotDelay.releaseShare * 100)}`;
    growthInput.value = `${shotDelay.gridRampGapGrowthThirtyseconds}`;
    render();
  }

  defaultButton.addEventListener('click', () => applyPreset(DEFAULT_PRESET));
  linearButton.addEventListener('click', () => applyPreset(LINEAR_PRESET));
  oldButton.addEventListener('click', () => applyPreset(OLD_PRESET));
  gridInput.addEventListener('input', apply);
  gapInput.addEventListener('input', apply);
  splitInput.addEventListener('input', apply);
  growthInput.addEventListener('input', apply);
  initializeFromStore();
  return { dispose: () => panel.remove() };
}

function createCameraSection() {
  const defaults = defaultPlayerCameraSettings();
  setPlayerCameraSettings({
    edgeLookDegrees: readStoredNumber(CAMERA_EDGE_LOOK_KEY, defaults.edgeLookDegrees),
    edgeRollDegrees: readStoredNumber(CAMERA_EDGE_ROLL_KEY, defaults.edgeRollDegrees),
    edgeDeadZone: readStoredNumber(CAMERA_EDGE_DEAD_ZONE_KEY, defaults.edgeDeadZone),
  });

  const section = document.createElement('section');
  section.className = 'debug-panel-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Camera';

  const { label: lookLabel, text: lookText, input: lookInput } = range('0', '16', '0.5');
  const { label: rollLabel, text: rollText, input: rollInput } = range('0', '10', '0.5');
  const { label: deadZoneLabel, text: deadZoneText, input: deadZoneInput } = range('0', '50', '1');
  const resetButton = button('Reset');
  const help = document.createElement('p');
  help.textContent = 'Edge look turns the camera toward the cursor near screen edges, widening the practical lock-on area. Edge roll is cosmetic bank.';

  const settings = getPlayerCameraSettings();
  lookInput.value = `${settings.edgeLookDegrees}`;
  rollInput.value = `${settings.edgeRollDegrees}`;
  deadZoneInput.value = `${Math.round(settings.edgeDeadZone * 100)}`;

  function render() {
    lookText.textContent = `Edge look: ${formatDegrees(Number(lookInput.value))}° max`;
    rollText.textContent = `Edge roll: ${formatDegrees(Number(rollInput.value))}° max`;
    deadZoneText.textContent = `Deadzone: ${Number(deadZoneInput.value)}% from center`;
  }

  function apply() {
    const edgeLookDegrees = Number(lookInput.value);
    const edgeRollDegrees = Number(rollInput.value);
    const edgeDeadZone = Number(deadZoneInput.value) / 100;
    setPlayerCameraSettings({ edgeLookDegrees, edgeRollDegrees, edgeDeadZone });
    localStorage.setItem(CAMERA_EDGE_LOOK_KEY, `${edgeLookDegrees}`);
    localStorage.setItem(CAMERA_EDGE_ROLL_KEY, `${edgeRollDegrees}`);
    localStorage.setItem(CAMERA_EDGE_DEAD_ZONE_KEY, `${edgeDeadZone}`);
    render();
  }

  resetButton.addEventListener('click', () => {
    lookInput.value = `${defaults.edgeLookDegrees}`;
    rollInput.value = `${defaults.edgeRollDegrees}`;
    deadZoneInput.value = `${Math.round(defaults.edgeDeadZone * 100)}`;
    apply();
  });
  lookInput.addEventListener('input', apply);
  rollInput.addEventListener('input', apply);
  deadZoneInput.addEventListener('input', apply);
  render();

  section.append(heading, lookLabel, rollLabel, deadZoneLabel, resetButton, help);
  return section;
}

function createDebugModeSection(level: DebugPanelLevel, selector: LevelDebugSelector) {
  const params = level.urlParams ?? new URLSearchParams(window.location.search);
  const section = document.createElement('section');
  section.className = 'debug-panel-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Debug mode';

  const modeLabel = document.createElement('label');
  modeLabel.className = 'debug-panel-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = params.has(selector.queryParam);
  const modeText = document.createElement('span');
  modeText.textContent = 'Debug mode';
  modeLabel.append(checkbox, modeText);

  const selectLabel = document.createElement('label');
  selectLabel.className = 'debug-panel-field';
  const selectText = document.createElement('span');
  selectText.textContent = selector.label;
  const select = document.createElement('select');
  const storedValue = readStoredDebugValue(level.id, selector);
  const activeValue = validOptionId(selector, params.get(selector.queryParam))
    ?? storedValue
    ?? selector.options[0]?.id
    ?? '';
  for (const optionDefinition of selector.options) {
    const option = document.createElement('option');
    option.value = optionDefinition.id;
    option.textContent = optionDefinition.title;
    option.selected = optionDefinition.id === activeValue;
    select.append(option);
  }
  select.value = activeValue;
  selectLabel.append(selectText, select);
  selectLabel.hidden = !checkbox.checked;

  checkbox.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('level', level.id);
    if (checkbox.checked) {
      const nextValue = validOptionId(selector, readStoredDebugValue(level.id, selector))
        ?? selector.options[0]?.id;
      if (nextValue) {
        storeDebugValue(level.id, selector, nextValue);
        url.searchParams.set(selector.queryParam, nextValue);
      }
    } else {
      storeDebugValue(level.id, selector, select.value);
      url.searchParams.delete(selector.queryParam);
    }
    window.location.href = url.toString();
  });

  select.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('level', level.id);
    url.searchParams.set(selector.queryParam, select.value);
    storeDebugValue(level.id, selector, select.value);
    window.location.href = url.toString();
  });

  section.append(heading, modeLabel, selectLabel);
  return section;
}

function button(text: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  return element;
}

function range(min: string, max: string, step: string) {
  const label = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  label.append(text, input);
  return { label, text, input };
}

function setDisabled(label: HTMLLabelElement, input: HTMLInputElement, disabled: boolean) {
  label.classList.toggle('debug-panel-disabled', disabled);
  input.disabled = disabled;
}

function labelForPattern(pattern: ShotDelayPattern) {
  if (pattern === 'linear') return 'Shot rhythm: linear';
  return 'Shot rhythm: default tempo-adaptive grid ramp (doubles per shot, capped near 1.9s)';
}

function formatDegrees(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function readStoredNumber(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function optionIndexFor(enabled: boolean, gridThirtyseconds: number) {
  if (!enabled) return 0;
  const index = GRID_OPTIONS.findIndex((option) => option.enabled && option.gridThirtyseconds === gridThirtyseconds);
  return index === -1 ? 3 : index;
}

function validOptionId(selector: LevelDebugSelector, value: string | null | undefined) {
  return selector.options.find((option) => option.id === value)?.id;
}

function debugStorageKey(levelId: string, selector: LevelDebugSelector) {
  return `pareto-rail-debug-${levelId}-${selector.queryParam}`;
}

function readStoredDebugValue(levelId: string, selector: LevelDebugSelector) {
  return validOptionId(selector, localStorage.getItem(debugStorageKey(levelId, selector)));
}

function storeDebugValue(levelId: string, selector: LevelDebugSelector, value: string) {
  if (validOptionId(selector, value)) localStorage.setItem(debugStorageKey(levelId, selector), value);
}
