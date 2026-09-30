import type { GameLoadProgress } from '../../game';

/* Where the bar sits at each stage. On a cold load the shader compiles take most of the
   time and the effects frame about a third of it, so they get the width in that ratio. */
function describe(progress: GameLoadProgress | null): { label: string; fraction: number } {
  if (!progress) return { label: 'Loading level', fraction: 0.04 };
  switch (progress.stage) {
    case 'scene': return { label: 'Building scene', fraction: 0.1 };
    case 'shaders': return {
      label: `Compiling shaders ${progress.done} / ${progress.total}`,
      fraction: 0.15 + 0.55 * (progress.total > 0 ? progress.done / progress.total : 1),
    };
    case 'effects': return { label: 'Warming up effects', fraction: 0.75 };
  }
}

/**
 * The one screen a player sees from following a play link until the level's first frame:
 * the level module download, the renderer chunk, and the runtime's own load stages.
 */
export function LoadingPanel({ progress = null }: { progress?: GameLoadProgress | null }) {
  const { label, fraction } = describe(progress);
  return (
    <section className="page-panel game-loading">
      <p className="eyebrow">Loading</p>
      <h1>Preparing level…</h1>
      <div className="game-loading-bar" role="progressbar" aria-label="Loading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <span style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <p className="game-loading-stage" aria-live="polite">{label}</p>
    </section>
  );
}
