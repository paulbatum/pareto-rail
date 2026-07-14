import type { CSSProperties } from 'react';
import { levelMetadatas, selectableLevelGroups } from '../../levels';
import { rankCatalog } from '../../benchmark/catalog';
import { homeCopy } from '../content';
import { RouteLink } from '../components/RouteLink';

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const crystalHero = levelMetadatas.find((level) => level.id === 'crystal-corridor')?.contentImages?.hero;
  const rankPreviewHeroes = ['mass-driver-vyxj', 'mass-driver-wo4m'].flatMap((levelId) => {
    const entrant = rankCatalog.entrants.find((candidate) => candidate.levelId === levelId);
    return entrant?.thumbnailPath ? [entrant.thumbnailPath] : [];
  });

  return (
    <>
      <section className="hero page-panel hero-with-graphic">
        <div className="hero-copy">
          <p className="eyebrow">{homeCopy.eyebrow}</p>
          <h1>{homeCopy.title}<br /><span>{homeCopy.titleAccent}</span></h1>
          <p className="lede">{homeCopy.lede}</p>
        </div>
        <div className="hero-graphic">
          <HeroTunnel />
        </div>
      </section>
      <section className="home-choice-grid" aria-label="Choose where to start">
        <article className="home-choice">
          {crystalHero && <div className="home-choice-media" aria-hidden="true"><img src={crystalHero} alt="" /></div>}
          <div className="home-choice-copy">
            <p className="choice-eyebrow">{homeCopy.reference.eyebrow}</p>
            <h2>{homeCopy.reference.title}</h2>
            <p>{homeCopy.reference.body}</p>
            <RouteLink className="button primary" href="/play/crystal-corridor" onNavigate={onNavigate}>{homeCopy.reference.action}</RouteLink>
          </div>
        </article>
        <article className="home-choice">
          {rankPreviewHeroes.length > 0 && <div className="home-choice-media home-choice-media-pair" aria-hidden="true">{rankPreviewHeroes.map((heroPath) => <img src={heroPath} alt="" key={heroPath} />)}</div>}
          <div className="home-choice-copy">
            <p className="choice-eyebrow">{homeCopy.benchmark.eyebrow}</p>
            <h2>{homeCopy.benchmark.title}</h2>
            <p>{homeCopy.benchmark.body}</p>
            <RouteLink className="button" href="/rank" onNavigate={onNavigate}>{homeCopy.benchmark.action}</RouteLink>
          </div>
        </article>
      </section>
      <section className="home-note"><strong>Keep going to build your personal curve.</strong> {homeCopy.payoff}</section>
    </>
  );
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

