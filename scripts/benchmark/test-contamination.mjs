#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  auditTranscriptRecords,
  classifyToolCall,
  extractToolCalls,
  verdictFor,
} from './detect-contamination.mjs';

const options = {
  worktree: '/tmp/entrant-worktree',
  assignedLevelId: 'assigned-a1b2',
};

function classes(findings) {
  return findings.map((finding) => finding.classification);
}

function paths(findings) {
  return findings.flatMap((finding) => finding.paths);
}

// Codex: JSON-string arguments on a normal function_call.
{
  const record = {
    type: 'response_item',
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: {
      type: 'function_call',
      name: 'exec',
      arguments: JSON.stringify({ cmd: 'cat src/benchmark-levels/other-zz99/gameplay.ts' }),
    },
  };
  const calls = extractToolCalls(record);
  assert.equal(calls.length, 1);
  assert.deepEqual(classes(classifyToolCall(calls[0], options)), ['content-read']);
}

// Codex custom_tool_call: directory inspection is informational, not a violation.
{
  const record = {
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'const r = await tools.exec_command({cmd:"find src/benchmark-levels/other-zz99 -type f -print"});',
    },
  };
  const calls = extractToolCalls(record);
  assert.deepEqual(classes(classifyToolCall(calls[0], options)), ['listing']);
}

// Claude: Bash copies from another entrant level, which is the strongest finding.
{
  const record = {
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'cp src/benchmark-levels/other-zz99/visuals/*.ts src/benchmark-levels/assigned-a1b2/visuals/' },
      }],
    },
  };
  const calls = extractToolCalls(record);
  assert.deepEqual(classes(classifyToolCall(calls[0], options)), ['copy']);
}

// Claude's dedicated Read tool reports content reads and flags absolute paths
// outside the worktree, while the assigned level remains allowed.
{
  const records = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/entrant/secrets.txt' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/benchmark-levels/assigned-a1b2/gameplay.ts' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/benchmark-levels/types.ts' } }] } },
  ];
  const result = auditTranscriptRecords(records, options);
  assert.deepEqual(classes(result.findings), ['outside-worktree']);
  assert.deepEqual(paths(result.findings), ['/home/entrant/secrets.txt']);
}

// pi: read, list, and outside-path cases use toolCall arguments rather than a
// JSON string, and all three are recognized.
{
  const records = [{
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'read', arguments: { path: 'public/level-content/other-zz99/hero.png' } },
        { type: 'toolCall', name: 'list', arguments: { path: 'benchmark/themes' } },
        { type: 'toolCall', name: 'read', arguments: { path: '$HOME/.config/agent.json' } },
      ],
    },
  }];
  const result = auditTranscriptRecords(records, options);
  assert.deepEqual(classes(result.findings), ['content-read', 'listing', 'outside-worktree']);
}

// Prime Agent: the same session shape as pi, but every action arrives as Python in one `ipython`
// tool call, so the code is read as shell activity — %%bash commands and Python file reads alike.
{
  const records = [
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'ipython', arguments: { code: "%%bash\ncat public/level-content/other-zz99/hero.png" } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'ipython', arguments: { code: "print(open('src/benchmark-levels/other-zz99/gameplay.ts').read())" } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'ipython', arguments: { code: "import shutil; shutil.copy('/home/entrant/secrets.txt', 'notes.txt')" } }] } },
  ];
  const result = auditTranscriptRecords(records, { ...options, adapter: 'prime-agent-cli' });
  assert.deepEqual(classes(result.findings), ['content-read', 'content-read', 'outside-worktree']);
}

// agy: tool calls hang off a PLANNER_RESPONSE step as {name, args}, with capitalized
// argument keys. The same three cases are recognized through that shape.
{
  const records = [{
    type: 'PLANNER_RESPONSE',
    source: 'MODEL',
    created_at: '2026-07-25T04:16:51Z',
    tool_calls: [
      { name: 'view_file', args: { AbsolutePath: 'public/level-content/other-zz99/hero.png' } },
      { name: 'list_dir', args: { DirectoryPath: 'benchmark/themes' } },
      { name: 'view_file', args: { AbsolutePath: '/home/entrant/secrets.txt' } },
    ],
  }];
  const result = auditTranscriptRecords(records, options);
  assert.deepEqual(classes(result.findings), ['content-read', 'listing', 'outside-worktree']);
}

// Shared benchmark root files, test fixtures, URLs, and harness scratch files do
// not produce a finding.
{
  const records = [
    { type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: JSON.stringify({ cmd: 'cat src/benchmark-levels/catalog.ts' }) } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: JSON.stringify({ cmd: 'cat src/benchmark-levels/test-fixtures/example.ts' }) } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'https://example.test/benchmark/src/benchmark-levels/other.ts' } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cat /tmp/harness-scratch.txt' } }] } },
  ];
  assert.deepEqual(auditTranscriptRecords(records, options).findings, []);
}

// Parent traversal and an explicit cd to an outside directory are both outside
// evidence; a relative path that remains inside the worktree is not.
{
  const records = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/other-run/src/benchmark-levels/other-zz99/gameplay.ts' } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cd /tmp/another-worktree && cat package.json' } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: '../../secrets.txt' } }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: '../entrant-worktree/src/engine/types.ts' } }] } },
  ];
  const result = auditTranscriptRecords(records, options);
  assert.deepEqual(classes(result.findings), ['outside-worktree', 'outside-worktree', 'outside-worktree']);
  assert.ok(paths(result.findings).includes('/tmp/other-run/src/benchmark-levels/other-zz99/gameplay.ts'));
  assert.ok(paths(result.findings).includes('/tmp/another-worktree'));
  assert.ok(paths(result.findings).includes('../../secrets.txt'));
}

