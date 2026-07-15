import { useCallback, useEffect, useState } from 'react';
import { SiteLayout } from './layout/SiteLayout';
import { parseRoute, navigate, levelsViewPath, type AppRoute } from './router';
import { AboutPage, HomePage, LeaderboardPage, NotFoundPage } from './pages/PublicPages';
import { LevelsPage } from './pages/LevelsPage';
import { PlayRoute } from './pages/GamePage';
import { RankPage } from './pages/RankPage';

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute());
  const onNavigate = useCallback((path: string) => navigate(path), []);

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // /play predates /levels and still resolves there; canonicalize the address bar.
  useEffect(() => {
    if (route.kind === 'levels' && window.location.pathname === '/play') {
      window.history.replaceState({}, '', levelsViewPath.gallery);
    }
  }, [route]);

  useEffect(() => {
    document.title = route.kind === 'home'
      ? 'Pareto Rail'
      : route.kind === 'notFound'
        ? 'Pareto Rail — Not found'
        : `Pareto Rail — ${route.kind[0].toUpperCase()}${route.kind.slice(1)}`;
  }, [route]);

  return <SiteLayout route={route} onNavigate={onNavigate}>{renderPage(route, onNavigate)}</SiteLayout>;
}

function renderPage(route: AppRoute, onNavigate: (path: string) => void) {
  if (route.kind === 'home') return <HomePage onNavigate={onNavigate} />;
  if (route.kind === 'play') return <PlayRoute route={route} onNavigate={onNavigate} />;
  if (route.kind === 'levels') return <LevelsPage route={route} onNavigate={onNavigate} />;
  if (route.kind === 'rank') return <RankPage route={route} onNavigate={onNavigate} />;
  if (route.kind === 'leaderboard') return <LeaderboardPage onNavigate={onNavigate} />;
  if (route.kind === 'about') return <AboutPage />;
  return <NotFoundPage onNavigate={onNavigate} />;
}
