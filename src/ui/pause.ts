function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing pause element: ${selector}`);
  return element;
}

export type PauseMenuOptions = {
  initialVolume: number;
  initialBloom: number;
  fullscreenAvailable: boolean;
  onResume: () => void;
  onFullscreen: () => void;
  onVolume: (value: number) => void;
  onBloom: (value: number) => void;
};

export function createPauseMenu(options: PauseMenuOptions) {
  const overlay = requireElement<HTMLElement>('#pause');
  const resume = requireElement<HTMLButtonElement>('[data-pause="resume"]');
  const fullscreen = requireElement<HTMLButtonElement>('[data-pause="fullscreen"]');
  const volume = requireElement<HTMLInputElement>('[data-pause="volume"]');
  const bloom = requireElement<HTMLInputElement>('[data-pause="bloom"]');

  volume.value = `${Math.round(options.initialVolume)}`;
  bloom.value = `${Math.round(options.initialBloom)}`;

  fullscreen.classList.toggle('hidden', !options.fullscreenAvailable);

  const updateFullscreenText = () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  };

  resume.addEventListener('click', options.onResume);
  fullscreen.addEventListener('click', options.onFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenText);
  volume.addEventListener('input', () => options.onVolume(Number(volume.value)));
  bloom.addEventListener('input', () => options.onBloom(Number(bloom.value)));

  return {
    setPaused(paused: boolean) {
      overlay.classList.toggle('hidden', !paused);
      if (paused) resume.focus();
    },
  };
}
