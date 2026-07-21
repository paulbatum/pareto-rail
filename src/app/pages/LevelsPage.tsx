import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BenchmarkModelUsage, BenchmarkTheme } from '../../benchmark/types';
import { entrantLabel } from '../../benchmark/identity';
import { rankCatalog, type RankCatalogConfiguration, type RankCatalogEntrant } from '../../benchmark/catalog';
import { benchmarkLevelCatalog, selectableLevelGroups } from '../../levels';
import { BenchmarkLocalStore } from '../../benchmark/storage';
import { builtInLevelBlurbs, levelsCopy, levelsSplashCopy } from '../content';
import { copyText } from '../clipboard';
import { RouteLink } from '../components/RouteLink';
import { ModelUsage, totalInputTokens } from '../components/ModelUsage';
import { getLevelsView, setLevelsView } from '../levels-view';
import { acknowledgeSpoilers, decideSpoilerGate, readSeenSpoilerIds, type SpoilerGateDecision } from '../spoilers';
import { levelsViewPath, navigate, type AppRoute, type LevelsView } from '../router';

type BuiltInRecord = {
  kind: 'built-in';
  levelId: string;
  title: string;
  reference: boolean;
  thumbnailPath?: string;
  blurb?: string;
};

type BenchmarkRecord = {
  kind: 'benchmark';
  levelId: string;
  entrant: RankCatalogEntrant;
  theme: BenchmarkTheme;
  configuration?: RankCatalogConfiguration;
  entrantIndex: number;
};

type LevelRecord = BuiltInRecord | BenchmarkRecord;
type ThemeBand = { key: string; theme: BenchmarkTheme; records: BenchmarkRecord[] };
type Navigate = (path: string) => void;

const REFERENCE_LEVEL_ID = 'crystal-corridor';

export function LevelsPage({ route, onNavigate }: { route: Extract<AppRoute, { kind: 'levels' }>; onNavigate: Navigate }) {
  const builtIn = useMemo(builtInRecords, []);
  const bands = useMemo(themeBands, []);
  const benchmarkCount = bands.reduce((total, band) => total + band.records.length, 0);

  // The splash decision is computed once per mount so it cannot flicker; a
  // dismissal only flips this local state and persists the seen ids.
  const displayedIds = useMemo(() => bands.flatMap((band) => band.records.map((record) => record.levelId)), [bands]);
  const [splash, setSplash] = useState<SpoilerGateDecision>(() => decideSpoilerGate({
    displayedIds,
    ...engagementCounts(),
    seen: readSeenSpoilerIds(),
  }));
  const dismissSplash = useCallback(() => {
    acknowledgeSpoilers(displayedIds);
    setSplash({ variant: 'hidden', newCount: 0 });
  }, [displayedIds]);
  const showSplash = splash.variant !== 'hidden';

  // The toggle writes the preference before navigating, so a bare /levels visit
  // resumes the last-used view without trapping anyone in it. This redirects
  // before paint: /levels is the data view for most visitors, and an effect
  // would show them a frame of gallery on the way there.
  useLayoutEffect(() => {
    if (route.view === 'gallery' && getLevelsView() === 'data') navigate(levelsViewPath.data, true);
  }, [route.view]);

  return (
    <>
      <header className="levels-header">
        <div>
          <p className="eyebrow">{levelsCopy.eyebrow}</p>
          <h1>{levelsCopy.title}</h1>
        </div>
        <div className="levels-header-meta">
          <ViewToggle view={route.view} onNavigate={onNavigate} />
          <span className="levels-count">{builtIn.length + benchmarkCount} levels · {builtIn.length} built-in · {benchmarkCount} benchmark</span>
        </div>
      </header>
      {showSplash
        ? <LevelsSplash decision={splash} onDismiss={dismissSplash} onNavigate={onNavigate} />
        : route.view === 'data'
          ? <DataView builtIn={builtIn} bands={bands} benchmarkCount={benchmarkCount} onNavigate={onNavigate} />
          : <GalleryView builtIn={builtIn} bands={bands} onNavigate={onNavigate} />}
    </>
  );
}

/** Vote and distinct-play counts from the local benchmark snapshot. A fresh
 * store instance for a read is the established pattern (see RankPage). */
function engagementCounts(): { historyLength: number; levelRunsLength: number } {
  try {
    const snapshot = new BenchmarkLocalStore().snapshot;
    return { historyLength: snapshot.history.length, levelRunsLength: snapshot.levelRuns.length };
  } catch {
    return { historyLength: 0, levelRunsLength: 0 };
  }
}

