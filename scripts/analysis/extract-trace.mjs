#!/usr/bin/env node
// Extract a normalized rollout trace + data package from a benchmark run directory.
//
// Usage:
//   node scripts/analysis/extract-trace.mjs <run-dir> [--out <output-dir>]
//
// Reads the controller capture and the full Claude Code session transcript
// (main + subagent sidechains) and writes machine-readable analysis files:
//   run.json, trace.json, subagents/agent-<id>.json, files.json, snapshot-moments.json
//
// The run directory is read-only; nothing under it is modified.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TRUNCATE_LIMIT = 2000; // chars; applies to bulky tool inputs/results only

// ---------- args ----------
const args = process.argv.slice(2);
let runDir = null;
let outDir = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--out') { outDir = args[i + 1]; i += 1; }
  else if (!runDir) runDir = args[i];
}
if (!runDir) {
  console.error('usage: extract-trace.mjs <run-dir> [--out <output-dir>]');
  process.exit(1);
}
runDir = path.resolve(runDir);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

// ---------- helpers ----------
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readJsonl = (p) =>
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l, idx) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`bad JSON at ${p}:${idx + 1}: ${e.message}`); }
  });
const byteLen = (s) => Buffer.byteLength(s || '', 'utf8');

function truncated(text, limit = TRUNCATE_LIMIT) {
  const s = text == null ? '' : String(text);
  const bytes = byteLen(s);
  if (s.length <= limit) return { text: s, truncated: false, byteLength: bytes };
  return { text: s.slice(0, limit), truncated: true, byteLength: bytes };
}

// ---------- locate source files ----------
const runDefinition = readJson(path.join(runDir, 'run-definition.json'));
const manifest = readJson(path.join(runDir, 'manifest.json'));
const evaluated = (() => { try { return readJson(path.join(runDir, 'evaluated.json')); } catch { return {}; } })();
const rawUsage = (() => {
  try { return readJson(path.join(runDir, 'stages/solo/claude/raw-usage.json')); } catch { return {}; }
})();
const gatesRecord = (() => {
  try { return readJson(path.join(runDir, 'gates/gates.json')); } catch { return { gates: [] }; }
})();
const resultRecord = (() => {
  try { return readJson(path.join(runDir, 'stages/solo/claude/result.json')); } catch { return {}; }
})();

const worktreePath = (runDefinition.worktree && runDefinition.worktree.path) || '/tmp/raild-run';
const payloadPath = (runDefinition.payload && runDefinition.payload.path) || null;

// Normalize an absolute worktree path to a repo-relative path.
function relPath(p) {
  if (!p) return p;
  let s = String(p);
  for (const prefix of [worktreePath, payloadPath].filter(Boolean)) {
    const pre = prefix.endsWith('/') ? prefix : prefix + '/';
    if (s.startsWith(pre)) return s.slice(pre.length);
    if (s === prefix) return '.';
  }
  return s;
}

const sessionId = resultRecord.sessionId
  || (manifest.stages && manifest.stages[0] && manifest.stages[0].sessionId);
const projectDir = path.join(runDir, 'harness-home', 'projects');
// Multiple project folders may exist; pick the one holding this session's transcript.
const projectFolders = fs.readdirSync(projectDir).filter((d) =>
  fs.statSync(path.join(projectDir, d)).isDirectory());
const projectFolder = (() => {
  const match = projectFolders.find((d) => fs.existsSync(path.join(projectDir, d, `${sessionId}.jsonl`)));
  if (!match) throw new Error(`no project folder contains ${sessionId}.jsonl (looked in: ${projectFolders.join(', ')})`);
  return path.join(projectDir, match);
})();
const mainSessionPath = path.join(projectFolder, `${sessionId}.jsonl`);
const subagentDir = path.join(projectFolder, sessionId, 'subagents');

