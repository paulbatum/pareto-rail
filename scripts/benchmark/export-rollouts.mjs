#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Stages the full agent transcripts (rollout.jsonl and events.jsonl) of every
// published run into tmp/rollouts-export/, gzipped, together with a dataset
// card, and writes a checksummed file index to benchmark/manifests/rollouts.json.
// The staging tree is what gets uploaded to the Hugging Face dataset named
// below; the index is committed so readers can verify what they download.
// Transcripts are far too large for the git repository, which is why they live
// on the dataset while the per-run provenance manifests live in-repo.

const DATASET = 'paulbatum/pareto-rail-rollouts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = path.join(root, 'benchmark/private');
const runsRoot = path.join(privateRoot, 'runs');
const publicationPath = path.join(privateRoot, 'publication.json');
const stagingRoot = path.join(root, 'tmp/rollouts-export');
const indexPath = path.join(root, 'benchmark/manifests/rollouts.json');
const leakConfigPath = path.join(root, 'scripts/benchmark/betterleaks.toml');
// The scan cache lives beside the private run records it describes: gitignored,
// outside the staging tree so it can never be uploaded, and absent from a fresh
// clone — where its absence means every transcript is scanned.
const scanCachePath = path.join(privateRoot, 'rollout-scan-cache.json');
const SCAN_CACHE_VERSION = 1;

const TRANSCRIPT_FILES = ['rollout.jsonl', 'events.jsonl'];
const SUBAGENT_ROLLOUT_DIRECTORY = 'subagent-rollouts';

// Same credential shapes as export-provenance.mjs. The published transcripts
// scan clean today; any future hit fails the export before staging.
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

// Every transcript is also swept by a leak scanner (stdin mode, so exactly the
// bytes that ship are scanned) — a far broader curated ruleset than the regexes
// above. Betterleaks is preferred (the maintained successor to gitleaks, same
// author); gitleaks is accepted as a fallback since this invocation is
// CLI-compatible across both. A binary is required: this script exists to
// publish, and publishing unscanned transcripts is the failure mode being
// designed against.
function findLeakScanner() {
  for (const name of ['betterleaks', 'gitleaks']) {
    for (const candidate of [name, path.join(os.homedir(), '.local/bin', name)]) {
      const probe = spawnSync(candidate, ['version'], { stdio: 'ignore' });
      if (!probe.error && probe.status === 0) return candidate;
    }
  }
  throw new Error(
    'No leak scanner found on PATH or in ~/.local/bin. Install the single binary from https://github.com/betterleaks/betterleaks/releases and re-run.',
  );
}

function leakScan(scanner, buffer, rel) {
  // The repo config only carries an Expr filter for a known transcript false
  // positive; Expr filters are betterleaks-only, so gitleaks runs bare.
  const configArgs = path.basename(scanner) === 'betterleaks'
    ? ['-c', leakConfigPath]
    : [];
  const result = spawnSync(scanner, ['stdin', '--no-banner', '--exit-code', '9', ...configArgs], {
    input: buffer,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 0) return;
  if (result.status === 9) {
    throw new Error(`${path.basename(scanner)} found credential-shaped content in ${rel}:\n${result.stdout}${result.stderr}`);
  }
  throw new Error(`${path.basename(scanner)} failed on ${rel} (exit ${result.status}): ${result.stderr}`);
}

function scanLines(text, rel) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(line)) hits.push(`${rel}:${i + 1} matched ${pattern.name}`);
    }
  });
  return hits;
}

// Held at module scope so the cache is written even when a scan fails partway:
// only clean verdicts are stored, so the work already done is kept.
let activeScanCache = null;

