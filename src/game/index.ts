import { PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RunSummary } from '../engine/scoring';
import { GAME_FOV_DEGREES } from '../engine/lock-on-runner';
import { createEventBus } from '../events';
import { createPost, getBloomLevel, getMotionBlurLevel, setBloomLevel, setMotionBlurLevel } from '../engine/post';
import { getStartScreenTip } from '../ui/client-tip';
import { installDevErrorOverlay } from '../ui/dev-error-overlay';
import { createHud, showUnsupported } from '../ui/hud';
import { createPauseMenu } from '../ui/pause';
import type { LevelDefinition } from '../engine/types';

export type GameLaunchContext = {
  source?: 'home' | 'play' | 'rank';
  levelId?: string;
  mode?: 'reference' | 'benchmark';
};

export type GameMountOptions = {
  host: HTMLElement;
  level: LevelDefinition;
  launchContext?: GameLaunchContext;
  onRunEnd?: (summary: RunSummary, context?: GameLaunchContext) => void;
  signal?: AbortSignal;
};

export type GameMount = { dispose(): void };

type Disposer = () => void;

const inertGameMount: GameMount = { dispose() {} };

// A stale async mount must not clear the class for the mount that replaced it.
const activeGameMounts = new Set<symbol>();

function createDisposerStack() {
  const disposers: Disposer[] = [];
  let disposed = false;
  return {
    add(disposer: Disposer) {
      if (disposed) {
        disposer();
        return;
      }
      disposers.push(disposer);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        try {
          disposers[index]();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) throw firstError;
    },
  };
}