// ---------- run start reference ----------
const runStartIso = manifest.timing.startedAt;
const runStartMs = Date.parse(runStartIso);
const tSeconds = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Number(((ms - runStartMs) / 1000).toFixed(3)) : null;
};

// ---------- subagent meta: toolUseId -> agentId ----------
const subagentFiles = fs.existsSync(subagentDir)
  ? fs.readdirSync(subagentDir).filter((f) => f.endsWith('.jsonl'))
  : [];
const toolUseIdToAgent = new Map();
const agentMeta = new Map();
for (const f of subagentFiles) {
  const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
  const metaPath = path.join(subagentDir, f.replace(/\.jsonl$/, '.meta.json'));
  let meta = {};
  if (fs.existsSync(metaPath)) meta = readJson(metaPath);
  agentMeta.set(agentId, { ...meta, agentId, file: f });
  if (meta.toolUseId) toolUseIdToAgent.set(meta.toolUseId, agentId);
}

// ---------- delta computation from structuredPatch ----------
function patchDelta(structuredPatch) {
  let added = 0; let removed = 0;
  if (!Array.isArray(structuredPatch)) return null;
  for (const hunk of structuredPatch) {
    for (const line of hunk.lines || []) {
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}

// ---------- summary line for a tool call ----------
function toolSummary(name, input, result) {
  const inp = input || {};
  switch (name) {
    case 'Read':
      return `Read ${relPath(inp.file_path)}`;
    case 'Write': {
      const rp = relPath(inp.file_path);
      const lines = (inp.content || '').split('\n').length;
      return `Write ${rp} (${lines} lines, ${byteLen(inp.content)} bytes)`;
    }
    case 'Edit': {
      const rp = relPath(inp.file_path);
      const d = result && patchDelta(result.structuredPatch);
      return d ? `Edit ${rp} (+${d.added} -${d.removed} lines)` : `Edit ${rp}`;
    }
    case 'Bash':
      return `Bash: ${inp.description || (inp.command || '').split('\n')[0]}`;
    case 'ToolSearch':
      return `ToolSearch: ${inp.query || ''}`;
    case 'TaskCreate':
      return `TaskCreate: ${inp.subject || ''}`;
    case 'TaskUpdate':
      return `TaskUpdate: ${inp.taskId || ''} -> ${inp.status || inp.state || ''}`.trim();
    case 'Agent':
      return `Agent: ${inp.description || ''} (${inp.subagent_type || ''}, ${inp.model || ''})`;
    default:
      return `${name}`;
  }
}

// Compact, selectively-truncated view of a tool call's inputs.
function compactInputs(name, input) {
  const inp = input || {};
  const out = {};
  const passThroughLong = new Set(['command', 'content', 'old_string', 'new_string', 'prompt', 'description', 'query']);
  const keep = ['file_path', 'command', 'description', 'subject', 'status', 'taskId', 'query',
    'module', 'export', 'args', 'subagent_type', 'model', 'old_string', 'new_string',
    'replace_all', 'activeForm', 'limit', 'offset'];
  for (const k of keep) {
    if (!(k in inp)) continue;
    const v = inp[k];
    if (typeof v === 'string' && passThroughLong.has(k)) {
      const t = truncated(v);
      out[k] = t.text;
      if (t.truncated) { out[`${k}__truncated`] = true; out[`${k}__byteLength`] = t.byteLength; }
    } else {
      out[k] = v;
    }
  }
  if (name === 'Agent') delete out.prompt; // prompt captured on the spawn event separately
  return out;
}

// Extract text from a tool_result content field (string | array of blocks).
function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : (x.text || ''))).join('');
  return '';
}

