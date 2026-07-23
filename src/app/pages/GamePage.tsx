import { useEffect, useState } from 'react';
import type { LevelDefinition } from '../../engine/types';
import { getLevelEntryById } from '../../levels';
import { levelsViewPath, type AppRoute, type LevelsView } from '../router';
import { RouteLink } from '../components/RouteLink';
import { GameFrame } from '../components/LazyGameFrame';

export function PlayRoute({ route, onNavigate }: { route: Extract<AppRoute, { kind: 'play' }>; onNavigate: (path: string) => void }) {
  const [level, setLevel] = useState<LevelDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLevel(null);
    setError(null);
    void getLevelEntryById(route.levelId).then((entry) => entry.load()).then((loaded) => {
      if (active) setLevel(loaded);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Level could not be loaded');
    });
    return () => { active = false; };
  }, [route.levelId]);

  if (error) return <section className="page-panel"><p className="eyebrow">Play</p><h1>Level unavailable</h1><p className="lede">{error}</p><RouteLink className="button" href="/levels" onNavigate={onNavigate}>Back to levels</RouteLink></section>;
  if (!level) return <section className="page-panel"><p className="eyebrow">Loading</p><h1>Preparing level…</h1></section>;
  return <GameFrame level={level} runEndContent={<PlayInvitation levelId={level.id} from={route.from} onNavigate={onNavigate} />} />;
}

/** Crystal Corridor is the reference level, so its run always points on to the
 * comparison it calibrates. The way back only appears for a launch off the
 * Levels page — someone who arrived from the home page or a shared link has no
 * levels page behind them to return to. */
function PlayInvitation({ levelId, from, onNavigate }: { levelId: string; from?: LevelsView; onNavigate: (path: string) => void }) {
  const crystal = levelId === 'crystal-corridor';
  if (!crystal && !from) return null;
  return (
    <section className="crystal-invitation" aria-label="What next">
      <p>{crystal ? 'Ready to see what models can build?' : 'Pick another level when you’re ready.'}</p>
      <div className="invitation-actions">
        {crystal && <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Rank model levels</RouteLink>}
        {from && <RouteLink className={crystal ? 'button' : 'button primary'} href={levelsViewPath[from]} onNavigate={onNavigate}>Back to levels</RouteLink>}
      </div>
    </section>
  );
}
