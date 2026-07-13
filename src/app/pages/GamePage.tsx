import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LevelDefinition } from '../../engine/types';
import type { RunSummary } from '../../engine/scoring';
import { getLevelEntryById } from '../../levels';
import { mountGame, type GameMount, type GameLaunchContext } from '../../game';
import { GameRuntimeShell } from '../../game/GameRuntimeShell';
import type { AppRoute } from '../router';
import { RouteLink } from '../components/RouteLink';
import { PlayPage } from './PublicPages';

type GameFrameProps = {
  level: LevelDefinition;
  title?: string;
  backPath?: string;
  backLabel?: string;
  launchContext?: GameLaunchContext;
  showLevelPicker?: boolean;
  onNavigate: (path: string) => void;
  onRunEnd?: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void>;
  runEndContent?: ReactNode;
};

export function GameFrame({ level, title = level.title, backPath = '/play', backLabel = 'Levels', launchContext, showLevelPicker, onNavigate, onRunEnd, runEndContent }: GameFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const runtimeRef = useRef<HTMLDivElement>(null);
  const [endPanel, setEndPanel] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const runtimeRoot = runtimeRef.current;
    const frame = frameRef.current;
    if (!runtimeRoot || !frame) return;
    let disposed = false;
    let game: GameMount | null = null;
    setEndPanel(null);
    document.title = `Pareto Rail — ${title}`;

    void mountGame({
      host: runtimeRoot,
      level,
      launchContext,
      showLevelPicker,
      onRunEnd: (summary, context) => {
        if (disposed) return;
        setEndPanel(frame.querySelector<HTMLElement>('.end-panel'));
        void onRunEnd?.(summary, frame, context);
      },
    }).then((mounted) => {
      if (disposed) mounted.dispose();
      else game = mounted;
    });

    return () => {
      disposed = true;
      game?.dispose();
    };
  }, [level, title, launchContext?.source, launchContext?.levelId, launchContext?.mode, showLevelPicker, onRunEnd]);

  const endContent = runEndContent ?? (level.id === 'crystal-corridor' ? <CrystalInvitation onNavigate={onNavigate} /> : null);

  return <>
    <section className="game-frame" aria-label={`${title} game`} ref={frameRef}>
      <div className="game-toolbar" data-game-ui>
        <RouteLink className="game-back" href={backPath} onNavigate={onNavigate}>← {backLabel}</RouteLink>
        <span className="game-title">{title}</span>
      </div>
      <div className="game-mount">
        <GameRuntimeShell ref={runtimeRef} />
      </div>
    </section>
    {endPanel && endContent ? createPortal(endContent, endPanel) : null}
  </>;
}

function CrystalInvitation({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="crystal-invitation" aria-label="What next">
      <p><strong>Crystal Corridor</strong> is the polished reference. Ready to see what models can build?</p>
      <div className="invitation-actions">
        <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Rank model levels</RouteLink>
        <RouteLink className="button" href="/play/crystal-corridor" onNavigate={onNavigate}>Replay Crystal</RouteLink>
        <RouteLink className="button" href="/play" onNavigate={onNavigate}>Explore levels</RouteLink>
      </div>
    </section>
  );
}

export function PlayRoute({ route, onNavigate }: { route: Extract<AppRoute, { kind: 'play' }>; onNavigate: (path: string) => void }) {
  const [level, setLevel] = useState<LevelDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLevel(null);
    setError(null);
    if (!route.levelId) return () => { active = false; };
    void getLevelEntryById(route.levelId).then((entry) => entry.load()).then((loaded) => {
      if (active) setLevel(loaded);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Level could not be loaded');
    });
    return () => { active = false; };
  }, [route.levelId]);

  if (!route.levelId) return <PlayPage onNavigate={onNavigate} />;
  if (error) return <section className="page-panel"><p className="eyebrow">Play</p><h1>Level unavailable</h1><p className="lede">{error}</p><RouteLink className="button" href="/play" onNavigate={onNavigate}>Back to levels</RouteLink></section>;
  if (!level) return <section className="page-panel"><p className="eyebrow">Loading</p><h1>Preparing level…</h1></section>;
  return <GameFrame level={level} onNavigate={onNavigate} />;
}