function scannerVersion(scanner) {
  const probe = spawnSync(scanner, ['version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error(`Could not read ${path.basename(scanner)} version.`);
  return `${probe.stdout}${probe.stderr}`.trim();
}

// One fingerprint covers everything that decides a verdict except the scanned
// bytes: the scanner and its version, the leak-scanner config, the in-repo
// regexes, and the two functions that apply them. Change any of these and the
// fingerprint changes, which discards every cached verdict. Hashing the inputs
// is what makes that automatic — nothing has to remember to bump a number.
function rulesetFingerprint(scanner) {
  const material = JSON.stringify({
    cacheVersion: SCAN_CACHE_VERSION,
    scanner: path.basename(scanner),
    scannerVersion: scannerVersion(scanner),
    leakConfig: crypto.createHash('sha256').update(fs.readFileSync(leakConfigPath)).digest('hex'),
    patterns: SECRET_PATTERNS.map((p) => [p.name, p.re.source, p.re.flags]),
    scanLines: scanLines.toString(),
    leakScan: leakScan.toString(),
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

function loadScanCache(fingerprint, rescan) {
  const cache = { fingerprint, clean: new Set(), reused: 0, scans: 0, dirty: false };
  if (rescan || !fs.existsSync(scanCachePath)) return cache;
  try {
    const stored = JSON.parse(fs.readFileSync(scanCachePath, 'utf8'));
    // A stored fingerprint that does not match the current one means the cached
    // verdicts were produced by different rules, so none of them are reused.
    if (stored.fingerprint === fingerprint && Array.isArray(stored.clean)) {
      for (const hash of stored.clean) cache.clean.add(hash);
    }
  } catch {
    // An unreadable cache scans everything, which is the safe direction.
  }
  return cache;
}

function saveScanCache(cache) {
  if (!cache.dirty) return;
  const payload = { fingerprint: cache.fingerprint, clean: [...cache.clean].sort() };
  fs.mkdirSync(path.dirname(scanCachePath), { recursive: true });
  fs.writeFileSync(scanCachePath, `${JSON.stringify(payload, null, 2)}\n`);
  cache.dirty = false;
}

// Scans one buffer and returns its sha256, which the index also records. A
// buffer whose hash is already cached under the current ruleset fingerprint
// scanned clean before, so it is not scanned again. A hash enters the cache
// only after both scans pass, so a hit or a scanner failure leaves the file
// uncached and it is rescanned next time.
function scanBuffer(scanner, buffer, rel, cache, allHits) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (cache.clean.has(digest)) {
    cache.reused += 1;
    return digest;
  }
  cache.scans += 1;
  const hits = scanLines(buffer.toString('utf8'), rel);
  allHits.push(...hits);
  leakScan(scanner, buffer, rel);
  if (hits.length === 0) {
    cache.clean.add(digest);
    cache.dirty = true;
  }
  return digest;
}

function collectTranscripts(runDir) {
  const files = [];
  const stagesDir = path.join(runDir, 'stages');
  if (!fs.existsSync(stagesDir)) return files;
  for (const stage of fs.readdirSync(stagesDir).sort()) {
    const stagePath = path.join(stagesDir, stage);
    if (!fs.statSync(stagePath).isDirectory()) continue;
    for (const harness of fs.readdirSync(stagePath).sort()) {
      const harnessPath = path.join(stagePath, harness);
      if (!fs.statSync(harnessPath).isDirectory()) continue;
      for (const name of TRANSCRIPT_FILES) {
        const abs = path.join(harnessPath, name);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          files.push({ rel: path.join('stages', stage, harness, name), abs });
        }
      }
      // A harness that delegates into sessions of its own keeps one transcript per subagent here,
      // beside the parent rollout; they are part of the same run's record.
      const subagentPath = path.join(harnessPath, SUBAGENT_ROLLOUT_DIRECTORY);
      if (!fs.existsSync(subagentPath)) continue;
      for (const name of fs.readdirSync(subagentPath).sort()) {
        const abs = path.join(subagentPath, name);
        if (name.endsWith('.jsonl') && fs.statSync(abs).isFile()) {
          files.push({ rel: path.join('stages', stage, harness, SUBAGENT_ROLLOUT_DIRECTORY, name), abs });
        }
      }
    }
  }
  return files;
}

function collectPreviews(runDir) {
  const files = [];
  const assignment = path.join(runDir, 'rendered-assignment.md');
  if (fs.existsSync(assignment)) files.push({ rel: 'assignment.md', abs: assignment });
  const stagesDir = path.join(runDir, 'stages');
  if (!fs.existsSync(stagesDir)) return files;
  for (const stage of fs.readdirSync(stagesDir).sort()) {
    const stagePath = path.join(stagesDir, stage);
    if (!fs.statSync(stagePath).isDirectory()) continue;
    for (const harness of fs.readdirSync(stagePath).sort()) {
      const abs = path.join(stagePath, harness, 'final-message.md');
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        files.push({ rel: path.join('stages', stage, harness, 'final-message.md'), abs });
      }
    }
  }
  return files;
}

// Deterministic gzip: fixed level, and node's zlib leaves the header mtime at
// zero, so identical input bytes produce identical archive bytes across runs.
function gzipTo(destAbs, buffer) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, zlib.gzipSync(buffer, { level: 9 }));
}

