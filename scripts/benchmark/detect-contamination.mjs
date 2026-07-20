#!/usr/bin/env node

/**
 * Heuristic audit of entrant tool calls for benchmark contamination.
 *
 * This intentionally audits the calls recorded in a transcript, not the resulting
 * filesystem. A clean result means only that this evidence pass found nothing.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const FINDING_CLASSES = Object.freeze([
  'copy',
  'content-read',
  'outside-worktree',
  'listing',
  'web',
  'web-self-lookup',
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_ROOT = path.join(ROOT, 'benchmark/private/runs');
const WEB_URL_PATTERN = /https?:\/\/[^\s"'`<>]+/gi;
const SHARED_BENCHMARK_ROOT_FILES = new Set([
  'catalog.ts',
  'types.ts',
  'index.ts',
  'validation.ts',
  'domain.test.ts',
]);
const LIST_TOOL_NAMES = new Set([
  'dir',
  'find',
  'glob',
  'list',
  'ls',
  'tree',
]);
const READ_TOOL_NAMES = new Set([
  'cat',
  'file_read',
  'grep',
  'head',
  'less',
  'more',
  'read',
  'read_file',
  'sed',
  'tail',
]);
const COPY_TOOL_NAMES = new Set([
  'copy',
  'cp',
  'install',
  'move',
  'mv',
  'rsync',
]);
const SHELL_TOOL_NAMES = new Set([
  'bash',
  'cells',
  'exec',
  'exec_command',
  'shell',
]);
const WEB_SEARCH_TOOL_NAMES = new Set([
  'browser_search',
  'internet_search',
  'search',
  'search_web',
  'web_search',
  'websearch',
]);
const WEB_FETCH_TOOL_NAMES = new Set([
  'browse',
  'browser',
  'browser_open',
  'fetch',
  'fetch_url',
  'http_get',
  'open_url',
  'visit',
  'web_fetch',
  'webfetch',
]);

/**
 * Convert one transcript record into normalized tool calls. Unknown record shapes
 * deliberately produce no calls.
 */
export function extractToolCalls(record, { adapter } = {}) {
  if (!record || typeof record !== 'object') return [];
  const timestamp = record.timestamp ?? record.created_at ?? record.message?.timestamp ?? null;
  const normalizedAdapter = normalizeAdapter(adapter) ?? inferAdapter(record);
  const calls = [];

  if (record.type === 'response_item' && record.payload && typeof record.payload === 'object') {
    const payload = record.payload;
    if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && typeof payload.name === 'string') {
      calls.push({
        adapter: normalizedAdapter ?? 'codex-cli',
        name: payload.name,
        input: parseArguments(payload.arguments ?? payload.input),
        timestamp: timestamp ?? payload.timestamp ?? null,
      });
    }
  }

  if (record.type === 'assistant' && record.message && Array.isArray(record.message.content)) {
    for (const content of record.message.content) {
      if (content?.type !== 'tool_use' || typeof content.name !== 'string') continue;
      calls.push({
        adapter: normalizedAdapter ?? 'claude-cli',
        name: content.name,
        input: content.input,
        timestamp: timestamp ?? content.timestamp ?? null,
      });
    }
  }

  if (record.type === 'message' && record.message?.role === 'assistant' && Array.isArray(record.message.content)) {
    for (const content of record.message.content) {
      if (content?.type !== 'toolCall' || typeof content.name !== 'string') continue;
      calls.push({
        adapter: normalizedAdapter ?? 'pi-cli',
        name: content.name,
        input: content.arguments,
        timestamp: timestamp ?? content.timestamp ?? null,
      });
    }
  }

  return calls;
}

/** Extract informational web activity from one normalized tool call. */
export function extractWebEvents(call) {
  if (!call || typeof call !== 'object') return [];
  const name = normalizedName(call.name).replace(/[.:/ -]/g, '_');
  const kind = webToolKind(name);
  const events = [];

  if (kind) {
    const input = call.input;
    let query = null;
    let url = null;
    if (typeof input === 'string') {
      const urls = extractUrls(input);
      if (kind === 'fetch' && urls.length > 0) url = urls[0];
      else query = input;
    } else if (input && typeof input === 'object') {
      query = firstString(input, ['query', 'q', 'search_query', 'searchTerm', 'prompt', 'text']);
      url = firstString(input, ['url', 'uri', 'href', 'link', 'target']);
      if (!query && !url) {
        const text = JSON.stringify(input);
        const urls = extractUrls(text);
        if (kind === 'fetch' && urls.length > 0) url = urls[0];
        else query = text;
      }
    }
    events.push({ timestamp: call.timestamp ?? null, tool: call.name, query, url });
  }

  if (SHELL_TOOL_NAMES.has(normalizedName(call.name))) {
    for (const command of shellCommandSource(call)) {
      const lower = command.toLowerCase();
      const networkCommand = /\b(?:curl|wget)\b/.test(lower) || /\bgit\s+(?:clone|fetch)\b/.test(lower);
      if (!networkCommand) continue;
      for (const url of extractUrls(command)) events.push({ timestamp: call.timestamp ?? null, tool: call.name, query: null, url });
    }
  }

  return events;
}