/** Spoiler gate shown in place of the catalog until dismissed. The primary
 * action navigates without recording a dismissal, so an un-engaged visitor
 * sees it again next time they land here. */
function LevelsSplash({ decision, onDismiss, onNavigate }: { decision: SpoilerGateDecision; onDismiss: () => void; onNavigate: Navigate }) {
  const isNew = decision.variant === 'new-additions';
  const heading = isNew ? levelsSplashCopy.newAdditions.heading(decision.newCount) : levelsSplashCopy.intro.heading;
  const body = isNew ? levelsSplashCopy.newAdditions.body(decision.newCount) : levelsSplashCopy.intro.body;

  return (
    <section className="levels-splash">
      <h2>{heading}</h2>
      <p className="levels-splash-body">{body}</p>
      <div className="levels-splash-actions">
        <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>{levelsSplashCopy.primary}</RouteLink>
        <button type="button" className="levels-splash-dismiss" onClick={onDismiss}>{levelsSplashCopy.secondary}</button>
      </div>
    </section>
  );
}

function ViewToggle({ view, onNavigate }: { view: LevelsView; onNavigate: Navigate }) {
  const select = (next: LevelsView) => (path: string) => { setLevelsView(next); onNavigate(path); };
  return (
    <nav className="view-toggle" aria-label="Levels view">
      <RouteLink href={levelsViewPath.gallery} onNavigate={select('gallery')} aria-current={view === 'gallery' ? 'true' : undefined}>▦ Gallery</RouteLink>
      <RouteLink href={levelsViewPath.data} onNavigate={select('data')} aria-current={view === 'data' ? 'true' : undefined}>☰ Data</RouteLink>
    </nav>
  );
}

/* ---------- Gallery ---------- */

function GalleryView({ builtIn, bands, onNavigate }: { builtIn: BuiltInRecord[]; bands: ThemeBand[]; onNavigate: Navigate }) {
  return (
    <>
      <section className="levels-band">
        <div className="levels-band-head"><h2>Built-in levels — {builtIn.length}</h2></div>
        <div className="levels-grid">
          {builtIn.map((record) => <GalleryCard key={record.levelId} record={record} onNavigate={onNavigate} />)}
        </div>
      </section>
      {bands.map((band) => (
        <section className="levels-band" key={band.key}>
          <div className="levels-band-head">
            <h2>Benchmark — {band.theme.title} — {band.records.length} run{band.records.length === 1 ? '' : 's'}</h2>
            <RouteLink href={`${levelsViewPath.data}#theme-${band.theme.id}`} onNavigate={onNavigate}>Theme prompt ▸</RouteLink>
          </div>
          <div className="levels-grid">
            {band.records.map((record) => <GalleryCard key={record.levelId} record={record} onNavigate={onNavigate} />)}
          </div>
        </section>
      ))}
      <footer className="levels-footnote">
        <CatalogStamp />
      </footer>
    </>
  );
}

function GalleryCard({ record, onNavigate }: { record: LevelRecord; onNavigate: Navigate }) {
  const featured = record.kind === 'benchmark' && record.entrant.featured === true;
  return (
    <div className="gallery-card">
      <span className="gallery-thumb">
        <Thumbnail path={thumbnailPathOf(record)} />
        {featured && <b className="gallery-featured" title="Featured">◆</b>}
        <span className="gallery-play" aria-hidden="true"><span /></span>
      </span>
      <span className="gallery-copy">
        {record.kind === 'built-in'
          ? <RouteLink className="gallery-open name" href={playPath(record.levelId)} onNavigate={onNavigate}>{record.title}</RouteLink>
          : <span className="name-row">
              <RouteLink className="gallery-open name run-id" href={playPath(record.levelId)} onNavigate={onNavigate}>{record.levelId}</RouteLink>
              <GalleryCardMark record={record} onNavigate={onNavigate} />
            </span>}
        <span className="meta-row">{galleryMeta(record)}</span>
      </span>
    </div>
  );
}

/** A run that did not complete says so; everything else offers its record. */
function GalleryCardMark({ record, onNavigate }: { record: BenchmarkRecord; onNavigate: Navigate }) {
  const result = record.entrant.run?.result;
  if (result !== undefined && result !== 'completed') return <span className="gallery-result-tag">{formatResult(result)}</span>;
  return <RouteLink className="gallery-details-link" href={entrantPath(record.levelId)} onNavigate={onNavigate}>Details ▸</RouteLink>;
}

