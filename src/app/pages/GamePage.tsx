import { useEffect, useState } from 'react';
import type { LevelDefinition } from '../../engine/types';
import { getLevelEntryById } from '../../levels';
import type { AppRoute } from '../router';
import { RouteLink } from '../components/RouteLink';
import { GameFrame } from '../components/GameFrame';
import { PlayPage } from './PublicPages';

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