function webToolKind(name) {
  if (name === 'toolsearch' || name === 'tool_search') return null;
  if (WEB_SEARCH_TOOL_NAMES.has(name) || /(?:web|internet|browser)_?search$/.test(name)) return 'search';
  if (WEB_FETCH_TOOL_NAMES.has(name) || /(?:web|browser)_?(?:fetch|browse|open|visit)$/.test(name)) return 'fetch';
  return null;
}

function firstString(value, keys) {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  return null;
}

function extractUrls(text) {
  return [...String(text).matchAll(WEB_URL_PATTERN)].map((match) => match[0].replace(/[.,;:!?)}\]]+$/g, ''));
}

function shellCommandSource(call) {
  const name = normalizedName(call.name);
  const input = call.input;
  if (typeof input === 'string') {
    const wrapped = extractWrappedCommands(input);
    if (wrapped.length > 0) return wrapped;
    if (/^\s*(?:curl|wget|git\s+(?:clone|fetch))\b/i.test(input) || /^\s*(?:curl|wget|git\s+(?:clone|fetch))\b/im.test(input)) return [input];
    return [];
  }
  if (!input || typeof input !== 'object' || !SHELL_TOOL_NAMES.has(name)) return [];
  for (const key of ['command', 'cmd', 'script']) if (typeof input[key] === 'string') return [input[key]];
  return [];
}

/** Load the repo and benchmark identifiers used for self-lookup detection. */
export async function loadSelfLookupContext({ root = ROOT } = {}) {
  const terms = new Set(['pareto rail']);
  const levelIds = new Set();
  const themeIds = new Set();

  try {
    const config = await fsp.readFile(path.join(root, '.git/config'), 'utf8');
    for (const match of config.matchAll(/^\s*url\s*=\s*(\S+)/gm)) {
      for (const term of remoteIdentityTerms(match[1])) terms.add(term);
    }
  } catch {
    // A detached/synthetic checkout may not carry the controller's git config.
  }

  try {
    for (const entry of await fsp.readdir(path.join(root, 'src/benchmark-levels'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'test-fixtures') levelIds.add(entry.name.toLowerCase());
    }
  } catch {
    // Keep the remote and phrase checks when the catalog is unavailable.
  }
  try {
    for (const entry of await fsp.readdir(path.join(root, 'benchmark/themes'))) {
      if (entry.endsWith('.md') && entry !== 'README.md') themeIds.add(entry.slice(0, -3).toLowerCase());
    }
  } catch {
    // Keep the other checks when the private benchmark inputs are unavailable.
  }

  return { terms: [...terms], levelIds: [...levelIds], themeIds: [...themeIds] };
}

function remoteIdentityTerms(remote) {
  const cleaned = remote.trim().replace(/\.git$/, '');
  const withoutScheme = cleaned.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const match = withoutScheme.match(/^(?:[^@/]+@)?([^/:]+)(?::|\/)(.+)$/);
  if (!match) return [];
  const host = match[1].toLowerCase();
  const parts = match[2].split('/').filter(Boolean).map((part) => part.toLowerCase());
  const terms = [host, ...parts];
  if (parts.length >= 2) terms.push(`${host}/${parts.at(-2)}/${parts.at(-1)}`);
  if (parts.length >= 2) terms.push(`${parts.at(-2)}/${parts.at(-1)}`);
  return terms;
}

function selfLookupContextForRun(base, definition) {
  const themeId = definition.themeId ?? definition.assignment?.theme?.id ?? null;
  const levelId = definition.levelId ?? definition.assignment?.levelId ?? null;
  const context = {
    ...base,
    terms: [...(base?.terms ?? [])],
    levelIds: [...(base?.levelIds ?? [])],
    themeIds: [...(base?.themeIds ?? [])],
    assignedThemeId: themeId?.toLowerCase() ?? null,
  };
  if (themeId) context.themeIds.push(themeId.toLowerCase());
  if (levelId) context.levelIds.push(levelId.toLowerCase());
  return context;
}

export function isSelfLookup(event, { selfLookupContext } = {}) {
  const context = selfLookupContext ?? {};
  const text = [event?.query, event?.url].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  const normalizedText = text.replace(/[._/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const term of context.terms ?? []) {
    const normalizedTerm = String(term).toLowerCase();
    if (normalizedTerm.includes(' ')) {
      if (normalizedText.includes(normalizedTerm.replace(/[._/-]+/g, ' ').replace(/\s+/g, ' ').trim())) return true;
    } else if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}($|[^a-z0-9])`, 'i').test(text)) {
      return true;
    }
  }
  for (const id of [...(context.levelIds ?? []), ...(context.themeIds ?? [])]) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(String(id).toLowerCase())}($|[^a-z0-9])`, 'i').test(text)) return true;
  }
  if (context.assignedThemeId && new RegExp(`(^|[^a-z0-9])${escapeRegExp(context.assignedThemeId)}-[a-z0-9]+($|[^a-z0-9])`, 'i').test(text)) return true;
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify one normalized tool call. The returned findings have no transcript
 * source or line number; auditTranscriptRecords adds those fields.
 */
