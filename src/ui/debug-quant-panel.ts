import {
  getActionSfxQuantization,
  getShotDelaySettings,
  setActionSfxQuantization,
  setShotDelaySettings,
  type ShotDelayPattern,
} from '../engine/action-sfx-quantization';

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

const REZER_PRESET: TimingPreset = {
  sfxEnabled: true,
  sfxGridThirtyseconds: 1,
  shotGapThirtyseconds: 2,
  releaseShare: 0.75,
  pattern: 'grid-ramp',
  gridRampGapGrowthThirtyseconds: 2,
};

export function installDebugQuantPanel(level: { id: string; bpm: number }) {
  if (!import.meta.env.DEV) return;

  const thirtysecondSeconds = 60 / level.bpm / 8;
  const panel = document.createElement('details');
  panel.className = 'debug-quant-panel';
  panel.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'Timing';
  panel.append(summary);

  const body = document.createElement('div');
  body.className = 'debug-quant-panel-body';
  panel.append(body);

  const presets = document.createElement('div');
  presets.className = 'debug-quant-presets';
  const rezerButton = button('Default');
  const linearButton = button('Linear');
  const oldButton = button('Old');
  presets.append(rezerButton, linearButton, oldButton);

  const patternText = document.createElement('div');
  patternText.className = 'debug-quant-readout';

  const { label: gridLabel, text: gridText, input: gridInput } = range('0', `${GRID_OPTIONS.length - 1}`, '1');
  const { label: gapLabel, text: gapText, input: gapInput } = range('0', '8', '1');
  const { label: splitLabel, text: splitText, input: splitInput } = range('0', '100', '5');
  const { label: growthLabel, text: growthText, input: growthInput } = range('0', '4', '1');

  const help = document.createElement('p');
  help.textContent = 'Default uses per-shot grid sizes: 32nd, 16th, 8th, quarter, half, bar. Disabled sliders do not affect the active preset.';

  body.append(presets, patternText, gridLabel, gapLabel, splitLabel, growthLabel, help);
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

  rezerButton.addEventListener('click', () => applyPreset(REZER_PRESET));
  linearButton.addEventListener('click', () => applyPreset(LINEAR_PRESET));
  oldButton.addEventListener('click', () => applyPreset(OLD_PRESET));
  gridInput.addEventListener('input', apply);
  gapInput.addEventListener('input', apply);
  splitInput.addEventListener('input', apply);
  growthInput.addEventListener('input', apply);
  initializeFromStore();
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
  label.classList.toggle('debug-quant-disabled', disabled);
  input.disabled = disabled;
}

function labelForPattern(pattern: ShotDelayPattern) {
  if (pattern === 'linear') return 'Shot rhythm: linear';
  return 'Shot rhythm: default grid ramp (32nd, 16th, 8th, quarter, half, bar)';
}

function optionIndexFor(enabled: boolean, gridThirtyseconds: number) {
  if (!enabled) return 0;
  const index = GRID_OPTIONS.findIndex((option) => option.enabled && option.gridThirtyseconds === gridThirtyseconds);
  return index === -1 ? 3 : index;
}
