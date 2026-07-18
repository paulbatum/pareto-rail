import { useEffect, useState } from 'react';
import { RouteLink } from '../components/RouteLink';
import { loadAnalysisSummaries } from './data';
import { fmtDuration, fmtUsd } from './format';
import type { AnalysisPackageSummary } from './types';

type AnalysisIndexPageProps = { onNavigate: (path: string) => void };

export function AnalysisIndexPage({ onNavigate }: AnalysisIndexPageProps) {
  const [summaries, setSummaries] = useState<AnalysisPackageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAnalysisSummaries()
      .then((loaded) => { if (!cancelled) setSummaries(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load analysis packages'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="analysis-index">
      <header className="levels-header">
        <div>
          <p className="eyebrow">Watch the agent work</p>
          <h1>Run analysis</h1>
        </div>
        <div className="levels-header-meta">
          {summaries && <span className="levels-count">{summaries.length} {summaries.length === 1 ? 'run' : 'runs'} analyzed</span>}
        </div>
      </header>
      <p className="lede analysis-index-lede">
        Every package here is a full benchmark rollout normalized into structured data: the agent&rsquo;s complete
        timeline, its delegation to subagents, every file edit, the screenshots it rendered of its own work while
        building, and an editorial layer of chapters and annotations.
      </p>
      {error && <div className="empty-state"><h2>Could not load packages</h2><p>{error}</p></div>}
      {!error && summaries === null && <p className="analysis-loading">Loading packages…</p>}
      {summaries && summaries.length === 0 && (
        <div className="empty-state">
          <div className="empty-glyph" aria-hidden="true">◇</div>
          <h2>No analysis packages yet</h2>
          <p>Packages appear here when a run under <code>benchmark/analysis/</code> is extracted and committed.</p>
        </div>
      )}
      {summaries && summaries.length > 0 && (
        <div className="analysis-card-grid">
          {summaries.map((summary) => <PackageCard key={summary.id} summary={summary} onNavigate={onNavigate} />)}
        </div>
      )}
    </div>
  );
}

function PackageCard({ summary, onNavigate }: { summary: AnalysisPackageSummary; onNavigate: (path: string) => void }) {
  const { run } = summary;
  const gatesPassed = run.gates.filter((gate) => gate.status === 'passed').length;
  return (
    <RouteLink className="analysis-card" href={`/analysis/${encodeURIComponent(summary.id)}`} onNavigate={onNavigate}>
      <span className="analysis-card-thumb">
        {summary.thumbnail
          ? <img src={summary.thumbnail} alt={`Final gameplay render of ${run.levelTitle}`} loading="lazy" />
          : <span className="thumbnail-fallback"><span>No render</span></span>}
      </span>
      <span className="analysis-card-copy">
        <span className="analysis-card-title-row">
          <strong>{run.levelTitle}</strong>
          <code>{summary.id}</code>
        </span>
        <span className="analysis-card-headline">{summary.headline}</span>
        <span className="analysis-card-meta">
          <span>{fmtUsd(run.cost.totalUsd)}</span>
          <span>{fmtDuration(run.timing.wallTimeSeconds)}</span>
          <span>{run.models.orchestrator}{run.models.delegate ? ` → ${run.models.delegate}` : ''}</span>
          <span className={gatesPassed === run.gates.length ? 'is-pass' : 'is-fail'}>
            {gatesPassed}/{run.gates.length} gates
          </span>
        </span>
      </span>
    </RouteLink>
  );
}