function datasetCard(index) {
  const ranked = index.runs.filter((run) => run.disposition !== 'rehearsal');
  const rehearsed = index.runs.filter((run) => run.disposition === 'rehearsal');
  const row = (run) => {
    const mb = (run.files.reduce((s, f) => s + f.rawBytes, 0) / 1048576).toFixed(1);
    const link = `[\`${run.runId}\`](https://huggingface.co/datasets/${DATASET}/tree/main/runs/${run.runId})`;
    return `| ${link} | ${run.themeId} | ${run.configurationId}${run.retired ? ' (retired)' : ''} | ${mb} |`;
  };
  const table = (title, runs) => [
    `## ${title}`, '',
    '| run | theme | configuration | transcript MB |',
    '| :-- | :-- | :-- | --: |',
    ...runs.map(row),
  ].join('\n');
  const sections = [];
  if (ranked.length > 0) sections.push(table('Runs', ranked));
  if (rehearsed.length > 0) {
    sections.push(
      table('Rehearsal runs (never ranked; kept as failure examples)', rehearsed),
      '',
      'Rehearsal runs are unattended generation attempts that were never part of the ranked pool. They are published exactly as captured, including the gate failures that ended them.',
    );
  }
  if (index.diagnostics?.length > 0) {
    const rows = index.diagnostics.map((diagnostic) => {
      const link = `[\`${diagnostic.id}\`](https://huggingface.co/datasets/${DATASET}/tree/main/diagnostics/${diagnostic.id})`;
      return `| ${link} | ${diagnostic.model} | ${diagnostic.status} | ${diagnostic.reason} |`;
    });
    sections.push([
      '## Diagnostics (not benchmark runs)', '',
      '| id | model | status | reason |',
      '| :-- | :-- | :-- | :-- |',
      ...rows,
      '',
      'Diagnostics are preserved agent sessions that were stopped or otherwise invalid before producing a benchmark result. They are not ranked evidence.',
    ].join('\n'));
  }
  return `---
license: mit
pretty_name: Pareto Rail benchmark rollouts
---

# Pareto Rail benchmark rollouts

Full agent transcripts for every published run of the [Pareto Rail](https://paretorail.com) level-generation benchmark: models one-shot a browser rail-shooter level from a written theme, and visitors rank the results blind on the public site. The benchmark's methodology, per-run provenance manifests (rendered prompt, sealed commits, gate results, measured cost), and the level source produced by each of these transcripts live in the main repository: [github.com/paulbatum/pareto-rail](https://github.com/paulbatum/pareto-rail).

## Layout

\`\`\`
runs/<run-id>/assignment.md                               # the rendered prompt the agent received
runs/<run-id>/stages/<stage>/<harness>/rollout.jsonl      # the harness-native session, opens in the trace viewer
runs/<run-id>/stages/<stage>/<harness>/events.jsonl.gz    # the harness's emitted event stream
runs/<run-id>/stages/<stage>/<harness>/final-message.md   # the agent's closing message
\`\`\`

Each \`rollout.jsonl\` is a raw Claude Code, Codex, or Pi session file, so it opens directly in the Hub's [agent trace viewer](https://huggingface.co/docs/hub/agent-traces); \`assignment.md\` and \`final-message.md\` are plain markdown. Transcripts are exactly as captured: agent screenshots taken during the run are embedded as base64. \`rollouts.json\` here (also committed in the main repository under \`benchmark/manifests/\`) maps each run to its level, theme, and configuration and records the size and sha256 of every transcript's uncompressed bytes, so a download can be verified (after gunzip, for the gzipped event streams).

${sections.join('\n\n')}
`;
}