function galleryMeta(record: LevelRecord) {
  if (record.kind === 'built-in') {
    return record.reference ? <span className="ref">Reference run</span> : <span>Built-in level</span>;
  }
  return <><span>{entrantLabel({ modelName: record.entrant.modelName, workflowName: record.entrant.workflowName })}</span><span>{formatCost(record.entrant.generationCost)}</span></>;
}

/* ---------- Data ---------- */

function DataView({ builtIn, bands, benchmarkCount, onNavigate }: { builtIn: BuiltInRecord[]; bands: ThemeBand[]; benchmarkCount: number; onNavigate: Navigate }) {
  const hash = useLocationHash();
  const themeTarget = hash.startsWith('theme-') ? hash.slice('theme-'.length) : null;
  const entrantTarget = hash.startsWith('entrant-') ? hash.slice('entrant-'.length) : null;
  const records: LevelRecord[] = [...builtIn, ...bands.flatMap((band) => band.records)];
  const selected = records.find((record) => record.levelId === entrantTarget)
    ?? (themeTarget === null ? undefined : bands.find((band) => band.theme.id === themeTarget)?.records[0])
    ?? bands[0]?.records[0]
    ?? builtIn[0];
  if (!selected) return null;

  return (
    <div className="levels-data-layout">
      <aside className="catalog-rail" aria-label="Level navigator">
        <div className="catalog-rail-section">
          <h2>Built-in — {builtIn.length}</h2>
          {builtIn.map((record) => (
            <RailItem key={record.levelId} record={record} selected={record.levelId === selected.levelId}>
              {record.reference && <b className="ref-tag">Ref</b>}
            </RailItem>
          ))}
        </div>
        <div className="catalog-rail-section">
          <h2>Benchmark — {benchmarkCount}</h2>
          {bands.map((band) => (
            <Fragment key={band.key}>
              <p className="catalog-rail-group">{band.theme.title}</p>
              {band.records.map((record) => (
                <RailItem key={record.levelId} record={record} selected={record.levelId === selected.levelId}>
                  {record.entrant.featured === true && <b className="featured-mark" title="Featured">◆</b>}
                  <span className="catalog-rail-cost">{formatCost(record.entrant.generationCost)}</span>
                </RailItem>
              ))}
            </Fragment>
          ))}
        </div>
        <CatalogDownload />
      </aside>
      <main className="catalog-detail">
        {selected.kind === 'built-in'
          ? <BuiltInRecordDetail record={selected} onNavigate={onNavigate} />
          : <EntrantRecordDetail record={selected} themeTarget={themeTarget} onNavigate={onNavigate} />}
      </main>
    </div>
  );
}

function RailItem({ record, selected, children }: { record: LevelRecord; selected: boolean; children?: React.ReactNode }) {
  return (
    <a className="catalog-rail-item" href={`#entrant-${record.levelId}`} aria-current={selected ? 'true' : undefined}>
      <span className="catalog-rail-thumb"><Thumbnail path={thumbnailPathOf(record)} /></span>
      <span className="catalog-rail-id">{record.levelId}</span>
      {children}
    </a>
  );
}

function BuiltInRecordDetail({ record, onNavigate }: { record: BuiltInRecord; onNavigate: Navigate }) {
  return (
    <>
      <header className="catalog-record-header">
        <h2>{record.title}</h2>
        <span className="spacer" />
        <RouteLink className="button primary" href={playPath(record.levelId)} onNavigate={onNavigate}>▸ Play this level</RouteLink>
      </header>
      <p className="catalog-identity">{record.reference ? 'Built-in level · reference run' : 'Built-in level'} · {record.levelId}</p>
      <div className="catalog-record-body">
        <RecordThumbnail record={record} onNavigate={onNavigate} />
        <div className="catalog-about">
          <p className="catalog-about-label">About this level</p>
          <p className="catalog-blurb">{record.blurb}</p>
          <p className="catalog-note">Built-in levels are hand-made, so they carry no generation record.</p>
        </div>
      </div>
    </>
  );
}

