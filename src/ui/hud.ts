import type { RunSummary } from '../game/scoring';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing HUD element: ${selector}`);
  return element;
}

export type Hud = ReturnType<typeof createHud>;

export function createHud() {
  const score = requireElement<HTMLElement>('[data-hud="score"]');
  const time = requireElement<HTMLElement>('[data-hud="time"]');
  const locks = requireElement<HTMLElement>('[data-hud="locks"]');
  const endScreen = requireElement<HTMLElement>('#end-screen');
  const endScore = requireElement<HTMLElement>('[data-end="score"]');
  const endKills = requireElement<HTMLElement>('[data-end="kills"]');
  const endRank = requireElement<HTMLElement>('[data-end="rank"]');

  return {
    update(values: { score: number; timeRemaining: number; lockCount: number }) {
      score.textContent = `${values.score}`;
      time.textContent = values.timeRemaining.toFixed(1);
      locks.textContent = `${values.lockCount}`;
    },

    showEnd(summary: RunSummary) {
      endScore.textContent = `${summary.score}`;
      endKills.textContent = `Kills ${summary.kills}/${summary.totalEnemies} · Missed ${summary.missed}`;
      endRank.textContent = summary.rank;
      endScreen.classList.remove('hidden');
    },

    hideEnd() {
      endScreen.classList.add('hidden');
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
