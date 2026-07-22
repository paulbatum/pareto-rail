#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = path.join(root, 'benchmark/private');
const runsRoot = path.join(privateRoot, 'runs');
const publicationPath = path.join(privateRoot, 'publication.json');
const manifestsRoot = path.join(root, 'benchmark/manifests');
const indexPath = path.join(manifestsRoot, 'index.json');

// The publishable provenance subset of a run directory. This is an allowlist: a
// file is copied only if it is named here, so a new artifact under a run is
// withheld by default rather than leaked by default. The goal is that a
// skeptical reader can verify the rendered prompt, the baseline and sealed
// commits, the gate results, the contamination and promotion decision, and the
// measured cost — nothing that carries live credentials or bulk transcript.
const RUN_ROOT_FILES = [
  'manifest.json',
  'run-definition.json',
  'rendered-assignment.md',
  'rendered-assignment.json',
  'payload.json',
  'evaluated.json',
  'promotion.json',
  'incident.json',
  'setup.json',
  'worktree.json',
  'stage-launch.json',
];
const INPUTS_FILES = ['assignment-template.md', 'theme.md'];
const STAGE_FILES = [
  'command.json',
  'result.json',
  'raw-usage.json',
  'selected-model.json',
  'budget.json',
  'final-message.md',
  'stderr.log',
];
// gates/ keeps its manifest and the small per-gate logs; promotion-checks/ keeps
// the per-check records. Both are matched by extension so a new gate or check is
// carried without editing this file.
const isGateFile = (name) => name === 'gates.json' || name.endsWith('.log');
const isPromotionCheckFile = (name) => name.endsWith('.json') || name.endsWith('.log');

// Radioactive by basename: files that carry live credentials, bulk transcript,
// or controller scratch. The allowlist above never names these, so this is the
// post-copy safety net — an exported tree containing any of them is a bug, and
// the export fails rather than shipping it.
const DENY_BASENAMES = new Set([
  'rollout.jsonl',
  'events.jsonl',
  'model-catalog.json',
  'model-catalog.stderr.log',
  'credential-source.json',
  'controller-state.json',
  'auth.json',
  '.credentials.json',
]);
// Entire directories that must never appear under an exported run.
const DENY_DIRNAMES = new Set(['budget', 'harness-home']);

// Credential shapes. Each is specific enough that the real run artifacts — which
// mention "api key" in prose and are dense with sha256 hashes and session ids —
// pass cleanly, while an actual secret does not. The env-assignment and generic
// api-key rules require a secret-like value to follow the name, so naming a
// variable without a value never trips them.
const SECRET_PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai-project-key', re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  {
    name: 'api-key-env-assignment',
    re: /\b(?:ANTHROPIC|OPENAI|OPENROUTER|MOONSHOT|GEMINI|GOOGLE|GROQ)_API_KEY\b\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i,
  },
  {
    name: 'generic-api-key-assignment',
    re: /\bapi[_-]?key\b["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i,
  },
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON ${path.relative(root, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isFile(p) {
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

// Collect the publishable file set of one run as { rel, abs } pairs, where rel
// is the path under the run directory. Missing files are simply absent — a run
// that predates a given artifact contributes fewer files, never an error.
function collectRunFiles(runDir) {
  const files = [];
  const take = (rel) => {
    const abs = path.join(runDir, rel);
    if (isFile(abs)) files.push({ rel, abs });
  };

  for (const name of RUN_ROOT_FILES) take(name);
  for (const name of INPUTS_FILES) take(path.join('inputs', name));

  const gatesDir = path.join(runDir, 'gates');
  if (fs.existsSync(gatesDir)) {
    for (const name of fs.readdirSync(gatesDir).sort()) {
      if (isGateFile(name)) take(path.join('gates', name));
    }
  }

  const checksDir = path.join(runDir, 'promotion-checks');
  if (fs.existsSync(checksDir)) {
    for (const name of fs.readdirSync(checksDir).sort()) {
      if (isPromotionCheckFile(name)) take(path.join('promotion-checks', name));
    }
  }

  const stagesDir = path.join(runDir, 'stages');
  if (fs.existsSync(stagesDir)) {
    for (const stage of fs.readdirSync(stagesDir).sort()) {
      const stagePath = path.join(stagesDir, stage);
      if (!fs.statSync(stagePath).isDirectory()) continue;
      for (const harness of fs.readdirSync(stagePath).sort()) {
        const harnessPath = path.join(stagePath, harness);
        if (!fs.statSync(harnessPath).isDirectory()) continue;
        for (const name of STAGE_FILES) take(path.join('stages', stage, harness, name));
      }
    }
  }

  return files;
}

// Depth-first list of every file under a directory, as paths relative to it.
function listFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out;
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function sameBytes(a, b) {
  if (!fs.existsSync(b)) return false;
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}

// Write only when content differs, so a re-run touches nothing and reports a
// no-op. Returns 'added', 'updated', or 'unchanged'.
function syncFile(srcAbs, destAbs) {
  if (fs.existsSync(destAbs)) {
    if (sameBytes(srcAbs, destAbs)) return 'unchanged';
    fs.copyFileSync(srcAbs, destAbs);
    return 'updated';
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return 'added';
}

function writeJsonIfChanged(destAbs, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(destAbs) && fs.readFileSync(destAbs, 'utf8') === text) return 'unchanged';
  const status = fs.existsSync(destAbs) ? 'updated' : 'added';
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, text);
  return status;
}

export function assertNoDenylisted() {
  const offenders = [];
  for (const rel of listFiles(manifestsRoot)) {
    const segments = rel.split(path.sep);
    const base = segments[segments.length - 1];
    if (DENY_BASENAMES.has(base)) offenders.push(rel);
    else if (segments.some((seg) => DENY_DIRNAMES.has(seg))) offenders.push(rel);
  }
  if (offenders.length > 0) {
    throw new Error(`Denylisted artifacts reached benchmark/manifests:\n${offenders.map((o) => `  ${o}`).join('\n')}`);
  }
}

export function scanForSecrets() {
  const hits = [];
  for (const rel of listFiles(manifestsRoot)) {
    const abs = path.join(manifestsRoot, rel);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(line)) hits.push({ rel, line: index + 1, pattern: pattern.name });
      }
    });
  }
  if (hits.length > 0) {
    const report = hits.map((h) => `  ${h.rel}:${h.line} matched ${h.pattern}`).join('\n');
    throw new Error(`Secrets scan found credential-shaped content in exported files:\n${report}`);
  }
}

