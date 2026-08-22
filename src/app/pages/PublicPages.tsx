import { useEffect, useMemo, useRef, useState } from 'react';
import mitLicense from '../../../LICENSE?raw';
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw';
import aboutContent from '../about.md?raw';
import readme from '../../../README.md?raw';
import { levelMetadatas, benchmarkLevelCatalog } from '../../levels';
import { findCatalogEntrant, rankCatalog, schedulingPool } from '../../benchmark/catalog';
import { completedMatchupsFromVotes } from '../../benchmark/catalog-api';
import { nextScheduledMatchup } from '../../benchmark/scheduler';
import { BenchmarkLocalStore } from '../../benchmark/storage';
import { homeCopy } from '../content';
import { featuredModels } from '../featured-models';
import { modelMatchPath, modelsWithMatchups, unpricedModels } from '../model-match';
import { RouteLink } from '../components/RouteLink';
import { Markdown, markdownRegion } from '../components/Markdown';
import { COST_AXIS, CurveChartFigure, CurveLegend, CurveTable, OUTPUT_TOKENS_AXIS, curveDomain, layoutCurveChart, ratedCurvePoints } from '../components/curve-chart';
import { OWNER_PARTICIPANT_PREFIX, loadLeaderboardResults, personalCurveFromLocalHistory, type LeaderboardResults } from '../leaderboard';
import type { PersonalCurve } from '../../benchmark/personal-curve';

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const crystalHero = levelMetadatas.find((level) => level.id === 'crystal-corridor')?.contentImages?.hero;
  // The pair this visitor's next matchup will actually serve, resolved once per
  // mount so it cannot change under them mid-view. Derived rather than named:
  // naming ids here leaked other entrants' ids into every entrant checkout.
  const [rankPreviewHeroes] = useState(scheduledPreviewHeroes);
  // The callout names an unpriced model — one the ranking cannot place — and only
  // when it also has an opponent to be played against. It disappears on its own
  // once the model is priced and enters ranked matchups.
  const stealthModel = useMemo(() => {
    const playable = new Set(benchmarkLevelCatalog.map((level) => level.id));
    const unpriced = unpricedModels({ playable });
    const matchable = modelsWithMatchups({ playable });
    return featuredModels.map((model) => model.name).find((name) => unpriced.has(name) && matchable.has(name)) ?? null;
  }, []);

  return (
    <>
      <section className="hero page-panel hero-with-graphic">
        <div className="hero-copy">
          <p className="eyebrow">{homeCopy.eyebrow}</p>
          <h1>{homeCopy.title}<br /><span>{homeCopy.titleAccent}</span></h1>
          <p className="lede">{homeCopy.lede}</p>
          {featuredModels.length > 0 && (
            <div className="hero-models">
              <h2>{homeCopy.models.heading}</h2>
              <ul>
                {featuredModels.map((model) => (
                  <li key={model.name} className={[model.isNew && 'is-new', model.note && 'has-note'].filter(Boolean).join(' ') || undefined}>
                    {model.href
                      ? <a href={model.href} target="_blank" rel="noreferrer">{model.name}</a>
                      : model.name}
                    {model.note && <span className="model-note">{model.note}</span>}
                    {model.isNew && <span className="new-tag">{homeCopy.models.newTag}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="hero-graphic">
          <HeroTunnel />
        </div>
      </section>
      <section className="home-choice-grid" aria-label="Choose where to start">
        <article className="home-choice recommended">
          <RouteLink className="home-choice-link" href="/play/crystal-corridor" onNavigate={onNavigate}>
            <div className="home-choice-copy">
              <div className="home-choice-head">
                <h2>{homeCopy.reference.title}</h2>
                <p className="choice-eyebrow">{homeCopy.reference.eyebrow}</p>
              </div>
              <p>{homeCopy.reference.body}</p>
            </div>
            {crystalHero && (
              <div className="home-choice-media">
                <img src={crystalHero} alt="" />
                <span className="button primary home-choice-cta">{homeCopy.reference.action}</span>
              </div>
            )}
          </RouteLink>
        </article>
        <article className="home-choice">
          <RouteLink className="home-choice-link" href="/rank" onNavigate={onNavigate}>
            <div className="home-choice-copy">
              <div className="home-choice-head">
                <h2>{homeCopy.benchmark.title}</h2>
              </div>
              <p>{homeCopy.benchmark.body}</p>
            </div>
            {rankPreviewHeroes.length > 0 && (
              <div className="home-choice-media home-choice-media-pair">
                {rankPreviewHeroes.map((heroPath) => <img src={heroPath} alt="" key={heroPath} />)}
                <span className="home-choice-vs" aria-hidden="true">VS</span>
                <span className="button primary home-choice-cta">{homeCopy.benchmark.action}</span>
              </div>
            )}
          </RouteLink>
        </article>
      </section>
      {stealthModel && (
        <section className="home-stealth">
          <div className="home-stealth-copy">
            <h2>{homeCopy.stealth.title(stealthModel)}</h2>
            <p>{homeCopy.stealth.body}</p>
          </div>
          <RouteLink className="button primary" href={modelMatchPath(stealthModel)} onNavigate={onNavigate}>{homeCopy.stealth.action(stealthModel)}</RouteLink>
        </section>
      )}
    </>
  );
}

/** Thumbnails for the matchup `/rank` would serve this visitor next, run through
 * the same local scheduler that page uses so the card previews the real pair. An
 * entrant baseline publishes an empty catalog, where this yields nothing and the
 * card renders without media. */
function scheduledPreviewHeroes(): readonly string[] {
  try {
    const store = new BenchmarkLocalStore();
    const judged = completedMatchupsFromVotes(rankCatalog, store.snapshot.history)
      .map(({ vote }) => ({ matchupId: vote.matchupId, relative: vote.relative, aLevelId: vote.aEntrantId }));
    const scheduled = nextScheduledMatchup(schedulingPool(rankCatalog), store.participantId, { judged });
    if (!scheduled) return [];
    const heroes = [scheduled.levelIdA, scheduled.levelIdB]
      .map((levelId) => findCatalogEntrant(rankCatalog, levelId)?.thumbnailPath);
    // Both sides or neither: one image under a "VS" would read as a broken pair.
    return heroes.every((hero) => !!hero) ? (heroes as string[]) : [];
  } catch {
    return [];
  }
}

function HeroTunnel() {
  return (
    <svg viewBox="0 0 340 420" role="img" aria-label="Line drawing of a lock-on reticle inside the game's octagonal tunnel">
      <defs>
        <polygon id="hero-oct" points="49.7,120 120,49.7 120,-49.7 49.7,-120 -49.7,-120 -120,-49.7 -120,49.7 -49.7,120" fill="none" />
      </defs>
      <g stroke="#3A3425" strokeWidth="1">
        <g transform="translate(155 220) scale(1.85)"><use href="#hero-oct" /></g>
        <g transform="translate(165 217) scale(1.43)"><use href="#hero-oct" /></g>
        <g transform="translate(174 214) scale(1.1)"><use href="#hero-oct" /></g>
        <g transform="translate(182 211) scale(0.85)"><use href="#hero-oct" /></g>
        <g transform="translate(189 209) scale(0.65)"><use href="#hero-oct" /></g>
        <g transform="translate(195 207) scale(0.5)"><use href="#hero-oct" /></g>
        <g transform="translate(200 206) scale(0.38)"><use href="#hero-oct" /></g>
      </g>
      <g stroke="#5C543D" strokeWidth="1">
        <g transform="translate(204 205) scale(0.29)"><use href="#hero-oct" /></g>
        <g transform="translate(207 204) scale(0.22)"><use href="#hero-oct" /></g>
        <g transform="translate(210 203) scale(0.16)"><use href="#hero-oct" /></g>
      </g>
      <g transform="translate(122 152)">
        <rect x="-44" y="-44" width="88" height="88" fill="none" stroke="#F2EDDF" strokeWidth="1.5" transform="rotate(45)" />
        <circle r="33" fill="none" stroke="#F2EDDF" strokeWidth="1.5" />
        <line x1="0" y1="-53" x2="0" y2="-66" stroke="#F2EDDF" strokeWidth="1.5" />
        <line x1="0" y1="53" x2="0" y2="66" stroke="#F2EDDF" strokeWidth="1.5" />
        <line x1="-53" y1="0" x2="-66" y2="0" stroke="#F2EDDF" strokeWidth="1.5" />
        <line x1="53" y1="0" x2="66" y2="0" stroke="#F2EDDF" strokeWidth="1.5" />
        <circle r="7" fill="#E85D93" />
      </g>
      <g transform="translate(246 296)">
        <rect x="-21" y="-21" width="42" height="42" fill="none" stroke="#E85D93" strokeWidth="1.3" transform="rotate(45)" />
        <circle r="15.5" fill="none" stroke="#E85D93" strokeWidth="1.3" />
        <circle r="3.6" fill="#F2EDDF" />
      </g>
      <g fill="none" stroke="#5C543D" strokeWidth="1">
        <rect x="40" y="330" width="17" height="17" transform="rotate(24 48 338)" />
        <rect x="276" y="82" width="12" height="12" transform="rotate(-18 282 88)" />
      </g>
    </svg>
  );
}

export function LeaderboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [excludeOwner, setExcludeOwner] = useState(false);
  const [results, setResults] = useState<LeaderboardResults | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    loadLeaderboardResults({ signal: controller.signal, ...(excludeOwner ? { excludeParticipantPrefix: OWNER_PARTICIPANT_PREFIX } : {}) })
      .then((loaded) => {
        setResults(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn('Could not load leaderboard results', error);
        setStatus('failed');
      });
    return () => controller.abort();
  }, [excludeOwner]);

  const ratedPoints = results ? ratedCurvePoints(results.curve) : [];

  return (
    <section className="page-panel leaderboard-panel">
      <p className="eyebrow">Quality vs cost</p>
      <h1>Leaderboard</h1>
      {import.meta.env.DEV && <label className="debug-toggle"><input type="checkbox" checked={excludeOwner} onChange={(event) => setExcludeOwner(event.target.checked)} />Exclude owner votes ({OWNER_PARTICIPANT_PREFIX}){results && excludeOwner && ` · ${results.excludedVotes} dropped`}</label>}
      {status === 'loading' && <p className="lede">Loading community results…</p>}
      {status === 'failed' && <div className="empty-state"><span className="empty-glyph">◌</span><h2>Results are unavailable</h2><p>The results service could not be reached. Try again in a moment.</p></div>}
      {status === 'ready' && results && (ratedPoints.length >= 2
        ? <><EarlyResultsBanner onNavigate={onNavigate} /><LeaderboardResultsView results={results} /></>
        : <div className="empty-state"><span className="empty-glyph">◌</span><h2>Public results are warming up</h2><p>Aggregate results will appear here once enough comparisons have been recorded. Help us populate the leaderboard by ranking some levels!</p><RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Rank Levels</RouteLink></div>)}
      <RouteLink className="text-link" href="/about" onNavigate={onNavigate}>Read the methodology →</RouteLink>
    </section>
  );
}

function EarlyResultsBanner({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="early-results">
      <div>
        <h2>We can’t do this alone</h2>
        <p>We need more votes to make the leaderboard reliable. Play two levels, choose the better one, and help us improve the rankings.</p>
      </div>
      <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Compare two levels</RouteLink>
    </div>
  );
}

function LeaderboardResultsView({ results }: { results: LeaderboardResults }) {
  const [comparing, setComparing] = useState(false);
  // Read once per mount: local history only changes on /rank, and a stale read
  // would put a chart on screen that no longer matches the rank page.
  const [personal] = useState(personalCurveFromLocalHistory);
  const communityPoints = ratedCurvePoints(results.curve);
  const canCompare = ratedCurvePoints(personal).length >= 2;
  return (
    <div className="curve-panel">
      <div className="curve-heading">
        <div><p className="eyebrow">Community results</p><h2>The Pareto Frontier</h2></div>
        <div className="curve-heading-actions">
          <span className="curve-status">{leaderboardNarrative(results)}</span>
          {canCompare && <button className="button" type="button" onClick={() => setComparing(true)}>Compare to personal</button>}
        </div>
      </div>
      {comparing && <CurveComparison results={results} personal={personal} onClose={() => setComparing(false)} />}
      <p className="curve-intro">Each plotted point is a model and workflow configuration, aggregated across its generated levels and across everyone who has voted. The best trade-offs move toward the <strong>upper left</strong>: higher preference at lower generation cost.</p>
      <CurveLegend />
      <CurveChartFigure layout={layoutCurveChart(communityPoints, COST_AXIS)} labels={{
        title: 'Quality vs cost',
        ratingAxisTitle: 'Community preference rating',
        chartDescription: 'Scatter plot of community preference rating by measured generation cost. Higher ratings are better and lower costs are better.',
        ratingTerm: 'Preference',
      }} />
      <CurveChartFigure layout={layoutCurveChart(communityPoints, OUTPUT_TOKENS_AXIS)} labels={{
        title: 'Quality vs output tokens',
        ratingAxisTitle: 'Community preference rating',
        chartDescription: 'Scatter plot of community preference rating by mean output tokens. Higher ratings are better and fewer output tokens are better.',
        ratingTerm: 'Preference',
      }} />
      <CurveTable points={results.curve.points.filter((point) => point.comparisons > 0)} caption="Community scoreboard" ratingTerm="Preference" />
    </div>
  );
}

/** The community curve and this device's own curve, side by side on one pair of
 * axes so the same configuration can be found in both. Ratings from a handful
 * of personal comparisons swing much wider than the community's, so the shared
 * scale is what makes the two charts answer the same question. */
function CurveComparison({ results, personal, onClose }: { results: LeaderboardResults; personal: PersonalCurve; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const communityPoints = ratedCurvePoints(results.curve);
  const personalPoints = ratedCurvePoints(personal);
  const domain = curveDomain([...communityPoints, ...personalPoints]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="curve-compare-backdrop" onClick={onClose}>
    <section className="curve-compare" role="dialog" aria-modal="true" aria-labelledby="curve-compare-title" onClick={(event) => event.stopPropagation()}>
      <div className="curve-heading">
        <div><p className="eyebrow">Side by side</p><h2 id="curve-compare-title">Community vs your results</h2></div>
        <button className="button" type="button" ref={closeButton} onClick={onClose}>Close</button>
      </div>
      <p className="curve-intro">Both charts share one pair of axes, so a configuration sits at the same cost in each and its height is directly comparable. Your ratings rest on far fewer comparisons, so expect them to swing wider.</p>
      <CurveLegend />
      <div className="curve-compare-grid">
        <article>
          <h3>Community<span>{leaderboardNarrative(results)}</span></h3>
          <CurveChartFigure layout={layoutCurveChart(communityPoints, COST_AXIS, domain)} labels={{
            ratingAxisTitle: 'Community preference rating',
            chartDescription: 'Scatter plot of community preference rating by measured generation cost.',
            ratingTerm: 'Preference',
          }} />
        </article>
        <article>
          <h3>Yours<span>{personal.comparisonCount} of your comparisons · {personal.establishedCount} ranked</span></h3>
          <CurveChartFigure layout={layoutCurveChart(personalPoints, COST_AXIS, domain)} labels={{
            ratingAxisTitle: 'Your preference rating',
            chartDescription: 'Scatter plot of your own preference rating by measured generation cost.',
            ratingTerm: 'Preference',
          }} />
        </article>
      </div>
    </section>
  </div>;
}

function leaderboardNarrative(results: LeaderboardResults): string {
  const votes = `${results.votes.toLocaleString('en-US')} ${results.votes === 1 ? 'vote' : 'votes'}`;
  const participants = `${results.participants.toLocaleString('en-US')} ${results.participants === 1 ? 'participant' : 'participants'}`;
  return `${votes} · ${participants}`;
}

export function AboutPage() {
  return (
    <section className="page-panel prose">
      <p className="eyebrow">About</p>
      <h1>Pareto Rail</h1>
      <p className="lede">Built by <a href="https://x.com/paulbatum" target="_blank" rel="noreferrer">@paulbatum</a></p>
      <Markdown source={markdownRegion(readme, 'site')} />
      <Markdown source={aboutContent} />
      <h2>License</h2>
      <p>Pareto Rail is open source under the MIT License, available on <a href="https://github.com/paulbatum/pareto-rail" target="_blank" rel="noreferrer">GitHub</a>. Third-party software, data, and reference material retain their original terms.</p>
      <div className="legal-disclosures">
        <details className="legal-details">
          <summary>MIT License</summary>
          <pre className="legal-document">{mitLicense}</pre>
        </details>
        <details className="legal-details">
          <summary>Third-party notices</summary>
          <pre className="legal-document">{thirdPartyNotices}</pre>
        </details>
      </div>
      <BuildVersion />
    </section>
  );
}

function BuildVersion() {
  const hash = __COMMIT_HASH__;
  if (!hash) return null;
  return (
    <p className="build-version">
      Build{' '}
      <a href={`https://github.com/paulbatum/pareto-rail/commit/${hash}`} target="_blank" rel="noreferrer">
        <code>{hash.slice(0, 7)}</code>
      </a>
    </p>
  );
}

export function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="page-panel">
      <p className="eyebrow">404</p>
      <h1>This track doesn't exist.</h1>
      <p className="lede">The page you asked for isn't here - it may have moved, or the link may be wrong.</p>
      <div className="empty-state"><span className="empty-glyph">◌</span><h2>Nothing on this rail</h2><p>Head back to the start and pick a direction.</p></div>
      <RouteLink className="button primary" href="/" onNavigate={onNavigate}>Return home</RouteLink>
    </section>
  );
}
