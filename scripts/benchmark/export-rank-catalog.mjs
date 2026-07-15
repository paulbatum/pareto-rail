#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = path.join(root, 'benchmark/private');
const themesRoot = path.join(root, 'benchmark/themes');
const levelsRoot = path.join(root, 'src/benchmark-levels');
const outputPath = path.join(levelsRoot, '..', 'benchmark', 'rank-catalog.json');

const configurationLabels = {
  'claude-fable-5-high': {
    modelName: 'Claude Fable 5',
    workflowName: 'solo',
    primaryModel: 'claude-fable-5',
    effort: 'high',
    workflowSummary: 'One fresh unattended Claude Code session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
    featured: true,
  },
  'claude-fable-5-opus-delegation': {
    modelName: 'Claude Fable 5',
    workflowName: 'delegated',
    primaryModel: 'claude-fable-5',
    effort: 'high',
    delegateModel: 'opus',
    delegateEffort: 'high',
    workflowSummary: 'Fable remains the planner and reviewer while an Opus subagent implements inside the same unattended Claude Code session.',
  },
  'codex-sol-high': {
    modelName: 'GPT-5.6 Sol',
    workflowName: 'solo',
    primaryModel: 'gpt-5.6-sol',
    effort: 'high',
    workflowSummary: 'One fresh unattended Codex session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
    featured: true,
  },
  'codex-sol-terra-delegation': {
    modelName: 'GPT-5.6 Sol',
    workflowName: 'delegated',
    primaryModel: 'gpt-5.6-sol',
    effort: 'high',
    delegateModel: 'gpt-5.6-terra',
    delegateEffort: 'high',
    workflowSummary: 'Sol remains the planner and reviewer while a Terra subagent implements inside the same unattended Codex session.',
  },
};

const delegationIntroduction = 'Your work will be evaluated on a quality/cost pareto curve. Therefore you are encouraged to use your built in support for delegating work to subagents running cheaper models.';
const delegationResponsibility = 'You remain fully responsible for the quality of the final product. Take an active role in refining the outputs from the subagent, not just passive review.';

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

function runManifest(assignment) {
  const manifestPath = path.join(root, 'benchmark/private/runs', assignment.runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Promoted level ${assignment.levelId} is missing its run manifest: ${path.relative(root, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) {
    throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} has no stages with pricing.`);
  }
  if (!Array.isArray(manifest.cost?.models) || manifest.cost.models.length === 0) {
    throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} has no per-model usage.`);
  }
  return manifest;
}

function generationCost(assignment, manifest) {
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

function runMetrics(assignment, manifest, labels) {
  const generationWallTimeSeconds = Math.max(...manifest.stages.map((stage) => stage.wallTimeSeconds ?? 0));
  const totalWallTimeSeconds = manifest.timing?.wallTimeSeconds;
  if (!Number.isFinite(generationWallTimeSeconds) || !Number.isFinite(totalWallTimeSeconds)) {
    throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} is missing timing data.`);
  }
  const firstModel = manifest.cost.models[0]?.modelName;
  const models = manifest.cost.models.map((model) => ({
    modelName: model.modelName,
    role: labels.workflowName === 'solo' ? 'solo' : model.modelName === firstModel ? 'orchestrate' : 'implement',
    inputTokens: model.inputTokens ?? 0,
    outputTokens: model.outputTokens ?? 0,
    ...(model.cacheReadTokens !== undefined ? { cacheReadTokens: model.cacheReadTokens } : {}),
    ...(model.cacheWriteTokens !== undefined ? { cacheWriteTokens: model.cacheWriteTokens } : {}),
    ...(model.reasoningTokens !== undefined ? { reasoningTokens: model.reasoningTokens } : {}),
    ...(model.costUsd !== undefined ? { costUsd: Number(model.costUsd.toFixed(8)) } : {}),
  }));
  const incomplete = manifest.stages.find((stage) => stage.result !== 'completed');
  return {
    generationWallTimeSeconds: Number(generationWallTimeSeconds.toFixed(3)),
    totalWallTimeSeconds: Number(totalWallTimeSeconds.toFixed(3)),
    result: incomplete?.result ?? 'completed',
    orchestrationTreatment: manifest.cost.orchestrationTreatment,
    harness: runHarness(assignment, manifest),
    models,
  };
}

// A run is driven by exactly one CLI, so every stage must agree on it. Each CLI reports its
// version in its own shape (`2.1.207 (Claude Code)`, `codex-cli 0.144.1`); strip the harness
// restatement so the published field is a bare version.
function runHarness(assignment, manifest) {
  const harnesses = manifest.stages.map((stage, index) => {
    const name = stage?.harness?.name;
    const version = stage?.harness?.version;
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} is missing stages[${index}].harness.`);
    }
    return { name, version: bareVersion(version) };
  });
  const [first] = harnesses;
  const disagreeing = harnesses.find((harness) => harness.name !== first.name || harness.version !== first.version);
  if (disagreeing) {
    throw new Error(`Run ${assignment.runId} for promoted level ${assignment.levelId} reports more than one harness: ${first.name} ${first.version} and ${disagreeing.name} ${disagreeing.version}.`);
  }
  return first;
}