function main() {
  if (!fs.existsSync(publicationPath)) {
    throw new Error(`No publication manifest found at ${path.relative(root, publicationPath)}.`);
  }
  const publication = readJson(publicationPath);
  if (!Array.isArray(publication.entrants)) throw new Error('Publication has no entrants array.');

  const entrants = [...publication.entrants].sort((a, b) => a.runId.localeCompare(b.runId));

  // Desired tree: relative-to-manifests path -> source absolute path.
  const desired = new Map();
  const index = [];
  for (const entrant of entrants) {
    const runDir = path.join(runsRoot, entrant.runId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Entrant ${entrant.levelId} references missing run directory ${path.relative(root, runDir)}.`);
    }
    for (const { rel, abs } of collectRunFiles(runDir)) {
      desired.set(path.join(entrant.runId, rel), abs);
    }
    index.push({
      runId: entrant.runId,
      levelId: entrant.levelId,
      themeId: entrant.themeId,
      configurationId: entrant.configurationId,
      ...(entrant.retired ? { retired: true } : {}),
    });
  }

  const counts = { added: 0, updated: 0, unchanged: 0, pruned: 0 };

  for (const [rel, srcAbs] of desired) {
    const status = syncFile(srcAbs, path.join(manifestsRoot, rel));
    counts[status] += 1;
  }

  // Prune: any exported file no longer desired (a run dropped from publication,
  // or an artifact removed from the allowlist). README.md and index.json are
  // export-owned and never pruned as run content.
  const prunedRuns = new Set();
  for (const rel of listFiles(manifestsRoot)) {
    if (rel === 'README.md' || rel === 'index.json') continue;
    if (desired.has(rel)) continue;
    fs.rmSync(path.join(manifestsRoot, rel));
    counts.pruned += 1;
    prunedRuns.add(rel.split(path.sep)[0]);
  }
  removeEmptyDirs(manifestsRoot);
  for (const runId of [...prunedRuns].sort()) {
    console.log(`Pruned artifacts for run ${runId} (no longer published).`);
  }

  const indexStatus = writeJsonIfChanged(indexPath, { runs: index });

  assertNoDenylisted();
  scanForSecrets();

  const bytes = listFiles(manifestsRoot).reduce((sum, rel) => sum + fs.statSync(path.join(manifestsRoot, rel)).size, 0);
  console.log(
    `Exported provenance for ${entrants.length} runs: ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.pruned} pruned; index.json ${indexStatus}.`,
  );
  console.log(`benchmark/manifests total size: ${(bytes / 1048576).toFixed(2)} MB across ${listFiles(manifestsRoot).length} files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Provenance export failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
