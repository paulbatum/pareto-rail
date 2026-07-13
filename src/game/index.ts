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
};

export type GameMount = { dispose(): void };

export async function mountGame({ host, level, launchContext, showLevelPicker, onRunEnd }: GameMountOptions): Promise<GameMount> {
  if (import.meta.env.DEV) installDevErrorOverlay();
  const frame = document.createElement('div');
  frame.className = 'game-runtime';
  frame.innerHTML = gameMarkup();
  host.append(frame);
  document.body.classList.add('game-active');
  document.body.classList.remove('booting');

  if (!('gpu' in navigator)) {
    showUnsupported('This game requires WebGPU', frame);
    return { dispose() { frame.remove(); document.body.classList.remove('game-active'); } };
  }

  const app = frame.querySelector<HTMLElement>('[data-game="app"]')!;
  const urlParams = new URLSearchParams(window.location.search);
  const debugValue = import.meta.env.DEV && level.debugSelector
    ? urlParams.get(level.debugSelector.queryParam) ?? undefined
    : undefined;
  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(level.post?.clearColor ?? 0x02040a, 1);
  try {
    await renderer.init();
  } catch (error) {
    console.error(error);
    showUnsupported('This game requires WebGPU', frame);
    return { dispose() { renderer.dispose(); frame.remove(); document.body.classList.remove('game-active'); } };
  }
  if (!host.isConnected) {
    renderer.dispose();
    frame.remove();
    return { dispose() { document.body.classList.remove('game-active'); } };
  }
  app.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);
  const hud = createHud({ showTimer: import.meta.env.DEV });
  const bus = createEventBus();
  const audio = level.createAudio(bus);
  const legacyVolume = readStoredPercent('raild-volume', 50);
  audio.setMusicVolume(readStoredPercent('raild-music-volume', legacyVolume) / 100);
  audio.setSfxVolume(readStoredPercent('raild-sfx-volume', legacyVolume) / 100);
  setBloomLevel(readStoredPercent('raild-bloom', 100) / 100);
  setMotionBlurLevel(readStoredPercent('raild-motion-blur', 100) / 100);
  audio.installGestureStart();
  const post = createPost(renderer, scene, camera, level.post);
  const perfParam = urlParams.get('perf');
  const perfEnabled = perfParam === '1' || (import.meta.env.DEV && perfParam !== '0');
  const perfOverlay = perfEnabled
    ? (await import('../ui/perf-overlay')).createPerfOverlay({ renderer, scene, bus, levelId: level.id })
    : null;

  let paused = false;
  let disposed = false;
  let last = performance.now();
  let setPaused = (_paused: boolean) => {};
  const fullscreenAvailable = canUseFullscreen();
  const togglePause = () => setPaused(!paused);
  const toggleFullscreen = () => { if (fullscreenAvailable) void setFullscreen(!document.fullscreenElement); };
  const pauseMenu = createPauseMenu({
    root: frame,
    fullscreenAvailable,
    initialMusicVolume: audio.getMusicVolume() * 100,
    initialSfxVolume: audio.getSfxVolume() * 100,
    initialBloom: getBloomLevel() * 100,
    initialMotionBlur: getMotionBlurLevel() * 100,
    onResume: () => setPaused(false),
    onEndRun: () => { bus.emit('runendrequest', undefined); setPaused(false); },
    onFullscreen: toggleFullscreen,
    onMusicVolume: (value) => { localStorage.setItem('raild-music-volume', `${value}`); audio.setMusicVolume(value / 100); },
    onSfxVolume: (value) => { localStorage.setItem('raild-sfx-volume', `${value}`); audio.setSfxVolume(value / 100); },
    onBloom: (value) => { localStorage.setItem('raild-bloom', `${value}`); setBloomLevel(value / 100); },
    onMotionBlur: (value) => { localStorage.setItem('raild-motion-blur', `${value}`); setMotionBlurLevel(value / 100); },
  });
  setPaused = (nextPaused) => {
    paused = nextPaused;
    pauseMenu.setPaused(paused);
    if (paused) void audio.suspend(); else void audio.start();
    last = performance.now();
  };

  const runtime = level.createRuntime({ scene, camera, canvas: renderer.domElement, bus, hud, onPause: togglePause, onFullscreen: toggleFullscreen, startTip: getStartScreenTip(fullscreenAvailable), debugValue });
  const offRunEnd = bus.on('runend', (summary) => {
    onRunEnd?.(summary, launchContext);
    if (level.id === 'crystal-corridor') addCrystalInvitation(summary, frame);
  });
  if (showLevelPicker !== false) installLevelPicker(frame, level.id, import.meta.env.DEV);
  let debugPanel: { dispose?: () => void } | undefined;
  if (import.meta.env.DEV) {
    try {
      debugPanel = await import('../ui/debug-panel').then(({ installDebugPanel }) => installDebugPanel({ id: level.id, bpm: level.bpm, debugSelector: level.debugSelector, urlParams })) as { dispose?: () => void } | undefined;
    } catch (error) {
      console.warn('Debug panel failed to install', error);
    }
  }
  const resize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight); };
  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(() => {
    if (disposed) return;
    const now = performance.now(); const dtMs = now - last; const dt = Math.min(0.05, dtMs / 1000); last = now;
    if (!paused) runtime.update(dt, now / 1000);
    post.render({ advanceMotionBlur: !paused }); perfOverlay?.recordFrame(dtMs, now);
  });

  return { dispose() {
    if (disposed) return; disposed = true;
    offRunEnd(); window.removeEventListener('resize', resize); renderer.setAnimationLoop(null);
    perfOverlay?.dispose(); debugPanel?.dispose?.(); runtime.dispose(); audio.dispose(); bus.clear(); pauseMenu.dispose?.();
    renderer.dispose(); frame.remove(); document.body.classList.remove('game-active');
  } };
}

