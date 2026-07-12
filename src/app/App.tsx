import { useCallback, useEffect, useState } from 'react';
import { SiteLayout } from './layout/SiteLayout';
import { parseRoute, navigate, type AppRoute } from './router';
import { AboutPage, HomePage, LeaderboardPage } from './pages/PublicPages';
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

  useEffect(() => {
    document.title = route.kind === 'home'
      ? 'Pareto Rail'
      : `Pareto Rail — ${route.kind[0].toUpperCase()}${route.kind.slice(1)}`;
  }, [route]);

  return <SiteLayout route={route} onNavigate={onNavigate}>{renderPage(route, onNavigate)}</SiteLayout>;
}

function renderPage(route: AppRoute, onNavigate: (path: string) => void) {
  if (route.kind === 'home') return <HomePage onNavigate={onNavigate} />;
  if (route.kind === 'play') return <PlayRoute route={route} onNavigate={onNavigate} />;
  if (route.kind === 'rank') return <RankPage route={route} onNavigate={onNavigate} />;
  if (route.kind === 'leaderboard') return <LeaderboardPage onNavigate={onNavigate} />;
  return <AboutPage />;
}
