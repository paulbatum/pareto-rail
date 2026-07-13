import { useState, type ReactNode } from 'react';
import { routePath, type AppRoute } from '../router';
import { RouteLink } from '../components/RouteLink';

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/play', label: 'Play' },
  { href: '/rank', label: 'Rank' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/about', label: 'About' },
];

type SiteLayoutProps = {
  route: AppRoute;
  onNavigate: (path: string) => void;
  children: ReactNode;
};

export function SiteLayout({ route, onNavigate, children }: SiteLayoutProps) {
  const currentPath = routePath(route);

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
            const active = item.href === currentPath || (route.kind === 'play' && item.href === '/play');
            return <RouteLink key={item.href} href={item.href} onNavigate={onNavigate} aria-current={active ? 'page' : undefined}>{item.label}</RouteLink>;
          })}
        </nav>
      </header>
      <main className="app-content">{isEntryPoint(route) && <WebGPUNotice />}{children}</main>
    </div>
  );
}

function isEntryPoint(route: AppRoute): boolean {
  return (route.kind === 'play' && !route.levelId) || (route.kind === 'rank' && !route.playSide);
}

function WebGPUNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || typeof navigator === 'undefined' || 'gpu' in navigator) return null;
  return <aside className="webgpu-notice" role="status"><span>This game needs WebGPU — recent Chrome or Edge.</span><button type="button" aria-label="Dismiss WebGPU notice" onClick={() => setDismissed(true)}>Dismiss</button></aside>;
}
