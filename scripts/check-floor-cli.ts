import fs from 'node:fs/promises';
import path from 'node:path';
import { computeCenterMetrics, formatEngineDefaultsReport, runSimulationSuite, validateLevelAudioConfig } from './simulation-cli';
import { analyzeOcclusionLevels, formatReports } from './target-occlusion.mjs';
import { buildGallery } from './level-gallery.mjs';

export async function main(argv = process.argv.slice(2), env: { root?: string } = {}) {
  const root = env.root ?? process.cwd();
  const options = parseArgs(argv);
  const { analyzePerformanceLevels, formatPerformanceReports } = await import('./check-perf.mjs');
  const audioConfigErrors = await validateLevelAudioConfig(options.level, root);

  const [result, occlusionReports, perfReports] = await Promise.all([
    runSimulationSuite({
      level: options.level,
      rootDir: root,
      policies: ['none', 'perfect', 'imperfect', 'reject'],
      seed: options.seed,
      dt: options.dt,
      gapThreshold: options.gapThreshold,
    }),
    analyzeOcclusionLevels([options.level], { dt: options.dt }),
    analyzePerformanceLevels([options.level], { dt: options.dt }),
  ]);

  const failures: string[] = [];
  const warnings: string[] = [];
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

  const perfectRun = result.runs.find((run) => run.policy === 'perfect');
  if (perfectRun) {
    const metrics = computeCenterMetrics(perfectRun);
    if (metrics.kills > 0) {
      const { avgDistance, centerPercent } = metrics;
      
      // Distance gate
      if (avgDistance > 60.0) {
        failures.push(`Average enemy destruction distance is too high (${avgDistance.toFixed(1)}m, limit 60.0m). Enemies must not spawn too far away.`);
      } else if (avgDistance > 45.0) {
        warnings.push(`Average enemy destruction distance is slightly high (${avgDistance.toFixed(1)}m, warning threshold 45.0m). Consider spawning enemies closer.`);
      }

      // Centerness gate
      if (centerPercent > 70.0) {
        failures.push(`Enemy destruction concentration in screen center is too high (${centerPercent.toFixed(1)}%, limit 70.0%). Enemies must not cluster in the center of the screen.`);
      } else if (centerPercent > 25.0) {
        warnings.push(`Enemy destruction concentration in screen center is slightly high (${centerPercent.toFixed(1)}%, warning threshold 25.0%). Consider spreading spawns away from the center.`);
      }
    }
  }

  const cardPath = path.join(root, 'src', level.sourceRoot, level.folder, 'level.md');
  try {
    const card = await fs.readFile(cardPath, 'utf8');
    if (!isNonTemplateCard(card, level.title)) failures.push(`${relative(root, cardPath)} is missing, too thin, or still looks like a template.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') failures.push(`Missing ${relative(root, cardPath)}.`);
    else throw error;
  }

  const galleryPath = path.join(root, 'docs', 'level-gallery.md');
  const expectedGallery = await buildGallery(root);
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
  for (const error of audioConfigErrors) failures.push(`Audio configuration validation failed: ${error}`);

  const lines: string[] = [];
  lines.push(`${level.title} floor check`);
  lines.push(`duration ${level.duration.toFixed(1)}s; spawned kinds ${spawnedKinds.size}: ${[...spawnedKinds].sort().join(', ') || 'none'}`);
  lines.push(`event coverage missing: ${result.eventCoverage.neverFired.join(', ') || 'none'}`);
  lines.push('');
  lines.push(formatEngineDefaultsReport(result.engineDefaults));
  lines.push('');
  lines.push(`target occlusion warnings: ${occlusionWarnings.length}`);
  lines.push(`performance gate failures: ${perfFailures.length}`);
  lines.push(`audio configuration failures: ${audioConfigErrors.length}`);
  lines.push(`spawn centerness/distance warnings: ${warnings.length}`);
  
  if (warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

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

function relative(root: string, filePath: string) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}