export function classifyToolCall(call, { worktree, assignedLevelId, cwd = worktree, ownRunDirectory } = {}) {
  if (!call || typeof call !== 'object') return [];
  const worktreeRoot = worktree ? path.resolve(worktree) : null;
  const ownRunRoot = ownRunDirectory ? path.resolve(ownRunDirectory) : null;
  const source = toolSource(call);
  if (!source) return [];
  const operation = directToolOperation(call.name, call.input);
  const candidates = extractPathCandidates(source);
  const findings = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const info = inspectPath(candidate.raw, {
      worktree: worktreeRoot,
      cwd: cwd ? path.resolve(cwd) : worktreeRoot,
      source,
    });

    if (info.outside) {
      // The run's own artifact directory (harness home, tool results, rendered
      // assignment) is run-owned machinery, not an escape.
      if (ownRunRoot && info.absolutePath && !path.relative(ownRunRoot, info.absolutePath).startsWith('..')) continue;
      if (shouldIgnoreOutside(info, { candidate, source, operation })) continue;
      addFinding(findings, seen, {
        classification: 'outside-worktree',
        paths: [candidate.raw],
        excerpt: excerptAround(source, candidate.raw),
        timestamp: call.timestamp ?? null,
      });
      continue;
    }

    const monitored = monitoredPath(info.relativePath, assignedLevelId);
    if (!monitored) continue;
    if (monitored.kind === 'ignored') continue;

    const classification = operation ?? shellOperation(source, candidate, call.name);
    if (!classification) continue;
    addFinding(findings, seen, {
      classification,
      paths: [displayPath(candidate.raw, info.relativePath)],
      excerpt: excerptAround(source, candidate.raw),
      timestamp: call.timestamp ?? null,
    });
  }

  return mergeFindings(findings);
}

/** Classify all tool calls in an iterable of synthetic or parsed records. */
export function auditTranscriptRecords(records, options = {}) {
  const findings = [];
  const webEvents = [];
  let calls = 0;
  let line = 0;
  for (const record of records) {
    line += 1;
    const extracted = extractToolCalls(record, options);
    calls += extracted.length;
    for (const call of extracted) {
      for (const finding of classifyToolCall(call, options)) {
        findings.push({ ...finding, line, tool: call.name });
      }
      for (const event of extractWebEvents(call)) {
        const selfLookup = isSelfLookup(event, options);
        const enriched = { ...event, line, selfLookup };
        webEvents.push(enriched);
        findings.push(webFinding(enriched, selfLookup));
      }
    }
  }
  return { calls, findings: dedupeFindings(findings), webEvents };
}

function webFinding(event, selfLookup) {
  const value = event.query ?? event.url ?? '<no query or URL captured>';
  return {
    classification: selfLookup ? 'web-self-lookup' : 'web',
    paths: [value],
    excerpt: `${event.tool}: ${value}`,
    timestamp: event.timestamp ?? null,
    line: event.line,
    tool: event.tool,
  };
}

/**
 * The transcript stores JSON arguments as a string for Codex function calls.
 * Invalid JSON is retained as text so heuristic matching still has a chance.
 */
