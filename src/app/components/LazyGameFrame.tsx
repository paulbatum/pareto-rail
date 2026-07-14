import { lazy, Suspense } from 'react';
import type { GameFrameProps } from './GameFrame';

// GameFrame pulls in the three.js/WebGPU runtime, so it loads on demand. This keeps
// the content pages (home, about, leaderboard) and the level/matchup pickers out of
// that chunk — they only pay for it once a game actually mounts.
const GameFrameImpl = lazy(() => import('./GameFrame').then((module) => ({ default: module.GameFrame })));

export function GameFrame(props: GameFrameProps) {
  return (
    <Suspense fallback={<section className="page-panel"><p className="eyebrow">Loading</p><h1>Preparing renderer…</h1></section>}>
      <GameFrameImpl {...props} />
    </Suspense>
  );
}
