/**
 * Loaders for the rollout analysis packages. Packages are auto-discovered from
 * `benchmark/analysis/<level-id>/` via Vite glob imports — dropping a new
 * package directory into the repo adds it to `/analysis` with no registry edit,
 * mirroring how `src/benchmark-levels/` is discovered.
 */
import type {
  AnalysisAnnotations,
  AnalysisFiles,
  AnalysisNarrative,
  AnalysisPackage,
  AnalysisPackageSummary,
  AnalysisRun,
  AnalysisSections,
  AnalysisSnapshotMoments,
  AnalysisSnapshots,
  AnalysisTrace,
  SubagentTranscript,
} from './types';

type Loader<T> = Record<string, () => Promise<T>>;

const runFiles = import.meta.glob('/benchmark/analysis/*/run.json', { import: 'default' }) as Loader<AnalysisRun>;
const traceFiles = import.meta.glob('/benchmark/analysis/*/trace.json', { import: 'default' }) as Loader<AnalysisTrace>;
const subagentFiles = import.meta.glob('/benchmark/analysis/*/subagents/agent-*.json', { import: 'default' }) as Loader<SubagentTranscript>;
const filesFiles = import.meta.glob('/benchmark/analysis/*/files.json', { import: 'default' }) as Loader<AnalysisFiles>;
const momentFiles = import.meta.glob('/benchmark/analysis/*/snapshot-moments.json', { import: 'default' }) as Loader<AnalysisSnapshotMoments>;
const snapshotFiles = import.meta.glob('/benchmark/analysis/*/snapshots.json', { import: 'default' }) as Loader<AnalysisSnapshots>;
const sectionFiles = import.meta.glob('/benchmark/analysis/*/sections.json', { import: 'default' }) as Loader<AnalysisSections>;
const annotationFiles = import.meta.glob('/benchmark/analysis/*/annotations.json', { import: 'default' }) as Loader<AnalysisAnnotations>;
const narrativeFiles = import.meta.glob('/benchmark/analysis/*/narrative.json', { import: 'default' }) as Loader<AnalysisNarrative>;

/** Snapshot PNGs, resolved to served URLs at build time. Keyed by source path. */
const imageUrls = import.meta.glob('/benchmark/analysis/*/snapshots/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function packageDir(id: string): string {
  return `/benchmark/analysis/${id}`;
}

function idFromPath(path: string): string {
  const match = /^\/benchmark\/analysis\/([^/]+)\//.exec(path);
  return match ? match[1] : path;
}

export function listAnalysisIds(): string[] {
  return Object.keys(runFiles).map(idFromPath).sort();
}

export function hasAnalysisPackage(id: string): boolean {
  return `${packageDir(id)}/run.json` in runFiles;
}

/** URL for an image referenced from snapshots.json (`snapshots/moment-n/x.png`). */
export function snapshotImageUrl(id: string, imagePath: string): string | undefined {
  return imageUrls[`${packageDir(id)}/${imagePath}`];
}

async function loadPart<T>(loaders: Loader<T>, path: string): Promise<T> {
  const load = loaders[path];
  if (!load) throw new Error(`Analysis package file missing: ${path}`);
  return load();
}

export async function loadAnalysisSummaries(): Promise<AnalysisPackageSummary[]> {
  const ids = listAnalysisIds();
  return Promise.all(
    ids.map(async (id) => {
      const dir = packageDir(id);
      const [run, narrative, snapshots, trace] = await Promise.all([
        loadPart(runFiles, `${dir}/run.json`),
        loadPart(narrativeFiles, `${dir}/narrative.json`),
        loadPart(snapshotFiles, `${dir}/snapshots.json`),
        loadPart(traceFiles, `${dir}/trace.json`),
      ]);
      return {
        id,
        run,
        headline: narrative.headline,
        verdict: narrative.verdict,
        thumbnail: cardThumbnail(id, snapshots),
        eventTotal: trace.eventCount,
      };
    }),
  );
}

/** The last gameplay render the agent produced is the truest card art for the
 * run; fall back to the very first image so a package without gameplay
 * snapshots still gets a face. */
function cardThumbnail(id: string, snapshots: AnalysisSnapshots): string | undefined {
  const moments = [...snapshots.moments].sort((a, b) => b.ordinal - a.ordinal);
  for (const moment of moments) {
    const gameplay = moment.images.find((image) => image.path.includes('gameplay'));
    if (gameplay) {
      const url = snapshotImageUrl(id, gameplay.path);
      if (url) return url;
    }
  }
  const first = snapshots.moments[0]?.images[0];
  return first ? snapshotImageUrl(id, first.path) : undefined;
}

export async function loadAnalysisPackage(id: string): Promise<AnalysisPackage> {
  const dir = packageDir(id);
  const subagentPaths = Object.keys(subagentFiles).filter((path) => path.startsWith(`${dir}/subagents/`)).sort();
  const [run, trace, subagents, files, snapshotMoments, snapshots, sections, annotations, narrative] = await Promise.all([
    loadPart(runFiles, `${dir}/run.json`),
    loadPart(traceFiles, `${dir}/trace.json`),
    Promise.all(subagentPaths.map((path) => loadPart(subagentFiles, path))),
    loadPart(filesFiles, `${dir}/files.json`),
    loadPart(momentFiles, `${dir}/snapshot-moments.json`),
    loadPart(snapshotFiles, `${dir}/snapshots.json`),
    loadPart(sectionFiles, `${dir}/sections.json`),
    loadPart(annotationFiles, `${dir}/annotations.json`),
    loadPart(narrativeFiles, `${dir}/narrative.json`),
  ]);
  return { id, run, trace, subagents, files, snapshotMoments, snapshots, sections, annotations, narrative };
}