function parseArguments(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeAdapter(adapter) {
  if (adapter === 'codex-cli' || adapter === 'codex') return 'codex-cli';
  if (adapter === 'claude-cli' || adapter === 'claude') return 'claude-cli';
  if (adapter === 'pi-cli' || adapter === 'pi') return 'pi-cli';
  return null;
}

function inferAdapter(record) {
  if (record?.type === 'response_item') return 'codex-cli';
  if (record?.type === 'assistant') return 'claude-cli';
  if (record?.type === 'message') return 'pi-cli';
  return null;
}

function normalizedName(name) {
  return typeof name === 'string' ? name.toLowerCase() : '';
}

function directToolOperation(name, input) {
  const normalized = normalizedName(name);
  if (LIST_TOOL_NAMES.has(normalized)) return 'listing';
  if (READ_TOOL_NAMES.has(normalized)) return 'content-read';
  if (COPY_TOOL_NAMES.has(normalized)) return 'copy';
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'exec' || normalized === 'exec_command' || normalized === 'cells') return null;
  if (normalized.includes('list') || normalized.includes('glob')) return 'listing';
  if (normalized.includes('read') || normalized.includes('grep')) return 'content-read';
  if (normalized.includes('copy') || normalized.includes('rsync')) return 'copy';
  // A tool with a command-shaped argument is treated as shell activity even if a
  // provider gives the tool a new name. This keeps adapter additions conservative.
  if (input && typeof input === 'object' && ['command', 'cmd', 'script', 'code'].some((key) => typeof input[key] === 'string')) return null;
  return null;
}

function toolSource(call) {
  const input = call.input;
  const name = normalizedName(call.name);
  if (typeof input === 'string') {
    if (SHELL_TOOL_NAMES.has(name)) {
      const wrappedCommands = extractWrappedCommands(input);
      if (wrappedCommands.length > 0) return wrappedCommands.join('\n');
    }
    return input;
  }
  if (!input || typeof input !== 'object') return '';

  for (const key of ['command', 'cmd', 'script', 'code']) {
    if (typeof input[key] === 'string') return input[key];
  }
  if (typeof input.input === 'string' && SHELL_TOOL_NAMES.has(name)) return input.input;

  // Dedicated file tools should contribute path-bearing fields, not a Grep
  // pattern that merely mentions a path as text.
  const keys = name.includes('glob') ? ['pattern', 'path', 'file_path'] : name.includes('grep') ? ['path', 'file_path', 'include'] : ['file_path', 'path', 'target', 'source', 'destination'];
  const values = keys.filter((key) => typeof input[key] === 'string').map((key) => input[key]);
  if (values.length > 0) return values.join(' ');
  return JSON.stringify(input);
}

function extractWrappedCommands(input) {
  const commands = [];
  const pattern = /\b(?:cmd|command)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const match of input.matchAll(pattern)) {
    const token = match[1];
    if (token.startsWith('"')) {
      try { commands.push(JSON.parse(token)); } catch { /* retain the next form if available */ }
    } else {
      commands.push(token.slice(1, -1).replaceAll('\\\\' + token[0], token[0]));
    }
  }
  return commands;
}