// StrictMode, route changes, and hot updates may invalidate a mount before async initialization settles; cancellation and cleanup must remain idempotent.
export async function mountGame({ host, level, launchContext, onRunEnd, signal }: GameMountOptions): Promise<GameMount> {
  await Promise.resolve();
  if (signal?.aborted) return inertGameMount;

  const stack = createDisposerStack();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stack.dispose();
  };
  const abort = () => {
    try {
      dispose();
    } catch (error) {
      console.error('Game cleanup failed', error);
    }
    return inertGameMount;
  };

  try {
    if (import.meta.env.DEV) installDevErrorOverlay();
    const releaseGameActivity = acquireGameActivity();
    stack.add(releaseGameActivity);
    const removeUiVisibilityControls = installUiVisibilityControls();
    stack.add(removeUiVisibilityControls);

    const urlParams = new URLSearchParams(window.location.search);
    /* Failures here are usually read on a phone, where there is no console to open. */
    const debugDetail = import.meta.env.DEV || urlParams.get('debug') === '1';
    const userAgent = navigator.userAgent;
    const describe = (detail: string) => (debugDetail ? detail : undefined);

    if (!('gpu' in navigator)) {
      /* navigator.gpu is only exposed in a secure context, so plain HTTP on anything but loopback
         looks exactly like a browser without WebGPU. Say which one it is. */
      if (!window.isSecureContext) {
        showUnsupported(host, {
          message: 'This page must be served over HTTPS',
          hint: 'WebGPU is only available in a secure context. Reload this page over HTTPS, or use localhost.',
          detail: describe(`origin: ${window.location.origin}\nisSecureContext: false\nnavigator.gpu: undefined`),
        });
      } else {
        showUnsupported(host, {
          message: 'This game requires WebGPU',
          hint: 'Please open this page in a browser with WebGPU enabled.',
          detail: describe(`navigator.gpu: undefined\nuserAgent: ${userAgent}`),
        });
      }
      return { dispose };
    }

    const app = host.querySelector<HTMLElement>('[data-game="app"]')!;
    const debugValue = import.meta.env.DEV && level.debugSelector
      ? urlParams.get(level.debugSelector.queryParam) ?? undefined
      : undefined;
    const renderer = new WebGPURenderer({ antialias: true, alpha: false });
    stack.add(() => {
      renderer.domElement.remove();
      renderer.dispose();
    });
    (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
    /* The runtime fills its frame, which the site nav insets from the top. */
    const viewWidth = () => app.clientWidth || window.innerWidth;
    const viewHeight = () => app.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewWidth(), viewHeight());
    renderer.setClearColor(level.post?.clearColor ?? 0x02040a, 1);
    try {
      await renderer.init();
    } catch (error) {
      if (signal?.aborted || !host.isConnected) return abort();
      console.error(error);
      /* The adapter exists but the device would not come up: a driver, a blocklist, or an
         out-of-memory tab, not a browser that lacks WebGPU. */
      const adapter = await navigator.gpu.requestAdapter().catch(() => null);
      showUnsupported(host, {
        message: adapter ? 'The graphics device failed to start' : 'This game requires WebGPU',
        hint: adapter
          ? 'Your browser supports WebGPU but could not open a device. Closing other tabs and reloading often clears it up.'
          : 'Please open this page in a browser with WebGPU enabled.',
        detail: describe(
          `adapter: ${adapter ? 'available' : 'none'}\n${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
        ),
      });
      return { dispose };
    }
    if (signal?.aborted || !host.isConnected) return abort();
    app.append(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(GAME_FOV_DEGREES, viewWidth() / viewHeight(), 0.1, 500);
    const hud = createHud({ showTimer: import.meta.env.DEV });
    const bus = createEventBus();
    stack.add(() => bus.clear());
    const audio = level.createAudio(bus);
    stack.add(() => audio.dispose());
    const legacyVolume = readStoredPercent('pareto-rail-volume', 50);
    audio.setMusicVolume(readStoredPercent('pareto-rail-music-volume', legacyVolume) / 100);
    audio.setSfxVolume(readStoredPercent('pareto-rail-sfx-volume', legacyVolume) / 100);
    setBloomLevel(readStoredPercent('pareto-rail-bloom', 100) / 100);
    setMotionBlurLevel(readStoredPercent('pareto-rail-motion-blur', 100) / 100);
    audio.installGestureStart();
    const post = createPost(renderer, scene, camera, level.post);
    const perfParam = urlParams.get('perf');
    const perfEnabled = perfParam === '1' || (import.meta.env.DEV && perfParam !== '0');
    const perfOverlay = perfEnabled
      ? (await import('../ui/perf-overlay')).createPerfOverlay({ renderer, scene, bus, levelId: level.id })
      : null;
    if (perfOverlay) stack.add(() => perfOverlay.dispose());
    if (signal?.aborted) return abort();

    let paused = false;
    let last = performance.now();
    let setPaused = (_paused: boolean) => {};
    const fullscreenAvailable = canUseFullscreen();
    const togglePause = () => setPaused(!paused);
    const toggleFullscreen = () => { if (fullscreenAvailable) void setFullscreen(!document.fullscreenElement); };
    const pauseMenu = createPauseMenu({
      root: host,
      fullscreenAvailable,
      initialMusicVolume: audio.getMusicVolume() * 100,
      initialSfxVolume: audio.getSfxVolume() * 100,
      initialBloom: getBloomLevel() * 100,
      initialMotionBlur: getMotionBlurLevel() * 100,
      onResume: () => setPaused(false),
      onEndRun: () => { bus.emit('runendrequest', undefined); setPaused(false); },
      onFullscreen: toggleFullscreen,
      onMusicVolume: (value) => { localStorage.setItem('pareto-rail-music-volume', `${value}`); audio.setMusicVolume(value / 100); },
      onSfxVolume: (value) => { localStorage.setItem('pareto-rail-sfx-volume', `${value}`); audio.setSfxVolume(value / 100); },
      onBloom: (value) => { localStorage.setItem('pareto-rail-bloom', `${value}`); setBloomLevel(value / 100); },
      onMotionBlur: (value) => { localStorage.setItem('pareto-rail-motion-blur', `${value}`); setMotionBlurLevel(value / 100); },
    });
    stack.add(() => pauseMenu.dispose?.());
    setPaused = (nextPaused) => {
      paused = nextPaused;
      pauseMenu.setPaused(paused);
      if (paused) void audio.suspend(); else void audio.start();
      last = performance.now();
    };

    const runtime = level.createRuntime({ scene, camera, canvas: renderer.domElement, bus, hud, onPause: togglePause, onFullscreen: toggleFullscreen, startTip: getStartScreenTip(fullscreenAvailable), debugValue });
    stack.add(() => runtime.dispose());
    const offRunEnd = bus.on('runend', (summary) => {
      onRunEnd?.(summary, launchContext);
    });
    stack.add(offRunEnd);
    if (import.meta.env.DEV) {
      try {
        const installedDebugPanel = await import('../ui/debug-panel').then(({ installDebugPanel }) => installDebugPanel({ id: level.id, bpm: level.bpm, debugSelector: level.debugSelector, urlParams, mountPerfReadout: perfOverlay ? (host) => perfOverlay.mount(host) : undefined })) as { dispose?: () => void } | undefined;
        if (installedDebugPanel) stack.add(() => installedDebugPanel.dispose?.());
      } catch (error) {
        console.warn('Debug panel failed to install', error);
      }
      if (signal?.aborted) return abort();
    }
    const resize = () => {
      const width = viewWidth();
      const height = viewHeight();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
    };
    /* Observing the frame rather than the window catches nav reflow and
       fullscreen transitions, which change the frame without resizing the window. */
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(app);
    stack.add(() => resizeObserver.disconnect());
    renderer.setAnimationLoop(() => {
      if (disposed) return;
      const now = performance.now(); const dtMs = now - last; const dt = Math.min(0.05, dtMs / 1000); last = now;
      if (!paused) runtime.update(dt, now / 1000);
      post.render({ advanceMotionBlur: !paused }); perfOverlay?.recordFrame(dtMs, now);
    });
    stack.add(() => renderer.setAnimationLoop(null));

    return { dispose };
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      console.error('Game cleanup failed', cleanupError);
    }
    if (signal?.aborted) return inertGameMount;
    throw error;
  }
}

function acquireGameActivity() {
  const mount = Symbol('game-mount');
  activeGameMounts.add(mount);
  document.body.classList.add('game-active');
  document.body.classList.remove('booting');
  return () => {
    if (!activeGameMounts.delete(mount)) return;
    if (activeGameMounts.size === 0) document.body.classList.remove('game-active');
  };
}

function installUiVisibilityControls() {
  let shortcutUiHidden = false;
  const updateUiVisibility = () => {
    document.body.classList.toggle('game-ui-hidden', shortcutUiHidden);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'd') return;
    event.preventDefault();
    shortcutUiHidden = !shortcutUiHidden;
    updateUiVisibility();
  };
  window.addEventListener('keydown', onKeyDown);
  updateUiVisibility();
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    document.body.classList.remove('game-ui-hidden');
  };
}

function canUseFullscreen() { return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen); }
async function setFullscreen(enabled: boolean) { try { if (enabled) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch (error) { console.warn('Fullscreen request failed', error); } }
function readStoredPercent(key: string, fallback: number) { const raw = localStorage.getItem(key); if (raw === null) return fallback; const value = Number(raw); return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback; }