// ---------- parse a transcript into an ordered event list ----------
// Returns { events, toolCalls (name->count), fileOps: [...], snapshots: [...] }
function parseTranscript(lines, { agentId }) {
  const prefix = agentId ? `${agentId.slice(0, 8)}-ev` : 'ev';
  const idFor = (n) => `${prefix}-${String(n).padStart(4, '0')}`;
  const agentLabel = agentId || 'main';

  // First pass: map toolUseId -> { wrapper, block } for results.
  const resultByToolUseId = new Map();
  for (const o of lines) {
    const m = o.message;
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_result') resultByToolUseId.set(b.tool_use_id, { wrapper: o, block: b });
    }
  }

  const events = [];
  const toolCalls = {};
  const fileOps = [];
  const snapshots = [];
  const resultEmittedFor = new Set(); // agentIds that already have a subagent-result event
  let counter = 0;
  const nextId = () => idFor((counter += 1));

  const emitSubagentResult = (content, ts, t) => {
    const taskId = (content.match(/<task-id>([^<]+)<\/task-id>/) || [])[1] || null;
    if (!taskId || resultEmittedFor.has(taskId)) return;
    resultEmittedFor.add(taskId);
    const status = (content.match(/<status>([^<]+)<\/status>/) || [])[1] || null;
    const summary = (content.match(/<summary>([^<]*)<\/summary>/) || [])[1] || null;
    events.push({ id: nextId(), ts, tSeconds: t, kind: 'subagent-result', agentId: taskId, status, summary });
  };

  for (const o of lines) {
    const ts = o.timestamp;
    const t = ts ? tSeconds(ts) : null;

    // Subagent completion can surface either as a user task-notification message or,
    // when it was consumed as an attachment, only as a queue-operation enqueue.
    if (o.type === 'queue-operation' && o.operation === 'enqueue'
      && typeof o.content === 'string' && o.content.includes('<task-notification>')) {
      emitSubagentResult(o.content, ts, t);
      continue;
    }

    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      const model = o.message.model;
      const usage = o.message.usage || null;
      let attachedUsage = false;
      for (const b of o.message.content) {
        const base = { id: nextId(), ts, tSeconds: t };
        if (usage && !attachedUsage) { base.usage = normalizeUsage(usage); attachedUsage = true; }
        if (b.type === 'thinking') {
          events.push({ ...base, kind: 'thinking', model, text: b.thinking || '' });
        } else if (b.type === 'text') {
          events.push({ ...base, kind: 'assistant-text', model, text: b.text || '' });
        } else if (b.type === 'tool_use') {
          toolCalls[b.name] = (toolCalls[b.name] || 0) + 1;
          const res = resultByToolUseId.get(b.id);
          const resultObj = res && res.wrapper.toolUseResult;
          if (b.name === 'Agent') {
            const spawnedAgent = toolUseIdToAgent.get(b.id) || (resultObj && resultObj.agentId) || null;
            const promptT = truncated(b.input && b.input.prompt);
            events.push({
              ...base,
              kind: 'subagent-spawn',
              tool: 'Agent',
              toolUseId: b.id,
              agentId: spawnedAgent,
              description: b.input && b.input.description,
              subagentType: b.input && b.input.subagent_type,
              model: (resultObj && resultObj.resolvedModel) || (b.input && b.input.model),
              summary: toolSummary('Agent', b.input, resultObj),
              prompt: promptT.text,
              promptTruncated: promptT.truncated,
              promptByteLength: promptT.byteLength,
            });
          } else {
            const summary = toolSummary(b.name, b.input, resultObj);
            const ev = {
              ...base,
              kind: 'tool-call',
              tool: b.name,
              toolUseId: b.id,
              summary,
              inputs: compactInputs(b.name, b.input),
            };
            events.push(ev);
            // Track file write/edit operations.
            if (b.name === 'Write' || b.name === 'Edit') {
              const fp = relPath(b.input && b.input.file_path);
              const delta = b.name === 'Edit'
                ? (resultObj ? patchDelta(resultObj.structuredPatch) : null)
                : { added: (b.input.content || '').split('\n').length, removed: 0 };
              fileOps.push({
                eventId: ev.id,
                agent: agentLabel,
                operation: b.name === 'Write' ? 'write' : 'edit',
                file: fp,
                ts,
                tSeconds: t,
                deltaSummary: b.name === 'Write'
                  ? { lines: delta.added, bytes: byteLen(b.input.content) }
                  : (delta || { added: null, removed: null }),
              });
            }
            // Track snapshot moments (Bash only).
            if (b.name === 'Bash') {
              const cmd = (b.input && b.input.command) || '';
              if (/npm run snapshot(:gameplay)?\b/.test(cmd) || /\bsnapshot:gameplay\b/.test(cmd)) {
                const r = resultObj || {};
                snapshots.push({
                  eventId: ev.id,
                  agent: agentLabel,
                  ts,
                  tSeconds: t,
                  command: cmd,
                  exitStatus: r.interrupted ? 'interrupted' : 'completed',
                  stderrPresent: !!(r.stderr && r.stderr.trim()),
                });
              }
            }
          }
        }
      }
    } else if (o.type === 'user' && o.message) {
      const c = o.message.content;
      if (typeof c === 'string') {
        if (c.startsWith('<task-notification>')) {
          emitSubagentResult(c, ts, t);
        } else {
          const tt = truncated(c, 8000); // user prompts: keep generous, still bounded
          events.push({
            id: nextId(), ts, tSeconds: t,
            kind: 'user-message',
            text: tt.text,
            truncated: tt.truncated,
            byteLength: tt.byteLength,
          });
        }
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'tool_result') {
            const rObj = o.toolUseResult || {};
            const rtext = truncated(resultText(b));
            const bashLike = typeof rObj.interrupted !== 'undefined';
            events.push({
              id: nextId(), ts, tSeconds: t,
              kind: 'tool-result',
              toolUseId: b.tool_use_id,
              isError: !!b.is_error,
              ok: bashLike ? !rObj.interrupted : !b.is_error,
              resultText: rtext.text,
              truncated: rtext.truncated,
              byteLength: rtext.byteLength,
            });
          } else if (b.type === 'text') {
            const tt = truncated(b.text, 8000);
            events.push({
              id: nextId(), ts, tSeconds: t,
              kind: 'user-message', text: tt.text, truncated: tt.truncated, byteLength: tt.byteLength,
            });
          }
        }
      }
    }
    // queue-operation / ai-title / last-prompt / attachment -> skipped as metadata
  }

  return { events, toolCalls, fileOps, snapshots };
}