export function extractPathCandidates(text) {
  const candidates = [];
  if (!text) return candidates;

  // Absolute POSIX paths. The URL check below prevents the two slashes in
  // https://host/path from becoming false outside-worktree paths.
  const absolutePattern = /(?<![A-Za-z0-9._\/*#$])\/(?:[A-Za-z0-9._~+@%*-]+\/)*[A-Za-z0-9._~+@%*?{}\[\]-]+/g;
  for (const match of text.matchAll(absolutePattern)) {
    const start = match.index ?? 0;
    const raw = trimPath(match[0]);
    if (!raw || isUrlAt(text, start)) continue;
    candidates.push({ raw, start, end: start + match[0].length });
  }

  // Repository-relative monitored roots, including a parent prefix so paths such
  // as ../src/benchmark-levels/old-level are checked too.
  const relativePattern = /(?<![A-Za-z0-9_./-])((?:\.\.?\/)*(?:src\/benchmark-levels|public\/level-content|benchmark(?:\/[A-Za-z0-9._~+@%*?{}\[\]-]+)+)(?:\/[A-Za-z0-9._~+@%*?{}\[\]-]+)*)/g;
  for (const match of text.matchAll(relativePattern)) {
    const start = match.index ?? 0;
    const raw = trimPath(match[1]);
    if (!raw) continue;
    candidates.push({ raw, start, end: start + match[1].length });
  }

  const bareBenchmarkPattern = /(?<![A-Za-z0-9_./-])benchmark(?![A-Za-z0-9._/-])/g;
  for (const match of text.matchAll(bareBenchmarkPattern)) {
    const start = match.index ?? 0;
    if (isLikelyBarePath(text, start, start + match[0].length)) candidates.push({ raw: 'benchmark', start, end: start + match[0].length });
  }

  // Parent traversal is relevant even when it does not end in one of the
  // monitored roots (for example ../../secrets.txt).
  const parentPattern = /(?<![A-Za-z0-9_./-])((?:\.\.\/)+[^\s"'`;,)&|]+|\.\.)/g;
  for (const match of text.matchAll(parentPattern)) {
    const start = match.index ?? 0;
    const raw = trimPath(match[1]);
    if (!raw) continue;
    candidates.push({ raw, start, end: start + match[1].length });
  }

  const homePattern = /(?<![A-Za-z0-9_])((?:~(?=\/|[\s"'`;,)&|]|$)(?:\/[^\s"'`;,)&|]*)?|\$HOME(?![A-Za-z0-9_])|\$\{HOME\})(?:\/[^\s"'`;,)&|]*)?)/g;
  for (const match of text.matchAll(homePattern)) {
    const start = match.index ?? 0;
    const raw = trimPath(match[1]);
    if (!raw) continue;
    candidates.push({ raw, start, end: start + match[1].length });
  }

  // Keep the longest match at an overlapping start, especially the full absolute
  // path when it also contains a repository-relative monitored root.
  candidates.sort((a, b) => a.start - b.start || b.raw.length - a.raw.length);
  const selected = [];
  for (const candidate of candidates) {
    const overlaps = selected.some((previous) => candidate.start < previous.end && previous.start < candidate.end);
    if (!overlaps) selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function isLikelyBarePath(text, start, end) {
  const compact = text.trim();
  if (compact === 'benchmark') return true;
  const before = text.slice(0, start);
  return /\b(?:ls|find|tree|dir|exa|eza|du|fd|cat|head|tail|sed|awk|grep|rg|cp|rsync|install|mv|cd|pushd)\s+[^;&|\n]*$/i.test(before)
    && !/\b(?:Read|Implement|Run|Generate|protocol|constraints|status)\s+[^;&|\n]*$/i.test(before.slice(Math.max(0, before.lastIndexOf('\n') + 1)));
}

function trimPath(value) {
  return value.replace(/[.,:;!?)}\]}>]+$/g, '');
}

function isUrlAt(text, start) {
  const prefix = text.slice(Math.max(0, start - 8), start).toLowerCase();
  return prefix.endsWith('http:') || prefix.endsWith('https:') || prefix.endsWith('file:');
}

function inspectPath(rawPath, { worktree, cwd, source }) {
  const raw = rawPath.replaceAll('\\', '/');
  const lower = raw.toLowerCase();
  const homePath = lower === '~' || lower.startsWith('~/') || lower === '$home' || lower.startsWith('$home/') || lower === '${home}' || lower.startsWith('${home}/');
  if (homePath) return { outside: true, raw, absolutePath: null, relativePath: null, homePath };
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('file://')) return { outside: false, ignored: true, relativePath: null };

  const base = cwd ?? worktree ?? process.cwd();
  const absolutePath = path.resolve(base, raw);
  if (!worktree) {
    return { outside: false, absolutePath, relativePath: path.posix.normalize(raw.replace(/^\.\//, '')) };
  }
  const relativePath = path.relative(worktree, absolutePath).replaceAll(path.sep, '/');
  const outside = relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath);
  return { outside, absolutePath, relativePath: relativePath || '.', homePath: false, source };
}

function monitoredPath(relativePath, assignedLevelId) {
  if (!relativePath || relativePath === '.') return null;
  const normalized = relativePath.replace(/^\.\//, '').replaceAll('\\', '/');
  const segments = normalized.split('/');

  if (segments[0] === 'benchmark') {
    return { kind: 'contaminating' };
  }

  if (segments[0] === 'src' && segments[1] === 'benchmark-levels') {
    const remainder = segments.slice(2);
    if (remainder.length === 0) return { kind: 'contaminating' };
    const first = remainder[0];
    if (first === 'test-fixtures') return { kind: 'ignored' };
    if (remainder.length === 1 && SHARED_BENCHMARK_ROOT_FILES.has(first)) return null;
    if (first === assignedLevelId) return null;
    return { kind: 'contaminating' };
  }

  if (segments[0] === 'public' && segments[1] === 'level-content') {
    const remainder = segments.slice(2);
    if (remainder.length === 0) return { kind: 'contaminating' };
    if (remainder[0] === assignedLevelId) return null;
    return { kind: 'contaminating' };
  }

  return null;
}

function shellOperation(source, candidate, toolName) {
  const normalized = normalizedName(toolName);
  if (!SHELL_TOOL_NAMES.has(normalized) && !source) return null;
  const segment = commandSegment(source, candidate.start);
  const lower = segment.toLowerCase();

  if (/\b(?:cp|rsync|install|mv)\b/.test(lower) || /\b(?:shutil\.(?:copy|copy2|copyfile)|copyfile)\s*\(/.test(lower)) return 'copy';
  if (isSourceBeforeRedirect(segment, candidate.start - segmentStart(source, candidate.start))) return 'copy';

  const hasContentRead = /\b(?:cat|head|tail|sed|awk|grep|rg|less|more|cut|readlink|file|strings|open|read_text|readfile|read_file|git\s+(?:show|checkout|cat-file))\b/.test(lower)
    || /(?:fs|pathlib|file)\s*\.?(?:readfile|read_text|open)|open\s*\(/.test(lower)
    || /\bxargs\s+(?:-[^\s]+\s+)*wc\b/.test(lower)
    || /\bwc\s+-/.test(lower);
  if (hasContentRead) return 'content-read';

  if (isListingCommand(lower)) return 'listing';

  // Unknown shell wrappers are evidence of path use but not enough to assert a
  // content read. A command that explicitly changes directory is handled by the
  // outside-path check and is otherwise not a monitored-tree read.
  return null;
}

function isListingCommand(lower) {
  if (/\b(?:ls|find|tree|dir|exa|eza)\b/.test(lower)) {
    return !/\b(?:-exec|xargs)\b/.test(lower) || !/\b(?:cat|head|tail|sed|awk|grep|rg|wc)\b/.test(lower);
  }
  if (/\b(?:rg|grep)\s+--files\b/.test(lower)) return true;
  if (/\bgit\s+(?:ls-files|ls-tree)\b/.test(lower)) return true;
  if (/\bgit\s+(?:status|diff)\b/.test(lower) && /(?:--name-only|--short|--porcelain)/.test(lower)) return true;
  if (/\b(?:du|fd)\b/.test(lower)) return true;
  if (/\bfor\s+\w+\s+in\b/.test(lower)) return true;
  return false;
}

function commandSegment(source, offset) {
  const before = source.slice(0, offset);
  const starts = [...before.matchAll(/(?:&&|\|\||;|\n)/g)];
  const start = starts.length ? (starts.at(-1).index ?? 0) + starts.at(-1)[0].length : 0;
  const after = source.slice(offset);
  const next = after.search(/(?:&&|\|\||;|\n)/);
  const end = next < 0 ? source.length : offset + next;
  return source.slice(start, end).trim();
}

function segmentStart(source, offset) {
  const before = source.slice(0, offset);
  const starts = [...before.matchAll(/(?:&&|\|\||;|\n)/g)];
  return starts.length ? (starts.at(-1).index ?? 0) + starts.at(-1)[0].length : 0;
}

function isSourceBeforeRedirect(segment, offsetInSegment) {
  const redirect = segment.search(/(?:^|[^2])>\s*/);
  return redirect >= 0 && offsetInSegment < redirect;
}

function shouldIgnoreOutside(info, { candidate, source, operation }) {
  const raw = info.raw ?? candidate.raw;
  const normalized = raw.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('file://')) return true;
  if (lower === '/dev/null' || lower.startsWith('/dev/')) return true;
  if (lower.startsWith('/level-content/')) return true;
  if (lower.includes('/node_modules/') || lower.endsWith('/node_modules')) return true;
  if (lower.startsWith('/proc/') || lower.startsWith('/sys/')) return true;
  if (isNonFilesystemPath(source, candidate.start, raw)) return true;
  if ((source.includes('*** Update File:') || source.includes('*** Add File:')) && raw.startsWith('../')) return true;

  if (isCdPath(source, candidate.start)) return false;
  if (isTmpScratch(normalized, source, candidate.start, operation)) return true;
  return false;
}

