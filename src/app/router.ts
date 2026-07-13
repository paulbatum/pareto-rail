export type AppRoute =
  | { kind: 'home' }
  | { kind: 'play'; levelId?: string }
  | { kind: 'rank'; playSide?: 'a' | 'b' }
  | { kind: 'leaderboard' }
  | { kind: 'about' };

export function parseRoute(location: Location = window.location): AppRoute {
  const path = location.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  // Keep old ?level= links working while giving new links a canonical shape.
  const legacyLevel = new URLSearchParams(location.search).get('level');
  if (legacyLevel && (path === '/' || path === '/play')) return { kind: 'play', levelId: legacyLevel };
  if (path === '/play') return { kind: 'play' };
  if (path.startsWith('/play/')) return { kind: 'play', levelId: decodeURIComponent(path.slice('/play/'.length)) };
  if (path === '/rank') {
    const play = new URLSearchParams(location.search).get('play');
    return { kind: 'rank', playSide: play === 'a' || play === 'b' ? play : undefined };
  }
  if (path === '/leaderboard') return { kind: 'leaderboard' };
  if (path === '/about') return { kind: 'about' };
  return { kind: 'home' };
}

export function routePath(route: AppRoute): string {
  if (route.kind === 'home') return '/';
  if (route.kind === 'play') return route.levelId ? `/play/${encodeURIComponent(route.levelId)}` : '/play';
  return `/${route.kind}`;
}

export function navigate(path: string, replace = false) {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
