#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QUOTA_CONTINUATION_MESSAGE, isQuotaError } from './pi-quota-wait-extension.js';

const QUOTA_ERROR = '403: {"message":"You\'ve reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle. To continue now, purchase extra usage or upgrade your plan: https://www.kimi.com/membership/subscription?tab=quota","type":"access_terminated_error"}';
const CONTINUATION = 'You were interrupted by a provider usage limit and have been resumed in the same session. Continue the assignment from where you left off and finish it per the original instructions.';

assert.equal(isQuotaError({ stopReason: 'error', errorMessage: QUOTA_ERROR }), true);
assert.equal(isQuotaError({ stopReason: 'error', errorMessage: '403: temporary upstream failure' }), false);
assert.equal(isQuotaError({ stopReason: 'error', errorMessage: 'Provider usage limit reached without an HTTP status' }), false);
assert.equal(QUOTA_CONTINUATION_MESSAGE, CONTINUATION);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-quota-wait-test-'));
try {
  process.env.PARETO_RAIL_QUOTA_WAIT_DIRECTORY = temporary;
  process.env.PARETO_RAIL_QUOTA_WAIT_MS = '10';
  process.env.PARETO_RAIL_QUOTA_WAIT_MAX = '2';
  const { default: loadPiQuotaWaitExtension } = await import('./pi-quota-wait-extension.js?quota-test');

  let agentEnd;
  const sent = [];
  loadPiQuotaWaitExtension({
    on(event, handler) {
      assert.equal(event, 'agent_end');
      agentEnd = handler;
    },
    async sendMessage(message, options) {
      sent.push({ message, options, sentAt: performance.now() });
    },
  });
  assert.equal(typeof agentEnd, 'function');

  await agentEnd({ messages: [{ role: 'assistant', stopReason: 'error', errorMessage: '500: provider exploded' }] });
  assert.equal(sent.length, 0, 'non-quota errors do not trigger a continuation');

  const startedAt = performance.now();
  await agentEnd({ messages: [{ role: 'assistant', stopReason: 'error', errorMessage: QUOTA_ERROR }] });
  assert.ok(performance.now() - startedAt >= 8, 'quota recovery waits before queueing the continuation');
  await agentEnd({ messages: [{ role: 'assistant', stopReason: 'error', errorMessage: QUOTA_ERROR }] });
  await agentEnd({ messages: [{ role: 'assistant', stopReason: 'error', errorMessage: QUOTA_ERROR }] });

  assert.equal(sent.length, 2, 'the maximum wait cap stops further intervention');
  assert.equal(sent[0].message.content, CONTINUATION);
  assert.equal(sent[0].message.customType, 'pareto-rail-quota-wait');
  assert.equal(sent[0].message.display, true);
  assert.deepEqual(sent[0].options, { deliverAs: 'steer', triggerTurn: true });
  assert.equal(sent[1].message.content, CONTINUATION);

  const lines = (await fs.readFile(path.join(temporary, 'quota-waits.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 4, 'each resumed wait has a detection line and a resume line');
  assert.equal(lines[0].errorMessage, QUOTA_ERROR);
  assert.equal(lines[0].waitMs, 10);
  assert.equal(typeof lines[0].detectedAt, 'string');
  assert.equal(lines[1].attempt, 1);
  assert.equal(typeof lines[1].resumedAt, 'string');
  assert.equal(lines[2].attempt, undefined);
  assert.equal(lines[3].attempt, 2);
} finally {
  delete process.env.PARETO_RAIL_QUOTA_WAIT_DIRECTORY;
  delete process.env.PARETO_RAIL_QUOTA_WAIT_MS;
  delete process.env.PARETO_RAIL_QUOTA_WAIT_MAX;
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log('Benchmark quota-wait tests passed.');