function isNonFilesystemPath(source, offset, raw) {
  if (raw === '/**' || raw.startsWith('/**/')) return true;
  const before = source.slice(0, offset);
  if (/\bssrLoadModule\(\s*['"]$/.test(before)) return true;
  if (/\b(?:from|import|require)\s*\(?\s*['"]$/.test(before)) return true;
  if (/\.(?:replace|replaceAll)\([^\n;]*['"]$/.test(before)) return true;
  const segment = commandSegment(source, offset);
  const localOffset = Math.max(0, offset - segmentStart(source, offset));
  if (/\b(?:sed|grep|rg)\b/i.test(segment)) {
    const singleQuotes = (segment.slice(0, localOffset).match(/'/g) ?? []).length;
    const doubleQuotes = (segment.slice(0, localOffset).match(/"/g) ?? []).length;
    if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) return true;
    if (!raw.slice(1).includes('/')) return true;
  }
  return false;
}

function isCdPath(source, offset) {
  const prefix = source.slice(0, offset);
  return /(?:^|[;&|]\s*|\b)(?:cd|pushd)\s+(?:--\s+)?$/i.test(prefix);
}

function isTmpScratch(raw, source, offset, operation) {
  if (!raw.startsWith('/tmp/')) return false;
  if (isCdPath(source, offset)) return false;
  // Scratch files are common in harness command wrappers. Repository-shaped paths
  // under /tmp are retained as evidence, while one-off scratch files are ignored.
  return !/(?:^|\/)(?:src|public|benchmark|docs|scripts|AGENTS\.md|package\.json|\.git)(?:\/|$)/i.test(raw);
}

function displayPath(raw, relativePath) {
  if (relativePath && !raw.startsWith('/') && !raw.startsWith('~') && !raw.startsWith('$')) return relativePath;
  return raw;
}

function excerptAround(source, rawPath, maximum = 360) {
  const compact = source.replace(/\s+/g, ' ').trim();
  const needle = rawPath.replaceAll('\\', '/');
  const index = compact.indexOf(needle);
  if (compact.length <= maximum) return compact;
  if (index < 0) return `${compact.slice(0, maximum - 1)}…`;
  const available = maximum - 1;
  const before = Math.min(index, Math.floor(available * 0.35));
  const start = Math.max(0, index - before);
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + available - (start > 0 ? 1 : 0))}…`;
}

function addFinding(findings, seen, finding) {
  const key = `${finding.classification}\u0000${finding.paths.join('\u0000')}\u0000${finding.excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

function mergeFindings(findings) {
  const merged = [];
  const byKey = new Map();
  for (const finding of findings) {
    const key = `${finding.classification}\u0000${finding.excerpt}\u0000${finding.timestamp ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      const copy = { ...finding, paths: [...finding.paths] };
      byKey.set(key, copy);
      merged.push(copy);
    } else {
      for (const matchedPath of finding.paths) if (!existing.paths.includes(matchedPath)) existing.paths.push(matchedPath);
    }
  }
  return merged;
}

function dedupeFindings(findings) {
  const result = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = [finding.classification, finding.line, finding.tool, finding.paths.join('|'), finding.excerpt].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

export function verdictFor(findings, webEvents = []) {
  if (findings.some((finding) => !['listing', 'web'].includes(finding.classification))) return 'CONTAMINATED';
  if (webEvents.length > 0) return 'needs-web-review';
  if (findings.length > 0) return 'listings-only';
  return 'clean';
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function findTranscriptFiles(runDirectory) {
  const files = [];
  const stageDirectory = path.join(runDirectory, 'stages');
  await walk(stageDirectory, files);
  const rootEvents = path.join(runDirectory, 'events.jsonl');
  if (await isFile(rootEvents)) files.push(rootEvents);

  const rollouts = files.filter((file) => path.basename(file) === 'rollout.jsonl').sort();
  if (rollouts.length > 0) return rollouts;
  return files.filter((file) => path.basename(file) === 'events.jsonl').sort();
}

async function walk(directory, files) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, files);
    else if (entry.isFile() && (entry.name === 'rollout.jsonl' || entry.name === 'events.jsonl')) files.push(fullPath);
  }
}

async function isFile(filePath) {
  try {
    return (await fsp.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function scanTranscriptFile(filePath, options) {
  const findings = [];
  const webEvents = [];
  let calls = 0;
  let lineNumber = 0;
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      lineNumber += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const extracted = extractToolCalls(record, options);
      calls += extracted.length;
      for (const call of extracted) {
        for (const finding of classifyToolCall(call, options)) {
          findings.push({
            ...finding,
            line: lineNumber,
            source: path.relative(ROOT, filePath).replaceAll(path.sep, '/'),
            tool: call.name,
          });
        }
        for (const event of extractWebEvents(call)) {
          const selfLookup = isSelfLookup(event, options);
          const enriched = {
            ...event,
            line: lineNumber,
            source: path.relative(ROOT, filePath).replaceAll(path.sep, '/'),
            selfLookup,
          };
          webEvents.push(enriched);
          findings.push({
            ...webFinding(enriched, selfLookup),
            source: enriched.source,
          });
        }
      }
    }
  } finally {
    lines.close();
  }
  return { calls, findings, webEvents };
}

export async function auditRun(runDirectory, { selfLookupContext } = {}) {
  const definition = await readJson(path.join(runDirectory, 'run-definition.json'));
  let worktreeRecord = {};
  try {
    worktreeRecord = await readJson(path.join(runDirectory, 'worktree.json'));
  } catch {
    // Relative contamination can still be audited without this record; outside
    // path checks simply have no trusted root in that case.
  }
  const worktree = worktreeRecord.worktree ?? definition.worktree?.path ?? definition.assignment?.worktree?.path ?? null;
  const levelId = definition.levelId ?? definition.assignment?.levelId ?? null;
  const adapter = normalizeAdapter(definition.stage?.adapter ?? definition.assignment?.stage?.adapter);
  const transcriptFiles = await findTranscriptFiles(runDirectory);
  const identity = selfLookupContextForRun(selfLookupContext ?? await loadSelfLookupContext(), definition);
  const options = { worktree, assignedLevelId: levelId, adapter, selfLookupContext: identity, ownRunDirectory: runDirectory };
  let scanned = { calls: 0, findings: [], webEvents: [] };

  for (const file of transcriptFiles) {
    const result = await scanTranscriptFile(file, options);
    scanned.calls += result.calls;
    scanned.findings.push(...result.findings);
    scanned.webEvents.push(...result.webEvents);
  }

  // Some early artifacts retained only events.jsonl. If a rollout exists but has
  // no recognizable calls, use the event log as a fallback rather than declaring
  // the run clean on an adapter-format mismatch.
  if (transcriptFiles.length > 0 && scanned.calls === 0 && transcriptFiles.every((file) => path.basename(file) === 'rollout.jsonl')) {
    const eventFiles = (await findEventFiles(runDirectory)).filter((file) => !transcriptFiles.includes(file));
    for (const file of eventFiles) {
      const result = await scanTranscriptFile(file, options);
      scanned.calls += result.calls;
      scanned.findings.push(...result.findings);
      scanned.webEvents.push(...result.webEvents);
    }
  }

  const findings = dedupeFindings(scanned.findings);
  return {
    runId: definition.runId ?? path.basename(runDirectory),
    levelId,
    adapter: adapter ?? definition.stage?.adapter ?? null,
    worktree,
    transcripts: transcriptFiles.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
    toolCalls: scanned.calls,
    verdict: verdictFor(findings, scanned.webEvents),
    findings,
    webEvents: scanned.webEvents,
  };
}

async function findEventFiles(runDirectory) {
  const files = [];
  await walk(runDirectory, files);
  return files.filter((file) => path.basename(file) === 'events.jsonl').sort();
}

async function runDirectories(runId) {
  if (runId) return [path.join(RUNS_ROOT, runId)];
  let entries;
  try {
    entries = await fsp.readdir(RUNS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(RUNS_ROOT, entry.name);
    if (await isFile(path.join(directory, 'run-definition.json'))) directories.push(directory);
  }
  return directories.sort();
}

function printHuman(results) {
  for (const result of results) {
    const identity = [result.runId, result.levelId ? `level=${result.levelId}` : null, result.adapter ? `adapter=${result.adapter}` : null].filter(Boolean).join(' ');
    console.log(`${identity}: ${result.verdict}`);
    for (const finding of result.findings) {
      const timestamp = finding.timestamp ? ` ${finding.timestamp}` : '';
      const paths = finding.paths.join(', ');
      console.log(`  ${finding.classification}: ${paths}${timestamp}`);
      console.log(`    ${finding.excerpt}`);
    }
  }
  const counts = { clean: 0, 'listings-only': 0, 'needs-web-review': 0, CONTAMINATED: 0 };
  for (const result of results) counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;
  console.log(`Scanned ${results.length} run(s): ${counts.CONTAMINATED ?? 0} contaminated, ${counts['needs-web-review'] ?? 0} needs-web-review, ${counts['listings-only'] ?? 0} listings-only, ${counts.clean ?? 0} clean.`);
}

function parseCli(argv) {
  let runId = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') json = true;
    else if (argument === '--run') {
      runId = argv[++index];
      if (!runId) throw new Error('--run requires a run id');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { runId, json };
}

async function main() {
  const { runId, json } = parseCli(process.argv.slice(2));
  const directories = await runDirectories(runId);
  if (runId && directories.length === 1 && !(await isFile(path.join(directories[0], 'run-definition.json')))) {
    throw new Error(`No run-definition.json found for run ${runId}`);
  }
  const identity = await loadSelfLookupContext();
  const results = [];
  for (const directory of directories) results.push(await auditRun(directory, { selfLookupContext: identity }));
  if (json) console.log(JSON.stringify({ runs: results }, null, 2));
  else printHuman(results);
  if (results.some((result) => result.findings.some((finding) => !['listing', 'web'].includes(finding.classification)))) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