function normalizeUsage(u) {
  if (!u) return null;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens,
  };
}

// ---------- parse subagents ----------
const subagentData = new Map(); // agentId -> { events, toolCalls, fileOps, snapshots, header }
for (const f of subagentFiles) {
  const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
  const lines = readJsonl(path.join(subagentDir, f));
  const parsed = parseTranscript(lines, { agentId });
  const meta = agentMeta.get(agentId) || {};

  // Prompt: first user string message.
  const firstUser = lines.find((o) => o.type === 'user' && o.message && typeof o.message.content === 'string');
  const prompt = firstUser ? firstUser.message.content : null;
  // Final result: last assistant text.
  let finalText = null;
  for (const o of lines) {
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      const txt = o.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (txt.trim()) finalText = txt;
    }
  }
  const firstTs = lines[0] && lines[0].timestamp;
  const lastTs = lines[lines.length - 1] && lines[lines.length - 1].timestamp;
  const durationSeconds = firstTs && lastTs
    ? Number(((Date.parse(lastTs) - Date.parse(firstTs)) / 1000).toFixed(3)) : null;

  // Token usage: sum across assistant messages.
  const usageTotal = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  for (const o of lines) {
    if (o.type === 'assistant' && o.message && o.message.usage) {
      const u = o.message.usage;
      usageTotal.inputTokens += u.input_tokens || 0;
      usageTotal.outputTokens += u.output_tokens || 0;
      usageTotal.cacheReadInputTokens += u.cache_read_input_tokens || 0;
      usageTotal.cacheCreationInputTokens += u.cache_creation_input_tokens || 0;
    }
  }

  subagentData.set(agentId, {
    ...parsed,
    header: {
      agentId,
      agentType: meta.agentType || null,
      description: meta.description || null,
      spawnDepth: meta.spawnDepth != null ? meta.spawnDepth : null,
      spawnToolUseId: meta.toolUseId || null,
      model: null, // filled from spawn event below
      prompt,
      promptByteLength: byteLen(prompt || ''),
      finalResultText: finalText,
      finalResultByteLength: byteLen(finalText || ''),
      startedAt: firstTs,
      finishedAt: lastTs,
      durationSeconds,
      lineCount: lines.length,
      usage: usageTotal,
    },
  });
}

