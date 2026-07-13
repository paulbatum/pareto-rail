#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schedulePath = path.join(root, 'benchmark/private/run-schedule.json');
const themesRoot = path.join(root, 'benchmark/themes');
const levelsRoot = path.join(root, 'src/benchmark-levels');
const outputPath = path.join(levelsRoot, '..', 'benchmark', 'rank-catalog.json');

const configurationLabels = {
  'claude-fable-5-high': { modelName: 'Claude Fable 5', workflowName: 'solo', featured: true },
  'claude-fable-5-opus-delegation': { modelName: 'Claude Fable 5', workflowName: 'delegated' },
  'codex-sol-high': { modelName: 'GPT-5.6 Sol', workflowName: 'solo', featured: true },
  'codex-sol-terra-delegation': { modelName: 'GPT-5.6 Sol', workflowName: 'delegated' },
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON ${path.relative(root, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTheme(themeId) {
  const filePath = path.join(themesRoot, `${themeId}.md`);
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read theme ${themeId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const heading = source.match(/^# ([^\n]+)\s*\n/m);
  if (!heading) throw new Error(`Theme ${themeId} does not contain a level-one heading.`);
  const prompt = source.slice(heading.index + heading[0].length).trim();
  if (!prompt) throw new Error(`Theme ${themeId} has no prompt body below its heading.`);
  const sentence = prompt.match(/^([\s\S]*?[.!?])(?:\s|$)/)?.[1] ?? prompt;
  return { id: themeId, title: heading[1].trim(), summary: sentence, prompt };
}

function promotedDirectory(levelId) {
  const directory = path.join(levelsRoot, levelId);
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function generationCost(assignment) {
  const manifestPath = path.join(root, 'benchmark/private/runs', assignment.runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Promoted level ${assignment.levelId} is missing its run manifest: ${path.relative(root, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) {
    throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} has no stages with pricing.`);
  }
  let total = 0;
  for (const [index, stage] of manifest.stages.entries()) {
    const cost = stage?.pricing?.costUsd;
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} is missing stages[${index}].pricing.costUsd.`);
    }
    total += cost;
  }
  return total;
}

function entrantFor(assignment, cost) {
  const descriptorPath = path.join(levelsRoot, assignment.levelId, 'level.json');
  const descriptor = readJson(descriptorPath);
  if (descriptor.id !== assignment.levelId) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} declares id ${descriptor.id}, expected ${assignment.levelId}.`);
  }
  if (typeof descriptor.title !== 'string' || descriptor.title.length === 0) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} is missing a title.`);
  }
  if (!descriptor.contentImages?.hero) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} is missing contentImages.hero.`);
  }
  const labels = configurationLabels[assignment.configurationId] ?? {
    modelName: assignment.configurationId,
    workflowName: assignment.configurationId,
  };
  return {
    levelId: assignment.levelId,
    themeId: assignment.theme.id,
    configurationId: assignment.configurationId,
    modelName: labels.modelName,
    workflowName: labels.workflowName,
    generationCost: Number(cost.toFixed(8)),
    thumbnailPath: descriptor.contentImages.hero,
    ...(labels.featured ? { featured: true } : {}),
  };
}

function main() {
  const schedule = readJson(schedulePath);
  if (!Array.isArray(schedule.assignments)) throw new Error('The run schedule has no assignments array.');

  // Validate every already-promoted assignment before applying theme completeness.
  // This prevents a bad promoted entry from being silently hidden by an incomplete
  // theme while still allowing not-yet-promoted assignments to remain unpublished.
  const costs = new Map();
  for (const assignment of schedule.assignments) {
    if (promotedDirectory(assignment.levelId)) costs.set(assignment.levelId, generationCost(assignment));
  }

  const assignmentsByTheme = new Map();
  for (const assignment of schedule.assignments) {
    const themeId = assignment.theme?.id;
    if (!themeId) throw new Error(`Scheduled assignment ${assignment.levelId} has no theme id.`);
    const assignments = assignmentsByTheme.get(themeId) ?? [];
    assignments.push(assignment);
    assignmentsByTheme.set(themeId, assignments);
  }

  const themes = [];
  const entrants = [];
  for (const themeId of [...assignmentsByTheme.keys()].sort()) {
    const assignments = assignmentsByTheme.get(themeId);
    if (assignments.some((assignment) => !promotedDirectory(assignment.levelId))) continue;
    themes.push(parseTheme(themeId));
    for (const assignment of [...assignments].sort((left, right) => left.levelId.localeCompare(right.levelId))) {
      entrants.push(entrantFor(assignment, costs.get(assignment.levelId)));
    }
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    themes,
    entrants,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${entrants.length} entrants across ${themes.length} themes.`);
}

try {
  main();
} catch (error) {
  console.error(`Rank catalog export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
