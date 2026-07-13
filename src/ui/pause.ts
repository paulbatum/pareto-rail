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
  onEndRun: () => void;
  onFullscreen: () => void;
  onMusicVolume: (value: number) => void;
  onSfxVolume: (value: number) => void;
  onBloom: (value: number) => void;
  onMotionBlur: (value: number) => void;
};

export function createPauseMenu(options: PauseMenuOptions) {
  const overlay = requireElement<HTMLElement>('#pause');
  const resume = requireElement<HTMLButtonElement>('[data-pause="resume"]');
  const endRun = requireElement<HTMLButtonElement>('[data-pause="end-run"]');
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

  const onMusic = () => options.onMusicVolume(Number(music.value));
  const onSfx = () => options.onSfxVolume(Number(sfx.value));
  const onBloom = () => options.onBloom(Number(bloom.value));
  const onMotionBlur = () => options.onMotionBlur(Number(motionBlur.value));
  resume.addEventListener('click', options.onResume);
  endRun.addEventListener('click', options.onEndRun);
  fullscreen.addEventListener('click', options.onFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenText);
  music.addEventListener('input', onMusic); sfx.addEventListener('input', onSfx);
  bloom.addEventListener('input', onBloom); motionBlur.addEventListener('input', onMotionBlur);

  return {
    setPaused(paused: boolean) {
      overlay.classList.toggle('hidden', !paused);
      if (paused) resume.focus();
    },
    dispose() {
      resume.removeEventListener('click', options.onResume);
      endRun.removeEventListener('click', options.onEndRun);
      fullscreen.removeEventListener('click', options.onFullscreen);
      document.removeEventListener('fullscreenchange', updateFullscreenText);
      music.removeEventListener('input', onMusic); sfx.removeEventListener('input', onSfx);
      bloom.removeEventListener('input', onBloom); motionBlur.removeEventListener('input', onMotionBlur);
    },
  };
}
