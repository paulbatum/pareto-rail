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

const TRANSCRIPT_FILES = ['rollout.jsonl', 'events.jsonl'];

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
    ? ['-c', path.join(root, 'scripts/benchmark/betterleaks.toml')]
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
  const rows = index.runs.map((run) => {
    const mb = (run.files.reduce((s, f) => s + f.rawBytes, 0) / 1048576).toFixed(1);
    const link = `[\`${run.runId}\`](https://huggingface.co/datasets/${DATASET}/tree/main/runs/${run.runId})`;
    return `| ${link} | ${run.themeId} | ${run.configurationId}${run.retired ? ' (retired)' : ''} | ${mb} |`;
  });
  const runTable = [
    '| run | theme | configuration | transcript MB |',
    '| :-- | :-- | :-- | --: |',
    ...rows,
  ].join('\n');
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

## Runs

${runTable}
`;
}

function main() {
  const upload = process.argv.includes('--upload');
  const scanner = findLeakScanner();
  const publication = JSON.parse(fs.readFileSync(publicationPath, 'utf8'));
  if (!Array.isArray(publication.entrants)) throw new Error('Publication has no entrants array.');
  const entrants = [...publication.entrants].sort((a, b) => a.runId.localeCompare(b.runId));

  const index = { dataset: DATASET, baseUrl: `https://huggingface.co/datasets/${DATASET}/resolve/main`, runs: [] };
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
      allHits.push(...scanLines(buffer.toString('utf8'), path.join(entrant.runId, rel)));
      leakScan(scanner, buffer, path.join(entrant.runId, rel));
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
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      });
    }
    // Small browsable plaintext next to the archives, so the dataset can be
    // judged in the Hugging Face file viewer without downloading anything:
    // the rendered assignment (the prompt) and each stage's final message.
    for (const { rel, abs } of collectPreviews(runDir)) {
      const buffer = fs.readFileSync(abs);
      allHits.push(...scanLines(buffer.toString('utf8'), path.join(entrant.runId, rel)));
      leakScan(scanner, buffer, path.join(entrant.runId, rel));
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

  if (allHits.length > 0) {
    throw new Error(`Secrets scan found credential-shaped content in transcripts:\n${allHits.map((h) => `  ${h}`).join('\n')}`);
  }

  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  fs.writeFileSync(indexPath, indexText);
  fs.writeFileSync(path.join(stagingRoot, 'rollouts.json'), indexText);
  fs.writeFileSync(path.join(stagingRoot, 'README.md'), datasetCard(index));

  const rawTotal = index.runs.reduce((s, r) => s + r.files.reduce((t, f) => t + f.rawBytes, 0), 0);
  console.log(`Staged transcripts for ${index.runs.length} runs into ${path.relative(root, stagingRoot)} (${(rawTotal / 1048576).toFixed(0)} MB raw, both secret scans clean).`);
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
}
