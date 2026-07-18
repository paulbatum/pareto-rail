import { useEffect } from 'react';
import type { AppRoute } from '../router';
import { AnalysisIndexPage } from './AnalysisIndexPage';
import { AnalysisPage } from './AnalysisPage';
import './analysis.css';

type AnalysisRouteProps = {
  route: Extract<AppRoute, { kind: 'analysis' }>;
  onNavigate: (path: string) => void;
};

export function AnalysisRoute({ route, onNavigate }: AnalysisRouteProps) {
  useEffect(() => {
    document.title = route.levelId ? `Pareto Rail — Analysis · ${route.levelId}` : 'Pareto Rail — Analysis';
  }, [route.levelId]);

  if (route.levelId) return <AnalysisPage levelId={route.levelId} onNavigate={onNavigate} />;
  return <AnalysisIndexPage onNavigate={onNavigate} />;
}
