import type { RunSummary } from '../engine/scoring';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing HUD element: ${selector}`);
  return element;
}

export type Hud = ReturnType<typeof createHud>;

type HudHealth = { current: number; max: number };

type HudOptions = {
  showTimer?: boolean;
};

export function createHud(options: HudOptions = {}) {
  const hud = requireElement<HTMLElement>('#hud');
  const score = requireElement<HTMLElement>('[data-hud="score"]');
  const timeCell = requireElement<HTMLElement>('[data-hud="time-cell"]');
  const time = requireElement<HTMLElement>('[data-hud="time"]');
  const locks = requireElement<HTMLElement>('[data-hud="locks"]');
  const hullCell = requireElement<HTMLElement>('[data-hud="hull-cell"]');
  const hullPips = requireElement<HTMLElement>('[data-hud="hull-pips"]');
  const damageFlash = requireElement<HTMLElement>('#damage-flash');
  const maxLockFlash = requireElement<HTMLElement>('#max-lock-flash');
  const endScreen = requireElement<HTMLElement>('#end-screen');
  const endPanel = requireElement<HTMLElement>('#end-screen .end-panel');
  const callout = requireElement<HTMLElement>('#callout');
  const tip = requireElement<HTMLElement>('#tip');
  const endScore = requireElement<HTMLElement>('[data-end="score"]');
  const endKills = requireElement<HTMLElement>('[data-end="kills"]');
  const endRank = requireElement<HTMLElement>('[data-end="rank"]');
  const endDetails = requireElement<HTMLElement>('[data-end="details"]');
  const endDeath = requireElement<HTMLElement>('[data-end="death"]');
  let hullMax = -1;
  let hullCurrent = -1;

  timeCell.classList.toggle('hidden', options.showTimer !== true);

  function rebuildHullPips(max: number) {
    hullPips.replaceChildren(
      ...Array.from({ length: max }, () => {
        const pip = document.createElement('span');
        pip.className = 'hull-pip';
        pip.textContent = '◆';
        return pip;
      }),
    );
    hullMax = max;
    hullCurrent = -1;
  }

  function updateHull(health: HudHealth | undefined) {
    hullCell.classList.toggle('hidden', health === undefined);
    if (!health) return;
    const max = Math.max(0, Math.ceil(health.max));
    const current = Math.max(0, Math.ceil(health.current));
    if (max !== hullMax) rebuildHullPips(max);
    if (current === hullCurrent) return;
    hullCurrent = current;
    [...hullPips.children].forEach((pip, index) => {
      pip.classList.toggle('filled', index < current);
      pip.classList.toggle('empty', index >= current);
    });
  }

  return {
    update(values: { score: number; elapsedTime: number; lockCount: number; health?: HudHealth }) {
      score.textContent = `${values.score}`;
      time.textContent = values.elapsedTime.toFixed(1);
      locks.textContent = `${values.lockCount}`;
      updateHull(values.health);
    },

    flashDamage() {
      damageFlash.classList.remove('damage-flash-pop');
      void damageFlash.offsetWidth;
      damageFlash.classList.add('damage-flash-pop');
    },

    flashMaxLock(x: number, y: number) {
      maxLockFlash.style.left = `${x}px`;
      maxLockFlash.style.top = `${y}px`;
      maxLockFlash.classList.remove('hidden', 'max-lock-flash-pop');
      void maxLockFlash.offsetWidth;
      maxLockFlash.classList.add('max-lock-flash-pop');
    },

    showEnd(summary: RunSummary) {
      endScore.textContent = `${summary.score}`;
      endKills.textContent = `Kills ${summary.kills}/${summary.totalEnemies} · Missed ${summary.missed}`;
      endRank.textContent = summary.rank;
      const details = summary.details?.filter((line) => line.trim().length > 0) ?? [];
      endDetails.textContent = details.join(' · ');
      endDetails.classList.toggle('hidden', details.length === 0);
      endDeath.classList.toggle('hidden', summary.died !== true);
      endPanel.classList.toggle('died', summary.died === true);
      endScreen.classList.remove('hidden');
    },

    hideEnd() {
      endScreen.classList.add('hidden');
      endPanel.classList.remove('died');
      endDeath.classList.add('hidden');
    },

    setHudActive(active: boolean) {
      hud.classList.toggle('hud-inactive', !active);
    },

    setCallout(message: string) {
      callout.textContent = message;
      callout.classList.toggle('hidden', message.length === 0);
      callout.classList.remove('callout-pop');
      if (message.length > 0) {
        void callout.offsetWidth;
        callout.classList.add('callout-pop');
      }
    },

    setTip(message: string) {
      tip.textContent = message;
    },

    showTip() {
      tip.classList.remove('hidden');
    },

    hideTip() {
      tip.classList.add('hidden');
    },
  };
}

export function showUnsupported(message = 'This game requires WebGPU') {
  document.body.innerHTML = `
    <div class="unsupported">
      <div class="unsupported-panel">
        <h1>${message}</h1>
        <p>Please open this page in a browser with WebGPU enabled.</p>
      </div>
    </div>
  `;
}
