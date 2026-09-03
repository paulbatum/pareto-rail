function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing pause element: ${selector}`);
  return element;
}

export type PauseMenuOptions = {
  root: ParentNode;
  initialVolume: number;
  initialBloom: number;
  initialMotionBlur: number;
  fullscreenAvailable: boolean;
  onResume: () => void;
  onOpen: () => void;
  onEndRun: () => void;
  onFullscreen: () => void;
  onVolume: (value: number) => void;
  onBloom: (value: number) => void;
  onMotionBlur: (value: number) => void;
};

export function createPauseMenu(options: PauseMenuOptions) {
  const { root } = options;
  const overlay = requireElement<HTMLElement>(root, '#pause');
  const resume = requireElement<HTMLButtonElement>(root, '[data-pause="resume"]');
  // Keep this optional so a stale game frame from a hot update cannot prevent
  // the rest of the runtime, including Escape handling, from mounting.
  const endRun = root.querySelector<HTMLButtonElement>('[data-pause="end-run"]');
  // Touch devices have no Escape key; this is their only way into the menu.
  const open = root.querySelector<HTMLButtonElement>('[data-pause="open"]');
  const fullscreen = requireElement<HTMLButtonElement>(root, '[data-pause="fullscreen"]');
  const volume = requireElement<HTMLInputElement>(root, '[data-pause="volume"]');
  const bloom = requireElement<HTMLInputElement>(root, '[data-pause="bloom"]');
  const motionBlur = requireElement<HTMLInputElement>(root, '[data-pause="motion-blur"]');

  volume.value = `${Math.round(options.initialVolume)}`;
  bloom.value = `${Math.round(options.initialBloom)}`;
  motionBlur.value = `${Math.round(options.initialMotionBlur)}`;

  fullscreen.classList.toggle('hidden', !options.fullscreenAvailable);

  const updateFullscreenText = () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  };

  const onVolume = () => options.onVolume(Number(volume.value));
  const onBloom = () => options.onBloom(Number(bloom.value));
  const onMotionBlur = () => options.onMotionBlur(Number(motionBlur.value));
  resume.addEventListener('click', options.onResume);
  open?.addEventListener('click', options.onOpen);
  endRun?.addEventListener('click', options.onEndRun);
  fullscreen.addEventListener('click', options.onFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenText);
  volume.addEventListener('input', onVolume);
  bloom.addEventListener('input', onBloom); motionBlur.addEventListener('input', onMotionBlur);

  return {
    setPaused(paused: boolean) {
      overlay.classList.toggle('hidden', !paused);
      if (paused) resume.focus();
    },
    dispose() {
      resume.removeEventListener('click', options.onResume);
      open?.removeEventListener('click', options.onOpen);
      endRun?.removeEventListener('click', options.onEndRun);
      fullscreen.removeEventListener('click', options.onFullscreen);
      document.removeEventListener('fullscreenchange', updateFullscreenText);
      volume.removeEventListener('input', onVolume);
      bloom.removeEventListener('input', onBloom); motionBlur.removeEventListener('input', onMotionBlur);
    },
  };
}
