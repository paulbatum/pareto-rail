import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LevelDefinition } from '../../engine/types';
import type { RunSummary } from '../../engine/scoring';
import type { GameMount, GameLaunchContext, GameLoadProgress } from '../../game';
import { mountGame } from '../../game';
import { GameRuntimeShell } from '../../game/GameRuntimeShell';
import { LoadingPanel } from './LoadingPanel';

export type GameFrameProps = {
  level: LevelDefinition;
  title?: string;
  launchContext?: GameLaunchContext;
  onRunEnd?: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void>;
  runEndContent?: ReactNode;
};

export function GameFrame({ level, title = level.title, launchContext, onRunEnd, runEndContent }: GameFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const runtimeRef = useRef<HTMLDivElement>(null);
  const [endPanel, setEndPanel] = useState<HTMLElement | null>(null);
  /* The frame stays hidden behind the loading panel until the mount settles. */
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<GameLoadProgress | null>(null);

  useEffect(() => {
    const runtimeRoot = runtimeRef.current;
    const frame = frameRef.current;
    if (!runtimeRoot || !frame) return;
    const controller = new AbortController();
    let game: GameMount | null = null;
    setEndPanel(null);
    setLoaded(false);
    setProgress(null);
    document.title = `Pareto Rail — ${title}`;

    void mountGame({
      host: runtimeRoot,
      level,
      signal: controller.signal,
      launchContext,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setProgress(progress);
      },
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
    }).finally(() => {
      if (!controller.signal.aborted) setLoaded(true);
    });

    return () => {
      controller.abort();
      game?.dispose();
    };
  }, [level, title, launchContext?.source, launchContext?.levelId, launchContext?.mode, onRunEnd]);

  return <>
    {!loaded && <LoadingPanel progress={progress} />}
    <section className={loaded ? 'game-frame' : 'game-frame loading'} aria-label={`${title} game`} ref={frameRef}>
      <div className="game-mount">
        <GameRuntimeShell ref={runtimeRef} />
      </div>
    </section>
    {endPanel && runEndContent ? createPortal(runEndContent, endPanel) : null}
  </>;
}