function EntrantRecordDetail({ record, themeTarget, onNavigate }: { record: BenchmarkRecord; themeTarget: string | null; onNavigate: Navigate }) {
  const { entrant, configuration, theme } = record;
  const run = entrant.run;
  const completed = run === undefined || run.result === 'completed';
  return (
    <>
      <header className="catalog-record-header">
        <h2>{entrant.levelId}</h2>
        {run && <span className={completed ? 'result-tag' : 'result-tag timed-out'}>{formatResult(run.result)}</span>}
        <span className="spacer" />
        <RouteLink className="button primary" href={playPath(entrant.levelId)} onNavigate={onNavigate}>▸ Play this level</RouteLink>
      </header>
      <p className="catalog-identity">{modelLine(record)}</p>

      {run && (
        <dl className="catalog-stats">
          <div className="stat-cost"><dt>Generation cost</dt><dd>{formatCost(entrant.generationCost)}</dd></div>
          <div><dt>Gen wall time</dt><dd title={`${count(Math.round(run.generationWallTimeSeconds))} seconds`}>{formatWallTime(run.generationWallTimeSeconds)}</dd></div>
          <TokenTotals models={run.models} />
        </dl>
      )}

      <div className="catalog-record-body">
        <RecordThumbnail record={record} onNavigate={onNavigate} />
        {run && (
          <div className="catalog-usage">
            <p>Model usage — {run.models.length} model{run.models.length === 1 ? '' : 's'}{run.harness && ` · ${run.harness.name} ${run.harness.version}`}</p>
            {run.models.map((model) => <ModelUsage key={`${model.modelName}-${model.role}`} model={model} showRole={run.models.length > 1} />)}
          </div>
        )}
      </div>

      <div className="catalog-disclosures" key={entrant.levelId}>
        {configuration && (
          <details open id={`config-${configuration.id}`}>
            <summary><span>Configuration — {configuration.id}</span></summary>
            <div className="catalog-disclosure-body">
              <dl className="run-facts">
                <div><dt>Primary model</dt><dd>{configuration.primaryModel}</dd></div>
                <div><dt>Effort</dt><dd>{configuration.effort}</dd></div>
                {configuration.delegateModel && <div><dt>Delegate model</dt><dd>{configuration.delegateModel}</dd></div>}
                {configuration.delegateEffort && <div><dt>Delegate effort</dt><dd>{configuration.delegateEffort}</dd></div>}
              </dl>
              <p>{configuration.workflowSummary}</p>
              {configuration.delegationGuidance && (
                <blockquote><span>Delegation guidance</span>{configuration.delegationGuidance}</blockquote>
              )}
            </div>
          </details>
        )}
        <ThemeDisclosure theme={theme} targeted={themeTarget === theme.id} />
        <RawRecord entrant={entrant} index={record.entrantIndex} />
      </div>
    </>
  );
}

/** Run totals across every model. A delegated run splits its tokens over two
 * models below; these are the figures for the run as a whole. */
function TokenTotals({ models }: { models: readonly BenchmarkModelUsage[] }) {
  const input = models.reduce((sum, model) => sum + totalInputTokens(model), 0);
  const cached = models.reduce((sum, model) => sum + (model.cacheReadTokens ?? 0), 0);
  const output = models.reduce((sum, model) => sum + model.outputTokens, 0);
  return (
    <>
      <div><dt>Input tokens</dt><dd title={input === 0 ? undefined : `${count(cached)} of ${count(input)} served from cache`}>{count(input)}</dd></div>
      <div><dt>Output tokens</dt><dd title="Includes reasoning tokens">{count(output)}</dd></div>
    </>
  );
}

