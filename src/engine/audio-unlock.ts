type AudioContextWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type AudioSessionNavigator = Navigator & {
  audioSession?: { type?: string };
};

const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend', 'click', 'keydown'] as const;

// iOS treats Web Audio as ambient by default, so the hardware silent switch mutes
// the whole game. Declaring the session as playback opts into primary-content
// behaviour and plays through the switch. Safari 16.4+; ignored elsewhere.
function claimPlaybackAudioSession() {
  const audioSession = (navigator as AudioSessionNavigator).audioSession;
  if (!audioSession) return;
  try {
    audioSession.type = 'playback';
  } catch (error) {
    console.warn('Could not set audio session type', error);
  }
}

export function createBrowserAudioContext() {
  const audioWindow = window as AudioContextWindow;
  const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser');
  claimPlaybackAudioSession();
  return new AudioContextCtor();
}

export function installAudioUnlock(start: () => Promise<void>) {
  let disposed = false;

  const removeListeners = () => {
    for (const eventName of AUDIO_UNLOCK_EVENTS) {
      window.removeEventListener(eventName, wake, true);
    }
  };

  /* Deliberately re-entrant: on iOS, resume() outside a valid activation window can pend
     forever, so a single in-flight attempt must never block later gestures. resume() is
     idempotent, and start() only resolves once the context is actually running. */
  const wake = () => {
    if (disposed) return;
    void start()
      .then(() => {
        if (disposed) return;
        disposed = true;
        removeListeners();
      })
      .catch(() => {
        /* Autoplay policy refused this attempt; keep listening for the next gesture. */
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
