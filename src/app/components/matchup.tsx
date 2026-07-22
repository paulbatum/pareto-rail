import { useState, type ReactNode } from 'react';
import type { MatchupSide, RevealPayload, VoteVerdict } from '../../benchmark/types';
import { entrantLabel } from '../../benchmark/identity';
import { allCatalogEntrants, rankCatalog, type RankCatalogConfiguration } from '../../benchmark/catalog';
import { ModelUsage } from './ModelUsage';

/** UI shared by the ranked (`/rank`) and casual (`/match`) comparison pages: the
 * compare-card grid, vote buttons, reveal cards, and the generation records the
 * reveal expands. Both pages read the same rank catalog, so the identity and run
 * details rendered here are identical between them. */

export function LevelThumbnail({ side, path }: { side: MatchupSide; path?: string }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) return <div className="thumbnail-fallback" aria-label={`Level ${side.toUpperCase()} thumbnail unavailable`}><span>Level {side.toUpperCase()}</span></div>;
  return <img className="level-thumbnail" src={path} alt={`Anonymous Level ${side.toUpperCase()}`} onError={() => setFailed(true)} />;
}

export function CompareCard({ side, thumbnailPath, className, primary = false, buttonLabel, onLaunch, children }: {
  side: MatchupSide;
  thumbnailPath?: string;
  className?: string;
  primary?: boolean;
  buttonLabel: string;
  onLaunch: () => void;
  children?: ReactNode;
}) {
  return <article className={`compare-card${className ? ` ${className}` : ''}`}>
    <h2>Level {side.toUpperCase()}</h2>
    <LevelThumbnail side={side} path={thumbnailPath} />
    {children}
    <button className={`button${primary ? ' primary' : ''}`} type="button" onClick={onLaunch}>{buttonLabel}</button>
  </article>;
}

export function VersusGrid({ a, b }: { a: ReactNode; b: ReactNode }) {
  return <div className="compare-grid">{a}<div className="versus-divider" aria-label="Versus"><span>VS</span></div>{b}</div>;
}

export function VoteButtons({ onVote }: { onVote: (verdict: VoteVerdict) => void }) {
  return <div className="vote-grid" role="group" aria-label="Choose a verdict">
    <button className="button primary" type="button" onClick={() => onVote('a-better')}>A is better</button>
    <button className="button primary" type="button" onClick={() => onVote('b-better')}>B is better</button>
    <button className="button" type="button" onClick={() => onVote('both-good')}>Both are good</button>
    <button className="button" type="button" onClick={() => onVote('both-bad')}>Both are bad</button>
  </div>;
}

export function RevealCards({ reveal, sideAnnotation }: { reveal: RevealPayload; sideAnnotation?: (side: MatchupSide) => ReactNode }) {
  const card = (side: MatchupSide) => {
    const entrant = reveal[side];
    const marker = revealMarker(reveal.vote.verdict, side);
    return <article className={`reveal-card${marker.className}`}>
      {marker.label && <span className="reveal-tag">{marker.label}</span>}
      <LevelThumbnail side={side} path={entrant.thumbnailPath} />
      <h2>Level {side.toUpperCase()}</h2>
      {sideAnnotation?.(side)}
      <p className="identity">{entrantLabel({ modelName: entrant.modelName, snapshotLabel: entrant.snapshotLabel, workflowName: entrant.workflowName })}</p>
      <p className="cost"><strong className="cost-value">${entrant.generationCost.toFixed(2)}</strong><span className="cost-label">measured generation cost</span></p>
      <GenerationDetails entrant={entrant} />
    </article>;
  };
  return <div className="reveal-grid">{card('a')}{card('b')}</div>;
}

export function RevealStage({ reveal, onNext }: { reveal: RevealPayload; onNext: () => void }) {
  return <><RevealCards reveal={reveal} /><div className="reveal-actions"><button className="button primary" type="button" onClick={onNext}>Next matchup</button></div></>;
}

export function GenerationDetails({ entrant, expanded = false }: { entrant: RevealPayload['a']; expanded?: boolean }) {
  const published = allCatalogEntrants(rankCatalog).find((candidate) => candidate.levelId === entrant.levelId);
  const run = entrant.run ?? published?.run;
  if (!run) return null;
  const configuration = configurationFor(entrant.configurationId);
  const Shell = expanded ? 'div' : 'details';
  return <Shell className={`run-details${expanded ? ' expanded' : ''}`}>
    {!expanded && <summary><span>Generation details</span><span>{formatDuration(run.generationWallTimeSeconds)} · {run.models.length} model{run.models.length === 1 ? '' : 's'}</span></summary>}
    <div className="run-details-body">
      <dl className="run-facts">
        <div><dt>Level ID</dt><dd>{entrant.levelId}</dd></div>
        <div><dt>Generation</dt><dd title={`${run.generationWallTimeSeconds.toLocaleString('en-US')} seconds`}>{formatDuration(run.generationWallTimeSeconds)}</dd></div>
        <div><dt>Full run</dt><dd title={`${run.totalWallTimeSeconds.toLocaleString('en-US')} seconds`}>{formatDuration(run.totalWallTimeSeconds)}</dd></div>
        <div><dt>Result</dt><dd>{formatRunResult(run.result)}</dd></div>
        {run.harness && <div><dt>Harness</dt><dd>{run.harness.name} {run.harness.version}</dd></div>}
      </dl>
      <div className="model-usage-list" aria-label="Token usage by model">
        <p>Token usage by model</p>
        {run.models.map((model) => <ModelUsage key={`${model.modelName}-${model.role}`} model={model} showRole={run.models.length > 1} />)}
      </div>
      {configuration && <WorkflowDetails configuration={configuration} />}
      <p className="run-data-note">Generation time covers the model session. Full run time also includes deterministic setup, sealing, and verification. Total input counts every token the model read, cached or not, since each harness bills first-sight tokens differently. Output includes reasoning tokens.</p>
    </div>
  </Shell>;
}

export function WorkflowDetails({ configuration }: { configuration: RankCatalogConfiguration }) {
  return <div className="workflow-details">
    <p><strong>{entrantLabel({ modelName: configuration.modelName, workflowName: configuration.workflowName })}</strong> {configuration.workflowSummary}</p>
    <dl><div><dt>Primary</dt><dd>{configuration.primaryModel} · {configuration.effort} effort</dd></div>{configuration.delegateModel && <div><dt>Requested delegate</dt><dd>{configuration.delegateModel} · {configuration.delegateEffort} effort</dd></div>}</dl>
    {configuration.delegationGuidance && <blockquote><span>Delegation guidance</span>{configuration.delegationGuidance}</blockquote>}
  </div>;
}

export function revealMarker(verdict: VoteVerdict, side: MatchupSide): { className: string; label: string | null } {
  if (verdict === 'both-good') return { className: ' is-picked', label: 'Your pick' };
  if (verdict === 'both-bad') return { className: ' is-rejected', label: 'Not preferred' };
  const picked = verdict === 'a-better' ? 'a' : 'b';
  return picked === side ? { className: ' is-picked', label: 'Your pick' } : { className: '', label: null };
}

function configurationFor(configurationId?: string): RankCatalogConfiguration | undefined {
  return configurationId ? rankCatalog.configurations?.find((configuration) => configuration.id === configurationId) : undefined;
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatRunResult(result: string): string {
  if (result === 'completed') return 'Completed';
  if (result === 'timed-out') return 'Timed out · playable output retained';
  return result.replaceAll('-', ' ');
}
