type AudioContextWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend', 'click', 'keydown'] as const;

export function createBrowserAudioContext() {
  const audioWindow = window as AudioContextWindow;
  const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser');
  return new AudioContextCtor();
}

export function installAudioUnlock(start: () => Promise<void>) {
  let starting = false;
  let disposed = false;

  const removeListeners = () => {
    for (const eventName of AUDIO_UNLOCK_EVENTS) {
      window.removeEventListener(eventName, wake, true);
    }
  };

  const wake = () => {
    if (starting || disposed) return;
    starting = true;
    void start()
      .then(() => {
        disposed = true;
        removeListeners();
      })
      .catch((error: unknown) => {
        console.warn('Audio unlock failed', error);
      })
      .finally(() => {
        starting = false;
      });
  };

  for (const eventName of AUDIO_UNLOCK_EVENTS) {
    window.addEventListener(eventName, wake, { capture: true, passive: true });
  }

  return () => {
    disposed = true;
    removeListeners();
  };
}
