import { useEffect, useState, type ReactNode } from 'react';
import { routePath, type AppRoute } from '../router';
import { RouteLink } from '../components/RouteLink';
import { getTheme, setTheme, type Theme } from '../theme';

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/rank', label: 'Rank' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/levels', label: 'Levels' },
  ...(import.meta.env.DEV ? [{ href: '/analysis', label: 'Analysis' }] : []),
  { href: '/about', label: 'About' },
];

type SiteLayoutProps = {
  route: AppRoute;
  onNavigate: (path: string) => void;
  children: ReactNode;
};

export function SiteLayout({ route, onNavigate, children }: SiteLayoutProps) {
  const currentPath = routePath(route);
  const [theme, setActiveTheme] = useState<Theme>(() => getTheme());
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setActiveTheme(nextTheme);
  };

  return (
    <div className="app-shell" data-route={route.kind}>
      <header className="site-nav">
        <RouteLink className="wordmark" href="/" onNavigate={onNavigate}>
          <svg className="wordmark-mark" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="4.5" y="4.5" width="13" height="13" transform="rotate(45 11 11)" />
            <circle className="wordmark-dot" cx="11" cy="11" r="3" />
          </svg>
          <span>Pareto Rail</span>
        </RouteLink>
        <nav aria-label="Primary">
          {navigation.map((item) => {
            const active = item.href === currentPath
              || ((route.kind === 'play' || route.kind === 'levels') && item.href === '/levels')
              || (route.kind === 'analysis' && item.href === '/analysis');
            return <RouteLink key={item.href} href={item.href} onNavigate={onNavigate} aria-current={active ? 'page' : undefined}>{item.label}</RouteLink>;
          })}
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${nextTheme} theme`}>
            <ThemeMark theme={nextTheme} />
          </button>
        </nav>
      </header>
      <main className="app-content">{isEntryPoint(route) && <WebGPUNotice />}{children}</main>
    </div>
  );
}

/** Shows the theme you would switch to: a sun for light, a moon for dark. */
function ThemeMark({ theme }: { theme: Theme }) {
  return (
    <svg className="theme-mark" viewBox="0 0 24 24" aria-hidden="true">
      {theme === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4.6" />
          <path d="M12 1.6v2.6M12 19.8v2.6M4.65 4.65l1.85 1.85M17.5 17.5l1.85 1.85M1.6 12h2.6M19.8 12h2.6M4.65 19.35l1.85-1.85M17.5 6.5l1.85-1.85" />
        </>
      ) : (
        <path d="M20.5 14.3A9 9 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8z" />
      )}
    </svg>
  );
}

function isEntryPoint(route: AppRoute): boolean {
  return route.kind === 'levels' || (route.kind === 'rank' && !route.playSide);
}

function WebGPUNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || typeof navigator === 'undefined' || 'gpu' in navigator) return null;
  return <aside className="webgpu-notice" role="status"><span>This game needs WebGPU - recent Chrome or Edge.</span><button type="button" aria-label="Dismiss WebGPU notice" onClick={() => setDismissed(true)}>Dismiss</button></aside>;
}
