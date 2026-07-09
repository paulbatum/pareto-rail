import fs from 'node:fs/promises';
import path from 'node:path';
import { formatEngineDefaultsReport, runSimulationSuite } from './simulation-cli';
import { analyzeOcclusionLevels, formatReports } from './target-occlusion.mjs';

export async function main(argv = process.argv.slice(2), env: { root?: string } = {}) {
  const root = env.root ?? process.cwd();
  const options = parseArgs(argv);
  const { analyzePerformanceLevels, formatPerformanceReports } = await import('./check-perf.mjs');

  const [result, occlusionReports, perfReports] = await Promise.all([
    runSimulationSuite({
      level: options.level,
      policies: ['none', 'perfect', 'imperfect', 'reject'],
      seed: options.seed,
      dt: options.dt,
      gapThreshold: options.gapThreshold,
    }),
    analyzeOcclusionLevels([options.level], { dt: options.dt }),
    analyzePerformanceLevels([options.level], { dt: options.dt }),
  ]);

  const failures: string[] = [];
  const level = result.level;

  const spawnedKinds = new Set<string>();
  for (const run of result.runs) for (const kind of Object.keys(run.counts.spawnedKinds)) spawnedKinds.add(kind);
  if (spawnedKinds.size < 3) {
    failures.push(`Only ${spawnedKinds.size} enemy kind(s) spawned: ${[...spawnedKinds].join(', ') || 'none'}.`);
  }

  if (!result.eventCoverage.fired.includes('beat')) failures.push('No beat events were emitted during simulation.');
  const rejectRun = result.runs.find((run) => run.policy === 'reject');
  if (!rejectRun || (rejectRun.counts.events.reject ?? 0) === 0) {
    failures.push('No reject event was observed under the forced reject policy.');
  }

  const cardPath = path.join(root, 'src', 'levels', level.folder, 'level.md');
  try {
    const card = await fs.readFile(cardPath, 'utf8');
    if (!isNonTemplateCard(card, level.title)) failures.push(`${relative(root, cardPath)} is missing, too thin, or still looks like a template.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') failures.push(`Missing ${relative(root, cardPath)}.`);
    else throw error;
  }

  const galleryPath = path.join(root, 'docs', 'level-gallery.md');
  const expectedGallery = await buildExpectedGallery(root);
  const actualGallery = await fs.readFile(galleryPath, 'utf8');
  if (actualGallery !== expectedGallery) failures.push('docs/level-gallery.md is not regenerated from the current level.md cards. Run npm run gallery.');

  const occlusionWarnings = occlusionReports.flatMap((report) => report.warnings.map((warning) => ({ report, warning })));
  if (occlusionWarnings.length > 0) {
    failures.push(`Target occlusion check found ${occlusionWarnings.length} warning${occlusionWarnings.length === 1 ? '' : 's'}. Run npm run check:occlusion -- --level ${level.id} for details.`);
  }

  const perfFailures = perfReports.flatMap((report: { failures: unknown[] }) => report.failures);
  if (perfFailures.length > 0) {
    failures.push(`Performance check found ${perfFailures.length} failing gate${perfFailures.length === 1 ? '' : 's'}. Run npm run check:perf -- --level ${level.id} for details.`);
  }

  const lines: string[] = [];
  lines.push(`${level.title} floor check`);
  lines.push(`duration ${level.duration.toFixed(1)}s; spawned kinds ${spawnedKinds.size}: ${[...spawnedKinds].sort().join(', ') || 'none'}`);
  lines.push(`event coverage missing: ${result.eventCoverage.neverFired.join(', ') || 'none'}`);
  lines.push('');
  lines.push(formatEngineDefaultsReport(result.engineDefaults));
  lines.push('');
  lines.push(`target occlusion warnings: ${occlusionWarnings.length}`);
  lines.push(`performance gate failures: ${perfFailures.length}`);
  if (failures.length) {
    lines.push('');
    lines.push('Failures:');
    for (const failure of failures) lines.push(`- ${failure}`);
    if (occlusionReports.length > 0) {
      lines.push('');
      const occlusionReport = occlusionReports[0];
      lines.push(formatReports(occlusionReports, {
        threshold: occlusionReport?.threshold ?? 0.05,
        sampleStep: occlusionReport?.sampleStep ?? 0.1,
        policy: 'perfect',
        json: false,
      }));
    }
    if (perfReports.length > 0) {
      lines.push('');
      lines.push(formatPerformanceReports(perfReports));
    }
    console.error(lines.join('\n'));
    process.exitCode = 1;
  } else {
    lines.push('All floor checks passed.');
    console.log(lines.join('\n'));
  }
}

function parseArgs(argv: string[]) {
  let level = '';
  let seed = 1;
  let dt = 1 / 60;
  let gapThreshold = 4;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };
    if (arg === '--level') level = value();
    else if (arg === '--seed') seed = Number(value());
    else if (arg === '--dt') dt = Number(value());
    else if (arg === '--gap-threshold') gapThreshold = Number(value());
    else if (arg === '-h' || arg === '--help') {
      console.log('Usage: npm run check:floor -- --level <id> [--seed n]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!level) throw new Error('Missing --level <id>');
  return { level, seed, dt, gapThreshold };
}

function isNonTemplateCard(card: string, title: string) {
  const trimmed = card.trim();
  if (trimmed.length < 160) return false;
  if (!trimmed.startsWith(`# ${title}`)) return false;
  return !/(TODO|TBD|<id>|Filled in per assignment|_Filled in)/i.test(trimmed);
}

async function buildExpectedGallery(root: string) {
  const registryPath = path.join(root, 'src', 'levels', 'index.ts');
  const registry = await fs.readFile(registryPath, 'utf8');
  const order = parseRegistryOrder(registry);
  const imports = parseSwitchImports(registry);
  const sections: string[] = [];
  for (const { id } of order) {
    const modulePath = imports.get(id) ?? `./${id}`;
    const dir = modulePath.replace(/^\.\//, '');
    const cardPath = path.join(root, 'src', 'levels', dir, 'level.md');
    sections.push((await fs.readFile(cardPath, 'utf8')).trimEnd());
  }
  const header = '# Level gallery\n\nGenerated by `npm run gallery`. Edit `src/levels/<id>/level.md`, then re-run `npm run gallery`.\n';
  return `${header}\n${sections.join('\n\n---\n\n')}\n`;
}

function parseRegistryOrder(source: string) {
  const arrayMatch = source.match(/export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error('Could not find levelMetadatas array');
  const entries: Array<{ id: string; title: string }> = [];
  const entryRegex = /\{\s*id:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(arrayMatch[1]))) entries.push({ id: match[1], title: match[2] });
  return entries;
}

function parseSwitchImports(source: string) {
  const map = new Map<string, string>();
  const caseRegex = /case '([^']+)':\s*\n\s*return \(await import\('([^']+)'\)\)\.[A-Za-z0-9_]+;/g;
  let match: RegExpExecArray | null;
  while ((match = caseRegex.exec(source))) map.set(match[1], match[2]);
  return map;
}

function relative(root: string, filePath: string) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}
