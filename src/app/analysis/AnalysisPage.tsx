import { useEffect, useMemo, useState } from 'react';
import { RouteLink } from '../components/RouteLink';
import { hasAnalysisPackage, loadAnalysisPackage } from './data';
import { fmtCount, fmtDuration, fmtUsd } from './format';
import { buildAnalysisModel, type AnalysisModel } from './model';
import { StoryView } from './StoryView';
import { TimelineView } from './TimelineView';
import { FilesView } from './FilesView';
import { SnapshotsView } from './SnapshotsView';
import { RunDataView } from './RunDataView';

export type AnalysisView = 'story' | 'timeline' | 'files' | 'snapshots' | 'data';

const VIEWS: { id: AnalysisView; label: string }[] = [
  { id: 'story', label: 'Story' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'files', label: 'Files' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'data', label: 'Run data' },
];

/** A jump target inside the timeline view. The token distinguishes repeated
 * jumps to the same event so the stream re-scrolls each time. */
export type EventFocus = { eventId: string; token: number };

type AnalysisPageProps = { levelId: string; onNavigate: (path: string) => void };

export function AnalysisPage({ levelId, onNavigate }: AnalysisPageProps) {
  const [model, setModel] = useState<AnalysisModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<AnalysisView>(() => initialView());
  const [focus, setFocus] = useState<EventFocus | null>(() => initialFocus());

  useEffect(() => {
    if (!hasAnalysisPackage(levelId)) {
      setError(`No analysis package exists for “${levelId}”.`);
      return;
    }
    let cancelled = false;
    loadAnalysisPackage(levelId)
      .then((pkg) => { if (!cancelled) setModel(buildAnalysisModel(pkg)); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load package'); });
    return () => { cancelled = true; };
  }, [levelId]);

  // Reflect the active view (and focused event) in the address bar so the state
  // deep-links, without pushing history entries for every tab switch.
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== 'story') params.set('view', view);
    if (focus && view === 'timeline') params.set('event', focus.eventId);
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState({}, '', next);
  }, [view, focus]);

  const jumpToEvent = useMemo(() => {
    let token = 0;
    return (eventId: string) => {
      token += 1;
      setView('timeline');
      setFocus({ eventId, token });
    };
  }, []);

  if (error) {
    return (
      <div className="analysis-page">
        <div className="empty-state">
          <div className="empty-glyph" aria-hidden="true">◇</div>
          <h2>Analysis not found</h2>
          <p>{error}</p>
          <p><RouteLink className="text-link" href="/analysis" onNavigate={onNavigate}>Back to all analyzed runs</RouteLink></p>
        </div>
      </div>
    );
  }
  if (!model) return <p className="analysis-loading">Loading rollout…</p>;

  const { run } = model.pkg;
  return (
    <div className="analysis-page">
      <header className="analysis-header">
        <div className="analysis-header-copy">
          <p className="eyebrow"><RouteLink href="/analysis" onNavigate={onNavigate}>Run analysis</RouteLink> / {run.levelId}</p>
          <h1>{run.levelTitle}</h1>
          <p className="analysis-headline">{model.pkg.narrative.headline}</p>
        </div>
        <dl className="analysis-header-stats">
          <Stat label="Total cost" value={fmtUsd(run.cost.totalUsd)} accent />
          <Stat label="Wall time" value={fmtDuration(run.timing.wallTimeSeconds)} />
          <Stat label="Turns" value={fmtCount(run.timing.numTurns)} />
          <Stat label="Events" value={fmtCount(model.merged.length)} />
          <Stat label="Agents" value={String(model.agents.length)} />
          <Stat
            label="Gates"
            value={`${run.gates.filter((gate) => gate.status === 'passed').length}/${run.gates.length}`}
            tone={run.gates.every((gate) => gate.status === 'passed') ? 'pass' : 'fail'}
          />
        </dl>
      </header>

      <nav className="view-toggle analysis-view-toggle" aria-label="Analysis views">
        {VIEWS.map((entry) => (
          <a
            key={entry.id}
            href={`?view=${entry.id}`}
            aria-current={view === entry.id ? 'true' : undefined}
            onClick={(clickEvent) => { clickEvent.preventDefault(); setView(entry.id); }}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      {view === 'story' && <StoryView model={model} onJumpToEvent={jumpToEvent} />}
      {view === 'timeline' && <TimelineView model={model} focus={focus} onJumpToEvent={jumpToEvent} />}
      {view === 'files' && <FilesView model={model} onJumpToEvent={jumpToEvent} />}
      {view === 'snapshots' && <SnapshotsView model={model} onJumpToEvent={jumpToEvent} />}
      {view === 'data' && <RunDataView model={model} />}
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'pass' | 'fail' }) {
  return (
    <div className={tone === 'fail' ? 'is-fail' : undefined}>
      <dt>{label}</dt>
      <dd className={accent ? 'is-accent' : undefined}>{value}</dd>
    </div>
  );
}

function initialView(): AnalysisView {
  const view = new URLSearchParams(window.location.search).get('view');
  return VIEWS.some((entry) => entry.id === view) ? (view as AnalysisView) : 'story';
}

function initialFocus(): EventFocus | null {
  const eventId = new URLSearchParams(window.location.search).get('event');
  return eventId ? { eventId, token: 0 } : null;
}
