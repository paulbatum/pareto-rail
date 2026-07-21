import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LevelDefinition } from '../../engine/types';
import type { RunSummary } from '../../engine/scoring';
import type { GameMount, GameLaunchContext } from '../../game';
import { mountGame } from '../../game';
import { GameRuntimeShell } from '../../game/GameRuntimeShell';
import { RouteLink } from './RouteLink';

export type GameFrameProps = {
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

export function GameFrame({ level, title = level.title, backPath = '/levels', backLabel = 'Levels', launchContext, showLevelPicker, onNavigate, onRunEnd, runEndContent }: GameFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const runtimeRef = useRef<HTMLDivElement>(null);
  const [endPanel, setEndPanel] = useState<HTMLElement | null>(null);
  /* The back link and level title live in the site header rather than over the
     render, where they crowded the score and lock readouts. */
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setNavSlot(document.getElementById('nav-game-slot'));
  }, []);

  useEffect(() => {
    const runtimeRoot = runtimeRef.current;
    const frame = frameRef.current;
    if (!runtimeRoot || !frame) return;
    const controller = new AbortController();
    let game: GameMount | null = null;
    setEndPanel(null);
    document.title = `Pareto Rail — ${title}`;

    void mountGame({
      host: runtimeRoot,
      level,
      signal: controller.signal,
      launchContext,
      showLevelPicker,
      onRunEnd: (summary, context) => {
        if (controller.signal.aborted) return;
        setEndPanel(frame.querySelector<HTMLElement>('.end-panel'));
        void onRunEnd?.(summary, frame, context);
      },
    }).then((mounted) => {
      if (controller.signal.aborted) mounted.dispose();
      else game = mounted;
    }).catch((error: unknown) => {
      console.error(error);
    });

    return () => {
      controller.abort();
      game?.dispose();
    };
  }, [level, title, launchContext?.source, launchContext?.levelId, launchContext?.mode, showLevelPicker, onRunEnd]);

  const endContent = runEndContent ?? (level.id === 'crystal-corridor' ? <CrystalInvitation onNavigate={onNavigate} /> : null);

  return <>
    <section className="game-frame" aria-label={`${title} game`} ref={frameRef}>
      <div className="game-mount">
        <GameRuntimeShell ref={runtimeRef} />
      </div>
    </section>
    {navSlot ? createPortal(
      <div className="game-toolbar">
        <RouteLink className="game-back" href={backPath} onNavigate={onNavigate}>← {backLabel}</RouteLink>
        <span className="game-title">{title}</span>
      </div>,
      navSlot,
    ) : null}
    {endPanel && endContent ? createPortal(endContent, endPanel) : null}
  </>;
}

function CrystalInvitation({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="crystal-invitation" aria-label="What next">
      <p><strong>Crystal Corridor</strong> is the polished reference. Ready to see what models can build?</p>
      <div className="invitation-actions">
        <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Rank model levels</RouteLink>
      </div>
    </section>
  );
}
