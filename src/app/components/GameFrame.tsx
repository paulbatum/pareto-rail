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
  launchContext?: GameLaunchContext;
  onNavigate: (path: string) => void;
  onRunEnd?: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void>;
  runEndContent?: ReactNode;
};

export function GameFrame({ level, title = level.title, launchContext, onNavigate, onRunEnd, runEndContent }: GameFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const runtimeRef = useRef<HTMLDivElement>(null);
  const [endPanel, setEndPanel] = useState<HTMLElement | null>(null);

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
  }, [level, title, launchContext?.source, launchContext?.levelId, launchContext?.mode, onRunEnd]);

  const endContent = runEndContent ?? (level.id === 'crystal-corridor' ? <CrystalInvitation onNavigate={onNavigate} /> : null);

  return <>
    <section className="game-frame" aria-label={`${title} game`} ref={frameRef}>
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
      <p>Ready to see what models can build?</p>
      <div className="invitation-actions">
        <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Rank model levels</RouteLink>
      </div>
    </section>
  );
}