// The run's own artifact directory (harness home, tool results) is run-owned
// machinery, not an outside-worktree escape.
{
  const records = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/repo/benchmark/private/runs/run-a1b2/harness-home/tool-results/xyz.txt' } }] } },
  ];
  const scoped = { ...options, ownRunDirectory: '/tmp/repo/benchmark/private/runs/run-a1b2' };
  assert.deepEqual(auditTranscriptRecords(records, scoped).findings, []);
  assert.deepEqual(classes(auditTranscriptRecords(records, options).findings), ['outside-worktree']);
}

// Code and prose fragments that happen to contain slashes are not filesystem
// references. Keep these examples verbatim because they came from real audit
// noise, rather than reducing them to a generic slash fixture.
{
  const nonFindings = [
    's/omitted/p',
    's/coverage/p',
    's/PRISM_WARM_Q8S5_/g',
    's/threaderWeave(bar(1\\.5), 4,/…/',
    '${broodsKilled}/3',
    '6/6',
    'Math.max(0, 4 - hitsTaken)}/4',
    'lock (ion white)/denied (hazard red)/damage-flash',
    'spawn/lock/unlock/fire/hit/…/volley/beat/playerhit',
    "import { EventBus } from '../../events'",
    "import '../timing'",
    "require('../../events')",
  ];
  for (const command of nonFindings) {
    assert.deepEqual(classifyToolCall({ name: 'bash', input: { command } }, options), [], command);
  }

  const substitution = classifyToolCall({
    name: 'bash',
    input: { command: "perl -pi -e 's/needle/\\/home\\/other-run\\/generated/' /tmp/other-worktree/src/generated.ts" },
  }, options);
  assert.deepEqual(paths(substitution), ['/tmp/other-worktree/src/generated.ts']);

  const generatedSource = classifyToolCall({
    name: 'bash',
    input: { command: "cat > generated.ts <<'EOF'\\nconst secret = '/home/other-run/secrets.txt'\\nEOF" },
  }, options);
  assert.deepEqual(generatedSource, []);
}

// Web extraction and self-lookup flagging cover Codex, Claude, and pi. The
// synthetic identity context stands in for the repo config and discovered ids.
{
  const webOptions = {
    ...options,
    selfLookupContext: {
      terms: ['pareto rail', 'github.com', 'paulbatum/pareto-rail'],
      levelIds: ['mass-driver-wo4m'],
      themeIds: ['mass-driver-detailed'],
      assignedThemeId: 'mass-driver-detailed',
    },
  };
  const records = [
    {
      type: 'response_item',
      timestamp: '2026-02-01T00:00:01.000Z',
      payload: { type: 'function_call', name: 'web_search', arguments: JSON.stringify({ query: 'pareto rail prior level discussion' }) },
    },
    {
      type: 'assistant',
      timestamp: '2026-02-01T00:00:02.000Z',
      message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://github.com/paulbatum/pareto-rail' } }] },
    },
    {
      type: 'message',
      timestamp: '2026-02-01T00:00:03.000Z',
      message: { role: 'assistant', content: [{ type: 'toolCall', name: 'search', arguments: { query: 'mass-driver-wo4m implementation' } }] },
    },
  ];
  const result = auditTranscriptRecords(records, webOptions);
  assert.equal(result.webEvents.length, 3);
  assert.deepEqual(classes(result.findings), ['web-self-lookup', 'web-self-lookup', 'web-self-lookup']);
  assert.equal(result.webEvents[0].query, 'pareto rail prior level discussion');
  assert.equal(result.webEvents[1].url, 'https://github.com/paulbatum/pareto-rail');
  assert.equal(verdictFor(result.findings, result.webEvents), 'CONTAMINATED');
}

// A non-self web lookup is reviewable evidence, not an automatic violation.
{
  const record = {
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'curl -L https://example.test/reference' } }] },
  };
  const result = auditTranscriptRecords([record], { ...options, selfLookupContext: { terms: ['pareto rail'] } });
  assert.deepEqual(classes(result.findings), ['web']);
  assert.equal(result.webEvents[0].url, 'https://example.test/reference');
  assert.equal(verdictFor(result.findings, result.webEvents), 'needs-web-review');
}

// A scrubbed baseline holds no other entrant's work, so surveying the monitored roots — or a
// wildcard that can only expand within them — reveals nothing and is not a finding.
{
  const scrubbed = { ...options, baselinePolicy: 'scrubbed' };
  const surveys = [
    'find src/benchmark-levels -maxdepth 2 -type f -print',
    'rg -n "LevelDefinition" src/benchmark-levels',
    'ls public/level-content',
    'cat src/benchmark-levels/*/level.json',
  ];
  for (const command of surveys) {
    assert.deepEqual(classifyToolCall({ name: 'bash', input: { command } }, scrubbed), [], command);
    assert.notDeepEqual(classifyToolCall({ name: 'bash', input: { command } }, options), [], command);
  }

  // Naming another level is still evidence of intent, whether or not the path resolves.
  assert.deepEqual(
    classes(classifyToolCall({ name: 'bash', input: { command: 'cat src/benchmark-levels/other-zz99/gameplay.ts' } }, scrubbed)),
    ['content-read'],
  );
}

// Built-in level content is shared reference material the brief points every entrant at.
{
  const withBuiltIns = { ...options, builtInLevelIds: ['prism-bloom', 'crystal-corridor'] };
  const command = 'cat public/level-content/prism-bloom/level.json';
  assert.deepEqual(classifyToolCall({ name: 'bash', input: { command } }, withBuiltIns), []);
  assert.deepEqual(
    classes(classifyToolCall({ name: 'bash', input: { command: 'cat public/level-content/other-zz99/level.json' } }, withBuiltIns)),
    ['content-read'],
  );
}

console.log('Benchmark contamination tests passed.');
