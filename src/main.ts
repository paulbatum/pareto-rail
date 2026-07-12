import './style.css';
import './app/style.css';
import { getBenchmarkLevelById, getLevelById, getLevelEntryById } from './levels';
import { createAppShell, createGameFrame } from './app/shell';
import { navigate, parseRoute } from './app/router';
import { mountGame, type GameMount } from './game';
import { installDevErrorOverlay } from './ui/dev-error-overlay';
import { RankController } from './app/rank';

async function bootstrap() {
  if (import.meta.env.DEV) installDevErrorOverlay();
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root');
  let game: GameMount | null = null;
  let renderToken = 0;
  const rank = import.meta.env.DEV
    ? await import('./benchmark/fixtures').then(({ createDevelopmentFixtureApi, createFixtureCatalog, playableLevelId }) => {
      const catalog = createFixtureCatalog('development');
      return new RankController({
        api: createDevelopmentFixtureApi(),
        resolvePlayable: (ref) => playableLevelId(ref, catalog),
      });
    })
    : new RankController();
  const shell = createAppShell((path) => navigate(path));
  app.replaceChildren(shell.root);
  document.body.classList.remove('booting');
  const render = async () => {
    const token = ++renderToken;
    game?.dispose(); game = null;
    document.body.classList.remove('game-active');
    const route = parseRoute();
    shell.render(route);
    document.title = route.kind === 'home' ? 'Pareto Rail' : `Pareto Rail — ${route.kind[0].toUpperCase()}${route.kind.slice(1)}`;
    if (route.kind === 'rank') {
      await rank.render(shell.main, (path) => navigate(path));
      if (token !== renderToken) return;
      if (!route.playSide) return;
      const launch = rank.launch(route.playSide);
      if (!launch) return;
      // Development rehearsal fixtures still point at their legacy local
      // modules. A production matchup is resolved through the benchmark-only
      // catalog, never by searching the mixed browsing list.
      const level = import.meta.env.DEV
        ? await getLevelById(launch.levelId)
        : await getBenchmarkLevelById(launch.levelId);
      if (token !== renderToken) return;
      const frame = createGameFrame(`Level ${launch.side.toUpperCase()}`, '/rank', 'Matchup');
      shell.main.replaceChildren(frame);
      const host = frame.querySelector<HTMLElement>('.game-mount');
      if (!host) return;
      game = await mountGame({ host, level, launchContext: { source: 'rank', levelId: launch.levelId, mode: 'benchmark' }, showLevelPicker: false, onRunEnd: async () => {
        await rank.completeRun(launch.side);
        addBenchmarkInvitation(frame, launch.side);
      } });
      return;
    }
    if (route.kind !== 'play' || !route.levelId) return;
    const entry = await getLevelEntryById(route.levelId);
    const level = await entry.load();
    if (token !== renderToken) return;
    shell.render(route);
    const frame = createGameFrame(level.title);
    shell.main.replaceChildren(frame);
    const host = frame.querySelector<HTMLElement>('.game-mount');
    if (!host) return;
    document.title = `Pareto Rail — ${level.title}`;
    game = await mountGame({ host, level, launchContext: { source: 'play', levelId: level.id, mode: entry.domain === 'benchmark' ? 'benchmark' : 'reference' } });
  };
  window.addEventListener('popstate', () => void render());
  await render();
}

function addBenchmarkInvitation(frame: HTMLElement, side: 'a' | 'b') {
  const panel = frame.querySelector<HTMLElement>('.end-panel');
  if (!panel || panel.querySelector('.benchmark-invitation')) return;
  const invitation = document.createElement('section');
  invitation.className = 'benchmark-invitation';
  const replayPath = `/rank?play=${side}`;
  invitation.innerHTML = `<p>Level ${side.toUpperCase()} recorded. Continue when you are ready.</p><div class="invitation-actions"><a class="button primary" href="/rank" data-route="/rank">Continue comparison</a><a class="button" href="${replayPath}" data-route="${replayPath}">Replay Level ${side.toUpperCase()}</a></div>`;
  panel.append(invitation);
}

void bootstrap();
