import { selectableLevelGroups } from '../levels';
import type { AppRoute } from './router';
import { navigate, routePath } from './router';

export type AppShell = ReturnType<typeof createAppShell>;

export function createAppShell(onRoute: (path: string) => void) {
  const root = document.createElement('div');
  root.className = 'app-shell';
  const nav = document.createElement('header');
  nav.className = 'site-nav';
  nav.innerHTML = `<a class="wordmark" href="/" data-route="/"><svg class="wordmark-mark" viewBox="0 0 36 24" aria-hidden="true"><path d="M2 20h32M4 18 11 11l6 4 8-10 7 3"/><path d="M26 3h6v6"/><circle cx="4" cy="18" r="1.6"/><circle cx="11" cy="11" r="1.6"/><circle cx="17" cy="15" r="1.6"/><circle cx="25" cy="5" r="1.6"/></svg><span>Pareto Rail</span></a>
    <nav aria-label="Primary"><a href="/play" data-route="/play">Play</a><a href="/rank" data-route="/rank">Rank</a><a href="/leaderboard" data-route="/leaderboard">Leaderboard</a><a href="/about" data-route="/about">About</a></nav>`;
  const main = document.createElement('main');
  main.className = 'app-content';
  root.append(nav, main);

  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-route]');
    if (!target) return;
    event.preventDefault();
    onRoute(target.dataset.route ?? target.getAttribute('href') ?? '/');
  });

  function render(route: AppRoute) {
    root.dataset.route = route.kind;
    nav.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach((link) => {
      const active = link.dataset.route === routePath(route) || (route.kind === 'play' && link.dataset.route === '/play');
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (route.kind === 'home') renderHome(main);
    else if (route.kind === 'play') renderPlay(main, route.levelId);
    else if (route.kind === 'rank') renderRank(main);
    else if (route.kind === 'leaderboard') renderLeaderboard(main);
    else renderAbout(main);
  }

  return { root, main, render };
}

function renderHome(host: HTMLElement) {
  host.innerHTML = `<section class="hero page-panel"><p class="eyebrow">A browser rail shooter benchmark</p><h1>One rail. Six locks.<br><span>Endless possibilities.</span></h1><p class="lede">Models build one-shot rail-shooter levels. People play them blind, then decide what feels best.</p><div class="action-row"><a class="button primary" href="/play/crystal-corridor" data-route="/play/crystal-corridor">Play Crystal</a><a class="button" href="/rank" data-route="/rank">Rank model levels</a></div></section><section class="home-note"><strong>Crystal Corridor</strong> is a polished reference run — a quick way to learn the lock-on rhythm before exploring generated levels.</section>`;
}

function renderPlay(host: HTMLElement, activeId?: string) {
  const groups = selectableLevelGroups();
  host.innerHTML = `<section class="page-panel"><p class="eyebrow">Play</p><h1>Choose a level</h1><p class="lede">Start with Crystal Corridor, then explore the curated collection and generated benchmark outputs.</p><div class="level-groups"></div></section>`;
  const groupsHost = host.querySelector<HTMLElement>('.level-groups');
  if (!groupsHost) return;
  const sections = [
    { label: 'Built-in levels', levels: groups.builtIn, meta: (id: string) => id === 'crystal-corridor' ? 'Reference run' : 'Built-in level' },
    { label: 'Benchmark levels', levels: groups.benchmark, meta: () => 'Benchmark output' },
  ];
  for (const section of sections) {
    if (section.levels.length === 0) continue;
    const wrapper = document.createElement('section');
    wrapper.className = 'level-group';
    const heading = document.createElement('h2');
    heading.textContent = section.label;
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const level of section.levels) {
      const card = document.createElement('a');
      card.className = `level-card${level.id === activeId ? ' selected' : ''}`;
      card.href = `/play/${encodeURIComponent(level.id)}`;
      card.dataset.route = card.getAttribute('href')!;
      const title = document.createElement('span');
      title.className = 'level-card-title';
      title.textContent = level.title;
      const meta = document.createElement('span');
      meta.className = 'level-card-meta';
      meta.textContent = section.meta(level.id);
      card.append(title, meta);
      grid.append(card);
    }
    wrapper.append(heading, grid);
    groupsHost.append(wrapper);
  }
}

function renderRank(host: HTMLElement) {
  host.innerHTML = `<section class="page-panel"><p class="eyebrow">Rank</p><h1>Play it blind. Pick a favorite.</h1><p class="lede">Every matchup pairs two independent model-built levels from the same assignment. Play both, then make one clear choice.</p><div class="info-grid"><div><span class="step">01</span><h2>Play</h2><p>See Level A and Level B without model or cost labels.</p></div><div><span class="step">02</span><h2>Choose</h2><p>Vote for the better run, or tell us both were good or bad.</p></div><div><span class="step">03</span><h2>Reveal</h2><p>Learn what made each level and how much it cost.</p></div></div><button class="button primary" type="button" data-coming-soon>Start a matchup</button><p class="muted" data-rank-status>Pairing service coming online — you can still browse the public results.</p></section>`;
}

function renderLeaderboard(host: HTMLElement) {
  host.innerHTML = `<section class="page-panel"><p class="eyebrow">Leaderboard</p><h1>Quality meets cost.</h1><p class="lede">Aggregate benchmark rankings will appear here as public comparisons accumulate.</p><div class="empty-state"><span class="empty-glyph">◌</span><h2>Public results are warming up</h2><p>Until the first release, this page remains useful context-free: no WebGPU, no account, and no game required.</p></div><a class="text-link" href="/about" data-route="/about">Read the methodology →</a></section>`;
}

function renderAbout(host: HTMLElement) {
  host.innerHTML = `<section class="page-panel prose"><p class="eyebrow">About</p><h1>A fairer way to compare generated play.</h1><p class="lede">Pareto Rail measures the part that matters most: how a level feels when a person has to play it.</p><h2>How it works</h2><p>Entrants receive the same theme and build independently. Players see two anonymous levels, complete a run or die trying, and vote once they have played both.</p><h2>What we publish</h2><p>Public results separate preference quality from measured generation cost, show sample counts, and call out provisional data, ties, and DNFs. Crystal Corridor is a human-built reference, not a benchmark entrant.</p><h2>Limitations</h2><p>Early ratings are estimates. Browser play is voluntary and subjective. We never expose private prompts, credentials, raw logs, or unpublished entrant mappings.</p></section>`;
}

export function createGameFrame(levelTitle: string, backPath = '/play', backLabel = 'Levels') {
  const frame = document.createElement('section');
  frame.className = 'game-frame';
  frame.setAttribute('aria-label', `${levelTitle} game`);
  frame.innerHTML = `<div class="game-toolbar"><a class="game-back" href="${backPath}" data-route="${backPath}">← ${backLabel}</a><span class="game-title"></span></div><div class="game-mount"></div>`;
  frame.querySelector('.game-title')!.textContent = levelTitle;
  return frame;
}
