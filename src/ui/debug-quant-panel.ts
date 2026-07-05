import { getActionSfxQuantization, setActionSfxQuantization } from '../engine/action-sfx-quantization';

const GRID_OPTIONS = [
  { label: 'Immediate', enabled: false, gridThirtyseconds: 4 },
  { label: '32nd note', enabled: true, gridThirtyseconds: 1 },
  { label: '16th note', enabled: true, gridThirtyseconds: 2 },
  { label: '8th note', enabled: true, gridThirtyseconds: 4 },
  { label: 'Quarter note', enabled: true, gridThirtyseconds: 8 },
  { label: 'Half note', enabled: true, gridThirtyseconds: 16 },
  { label: 'Bar', enabled: true, gridThirtyseconds: 32 },
] as const;

export function installDebugQuantPanel(activeLevelId: string) {
  if (!import.meta.env.DEV || activeLevelId !== 'crystal-corridor') return;

  const panel = document.createElement('details');
  panel.className = 'debug-quant-panel';
  panel.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'SFX Quant';
  panel.append(summary);

  const body = document.createElement('div');
  body.className = 'debug-quant-panel-body';
  panel.append(body);

  const gridLabel = document.createElement('label');
  const gridText = document.createElement('span');
  const gridInput = document.createElement('input');
  gridInput.type = 'range';
  gridInput.min = '0';
  gridInput.max = `${GRID_OPTIONS.length - 1}`;
  gridInput.step = '1';
  gridLabel.append(gridText, gridInput);

  const help = document.createElement('p');
  help.textContent = 'Crystal lock/fire SFX only. Gameplay timing is unchanged.';

  body.append(gridLabel, help);
  document.body.append(panel);

  const current = getActionSfxQuantization();
  gridInput.value = `${optionIndexFor(current.enabled, current.gridThirtyseconds)}`;

  function apply() {
    const option = GRID_OPTIONS[Number(gridInput.value)] ?? GRID_OPTIONS[0];
    setActionSfxQuantization({
      enabled: option.enabled,
      gridThirtyseconds: option.gridThirtyseconds,
    });
    gridText.textContent = `Snap grid: ${option.label}`;
  }

  gridInput.addEventListener('input', apply);
  apply();
}

function optionIndexFor(enabled: boolean, gridThirtyseconds: number) {
  if (!enabled) return 0;
  const index = GRID_OPTIONS.findIndex((option) => option.enabled && option.gridThirtyseconds === gridThirtyseconds);
  return index === -1 ? 3 : index;
}
