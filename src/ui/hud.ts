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
  const hullCell = requireElement<HTMLElement>('[data-hud="hull-cell"]');
  const hullPips = requireElement<HTMLElement>('[data-hud="hull-pips"]');
  const damageFlash = requireElement<HTMLElement>('#damage-flash');
  const maxLockFlash = requireElement<HTMLElement>('#max-lock-flash');
  const endScreen = requireElement<HTMLElement>('#end-screen');
  const endPanel = requireElement<HTMLElement>('#end-screen .end-panel');
  const callout = requireElement<HTMLElement>('#callout');
  const tip = requireElement<HTMLElement>('#tip');
  const soundTip = requireElement<HTMLElement>('#sound-tip');
  const rotateTip = requireElement<HTMLElement>('#rotate-tip');
  const fullscreenTip = requireElement<HTMLElement>('#fullscreen-tip');
  const endScore = requireElement<HTMLElement>('[data-end="score"]');
  const endKills = requireElement<HTMLElement>('[data-end="kills"]');
  const endRank = requireElement<HTMLElement>('[data-end="rank"]');
  const endDetails = requireElement<HTMLElement>('[data-end="details"]');
  const endDeath = requireElement<HTMLElement>('[data-end="death"]');
  let hullMax = -1;
  let hullCurrent = -1;
  let nudgesVisible = false;
  let soundActive = false;

  const applySoundTip = () => soundTip.classList.toggle('hidden', !nudgesVisible || !soundActive);

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
    update(values: { score: number; elapsedTime: number; health?: HudHealth }) {
      score.textContent = `${values.score}`;
      time.textContent = values.elapsedTime.toFixed(1);
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

    setTip(message: string, options?: { preserveCase?: boolean }) {
      /* Levels compose their instructions onto the client tip with ' • ', which can leave a
         dangling separator when the client tip is empty on their platform. */
      tip.textContent = message.replace(/^[\s•]+|[\s•]+$/g, '');
      /* The staged instruction prompt authors its own casing (HOLD, SWEEP…); everything else
         keeps the HUD's uppercase treatment. */
      tip.classList.toggle('tip-prompt', options?.preserveCase === true);
    },

    showTip() {
      tip.classList.remove('hidden');
    },

    hideTip() {
      tip.classList.add('hidden');
    },

    /* Sound, landscape, and fullscreen encouragement, all shown while the player is on a
       start screen. The landscape and fullscreen nudges are additionally gated in CSS (a
       portrait-touch query for rotate; a fine-pointer query plus setFullscreenOffered for
       fullscreen), so each only appears where its suggestion applies. */
    setStartNudgesVisible(visible: boolean) {
      nudgesVisible = visible;
      applySoundTip();
      rotateTip.classList.toggle('hidden', !visible);
      fullscreenTip.classList.toggle('hidden', !visible);
    },

    /* The sound nudge asks the player to turn their device volume up, which is only honest
       advice once audio is actually playing — before the browser's autoplay unlock it would
       point at silence. */
    setSoundActive(active: boolean) {
      soundActive = active;
      applySoundTip();
    },

    isSoundActive() {
      return soundActive;
    },

    /* Whether the fullscreen nudge is eligible at all: only when fullscreen is available and
       we are not already in it. Combined in CSS with the start-screen and fine-pointer gates. */
    setFullscreenOffered(offered: boolean) {
      fullscreenTip.classList.toggle('fullscreen-offered', offered);
    },
  };
}

export type UnsupportedNotice = {
  message: string;
  hint: string;
  /* Diagnostics for the on-screen panel. Only pass this when debug output is enabled: it is the
     only way to read a failure on a phone, where there is no console to open. */
  detail?: string;
};

export function showUnsupported(host: HTMLElement, notice: UnsupportedNotice) {
  const panel = host.querySelector<HTMLElement>('[data-game="unsupported"]');
  const heading = panel?.querySelector<HTMLElement>('[data-unsupported="message"]');
  const hint = panel?.querySelector<HTMLElement>('[data-unsupported="hint"]');
  const detail = panel?.querySelector<HTMLElement>('[data-unsupported="detail"]');
  if (!panel || !heading || !hint || !detail) throw new Error('Missing unsupported game panel');
  heading.textContent = notice.message;
  hint.textContent = notice.hint;
  detail.textContent = notice.detail ?? '';
  detail.classList.toggle('hidden', !notice.detail);
  panel.classList.remove('hidden');
}
