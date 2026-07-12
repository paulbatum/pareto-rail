import type { ReactNode } from 'react';
import { routePath, type AppRoute } from '../router';
import { RouteLink } from '../components/RouteLink';

const navigation = [
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
          <svg className="wordmark-mark" viewBox="0 0 36 24" aria-hidden="true">
            <path d="M2 20h32M4 18 11 11l6 4 8-10 7 3" />
            <path d="M26 3h6v6" />
            <circle cx="4" cy="18" r="1.6" /><circle cx="11" cy="11" r="1.6" />
            <circle cx="17" cy="15" r="1.6" /><circle cx="25" cy="5" r="1.6" />
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
      <main className="app-content">{children}</main>
    </div>
  );
}