function bareVersion(version) {
  return version.replace(/\s*\(.*\)\s*$/, '').replace(/^\S+\s+(?=\d)/, '').trim();
}

function entrantFor(assignment, cost, manifest) {
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
    run: runMetrics(assignment, manifest, labels),
    thumbnailPath: descriptor.contentImages.hero,
    ...(labels.featured ? { featured: true } : {}),
  };
}

function scheduleVersionNumber(benchmarkVersion) {
  const match = /^v([1-9][0-9]*)$/.exec(benchmarkVersion);
  if (!match) throw new Error(`Schedule benchmarkVersion must use v<number>, received ${benchmarkVersion}.`);
  return Number(match[1]);
}

function scheduleFiles() {
  return fs.readdirSync(privateRoot)
    .filter((fileName) => /^run-schedule.*\.json$/.test(fileName))
    .map((fileName) => path.join(privateRoot, fileName))
    .sort((left, right) => left.localeCompare(right));
}

function buildVersion(schedule, generatedAt) {
  if (!Array.isArray(schedule.assignments)) throw new Error(`Schedule ${schedule.benchmarkVersion} has no assignments array.`);
  // The public label registry is the exporter-owned allowlist for catalog
  // configurations. Schedules can contain later registrations before their
  // public labels and presentation assets are ready.
  const publicAssignments = schedule.assignments.filter((assignment) => configurationLabels[assignment.configurationId]);
  const withheld = schedule.assignments.filter((assignment) => !configurationLabels[assignment.configurationId]);
  for (const assignment of withheld) {
    console.warn(`Withholding ${assignment.levelId} from ${schedule.benchmarkVersion}: configuration ${assignment.configurationId} has no public label.`);
  }

  // Validate every already-promoted assignment before applying theme completeness.
  // This prevents a bad promoted entry from being silently hidden by an incomplete
  // theme while still allowing not-yet-promoted assignments to remain unpublished.
  const runData = new Map();
  for (const assignment of publicAssignments) {
    if (!promotedDirectory(assignment.levelId)) continue;
    const manifest = runManifest(assignment);
    runData.set(assignment.levelId, { manifest, cost: generationCost(assignment, manifest) });
  }

  const assignmentsByTheme = new Map();
  for (const assignment of publicAssignments) {
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
      const data = runData.get(assignment.levelId);
      entrants.push(entrantFor(assignment, data.cost, data.manifest));
    }
  }

  return {
    benchmarkVersion: `rank-catalog-${schedule.benchmarkVersion}`,
    generatedAt,
    themes,
    entrants,
  };
}

function main() {
  const files = scheduleFiles();
  if (files.length === 0) throw new Error(`No benchmark schedules found in ${path.relative(root, privateRoot)} matching run-schedule*.json.`);

  const schedules = files.map((filePath) => ({ filePath, schedule: readJson(filePath) }));
  const seenVersions = new Set();
  for (const { filePath, schedule } of schedules) {
    if (!schedule || typeof schedule !== 'object' || typeof schedule.benchmarkVersion !== 'string' || schedule.benchmarkVersion.length === 0) {
      throw new Error(`Schedule ${path.relative(root, filePath)} is missing benchmarkVersion.`);
    }
    if (seenVersions.has(schedule.benchmarkVersion)) {
      throw new Error(`Duplicate schedule benchmarkVersion ${schedule.benchmarkVersion}.`);
    }
    seenVersions.add(schedule.benchmarkVersion);
    schedule.versionNumber = scheduleVersionNumber(schedule.benchmarkVersion);
  }
  schedules.sort((left, right) => left.schedule.versionNumber - right.schedule.versionNumber || left.schedule.benchmarkVersion.localeCompare(right.schedule.benchmarkVersion));

  const generatedAt = new Date().toISOString();
  const versions = schedules.map(({ schedule }) => buildVersion(schedule, generatedAt));
  const configurations = Object.entries(configurationLabels).map(([id, labels]) => ({
    id,
    ...labels,
    ...(labels.delegateModel ? {
      delegationGuidance: `${delegationIntroduction}\n\nDelegate to model: ${labels.delegateModel} with reasoning level ${labels.delegateEffort}\n\n${delegationResponsibility}`,
    } : {}),
  }));
  const catalog = {
    generatedAt,
    activeBenchmarkVersion: versions.at(-1).benchmarkVersion,
    configurations,
    versions,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const entrants = versions.reduce((total, version) => total + version.entrants.length, 0);
  const themes = versions.reduce((total, version) => total + version.themes.length, 0);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${entrants} entrants across ${themes} themes in ${versions.length} benchmark versions.`);
}

try {
  main();
} catch (error) {
  console.error(`Rank catalog export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