// ---------- parse main session ----------
const mainLines = readJsonl(mainSessionPath);
const mainParsed = parseTranscript(mainLines, { agentId: null });

// Enrich subagent-spawn events + subagent headers with resolved model & parent event id,
// and attach subagent result text/duration to subagent-result events.
const spawnEventByAgent = new Map();
for (const ev of mainParsed.events) {
  if (ev.kind === 'subagent-spawn' && ev.agentId) {
    spawnEventByAgent.set(ev.agentId, ev);
    const sd = subagentData.get(ev.agentId);
    if (sd) sd.header.model = ev.model;
  }
}
for (const ev of mainParsed.events) {
  if (ev.kind === 'subagent-result' && ev.agentId) {
    const sd = subagentData.get(ev.agentId);
    if (sd) {
      const t = truncated(sd.header.finalResultText, 4000);
      ev.resultText = t.text;
      ev.resultTruncated = t.truncated;
      ev.resultByteLength = t.byteLength;
      ev.durationSeconds = sd.header.durationSeconds;
      ev.subagentUsage = sd.header.usage;
    }
    const spawn = spawnEventByAgent.get(ev.agentId);
    if (spawn) ev.spawnEventId = spawn.id;
  }
}
for (const [agentId, sd] of subagentData) {
  const spawn = spawnEventByAgent.get(agentId);
  sd.header.parentEventId = spawn ? spawn.id : null;
  sd.header.parentTSeconds = spawn ? spawn.tSeconds : null;
}

// ---------- files.json ----------
const allFileOps = [
  ...mainParsed.fileOps,
  ...[...subagentData.values()].flatMap((sd) => sd.fileOps),
].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

// Final payload file list from git diff (entrant baseline -> evaluated commit).
let finalPayloadFiles = null;
const entrantBaseline = manifest.baseline
  && manifest.baseline.entrantBaseline && manifest.baseline.entrantBaseline.identifier;
const evaluatedCommit = (manifest.output && manifest.output.evaluated && manifest.output.evaluated.commit)
  || evaluated.evaluatedCommit;
if (entrantBaseline && evaluatedCommit) {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'diff', '--name-status', entrantBaseline, evaluatedCommit], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    finalPayloadFiles = out.split('\n').filter(Boolean).map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status, file: rest.join('\t') };
    });
  } catch (e) {
    finalPayloadFiles = null; // commits not present in this checkout
  }
}
const finalPayloadSet = new Set((finalPayloadFiles || []).map((f) => f.file));

const filesMap = new Map();
for (const op of allFileOps) {
  if (!filesMap.has(op.file)) {
    filesMap.set(op.file, {
      file: op.file,
      inFinalPayload: finalPayloadFiles ? finalPayloadSet.has(op.file) : null,
      editCount: 0,
      firstTouchedTSeconds: op.tSeconds,
      lastTouchedTSeconds: op.tSeconds,
      agents: new Set(),
      history: [],
    });
  }
  const rec = filesMap.get(op.file);
  rec.editCount += 1;
  rec.lastTouchedTSeconds = op.tSeconds;
  rec.agents.add(op.agent);
  rec.history.push({
    eventId: op.eventId,
    agent: op.agent,
    operation: op.operation,
    tSeconds: op.tSeconds,
    deltaSummary: op.deltaSummary,
  });
}
const filesJson = {
  runId: manifest.runId,
  entrantBaseline,
  evaluatedCommit,
  finalPayloadFiles,
  files: [...filesMap.values()]
    .map((r) => ({ ...r, agents: [...r.agents] }))
    .sort((a, b) => a.firstTouchedTSeconds - b.firstTouchedTSeconds),
};

