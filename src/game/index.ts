import { PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RunSummary } from '../engine/scoring';
import { createEventBus } from '../events';
import { createPost, getBloomLevel, getMotionBlurLevel, setBloomLevel, setMotionBlurLevel } from '../engine/post';
import { getStartScreenTip } from '../ui/client-tip';
import { installDevErrorOverlay } from '../ui/dev-error-overlay';
import { createHud, showUnsupported } from '../ui/hud';
import { createPauseMenu } from '../ui/pause';
import { selectableLevelGroups } from '../levels';
import type { LevelDefinition } from '../engine/types';
import { navigate } from '../app/router';

export type GameLaunchContext = {
  source?: 'home' | 'play' | 'rank';
  levelId?: string;
  mode?: 'reference' | 'benchmark';
};

export type GameMountOptions = {
  host: HTMLElement;
  level: LevelDefinition;
  launchContext?: GameLaunchContext;
  showLevelPicker?: boolean;
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
export async function mountGame({ host, level, launchContext, showLevelPicker, onRunEnd, signal }: GameMountOptions): Promise<GameMount> {
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

    if (!('gpu' in navigator)) {
      showUnsupported(host, 'This game requires WebGPU');
      return { dispose };
    }

    const app = host.querySelector<HTMLElement>('[data-game="app"]')!;
    const urlParams = new URLSearchParams(window.location.search);
    const debugValue = import.meta.env.DEV && level.debugSelector
      ? urlParams.get(level.debugSelector.queryParam) ?? undefined
      : undefined;
    const renderer = new WebGPURenderer({ antialias: true, alpha: false });
    stack.add(() => {
      renderer.domElement.remove();
      renderer.dispose();
    });
    (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(level.post?.clearColor ?? 0x02040a, 1);
    try {
      await renderer.init();
    } catch (error) {
      if (signal?.aborted || !host.isConnected) return abort();
      console.error(error);
      showUnsupported(host, 'This game requires WebGPU');
      return { dispose };
    }
    if (signal?.aborted || !host.isConnected) return abort();
    app.append(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);
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
    const removeLevelPicker = showLevelPicker !== false
      ? installLevelPicker(host, level.id, import.meta.env.DEV)
      : undefined;
    if (removeLevelPicker) stack.add(removeLevelPicker);
    if (import.meta.env.DEV) {
      try {
        const installedDebugPanel = await import('../ui/debug-panel').then(({ installDebugPanel }) => installDebugPanel({ id: level.id, bpm: level.bpm, debugSelector: level.debugSelector, urlParams })) as { dispose?: () => void } | undefined;
        if (installedDebugPanel) stack.add(() => installedDebugPanel.dispose?.());
      } catch (error) {
        console.warn('Debug panel failed to install', error);
      }
      if (signal?.aborted) return abort();
    }
    const resize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight); };
    window.addEventListener('resize', resize);
    stack.add(() => window.removeEventListener('resize', resize));
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
    document.body.classList.toggle('game-ui-hidden', shortcutUiHidden || Boolean(document.fullscreenElement));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'd') return;
    event.preventDefault();
    shortcutUiHidden = !shortcutUiHidden;
    updateUiVisibility();
  };
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('fullscreenchange', updateUiVisibility);
  updateUiVisibility();
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('fullscreenchange', updateUiVisibility);
    document.body.classList.remove('game-ui-hidden');
  };
}

function installLevelPicker(host: HTMLElement, activeId: string, includeTechnical: boolean) {
  const picker = document.createElement('label'); picker.className = 'level-picker'; picker.dataset.gameUi = 'true'; picker.textContent = 'Level ';
  const select = document.createElement('select');
  const groups = selectableLevelGroups({ includeTechnical });
  const appendGroup = (label: string, levels: readonly { id: string; title: string }[]) => {
    if (levels.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const level of levels) {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = level.title;
      option.selected = level.id === activeId;
      group.append(option);
    }
    select.append(group);
  };
  appendGroup('Built-in levels', groups.builtIn);
  appendGroup('Benchmark levels', groups.benchmark);
  const onChange = () => navigate(`/play/${encodeURIComponent(select.value)}`);
  select.addEventListener('change', onChange);
  picker.append(select);
  host.append(picker);
  return () => {
    select.removeEventListener('change', onChange);
    picker.remove();
  };
}
function canUseFullscreen() { return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen); }
async function setFullscreen(enabled: boolean) { try { if (enabled) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch (error) { console.warn('Fullscreen request failed', error); } }
function readStoredPercent(key: string, fallback: number) { const raw = localStorage.getItem(key); if (raw === null) return fallback; const value = Number(raw); return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback; }