export function PlayPage({ activeId, onNavigate }: { activeId?: string; onNavigate: (path: string) => void }) {
  const groups = selectableLevelGroups();
  const sections = [
    { label: 'Built-in levels', levels: groups.builtIn, meta: (id: string) => id === 'crystal-corridor' ? 'Reference run' : 'Built-in level' },
    { label: 'Benchmark levels', levels: groups.benchmark, meta: (id: string) => `Benchmark output · ${levelIdSuffix(id)}` },
  ];

  return (
    <section className="page-panel">
      <p className="eyebrow">Play</p>
      <h1>Choose a level</h1>
      <p className="lede">Start with Crystal Corridor, then explore the curated collection and generated benchmark outputs.</p>
      <div className="level-groups">
        {sections.map((section) => section.levels.length > 0 && (
          <section className="level-group" key={section.label}>
            <h2>{section.label}</h2>
            <div className="level-grid">
              {section.levels.map((level) => (
                <RouteLink
                  className={`level-card${level.id === activeId ? ' selected' : ''}${level.contentImages ? ' has-content' : ' text-only'}`}
                  style={level.contentImages ? undefined : { '--card-hue': levelCardHue(level.id) } as CSSProperties}
                  href={`/play/${encodeURIComponent(level.id)}`}
                  onNavigate={onNavigate}
                  key={level.id}
                >
                  {level.contentImages && (
                    <span className="level-card-images" aria-label={`${level.title} visual preview`}>
                      <img className="level-card-hero" src={level.contentImages.hero} alt={`${level.title} highlight`} loading="lazy" />
                      <span className="level-card-supporting">
                        <img src={level.contentImages.overview} alt={`${level.title} four-moment overview`} loading="lazy" />
                        <img src={level.contentImages.start} alt={`${level.title} start screen`} loading="lazy" />
                      </span>
                    </span>
                  )}
                  <span className="level-card-copy">
                    <span className="level-card-title">{level.title}</span>
                    <span className="level-card-meta">{section.meta(level.id)}</span>
                  </span>
                </RouteLink>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export function LeaderboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="page-panel">
      <p className="eyebrow">Leaderboard</p>
      <h1>Quality meets cost.</h1>
      <p className="lede">Aggregate benchmark rankings will appear here as public comparisons accumulate.</p>
      <div className="empty-state"><span className="empty-glyph">◌</span><h2>Public results are warming up</h2><p>Aggregate results will appear here once the first benchmark release ships. Play some matchups meanwhile — your personal curve is yours immediately.</p></div>
      <RouteLink className="text-link" href="/about" onNavigate={onNavigate}>Read the methodology →</RouteLink>
    </section>
  );
}

export function AboutPage() {
  return (
    <section className="page-panel prose">
      <p className="eyebrow">About</p>
      <h1>A fairer way to compare generated play.</h1>
      <p className="lede">Pareto Rail measures the part that matters most: how a level feels when a person has to play it.</p>
      <h2>How it works</h2>
      <p>Entrants receive the same theme and build independently. Players see two anonymous levels, complete a run or die trying, and vote once they have played both.</p>
      <h2>What we publish</h2>
      <p>Public results separate preference quality from measured generation cost, show sample counts, and call out provisional data, ties, and DNFs. Crystal Corridor is a human-built reference, not a benchmark entrant.</p>
      <h2>Inspect the protocol</h2>
      <p>The headline comparison is intentionally simple. The model lineup, delegation instructions, timing definitions, and token accounting remain available below for anyone who wants to audit what each point means.</p>
      <details className="data-details">
        <summary>Models and delegation protocol</summary>
        <div className="protocol-grid">{(rankCatalog.configurations ?? []).map((configuration) => <article className="protocol-card" key={configuration.id}>
          <p className="choice-eyebrow">{configuration.workflowName}</p>
          <h3>{configuration.modelName}</h3>
          <p>{configuration.workflowSummary}</p>
          <dl><div><dt>Primary</dt><dd>{configuration.primaryModel}</dd></div><div><dt>Effort</dt><dd>{configuration.effort}</dd></div>{configuration.delegateModel && <><div><dt>Requested delegate</dt><dd>{configuration.delegateModel}</dd></div><div><dt>Delegate effort</dt><dd>{configuration.delegateEffort}</dd></div></>}</dl>
          {configuration.delegationGuidance && <blockquote><span>Verbatim delegation guidance</span>{configuration.delegationGuidance}</blockquote>}
        </article>)}</div>
      </details>
      <details className="data-details">
        <summary>Token, cost, and timing definitions</summary>
        <dl className="data-dictionary">
          <div><dt>Input tokens</dt><dd>Uncached model input attributed to that model.</dd></div>
          <div><dt>Cache read / write</dt><dd>Context served from or added to the provider cache. These are reported separately and can be much larger than uncached input.</dd></div>
          <div><dt>Output tokens</dt><dd>Tokens generated by the model. Claude includes thinking in output; Codex reports reasoning separately when available.</dd></div>
          <div><dt>Reasoning tokens</dt><dd>The separate Codex reasoning field when the harness reports one. A dash means unavailable, not zero.</dd></div>
          <div><dt>Generation time</dt><dd>Wall time from model process launch to exit. Delegated models overlap inside one parent session and are not double-counted.</dd></div>
          <div><dt>Full run time</dt><dd>Generation plus deterministic setup, sealing, and mechanical verification.</dd></div>
          <div><dt>Measured cost</dt><dd>USD reconstructed by the pinned ccusage tool from persisted model sessions. Delegated work is included. Claude records per-model cost; Codex currently exposes one run-level cost alongside per-model tokens.</dd></div>
          <div><dt>Chart point</dt><dd>One model and workflow configuration. Cost is averaged across its published levels; preference comes from your blind verdicts.</dd></div>
        </dl>
        <p className="catalog-stamp">Public catalog generated <time dateTime={rankCatalog.generatedAt}>{new Date(rankCatalog.generatedAt).toLocaleString('en-US')}</time>.</p>
      </details>
      <h2>Limitations</h2>
      <p>Early ratings are estimates. Browser play is voluntary and subjective. Public run metadata is redacted: credentials, private dashboard links, raw transcripts, and unpublished entrant mappings are never shipped to the site.</p>
    </section>
  );
}

function levelCardHue(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 178 + (hash % 150);
}

function levelIdSuffix(id: string): string {
  return id.slice(id.lastIndexOf('-') + 1);
}
