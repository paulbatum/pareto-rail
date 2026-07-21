import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  /* The nav wraps and restacks with viewport width, and hides outright in
     fullscreen, so its height is published as `--nav-h` for the game frame to
     inset by rather than being hardcoded. */
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const publish = () => {
      document.documentElement.style.setProperty('--nav-h', `${header.getBoundingClientRect().height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--nav-h');
    };
  }, []);

  const toggleTheme = () => {
    setActiveTheme(nextTheme);
  };

  return (
    <div className="app-shell" data-route={route.kind}>
      <header className="site-nav" ref={headerRef}>
        <RouteLink className="wordmark" href="/" onNavigate={onNavigate}>
          <svg className="wordmark-mark" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="4.5" y="4.5" width="13" height="13" transform="rotate(45 11 11)" />
            <circle className="wordmark-dot" cx="11" cy="11" r="3" />
          </svg>
          <span>Pareto Rail</span>
        </RouteLink>
        {/* Filled by GameFrame during play; collapses to nothing everywhere else. */}
        <div className="nav-game-slot" id="nav-game-slot" />
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
          <a className="icon-link" href="https://github.com/paulbatum/pareto-rail" target="_blank" rel="noreferrer" aria-label="Source on GitHub">
            <GitHubMark />
          </a>
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

function GitHubMark() {
  return (
    <svg className="icon-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
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