function main() {
  const upload = process.argv.includes('--upload');
  const rescan = process.argv.includes('--rescan');
  const scanner = findLeakScanner();
  const cache = loadScanCache(rulesetFingerprint(scanner), rescan);
  activeScanCache = cache;
  const publication = JSON.parse(fs.readFileSync(publicationPath, 'utf8'));
  if (!Array.isArray(publication.entrants)) throw new Error('Publication has no entrants array.');
  const entrants = [...publication.entrants].sort((a, b) => a.runId.localeCompare(b.runId));
  // Rehearsal rows are listed separately from entrants: their transcripts ship
  // on the same terms (same scans, same index) but they never entered the
  // results pool, so the card marks them and nothing downstream treats them
  // as ranked evidence.
  const rehearsals = [...(publication.rehearsals ?? [])].sort((a, b) => a.runId.localeCompare(b.runId));
  const diagnostics = [...(publication.diagnostics ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  const index = { dataset: DATASET, baseUrl: `https://huggingface.co/datasets/${DATASET}/resolve/main`, runs: [], diagnostics: [] };
  const allHits = [];
  fs.rmSync(stagingRoot, { recursive: true, force: true });

  for (const entrant of entrants) {
    const runDir = path.join(runsRoot, entrant.runId);
    if (!fs.existsSync(runDir)) throw new Error(`Entrant ${entrant.levelId} references missing run directory ${entrant.runId}.`);
    const transcripts = collectTranscripts(runDir);
    if (transcripts.length === 0) throw new Error(`Run ${entrant.runId} has no transcripts.`);
    const files = [];
    for (const { rel, abs } of transcripts) {
      const buffer = fs.readFileSync(abs);
      const sha256 = scanBuffer(scanner, buffer, path.join(entrant.runId, rel), cache, allHits);
      // rollout.jsonl is the harness-native session file, which the Hub's
      // agent-trace viewer renders as long as it stays a raw .jsonl; the
      // supplementary event stream ships gzipped.
      const isRollout = path.basename(rel) === 'rollout.jsonl';
      const datasetPath = path.join('runs', entrant.runId, isRollout ? rel : `${rel}.gz`);
      if (isRollout) {
        const dest = path.join(stagingRoot, datasetPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);
      } else {
        gzipTo(path.join(stagingRoot, datasetPath), buffer);
      }
      files.push({
        path: datasetPath,
        rawBytes: buffer.length,
        sha256,
      });
    }
    // Small browsable plaintext next to the archives, so the dataset can be
    // judged in the Hugging Face file viewer without downloading anything:
    // the rendered assignment (the prompt) and each stage's final message.
    for (const { rel, abs } of collectPreviews(runDir)) {
      const buffer = fs.readFileSync(abs);
      scanBuffer(scanner, buffer, path.join(entrant.runId, rel), cache, allHits);
      const dest = path.join(stagingRoot, 'runs', entrant.runId, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buffer);
    }
    index.runs.push({
      runId: entrant.runId,
      levelId: entrant.levelId,
      themeId: entrant.themeId,
      configurationId: entrant.configurationId,
      ...(entrant.retired ? { retired: true } : {}),
      files,
    });
  }

  for (const rehearsal of rehearsals) {
    const runDir = path.join(runsRoot, rehearsal.runId);
    if (!fs.existsSync(runDir)) throw new Error(`Rehearsal ${rehearsal.levelId} references missing run directory ${rehearsal.runId}.`);
    const transcripts = collectTranscripts(runDir);
    if (transcripts.length === 0) throw new Error(`Run ${rehearsal.runId} has no transcripts.`);
    const files = [];
    for (const { rel, abs } of transcripts) {
      const buffer = fs.readFileSync(abs);
      const sha256 = scanBuffer(scanner, buffer, path.join(rehearsal.runId, rel), cache, allHits);
      const isRollout = path.basename(rel) === 'rollout.jsonl';
      const datasetPath = path.join('runs', rehearsal.runId, isRollout ? rel : `${rel}.gz`);
      if (isRollout) {
        const dest = path.join(stagingRoot, datasetPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);
      } else {
        gzipTo(path.join(stagingRoot, datasetPath), buffer);
      }
      files.push({
        path: datasetPath,
        rawBytes: buffer.length,
        sha256,
      });
    }
    for (const { rel, abs } of collectPreviews(runDir)) {
      const buffer = fs.readFileSync(abs);
      scanBuffer(scanner, buffer, path.join(rehearsal.runId, rel), cache, allHits);
      const dest = path.join(stagingRoot, 'runs', rehearsal.runId, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buffer);
    }
    index.runs.push({
      runId: rehearsal.runId,
      levelId: rehearsal.levelId,
      themeId: rehearsal.themeId,
      configurationId: rehearsal.configurationId,
      disposition: 'rehearsal',
      files,
    });
  }

  for (const diagnostic of diagnostics) {
    if (!diagnostic.runId || !diagnostic.sourcePath) throw new Error(`Diagnostic ${diagnostic.id} needs runId and sourcePath.`);
    const runDir = path.join(runsRoot, diagnostic.runId);
    const source = path.resolve(runDir, diagnostic.sourcePath);
    if (!source.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(source)) {
      throw new Error(`Diagnostic ${diagnostic.id} references missing or unsafe sourcePath ${diagnostic.sourcePath}.`);
    }
    const buffer = fs.readFileSync(source);
    const datasetPath = path.join('diagnostics', diagnostic.id, path.basename(diagnostic.sourcePath));
    const scanPath = path.join(diagnostic.id, path.basename(diagnostic.sourcePath));
    const sha256 = scanBuffer(scanner, buffer, scanPath, cache, allHits);
    const dest = path.join(stagingRoot, datasetPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);

    const metadata = {
      id: diagnostic.id,
      runId: diagnostic.runId,
      status: diagnostic.status,
      reason: diagnostic.reason,
      model: diagnostic.model,
      provider: diagnostic.provider,
      files: [{
        path: datasetPath,
        rawBytes: buffer.length,
        sha256,
      }],
    };
    const metadataPath = path.join('diagnostics', diagnostic.id, 'metadata.json');
    fs.writeFileSync(path.join(stagingRoot, metadataPath), `${JSON.stringify(metadata, null, 2)}\n`);
    index.diagnostics.push(metadata);
  }

  if (allHits.length > 0) {
    throw new Error(`Secrets scan found credential-shaped content in transcripts:\n${allHits.map((h) => `  ${h}`).join('\n')}`);
  }

  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  fs.writeFileSync(indexPath, indexText);
  fs.writeFileSync(path.join(stagingRoot, 'rollouts.json'), indexText);
  fs.writeFileSync(path.join(stagingRoot, 'README.md'), datasetCard(index));

  const rawTotal = index.runs.reduce((s, r) => s + r.files.reduce((t, f) => t + f.rawBytes, 0), 0)
    + index.diagnostics.reduce((s, d) => s + d.files.reduce((t, f) => t + f.rawBytes, 0), 0);
  console.log(`Staged ${index.runs.length} runs and ${index.diagnostics.length} diagnostics into ${path.relative(root, stagingRoot)} (${(rawTotal / 1048576).toFixed(0)} MB raw, both secret scans clean).`);
  console.log(`Scanned ${cache.scans} files; reused ${cache.reused} cached clean verdicts${rescan ? ' (--rescan: cache ignored)' : ''}.`);
  console.log(`Wrote ${path.relative(root, indexPath)}.`);

  if (upload) {
    console.log(`Uploading to ${DATASET}…`);
    execFileSync('hf', ['upload', DATASET, stagingRoot, '.', '--repo-type', 'dataset', '--commit-message', `Export ${index.runs.length} published runs`], {
      stdio: 'inherit',
    });
  } else {
    console.log(`Staged only. Upload with: npm run benchmark:export-rollouts -- --upload`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Rollout export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (activeScanCache) saveScanCache(activeScanCache);
}
