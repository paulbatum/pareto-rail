#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSourceLines } from '../count-source-lines.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = path.join(root, 'benchmark/private');
const levelsRoot = path.join(root, 'src/benchmark-levels');
const outputPath = path.join(levelsRoot, '..', 'benchmark', 'rank-catalog.json');
const publicationPath = path.join(privateRoot, 'publication.json');
const featuredModelsPath = path.join(root, 'src/app/featured-models.md');
const publicModelNames = new Map([
  ['stealth/ox-alpha', 'z-ai/glm-5.3-flash'],
]);

export const configurationLabels = {
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
  },
  'codex-sol-max': {
    modelName: 'GPT-5.6 Sol',
    workflowName: 'solo',
    primaryModel: 'gpt-5.6-sol',
    effort: 'max',
    workflowSummary: 'One fresh unattended Codex session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'codex-luna-max': {
    modelName: 'GPT-5.6 Luna',
    workflowName: 'solo',
    primaryModel: 'gpt-5.6-luna',
    effort: 'max',
    workflowSummary: 'One fresh unattended Codex session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
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
  'claude-opus-4-8-high': {
    modelName: 'Claude Opus 4.8',
    workflowName: 'solo',
    primaryModel: 'claude-opus-4-8',
    effort: 'high',
    workflowSummary: 'One fresh unattended Claude Code session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'claude-opus-5-high': {
    modelName: 'Claude Opus 5',
    workflowName: 'solo',
    primaryModel: 'claude-opus-5',
    effort: 'high',
    workflowSummary: 'One fresh unattended Claude Code session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'claude-fable-5-1-high': {
    modelName: 'Claude Fable 5.1',
    workflowName: 'solo',
    primaryModel: 'claude-fable-5-1',
    effort: 'high',
    workflowSummary: 'One fresh unattended Claude Code session. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
    featured: true,
  },
  'claude-fable-5-high-b20': {
    modelName: 'Claude Fable 5',
    workflowName: 'solo, $20 budget',
    primaryModel: 'claude-fable-5',
    effort: 'high',
    workflowSummary: 'The solo unattended Claude Code session run under a $20 soft task budget: the model is told a budget exists, receives relative spend notices, and is resumed in the same session while it keeps submitting well under budget, so the budget is spent on the level\'s quality.',
  },
  'claude-opus-4-8-high-b20': {
    modelName: 'Claude Opus 4.8',
    workflowName: 'solo, $20 budget',
    primaryModel: 'claude-opus-4-8',
    effort: 'high',
    workflowSummary: 'The solo unattended Claude Code session run under a $20 soft task budget: the model is told a budget exists, receives relative spend notices, and is resumed in the same session while it keeps submitting well under budget, so the budget is spent on the level\'s quality.',
  },
  'codex-sol-high-b20': {
    modelName: 'GPT-5.6 Sol',
    workflowName: 'solo, $20 budget',
    primaryModel: 'gpt-5.6-sol',
    effort: 'high',
    workflowSummary: 'The solo unattended Codex session run under a $20 soft task budget: the model is told a budget exists, receives relative spend notices, and is resumed in the same session while it keeps submitting well under budget, so the budget is spent on the level\'s quality.',
  },
  'agy-gemini-3-6-flash-high': {
    modelName: 'Gemini 3.6 Flash',
    workflowName: 'solo',
    primaryModel: 'gemini-3.6-flash',
    effort: 'high',
    workflowSummary: 'One fresh unattended Antigravity CLI session driving Gemini on a Google subscription. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'agy-gemini-3-7-flash-high': {
    modelName: 'Gemini 3.7 Flash',
    workflowName: 'solo',
    primaryModel: 'gemini-3.7-flash',
    effort: 'high',
    workflowSummary: 'One fresh unattended Antigravity CLI session driving Gemini on a Google subscription. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'agy-gemini-3-8-flash-high': {
    modelName: 'Gemini 3.8 Flash',
    workflowName: 'solo',
    primaryModel: 'gemini-3.8-flash',
    effort: 'high',
    workflowSummary: 'One fresh unattended Antigravity CLI session driving Gemini on a Google subscription. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'pi-openrouter-ox-alpha-high': {
    modelName: 'GLM 5.3 Flash',
    workflowName: 'solo',
    primaryModel: 'z-ai/glm-5.3-flash',
    effort: 'high',
    workflowSummary: 'One fresh unattended pi session driving GLM 5.3 Flash over OpenRouter. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'pi-openrouter-inkling-high': {
    modelName: 'Inkling',
    workflowName: 'solo',
    primaryModel: 'thinkingmachines/inkling',
    effort: 'high',
    workflowSummary: 'One fresh unattended pi session driving Inkling over OpenRouter. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'pi-kimi-k3-max': {
    modelName: 'Kimi K3',
    workflowName: 'solo',
    primaryModel: 'k3',
    effort: 'max',
    workflowSummary: 'One fresh unattended pi session driving Kimi K3 on Moonshot\'s own subscription endpoint. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
  'pi-openrouter-kimi-k3-max': {
    modelName: 'Kimi K3',
    workflowName: 'solo',
    primaryModel: 'moonshotai/kimi-k3',
    effort: 'max',
    workflowSummary: 'One fresh unattended pi session driving Kimi K3 over OpenRouter. The model plans, implements, reviews, and verifies its own level without subagents or operator feedback.',
  },
};

// Publication scope: a configuration is published only when it carries a public
// label above and is listed here. The two gates stay separate so labeling a
// configuration (its identity) never republishes it on its own. A configuration
// missing from this set is warned and withheld; its entrants never enter the pool.
export const PUBLISHED_CONFIGURATIONS = new Set([
  'claude-fable-5-high',
  'claude-fable-5-opus-delegation',
  'codex-sol-high',
  'codex-sol-terra-delegation',
  'claude-fable-5-high-b20',
  'claude-opus-4-8-high',
  'claude-opus-4-8-high-b20',
  'claude-opus-5-high',
  'claude-fable-5-1-high',
  'codex-sol-high-b20',
  'codex-sol-max',
  'codex-luna-max',
  'agy-gemini-3-6-flash-high',
  'agy-gemini-3-7-flash-high',
  'agy-gemini-3-8-flash-high',
  'pi-openrouter-ox-alpha-high',
  'pi-openrouter-inkling-high',
  'pi-kimi-k3-max',
  'pi-openrouter-kimi-k3-max',
]);

const delegationIntroduction = 'Your work will be evaluated on a quality/cost pareto curve. Therefore you are encouraged to use your built in support for delegating work to subagents running cheaper models.';
const delegationResponsibility = 'You remain fully responsible for the quality of the final product. Take an active role in refining the outputs from the subagent, not just passive review.';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON ${path.relative(root, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTheme(theme) {
  const filePath = path.join(root, theme.path);
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read theme ${theme.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const heading = source.match(/^# ([^\n]+)\s*\n/m);
  if (!heading) throw new Error(`Theme ${theme.id} does not contain a level-one heading.`);
  const prompt = source.slice(heading.index + heading[0].length).trim();
  if (!prompt) throw new Error(`Theme ${theme.id} has no prompt body below its heading.`);
  const sentence = prompt.match(/^([\s\S]*?[.!?])(?:\s|$)/)?.[1] ?? prompt;
  return { id: theme.id, title: heading[1].trim(), summary: sentence, prompt };
}

function promotedDirectory(levelId) {
  const directory = path.join(levelsRoot, levelId);
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function manifestPathFor(entrant) {
  return path.join(privateRoot, 'runs', entrant.runId, 'manifest.json');
}

function runManifest(entrant) {
  const manifestPath = manifestPathFor(entrant);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Entrant ${entrant.levelId} is missing its run manifest: ${path.relative(root, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) {
    throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} has no stages with pricing.`);
  }
  if (!Array.isArray(manifest.cost?.models) || manifest.cost.models.length === 0) {
    throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} has no per-model usage.`);
  }
  return manifest;
}

// The run's cost, or null when the run could not be priced at all — a model published without a
// price leaves token counts and no dollar figure. A null cost publishes as an absent
// `generationCost`, which keeps the entrant off the cost chart. It is scheduled and rated
// like any other.
function generationCost(entrant, manifest) {
  if (manifest.cost?.status === 'unavailable') return null;
  let total = 0;
  for (const [index, stage] of manifest.stages.entries()) {
    const cost = stage?.pricing?.costUsd;
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} is missing stages[${index}].pricing.costUsd.`);
    }
    total += cost;
  }
  return total;
}

// The time a visitor compares entrants on is the time the model spent generating, so a round that ran
// without recording a completion still counts. `wallTimeSeconds` covers only the rounds that reported a
// duration, and the stage's `interruptedRounds` carry the window the session was observed running in.
function stageGenerationSeconds(stage) {
  const interrupted = (stage.interruptedRounds ?? []).reduce((total, round) => {
    if (!round.startedAt || !round.lastObservedAt) return total;
    return total + (Date.parse(round.lastObservedAt) - Date.parse(round.startedAt)) / 1_000;
  }, 0);
  return (stage.wallTimeSeconds ?? 0) + interrupted;
}

function runMetrics(entrant, manifest, labels) {
  const generationWallTimeSeconds = Math.max(...manifest.stages.map(stageGenerationSeconds));
  const totalWallTimeSeconds = manifest.timing?.wallTimeSeconds;
  if (!Number.isFinite(generationWallTimeSeconds) || !Number.isFinite(totalWallTimeSeconds)) {
    throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} is missing timing data.`);
  }
  const firstModel = manifest.cost.models[0]?.modelName;
  const models = manifest.cost.models.map((model) => ({
    modelName: publicModelNames.get(model.modelName) ?? model.modelName,
    role: labels.workflowName === 'solo' ? 'solo' : model.modelName === firstModel ? 'orchestrate' : 'implement',
    inputTokens: model.inputTokens ?? 0,
    outputTokens: model.outputTokens ?? 0,
    ...(model.cacheReadTokens !== undefined ? { cacheReadTokens: model.cacheReadTokens } : {}),
    ...(model.cacheWriteTokens !== undefined ? { cacheWriteTokens: model.cacheWriteTokens } : {}),
    ...(model.reasoningTokens !== undefined ? { reasoningTokens: model.reasoningTokens } : {}),
    ...(model.usageSource !== undefined ? { usageSource: model.usageSource } : {}),
    ...(model.costUsd !== undefined ? { costUsd: Number(model.costUsd.toFixed(8)) } : {}),
  }));
  const incomplete = manifest.stages.find((stage) => stage.result !== 'completed');
  return {
    generationWallTimeSeconds: Number(generationWallTimeSeconds.toFixed(3)),
    totalWallTimeSeconds: Number(totalWallTimeSeconds.toFixed(3)),
    result: incomplete?.result ?? 'completed',
    orchestrationTreatment: manifest.cost.orchestrationTreatment,
    harness: runHarness(entrant, manifest),
    models,
  };
}

// A run is driven by exactly one CLI, so every stage must agree on it. Each CLI reports its
// version in its own shape (`2.1.207 (Claude Code)`, `codex-cli 0.144.1`); strip the harness
// restatement so the published field is a bare version.
function runHarness(entrant, manifest) {
  const harnesses = manifest.stages.map((stage, index) => {
    const name = stage?.harness?.name;
    const version = stage?.harness?.version;
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} is missing stages[${index}].harness.`);
    }
    return { name, version: bareVersion(version) };
  });
  const [first] = harnesses;
  const disagreeing = harnesses.find((harness) => harness.name !== first.name || harness.version !== first.version);
  if (disagreeing) {
    throw new Error(`Run ${entrant.runId} for entrant ${entrant.levelId} reports more than one harness: ${first.name} ${first.version} and ${disagreeing.name} ${disagreeing.version}.`);
  }
  return first;
}

function bareVersion(version) {
  return version.replace(/\s*\(.*\)\s*$/, '').replace(/^\S+\s+(?=\d)/, '').trim();
}

// Provenance copied verbatim from the run manifest: which entrant baseline the
// level was generated on, and the materials commit it was handed. Omitted when a
// field is absent (a retired run predating the field).
function baselineFields(manifest) {
  const entrantBaseline = manifest.baseline?.entrantBaseline?.identifier;
  const materialsCommit = manifest.baseline?.materialsCommit;
  return {
    ...(typeof entrantBaseline === 'string' ? { entrantBaseline } : {}),
    ...(typeof materialsCommit === 'string' ? { materialsCommit } : {}),
  };
}

function readDescriptor(entrant) {
  const descriptorPath = path.join(levelsRoot, entrant.levelId, 'level.json');
  const descriptor = readJson(descriptorPath);
  if (descriptor.id !== entrant.levelId) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} declares id ${descriptor.id}, expected ${entrant.levelId}.`);
  }
  if (typeof descriptor.title !== 'string' || descriptor.title.length === 0) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} is missing a title.`);
  }
  if (!descriptor.contentImages?.hero) {
    throw new Error(`Benchmark descriptor ${path.relative(root, descriptorPath)} is missing contentImages.hero.`);
  }
  return descriptor;
}

// Build one entrant record from its run manifest. An entrant with a promoted
// level module also carries a thumbnail from its descriptor; without one the
// descriptor is skipped and the site renders a thumbnail fallback.
export function buildEntrant(entrant, { includeThumbnail }) {
  const manifest = runManifest(entrant);
  const cost = generationCost(entrant, manifest);
  const labels = configurationLabels[entrant.configurationId] ?? {
    modelName: entrant.configurationId,
    workflowName: entrant.configurationId,
  };
  const descriptor = includeThumbnail ? readDescriptor(entrant) : null;
  return {
    levelId: entrant.levelId,
    themeId: entrant.themeId,
    configurationId: entrant.configurationId,
    modelName: labels.modelName,
    workflowName: labels.workflowName,
    ...(cost === null ? {} : { generationCost: Number(cost.toFixed(8)) }),
    ...(promotedDirectory(entrant.levelId) ? { linesOfCode: countSourceLines(path.join(levelsRoot, entrant.levelId)) } : {}),
    run: runMetrics(entrant, manifest, labels),
    ...(descriptor ? { thumbnailPath: descriptor.contentImages.hero } : {}),
    ...(labels.featured ? { featured: true } : {}),
    ...(entrant.retired ? { retired: true } : {}),
    ...baselineFields(manifest),
  };
}

// Retained fallback for a retired entrant whose run predates current tooling and
// has no manifest: reuse the last published record so the gallery keeps its
// history. The retired level's content images are deleted with it, so the
// thumbnail reference is dropped and no provenance is available.
function historicalEntrantFor(entrant) {
  const catalog = readJson(outputPath);
  const record = (catalog.entrants ?? []).find((candidate) => candidate.levelId === entrant.levelId);
  if (!record) {
    throw new Error(`Retired entrant ${entrant.levelId} has no run manifest and no retained catalog record.`);
  }
  if (record.themeId !== entrant.themeId || record.configurationId !== entrant.configurationId) {
    throw new Error(`Retired entrant ${entrant.levelId} does not match its publication identity.`);
  }
  const { thumbnailPath, ...retained } = record;
  return { ...retained, retired: true };
}

// A configuration publishes only when it carries a global label (its identity)
// and sits in the publication scope. A configuration failing either gate is
// warned and withheld, so its entrants never enter the pool.
function isPublishedConfiguration(entrant) {
  const labeled = Boolean(configurationLabels[entrant.configurationId]);
  const scoped = PUBLISHED_CONFIGURATIONS.has(entrant.configurationId);
  if (labeled && scoped) return true;
  const reason = !labeled ? 'has no public label' : 'is not in the publication scope';
  console.warn(`Withholding ${entrant.levelId}: configuration ${entrant.configurationId} ${reason}.`);
  return false;
}

export function buildCatalog(publication, generatedAt) {
  if (!Array.isArray(publication.themes)) throw new Error('Publication has no themes array.');
  if (!Array.isArray(publication.entrants)) throw new Error('Publication has no entrants array.');
  const entrantsByTheme = new Map();
  for (const entrant of publication.entrants) {
    const list = entrantsByTheme.get(entrant.themeId) ?? [];
    list.push(entrant);
    entrantsByTheme.set(entrant.themeId, list);
  }

  const themes = [];
  const entrants = [];
  for (const theme of publication.themes) {
    const themeEntrants = (entrantsByTheme.get(theme.id) ?? []).filter(isPublishedConfiguration);
    // A theme publishes once it has at least one live (non-retired, promoted)
    // entrant. A not-yet-promoted entrant simply stays unpublished without hiding
    // the rest of its theme; a theme with no live entrant is not published at all.
    const hasLive = themeEntrants.some((entrant) => !entrant.retired && promotedDirectory(entrant.levelId));
    if (!hasLive) continue;

    const parsed = parseTheme(theme);
    themes.push({ ...parsed, ...(theme.retired ? { retired: true } : {}), ...(theme.experimental ? { experimental: true } : {}), ...(theme.featured ? { featured: true } : {}) });
    const accepted = new Set(theme.acceptedBaselines ?? []);
    for (const entrant of [...themeEntrants].sort((left, right) => left.levelId.localeCompare(right.levelId))) {
      if (entrant.retired) {
        // A retired entrant whose level module is still promoted keeps its
        // thumbnail and stays playable; one whose module was deleted publishes
        // without a thumbnail and the site renders its fallback.
        entrants.push(fs.existsSync(manifestPathFor(entrant))
          ? buildEntrant(entrant, { includeThumbnail: promotedDirectory(entrant.levelId) })
          : historicalEntrantFor(entrant));
        continue;
      }
      if (!promotedDirectory(entrant.levelId)) {
        console.warn(`Withholding ${entrant.levelId}: its level module is not promoted yet.`);
        continue;
      }
      const record = buildEntrant(entrant, { includeThumbnail: true });
      if (!accepted.has(record.entrantBaseline)) {
        throw new Error(`Entrant ${entrant.levelId} was generated on baseline ${record.entrantBaseline ?? '<none>'}, which is not an accepted baseline for theme ${theme.id} (accepted: ${[...accepted].join(', ') || '<none>'}).`);
      }
      entrants.push(record);
    }
  }

  const configurations = Object.entries(configurationLabels).map(([id, labels]) => ({
    id,
    ...labels,
    ...(labels.delegateModel ? {
      delegationGuidance: `${delegationIntroduction}\n\nDelegate to model: ${labels.delegateModel} with reasoning level ${labels.delegateEffort}\n\n${delegationResponsibility}`,
    } : {}),
  }));

  return { generatedAt, configurations, themes, entrants };
}

// The home page names its models from hand-maintained copy, so a model can be
// announced while it is still running and stay named after a retirement. Export
// reports the drift and leaves the decision with the operator rather than
// projecting the catalog into the copy. A `(retired)` name is an answer already
// given — the model publishes levels the home page deliberately stops naming —
// so it is silent in both directions.
//
// This parses the same file as src/app/featured-models.ts by the same rules;
// change one and change the other.
function reportFeaturedModelDrift(catalog) {
  const listed = fs.readFileSync(featuredModelsPath, 'utf8').split('\n')
    .map((line) => /^-\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((entry) => entry !== undefined)
    .map((entry) => ({ entry, retired: /\(retired\)$/i.test(entry) }))
    .map(({ entry, retired }) => ({ retired, name: entry.replace(/\s*\((?:new|retired)\)$/i, '') }))
    // A name may carry a note after an em dash, and may be written as a markdown
    // link. The catalog knows the model by its name alone, so both come off here.
    .map((item) => ({ ...item, name: /^(.*?)\s+—\s+.*\S$/.exec(item.name)?.[1] ?? item.name }))
    .map((item) => ({ ...item, name: /^\[(.+)\]\(\S+\)$/.exec(item.name)?.[1] ?? item.name }));
  const named = listed.filter((item) => !item.retired).map((item) => item.name);
  const acknowledged = new Set(listed.map((item) => item.name));
  const publishing = new Set(catalog.entrants
    .filter((entrant) => !entrant.retired)
    .map((entrant) => configurationLabels[entrant.configurationId]?.modelName)
    .filter(Boolean));
  const unnamed = [...publishing].filter((modelName) => !acknowledged.has(modelName));
  const unpublished = named.filter((modelName) => !publishing.has(modelName));
  if (unnamed.length === 0 && unpublished.length === 0) return;
  console.warn(`\nFeatured models in ${path.relative(root, featuredModelsPath)} differ from the catalog just written:`);
  for (const modelName of unnamed) console.warn(`  publishing levels, not named on the home page: ${modelName}`);
  for (const modelName of unpublished) console.warn(`  named on the home page, publishing no live level: ${modelName}`);
  console.warn('  That list is deliberately hand-maintained — decide whether the home page should change. This export is already complete.\n');
}

function main() {
  if (!fs.existsSync(publicationPath)) {
    throw new Error(`No publication manifest found at ${path.relative(root, publicationPath)}.`);
  }
  const publication = readJson(publicationPath);
  const catalog = buildCatalog(publication, new Date().toISOString());
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${catalog.entrants.length} entrants across ${catalog.themes.length} themes.`);
  reportFeaturedModelDrift(catalog);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Rank catalog export failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
