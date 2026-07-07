function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing pause element: ${selector}`);
  return element;
}

export type PauseMenuOptions = {
  initialMusicVolume: number;
  initialSfxVolume: number;
  initialBloom: number;
  initialMotionBlur: number;
  fullscreenAvailable: boolean;
  onResume: () => void;
  onFullscreen: () => void;
  onMusicVolume: (value: number) => void;
  onSfxVolume: (value: number) => void;
  onBloom: (value: number) => void;
  onMotionBlur: (value: number) => void;
};

export function createPauseMenu(options: PauseMenuOptions) {
  const overlay = requireElement<HTMLElement>('#pause');
  const resume = requireElement<HTMLButtonElement>('[data-pause="resume"]');
  const fullscreen = requireElement<HTMLButtonElement>('[data-pause="fullscreen"]');
  const music = requireElement<HTMLInputElement>('[data-pause="music"]');
  const sfx = requireElement<HTMLInputElement>('[data-pause="sfx"]');
  const bloom = requireElement<HTMLInputElement>('[data-pause="bloom"]');
  const motionBlur = requireElement<HTMLInputElement>('[data-pause="motion-blur"]');

  music.value = `${Math.round(options.initialMusicVolume)}`;
  sfx.value = `${Math.round(options.initialSfxVolume)}`;
  bloom.value = `${Math.round(options.initialBloom)}`;
  motionBlur.value = `${Math.round(options.initialMotionBlur)}`;

  fullscreen.classList.toggle('hidden', !options.fullscreenAvailable);

  const updateFullscreenText = () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  };

  resume.addEventListener('click', options.onResume);
  fullscreen.addEventListener('click', options.onFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenText);
  music.addEventListener('input', () => options.onMusicVolume(Number(music.value)));
  sfx.addEventListener('input', () => options.onSfxVolume(Number(sfx.value)));
  bloom.addEventListener('input', () => options.onBloom(Number(bloom.value)));
  motionBlur.addEventListener('input', () => options.onMotionBlur(Number(motionBlur.value)));

  return {
    setPaused(paused: boolean) {
      overlay.classList.toggle('hidden', !paused);
      if (paused) resume.focus();
    },
  };
}
