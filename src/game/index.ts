import { PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RunSummary } from '../engine/scoring';
import { GAME_FOV_DEGREES } from '../engine/lock-on-runner';
import { createEventBus } from '../events';
import { createPost, getBloomLevel, getMotionBlurLevel, setBloomLevel, setMotionBlurLevel } from '../engine/post';
import { withoutShadowDependentStages } from '../engine/post-stages';
import { applyInitializedRenderConfig, applyRenderConfig, CAMERA_NEAR, resolveCameraFar } from '../engine/render-config';
import { getStartScreenTip } from '../ui/client-tip';
import { installDevErrorOverlay } from '../ui/dev-error-overlay';
import { createHud, showUnsupported } from '../ui/hud';
import { createPauseMenu } from '../ui/pause';
import type { LevelDefinition } from '../engine/types';

export type GameLaunchContext = {
  source?: 'home' | 'play' | 'rank' | 'match';
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

/* Automated video capture plays the game from outside the page: it needs the scene
   to find targets, the camera to project them to screen space, and the event bus to
   follow what its own input did. Opt in per URL (`?capture=1`) so the handle never
   exists during ordinary play. */
export type GameCaptureHandle = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: ReturnType<typeof createEventBus>;
};

declare global {
  interface Window {
    __raildCapture?: GameCaptureHandle;
  }
}

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
    const perfParam = urlParams.get('perf');
    const perfEnabled = perfParam === '1' || (import.meta.env.DEV && perfParam !== '0');
    /* Render-size knobs for playtests on slow hardware: `scale` multiplies the device
       pixel ratio, `msaa=0` drops multisampling. Both change what the GPU is asked to
       draw without touching the level, so a playtest can attribute a slow frame. */
    const renderScale = clampScale(urlParams.get('scale'));
    const multisample = urlParams.get('msaa') !== '0';
    const pixelRatio = () => Math.min(window.devicePixelRatio, 2) * renderScale;
    /* Without a preference the browser picks the adapter, and on a laptop with two GPUs
       that is usually the integrated one. */
    const renderer = new WebGPURenderer({ antialias: multisample, alpha: false, trackTimestamp: perfEnabled, powerPreference: 'high-performance' });
    stack.add(() => {
      renderer.domElement.remove();
      renderer.dispose();
    });
    (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
    /* The runtime fills its frame, which the site nav insets from the top. */
    const viewWidth = () => app.clientWidth || window.innerWidth;
    const viewHeight = () => app.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(viewWidth(), viewHeight());
    renderer.setClearColor(level.post?.clearColor ?? 0x02040a, 1);
    applyRenderConfig(renderer, level.render);
    /* `?shadows=0` drops the shadow pass, another whole render of the scene, and with it the post
       stages that march the map — they would otherwise switch the pass back on. */
    const shadowsEnabled = urlParams.get('shadows') !== '0';
    if (!shadowsEnabled) renderer.shadowMap.enabled = false;
    const postConfig = shadowsEnabled ? level.post : withoutShadowDependentStages(level.post);
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
    applyInitializedRenderConfig(renderer, level.render);
    app.append(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(
      GAME_FOV_DEGREES,
      viewWidth() / viewHeight(),
      CAMERA_NEAR,
      resolveCameraFar(level.render),
    );
    const hud = createHud({ showTimer: import.meta.env.DEV });
    const bus = createEventBus();
    stack.add(() => bus.clear());
    const audio = level.createAudio(bus);
    stack.add(() => audio.dispose());
    /* Levels play at their authored balance; the player's one volume rides on the audio
       kit's output gain, which every level's audio passes through. */
    audio.setMusicVolume(1);
    audio.setSfxVolume(1);
    audio.setMasterVolume(readStoredPercent('pareto-rail-volume', 50) / 100);
    setBloomLevel(readStoredPercent('pareto-rail-bloom', 100) / 100);
    setMotionBlurLevel(readStoredPercent('pareto-rail-motion-blur', 100) / 100);
    audio.installGestureStart(() => hud.setSoundActive(true));
    const perfOverlay = perfEnabled
      ? (await import('../ui/perf-overlay')).createPerfOverlay({ renderer, scene, bus, levelId: level.id, knobs: diagnosticKnobs(urlParams) })
      : null;
    if (perfOverlay) stack.add(() => perfOverlay.dispose());
    if (signal?.aborted) return abort();

    let paused = false;
    let freecam: import('./freecam').Freecam | null = null;
    let last = performance.now();
    let setPaused = (_paused: boolean) => {};
    const fullscreenAvailable = canUseFullscreen();
    const togglePause = () => setPaused(!paused);
    const toggleFullscreen = () => { if (fullscreenAvailable) void setFullscreen(!document.fullscreenElement); };
    const pauseMenu = createPauseMenu({
      root: host,
      fullscreenAvailable,
      initialVolume: audio.getMasterVolume() * 100,
      initialBloom: getBloomLevel() * 100,
      initialMotionBlur: getMotionBlurLevel() * 100,
      onResume: () => setPaused(false),
      onOpen: () => setPaused(true),
      onEndRun: () => { bus.emit('runendrequest', undefined); setPaused(false); },
      onFullscreen: toggleFullscreen,
      onVolume: (value) => { localStorage.setItem('pareto-rail-volume', `${value}`); audio.setMasterVolume(value / 100); },
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

    const runtime = level.createRuntime({ scene, camera, renderer, canvas: renderer.domElement, bus, hud, onPause: togglePause, onFullscreen: toggleFullscreen, startTip: getStartScreenTip(), debugValue });
    stack.add(() => runtime.dispose());
    /* `?hide=a,b` takes named scene objects out of the frame, so a capture can price
       one of them by difference. Named objects are level-specific; an unknown name is
       a typo worth hearing about rather than a silent no-op. */
    for (const name of (urlParams.get('hide') ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const object = scene.getObjectByName(name);
      if (!object) throw new Error(`hide: no scene object named "${name}"`);
      object.visible = false;
    }
    /* Built after the runtime so post stages can find the level's scene objects, such as a god-rays light. */
    /* `?post=0` renders the scene straight to the canvas, so a playtest capture can
       separate what the level's materials cost from what the post chain costs. */
    const post = urlParams.get('post') === '0' ? null : createPost(renderer, scene, camera, postConfig);
    let postEnabled = post !== null;
    if (post) {
      stack.add(() => post.dispose());
      perfOverlay?.setSceneSamples(() => (postEnabled ? post.sceneSamples() : renderer.samples));
      /* Compile every scene shader before the first frame, in parallel and off the main thread. */
      await post.compileAsync();
    } else {
      await renderer.compileAsync(scene, camera);
    }
    if (perfOverlay) {
      const { buildSweepConfigs } = await import('./perf-sweep');
      perfOverlay.setSweepConfigs(buildSweepConfigs({
        scene,
        hasPost: post !== null,
        setPostEnabled: (enabled) => { postEnabled = enabled; },
      }));
    }
    if (signal?.aborted) return abort();
    if (urlParams.get('capture') === '1') {
      window.__raildCapture = { scene, camera, canvas: renderer.domElement, bus };
      stack.add(() => { delete window.__raildCapture; });
    }
    /* The desktop "press F for fullscreen" nudge only makes sense when fullscreen is available
       and we are not already in it, so gate it here and keep it in sync as fullscreen toggles. */
    if (fullscreenAvailable) {
      const syncFullscreenNudge = () => hud.setFullscreenOffered(!document.fullscreenElement);
      syncFullscreenNudge();
      document.addEventListener('fullscreenchange', syncFullscreenNudge);
      stack.add(() => document.removeEventListener('fullscreenchange', syncFullscreenNudge));
    }
    const offRunEnd = bus.on('runend', (summary) => {
      document.body.classList.add('run-ended');
      onRunEnd?.(summary, launchContext);
    });
    stack.add(offRunEnd);
    /* Phone-landscape CSS hides the site header during play but restores it with
       the end panel, where its back link is the way out. */
    const offRunStart = bus.on('runstart', () => document.body.classList.remove('run-ended'));
    stack.add(() => { offRunStart(); document.body.classList.remove('run-ended'); });
    if (import.meta.env.DEV) {
      try {
        freecam = (await import('./freecam')).createFreecam({
          playerCamera: camera,
          canvas: renderer.domElement,
          onCameraChange: (next) => post?.setCamera(next),
        });
        stack.add(() => freecam?.dispose());
      } catch (error) {
        console.warn('Freecam failed to install', error);
      }
      try {
        const installedDebugPanel = await import('../ui/debug-panel').then(({ installDebugPanel }) => installDebugPanel({ id: level.id, bpm: level.bpm, debugSelector: level.debugSelector, urlParams, freecam: freecam ?? undefined, mountPerfReadout: perfOverlay ? (host) => perfOverlay.mount(host) : undefined })) as { dispose?: () => void } | undefined;
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
      freecam?.syncAspect(camera.aspect);
      renderer.setPixelRatio(pixelRatio());
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
      /* Outside the pause gate so the debug camera still flies over a stopped game. */
      freecam?.update(dt);
      if (post && postEnabled) post.render({ advanceMotionBlur: !paused || Boolean(freecam?.isActive()), dt });
      else renderer.render(scene, camera);
      perfOverlay?.recordFrame(dtMs, now);
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
/* What a capture was measuring. Without this a saved report is just a number, and a
   run with the post chain off is indistinguishable from the shipping frame. */
const DIAGNOSTIC_PARAMS = ['scale', 'msaa', 'post', 'shadows', 'hide', 'lowpoly'];
function diagnosticKnobs(urlParams: URLSearchParams) {
  const knobs: Record<string, string> = {};
  for (const name of DIAGNOSTIC_PARAMS) {
    const value = urlParams.get(name);
    if (value !== null) knobs[name] = value;
  }
  return knobs;
}
function clampScale(raw: string | null) { const value = Number(raw); return raw !== null && Number.isFinite(value) && value > 0 ? Math.min(2, Math.max(0.25, value)) : 1; }
function readStoredPercent(key: string, fallback: number) { const raw = localStorage.getItem(key); if (raw === null) return fallback; const value = Number(raw); return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback; }
