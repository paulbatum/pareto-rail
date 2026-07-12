import { selectableLevelGroups } from '../../levels';
import { homeCopy } from '../content';
import { RouteLink } from '../components/RouteLink';

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <>
      <section className="hero page-panel">
        <p className="eyebrow">{homeCopy.eyebrow}</p>
        <h1>{homeCopy.title}<br /><span>{homeCopy.titleAccent}</span></h1>
        <p className="lede">{homeCopy.lede}</p>
      </section>
      <section className="home-choice-grid" aria-label="Choose where to start">
        <article className="home-choice">
          <p className="choice-eyebrow">{homeCopy.reference.eyebrow}</p>
          <h2>{homeCopy.reference.title}</h2>
          <p>{homeCopy.reference.body}</p>
          <RouteLink className="button primary" href="/play/crystal-corridor" onNavigate={onNavigate}>{homeCopy.reference.action}</RouteLink>
        </article>
        <article className="home-choice">
          <p className="choice-eyebrow">{homeCopy.benchmark.eyebrow}</p>
          <h2>{homeCopy.benchmark.title}</h2>
          <p>{homeCopy.benchmark.body}</p>
          <RouteLink className="button" href="/rank" onNavigate={onNavigate}>{homeCopy.benchmark.action}</RouteLink>
        </article>
      </section>
      <section className="home-note"><strong>Keep going to build your personal curve.</strong> {homeCopy.payoff}</section>
    </>
  );
}

export function PlayPage({ activeId, onNavigate }: { activeId?: string; onNavigate: (path: string) => void }) {
  const groups = selectableLevelGroups();
  const sections = [
    { label: 'Built-in levels', levels: groups.builtIn, meta: (id: string) => id === 'crystal-corridor' ? 'Reference run' : 'Built-in level' },
    { label: 'Benchmark levels', levels: groups.benchmark, meta: () => 'Benchmark output' },
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
                  className={`level-card${level.id === activeId ? ' selected' : ''}`}
                  href={`/play/${encodeURIComponent(level.id)}`}
                  onNavigate={onNavigate}
                  key={level.id}
                >
                  <span className="level-card-title">{level.title}</span>
                  <span className="level-card-meta">{section.meta(level.id)}</span>
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
      <div className="empty-state"><span className="empty-glyph">◌</span><h2>Public results are warming up</h2><p>Until the first release, this page remains useful context-free: no WebGPU, no account, and no game required.</p></div>
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
      <h2>Limitations</h2>
      <p>Early ratings are estimates. Browser play is voluntary and subjective. We never expose private prompts, credentials, raw logs, or unpublished entrant mappings.</p>
    </section>
  );
}