function ThemeDisclosure({ theme, targeted }: { theme: BenchmarkTheme; targeted: boolean }) {
  const element = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(true);

  // A theme link scrolls to the prompt and reopens it if it was collapsed;
  // switching entrants remounts this section, restoring the open default.
  useEffect(() => {
    if (!targeted) return;
    setOpen(true);
    element.current?.scrollIntoView({ block: 'center' });
  }, [targeted, theme.id]);

  return (
    <details ref={element} id={`theme-${theme.id}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>Theme — {theme.id}</span></summary>
      <div className="catalog-disclosure-body">
        <p className="prompt-text">{theme.prompt}</p>
      </div>
    </details>
  );
}

function RawRecord({ entrant, index }: { entrant: RankCatalogEntrant; index: number }) {
  const json = JSON.stringify(entrant, null, 2);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(json);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details>
      <summary><span>Raw JSON record</span><small>entrants[{index}]</small></summary>
      <div className="catalog-disclosure-body">
        <button className="catalog-raw-copy" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy to clipboard'}</button>
        <pre className="catalog-raw">{json}</pre>
      </div>
    </details>
  );
}

function RecordThumbnail({ record, onNavigate }: { record: LevelRecord; onNavigate: Navigate }) {
  return (
    <RouteLink className="catalog-thumb" href={playPath(record.levelId)} onNavigate={onNavigate} aria-label={`Play ${record.levelId}`}>
      <Thumbnail path={thumbnailPathOf(record)} />
      <span className="catalog-thumb-play" aria-hidden="true"><span /></span>
    </RouteLink>
  );
}

/** The catalog ships in the bundle, so the download is built from the same data
 * the page renders rather than a separate endpoint that could drift from it. */
function CatalogDownload() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(rankCatalog, null, 2)], { type: 'application/json' }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, []);

  if (!url) return null;
  return <div className="catalog-rail-download"><a href={url} download="rank-catalog.json">Download catalog JSON ▸</a></div>;
}

function CatalogStamp() {
  return <span>{rankCatalog.activeBenchmarkVersion} · {formatStamp(rankCatalog.generatedAt)}</span>;
}

function Thumbnail({ path }: { path?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [path]);

  if (!path || failed) return <span className="thumbnail-fallback"><span>No thumbnail</span></span>;
  return <img src={path} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function useLocationHash(): string {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash.slice(1)));

  useEffect(() => {
    // navigate() pushes state and fires popstate; in-page anchors fire hashchange.
    const read = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    read();
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);

  return hash;
}

/* ---------- Records ---------- */

function builtInRecords(): BuiltInRecord[] {
  return selectableLevelGroups().builtIn.map((level) => ({
    kind: 'built-in',
    levelId: level.id,
    title: level.title,
    reference: level.id === REFERENCE_LEVEL_ID,
    thumbnailPath: level.contentImages?.hero,
    blurb: builtInLevelBlurbs[level.id],
  }));
}

/** Benchmark browsing is catalog-driven: an entrant appears once it is
 * published and its level module is present. */
function themeBands(): ThemeBand[] {
  const playable = new Set(benchmarkLevelCatalog.map((level) => level.id));
  const configurations = new Map((rankCatalog.configurations ?? []).map((configuration) => [configuration.id, configuration]));
  const bands: ThemeBand[] = [];

  for (const version of rankCatalog.versions) {
    for (const theme of version.themes) {
      const records = version.entrants
        .map((entrant, entrantIndex) => ({ entrant, entrantIndex }))
        .filter(({ entrant }) => entrant.themeId === theme.id && playable.has(entrant.levelId))
        .sort((first, second) => first.entrant.generationCost - second.entrant.generationCost)
        .map(({ entrant, entrantIndex }): BenchmarkRecord => ({
          kind: 'benchmark',
          levelId: entrant.levelId,
          entrant,
          theme,
          configuration: configurations.get(entrant.configurationId),
          entrantIndex,
        }));
      if (records.length > 0) bands.push({ key: `${version.benchmarkVersion}:${theme.id}`, theme, records });
    }
  }

  return bands;
}

function thumbnailPathOf(record: LevelRecord): string | undefined {
  return record.kind === 'built-in' ? record.thumbnailPath : record.entrant.thumbnailPath;
}

function playPath(levelId: string): string {
  return `/play/${encodeURIComponent(levelId)}`;
}

function entrantPath(levelId: string): string {
  return `${levelsViewPath.data}#entrant-${levelId}`;
}

/* ---------- Formatting ---------- */

/** Every model that worked the run, with its reasoning effort. The workflow name
 * and configuration id are left to the configuration section below. An entrant
 * whose configuration is missing still names the model it ran under. */
function modelLine(record: BenchmarkRecord): string {
  const { configuration, entrant } = record;
  if (!configuration) return entrant.modelName;
  const models = [withEffort(configuration.primaryModel, configuration.effort)];
  if (configuration.delegateModel) models.push(withEffort(configuration.delegateModel, configuration.delegateEffort));
  return models.join(' + ');
}

function withEffort(model: string, effort?: string): string {
  return effort ? `${model} (${effort})` : model;
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatWallTime(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${minutes}:${pad(remainder)}`;
}

function formatResult(result: string): string {
  if (result === 'completed') return 'Completed';
  const spaced = result.replaceAll('-', ' ');
  return `${spaced[0]?.toUpperCase() ?? ''}${spaced.slice(1)}`;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function formatStamp(iso: string): string {
  const stamp = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())} ${pad(stamp.getUTCHours())}:${pad(stamp.getUTCMinutes())} UTC`;
}
