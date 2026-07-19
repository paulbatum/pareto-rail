import mitLicense from '../../../LICENSE?raw';
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw';
import { levelMetadatas } from '../../levels';
import { allCatalogEntrants, rankCatalog } from '../../benchmark/catalog';
import { homeCopy } from '../content';
import { RouteLink } from '../components/RouteLink';

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const crystalHero = levelMetadatas.find((level) => level.id === 'crystal-corridor')?.contentImages?.hero;
  const rankPreviewHeroes = ['mass-driver-vyxj', 'mass-driver-wo4m'].flatMap((levelId) => {
    const entrant = allCatalogEntrants(rankCatalog).find((candidate) => candidate.levelId === levelId);
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
        <article className="home-choice recommended">
          <div className="home-choice-copy">
            <p className="choice-eyebrow">{homeCopy.reference.eyebrow}</p>
            <h2>{homeCopy.reference.title}</h2>
            <p>{homeCopy.reference.body}</p>
            <RouteLink className="button primary" href="/play/crystal-corridor" onNavigate={onNavigate}>{homeCopy.reference.action}</RouteLink>
          </div>
          {crystalHero && <div className="home-choice-media" aria-hidden="true"><img src={crystalHero} alt="" /></div>}
        </article>
        <article className="home-choice">
          <div className="home-choice-copy">
            <p className="choice-eyebrow">{homeCopy.benchmark.eyebrow}</p>
            <h2>{homeCopy.benchmark.title}</h2>
            <p>{homeCopy.benchmark.body}</p>
            <RouteLink className="button" href="/rank" onNavigate={onNavigate}>{homeCopy.benchmark.action}</RouteLink>
          </div>
          {rankPreviewHeroes.length > 0 && <div className="home-choice-media home-choice-media-pair" aria-hidden="true">{rankPreviewHeroes.map((heroPath) => <img src={heroPath} alt="" key={heroPath} />)}<span className="home-choice-vs">VS</span></div>}
        </article>
      </section>
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

export function LeaderboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="page-panel">
      <p className="eyebrow">Leaderboard</p>
      <h1>Quality meets cost.</h1>
      <p className="lede">Aggregate benchmark rankings will appear here as public comparisons accumulate.</p>
      <div className="empty-state"><span className="empty-glyph">◌</span><h2>Public results are warming up</h2><p>Aggregate results will appear here once the first benchmark release ships. Play some matchups meanwhile - your personal curve is yours immediately.</p></div>
      <RouteLink className="text-link" href="/about" onNavigate={onNavigate}>Read the methodology →</RouteLink>
    </section>
  );
}

export function AboutPage() {
  return (
    <section className="page-panel prose">
      <p className="eyebrow">About</p>
      <h1>Pareto Rail</h1>
      <p className="lede">Built by <a href="https://x.com/paulbatum" target="_blank" rel="noreferrer">@paulbatum</a></p>
      <h2>Open source</h2>
      <p>Pareto Rail is released under the MIT License. Third-party software, data, and reference material retain their original terms.</p>
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
      <h2>Privacy</h2>
      <p>Pareto Rail uses Vercel Web Analytics to measure aggregate traffic. It sets no cookies, stores nothing on your device, and does not track you across sites or build a profile of you. Votes you cast are stored anonymously to compile the rankings.</p>
    </section>
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
