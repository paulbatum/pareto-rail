export type LevelsView = 'gallery' | 'data';

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'play'; levelId: string }
  | { kind: 'levels'; view: LevelsView }
  | { kind: 'rank'; playSide?: 'a' | 'b' }
  | { kind: 'analysis'; levelId?: string }
  | { kind: 'leaderboard' }
  | { kind: 'about' }
  | { kind: 'notFound' };

export const levelsViewPath: Record<LevelsView, string> = { gallery: '/levels', data: '/levels/data' };

export function parseRoute(location: Location = window.location): AppRoute {
  const path = location.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  // Keep old ?level= links working while giving new links a canonical shape.
  const legacyLevel = new URLSearchParams(location.search).get('level');
  if (legacyLevel && (path === '/' || path === '/play')) return { kind: 'play', levelId: legacyLevel };
  if (path.startsWith('/play/')) return { kind: 'play', levelId: decodeURIComponent(path.slice('/play/'.length)) };
  // /play was the level picker before /levels existed; it stays a working alias.
  if (path === '/play' || path === '/levels') return { kind: 'levels', view: 'gallery' };
  if (path === '/levels/data') return { kind: 'levels', view: 'data' };
  if (path === '/rank') {
    const play = new URLSearchParams(location.search).get('play');
    return { kind: 'rank', playSide: play === 'a' || play === 'b' ? play : undefined };
  }
  if (path === '/analysis') return { kind: 'analysis' };
  if (path.startsWith('/analysis/')) return { kind: 'analysis', levelId: decodeURIComponent(path.slice('/analysis/'.length)) };
  if (path === '/leaderboard') return { kind: 'leaderboard' };
  if (path === '/about') return { kind: 'about' };
  if (path === '/') return { kind: 'home' };
  return { kind: 'notFound' };
}

export function routePath(route: AppRoute): string {
  if (route.kind === 'home') return '/';
  if (route.kind === 'play') return `/play/${encodeURIComponent(route.levelId)}`;
  if (route.kind === 'levels') return levelsViewPath[route.view];
  if (route.kind === 'analysis') return route.levelId ? `/analysis/${encodeURIComponent(route.levelId)}` : '/analysis';
  if (route.kind === 'notFound') return window.location.pathname;
  return `/${route.kind}`;
}

export function navigate(path: string, replace = false) {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
