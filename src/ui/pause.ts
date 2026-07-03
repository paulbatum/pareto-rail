function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing pause element: ${selector}`);
  return element;
}

export type PauseMenuOptions = {
  initialVolume: number;
  initialGlow: number;
  onResume: () => void;
  onVolume: (value: number) => void;
  onGlow: (value: number) => void;
};

export function createPauseMenu(options: PauseMenuOptions) {
  const overlay = requireElement<HTMLElement>('#pause');
  const resume = requireElement<HTMLButtonElement>('[data-pause="resume"]');
  const volume = requireElement<HTMLInputElement>('[data-pause="volume"]');
  const glow = requireElement<HTMLInputElement>('[data-pause="glow"]');

  volume.value = `${Math.round(options.initialVolume)}`;
  glow.value = `${Math.round(options.initialGlow)}`;

  resume.addEventListener('click', options.onResume);
  volume.addEventListener('input', () => options.onVolume(Number(volume.value)));
  glow.addEventListener('input', () => options.onGlow(Number(glow.value)));

  return {
    setPaused(paused: boolean) {
      overlay.classList.toggle('hidden', !paused);
      if (paused) resume.focus();
    },
  };
}