// ---------- snapshot-moments.json ----------
const allSnapshots = [
  ...mainParsed.snapshots,
  ...[...subagentData.values()].flatMap((sd) => sd.snapshots),
].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

// For each snapshot moment, files modified since the previous snapshot moment (by timestamp).
const snapshotMoments = allSnapshots.map((snap, i) => {
  const prevTs = i === 0 ? null : Date.parse(allSnapshots[i - 1].ts);
  const thisTs = Date.parse(snap.ts);
  const since = allFileOps.filter((op) => {
    const opTs = Date.parse(op.ts);
    return (prevTs === null || opTs > prevTs) && opTs <= thisTs;
  }).map((op) => ({ file: op.file, agent: op.agent, operation: op.operation, tSeconds: op.tSeconds }));
  return {
    ordinal: i + 1,
    eventId: snap.eventId,
    agent: snap.agent,
    ts: snap.ts,
    tSeconds: snap.tSeconds,
    command: snap.command,
    exitStatus: snap.exitStatus,
    stderrPresent: snap.stderrPresent,
    filesModifiedSincePrevious: since,
  };
});

// ---------- run.json ----------
const toolCallsAll = {};
for (const src of [mainParsed.toolCalls, ...[...subagentData.values()].map((s) => s.toolCalls)]) {
  for (const [k, v] of Object.entries(src)) toolCallsAll[k] = (toolCallsAll[k] || 0) + v;
}

const modelUsage = (rawUsage.raw && rawUsage.raw.modelUsage) || {};
const costModels = (manifest.cost && manifest.cost.models) || [];