function gameMarkup() {
  return `<div data-game="app"></div><div id="hud" class="hud"><div class="hud-left"><div class="hud-cell"><span class="hud-label">Score</span><span class="hud-value" data-hud="score">0</span></div><div class="hud-cell hud-hull hidden" data-hud="hull-cell"><span class="hud-label">Hull</span><span class="hud-value" data-hud="hull-pips"></span></div></div><div class="hud-cell hud-time" data-hud="time-cell"><span class="hud-value hud-time-value" data-hud="time">0.0</span></div><div class="hud-cell hud-right"><span class="hud-label">Lock</span><span class="hud-value"><span data-hud="locks">0</span>/6</span></div></div><div id="end-screen" class="end-screen hidden"><div class="end-panel"><div class="label">Score</div><div class="score" data-end="score">0</div><div class="death-status hidden" data-end="death">Signal lost</div><div class="end-detail" data-end="kills">Kills 0/0</div><div class="rank" data-end="rank">D</div><div class="end-extra hidden" data-end="details"></div><div class="replay">Lock all six to replay</div></div></div><div id="damage-flash" class="damage-flash" aria-hidden="true"></div><div id="max-lock-flash" class="max-lock-flash hidden" aria-hidden="true">MAX</div><div id="callout" class="callout hidden" aria-live="polite"></div><div id="tip" class="tip hidden">HOLD to charge — SWEEP across all six targets — RELEASE to fire</div><div id="pause" class="pause-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="pause-panel"><h1 id="pause-title">Paused</h1><button type="button" data-pause="resume">Resume</button><button type="button" data-pause="end-run">End Run</button><button type="button" data-pause="fullscreen">Fullscreen</button><label><span>Music</span><input data-pause="music" type="range" min="0" max="100" value="80" /></label><label><span>Sound Effects</span><input data-pause="sfx" type="range" min="0" max="100" value="80" /></label><label><span>Bloom</span><input data-pause="bloom" type="range" min="0" max="100" value="100" /></label><label><span>Motion Blur</span><input data-pause="motion-blur" type="range" min="0" max="100" value="100" /></label></div></div><div class="scanlines" aria-hidden="true"></div>`;
}

function addCrystalInvitation(summary: RunSummary, frame: HTMLElement) {
  if (frame.querySelector('.crystal-invitation')) return;
  const panel = frame.querySelector('.end-panel'); if (!panel) return;
  const invitation = document.createElement('section'); invitation.className = 'crystal-invitation'; invitation.setAttribute('aria-label', 'What next');
  invitation.innerHTML = `<p><strong>Crystal Corridor</strong> is the polished reference. Ready to see what models can build?</p><div class="invitation-actions"><a class="button primary" href="/rank" data-route="/rank">Rank model levels</a><a class="button" href="/play/crystal-corridor" data-route="/play/crystal-corridor">Replay Crystal</a><a class="button" href="/play" data-route="/play">Explore levels</a></div>`;
  panel.append(invitation);
  void summary;
}

function installLevelPicker(host: HTMLElement, activeId: string, includeTechnical: boolean) {
  const picker = document.createElement('label'); picker.className = 'level-picker'; picker.textContent = 'Level ';
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
  select.addEventListener('change', () => navigate(`/play/${encodeURIComponent(select.value)}`)); picker.append(select); host.append(picker);
}
function canUseFullscreen() { return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen); }
async function setFullscreen(enabled: boolean) { try { if (enabled) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch (error) { console.warn('Fullscreen request failed', error); } }
function readStoredPercent(key: string, fallback: number) { const raw = localStorage.getItem(key); if (raw === null) return fallback; const value = Number(raw); return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback; }
