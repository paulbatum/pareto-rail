import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,63}$/;

// Sent verbatim to a harness resumed in its own session after an interruption, so the entrant keeps
// the assignment it was already working to rather than being handed a second one.
export const MANUAL_RESUME_MESSAGE = 'Your previous session was interrupted. You have been resumed in the same session; continue the assignment from where you left off and finish it per the original instructions.';

// Sent when an adapter resumes a session its harness stopped at a compaction. The entrant was not
// interrupted by an operator and its context is intact, so it is told what happened rather than
// handed the generic recovery message.
export const COMPACTION_CONTINUATION_MESSAGE = 'Your session was compacted and the harness stopped it early. Your context above is the compaction summary; your worktree is untouched. Continue the assignment from where you left off and finish it per the original instructions.';

// Bound on the compaction workaround. A stage is bounded by wall clock like every other harness; this
// only stops a pathological loop where every resume dies immediately.
export const MAX_COMPACTION_CONTINUATIONS = 30;

// A headless run ends at its first threshold compaction: the harness treats the session as idle while
// compaction runs, tears the connection down, and exits zero with the entrant's task half finished
// (https://github.com/PrimeIntellect-ai/prime-agent/issues/674). The stage looks complete and is not,
// so it is detected here and reported as a failure — which is also what makes the controller's
// `--continue-stage` recovery available, and that resumes the same session from the compacted context.
//
// This lives in the shared module because pi and Prime Agent share the print-mode idle wait that
// causes it; both adapters detect it the same way. Delete it, and the continuation loops that use it,
// once the upstream issue is fixed in every harness the benchmark runs.
//
// Two endings, one cause. The session either shows a compaction after the agent loop's last end, or
// an aborted post-compaction turn carrying no tokens.
export function compactionTruncation(events) {
  const lastAgentEnd = events.findLastIndex((event) => event.type === 'agent_end');
  if (lastAgentEnd !== -1) {
    const trailingCompaction = events.slice(lastAgentEnd).find((event) => event.type === 'compaction_start' || event.type === 'compaction_end');
    if (trailingCompaction) return 'the session ended at a threshold compaction';
  }
  const lastAssistant = events.findLast((event) => event.type === 'message_end' && event.message?.role === 'assistant');
  if (lastAssistant?.message?.stopReason === 'aborted') {
    return `the final turn was aborted: ${lastAssistant.message.errorMessage ?? 'no error message'}`;
  }
  return null;
}

export function fail(message) {
  throw new Error(message);
}

export function parseResumeRound(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    fail('--resume-round must be an integer of at least 1.');
  }
  return Number(value);
}

export function parseArgs(argv, { positional = false, booleans = [] } = {}) {
  const booleanFlags = new Set(['help', ...booleans]);
  const options = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      if (!positional) fail(`Unexpected argument: ${argument}`);
      rest.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!key) fail('Empty option name.');
    if (booleanFlags.has(key)) options[key] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return { options, rest };
}

export function requireOption(options, key) {
  const value = options[key];
  if (!value) fail(`Missing required option --${key}`);
  return value;
}

export function assertOnlyOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`Unknown option --${key}`);
  }
}

export async function readJson(filePath) {
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing file: ${filePath}`);
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

// Per-round stage records are named `<stem>.json` for the launch and `<stem>-resume-<n>.json` for
// each continuation. A round that dies before the harness reports — a provider error, a timeout —
// writes none, so the recorded rounds are enumerated rather than walked from zero: stopping at the
// first gap would drop every surviving later round.
export async function readRecordedRounds(stagePath, stem) {
  const pattern = new RegExp(`^${stem}(?:-resume-(\\d+))?\\.json$`);
  let entries;
  try {
    entries = await fs.readdir(stagePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const rounds = [];
  for (const entry of entries) {
    const match = pattern.exec(entry);
    if (match) rounds.push({ round: match[1] ? Number(match[1]) : 0, name: entry });
  }
  rounds.sort((a, b) => a.round - b.round);
  return Promise.all(rounds.map((record) => readJson(path.join(stagePath, record.name))));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertObject(value, label, errors) {
  if (!isPlainObject(value)) errors.push(`${label} must be an object.`);
  return isPlainObject(value);
}

export function assertAllowedKeys(value, keys, label, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${label} has unknown field ${key}.`);
  }
}

export function pathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertPrivateOrExternalPath(filePath, root = process.cwd()) {
  const resolved = path.resolve(filePath);
  const repositoryRoot = path.resolve(root);
  if (pathInside(resolved, repositoryRoot) && !pathInside(resolved, path.join(repositoryRoot, 'benchmark/private'))) {
    fail(`Refusing to write controller data inside the tracked repository: ${resolved}. Use benchmark/private/ or a path outside the repository.`);
  }
  return resolved;
}

export function formatErrors(errors) {
  return errors.map((error) => `- ${error}`).join('\n');
}