let eventsControllerCount = null;
try {
  eventsControllerCount = fs.readFileSync(path.join(runDir, 'stages/solo/claude/events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).length;
} catch { /* optional */ }

const runJson = {
  runId: manifest.runId,
  slotId: manifest.slotId,
  levelId: (manifest.output && manifest.output.levelId) || runDefinition.assignment.levelId,
  levelTitle: runDefinition.assignment.levelTitle,
  theme: {
    id: runDefinition.assignment.theme.id,
    path: runDefinition.assignment.theme.path,
  },
  configurationId: manifest.configuration.id,
  blinded: false,
  models: {
    orchestrator: runDefinition.stage.model,
    orchestratorEffort: runDefinition.stage.effort,
    delegate: runDefinition.delegation && runDefinition.delegation.delegateModel,
    delegateEffort: runDefinition.delegation && runDefinition.delegation.delegateEffort,
    usageKeys: Object.keys(modelUsage),
  },
  harness: manifest.stages && manifest.stages[0] && manifest.stages[0].harness,
  timing: {
    startedAt: manifest.timing.startedAt,
    finishedAt: manifest.timing.finishedAt,
    wallTimeSeconds: manifest.timing.wallTimeSeconds,
    numTurns: rawUsage.raw && rawUsage.raw.num_turns,
  },
  cost: {
    currency: (manifest.cost && manifest.cost.currency) || 'USD',
    status: manifest.cost && manifest.cost.status,
    totalUsd: manifest.cost && manifest.cost.totalUsd,
    perModel: costModels.map((m) => ({
      modelName: m.modelName,
      costUsd: m.costUsd,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens,
    })),
  },
  tokenTotals: Object.fromEntries(Object.entries(modelUsage).map(([k, v]) => [k, {
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    cacheReadInputTokens: v.cacheReadInputTokens,
    cacheCreationInputTokens: v.cacheCreationInputTokens,
    costUSD: v.costUSD,
  }])),
  gates: (gatesRecord.gates || []).map((g) => ({
    id: g.id, command: g.command, status: g.status, exitCode: g.exitCode, wallTimeSeconds: g.wallTimeSeconds,
  })),
  disposition: manifest.disposition || null,
  finalMessage: rawUsage.finalMessage || null,
  counts: {
    controllerEvents: eventsControllerCount,
    mainSessionLines: mainLines.length,
    mainTraceEvents: mainParsed.events.length,
    toolCallsMain: mainParsed.toolCalls,
    toolCallsAll,
    subagents: subagentData.size,
    filesTouched: filesMap.size,
    filesInFinalPayload: finalPayloadFiles ? finalPayloadFiles.length : null,
    snapshotMoments: snapshotMoments.length,
  },
  subagents: [...subagentData.values()].map((sd) => ({
    agentId: sd.header.agentId,
    description: sd.header.description,
    model: sd.header.model,
    parentEventId: sd.header.parentEventId,
    durationSeconds: sd.header.durationSeconds,
    events: sd.events.length,
    usage: sd.header.usage,
  })),
};

// ---------- trace.json ----------
const traceJson = {
  runId: manifest.runId,
  levelId: runJson.levelId,
  generatedAt: new Date().toISOString(),
  runStart: runStartIso,
  source: path.relative(runDir, mainSessionPath),
  sessionId,
  eventCount: mainParsed.events.length,
  events: mainParsed.events,
};

// ---------- write outputs ----------
const outputDir = outDir
  ? path.resolve(outDir)
  : path.join(repoRoot, 'benchmark', 'analysis', runJson.levelId);
fs.mkdirSync(path.join(outputDir, 'subagents'), { recursive: true });

const writeJson = (name, obj) => {
  const p = path.join(outputDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return { name, bytes: fs.statSync(p).size };
};

const written = [];
// Split trace if it would exceed ~5 MB.
const traceStr = JSON.stringify(traceJson, null, 2);
if (Buffer.byteLength(traceStr) > 5 * 1024 * 1024) {
  const segSize = 500;
  const segments = [];
  for (let i = 0; i < traceJson.events.length; i += segSize) {
    const seg = traceJson.events.slice(i, i + segSize);
    const segName = `trace.segment-${String(segments.length + 1).padStart(3, '0')}.json`;
    written.push(writeJson(segName, { ...traceJson, events: seg, segment: segments.length + 1 }));
    segments.push({ file: segName, firstEvent: seg[0].id, lastEvent: seg[seg.length - 1].id, count: seg.length });
  }
  written.push(writeJson('trace.json', { ...traceJson, events: undefined, split: true, segments }));
} else {
  written.push(writeJson('trace.json', traceJson));
}

written.unshift(writeJson('run.json', runJson));
written.push(writeJson('files.json', filesJson));
written.push(writeJson('snapshot-moments.json', { runId: manifest.runId, count: snapshotMoments.length, moments: snapshotMoments }));

for (const sd of subagentData.values()) {
  const obj = {
    header: sd.header,
    runStart: runStartIso,
    eventCount: sd.events.length,
    events: sd.events,
  };
  written.push(writeJson(path.join('subagents', `agent-${sd.header.agentId}.json`), obj));
}

// ---------- report ----------
console.log('Output directory:', outputDir);
for (const w of written) console.log(`  ${w.name}  ${(w.bytes / 1024).toFixed(1)} KB`);
console.log('\nKey counts:');
console.log('  main trace events:', mainParsed.events.length, '(from', mainLines.length, 'session lines)');
console.log('  subagents:', subagentData.size);
console.log('  files touched:', filesMap.size, '/ final payload files:', finalPayloadFiles ? finalPayloadFiles.length : 'n/a');
console.log('  snapshot moments:', snapshotMoments.length);
console.log('  tool calls (all):', JSON.stringify(toolCallsAll));
