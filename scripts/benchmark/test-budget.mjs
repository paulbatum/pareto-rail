#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  MINIMUM_RESUME_REMAINING_MS,
  crossedThreshold,
  initialAnnounced,
  initialSpend,
  noticeText,
  readJsonFile,
  resumeMessage,
  shouldResume,
  writeJsonAtomic,
} from './budget.mjs';
import { measureRunCost } from './ccusage-cost.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(ROOT, 'scripts/benchmark/budget-hook.mjs');

assert.equal(crossedThreshold(0.249, 0), null);
assert.equal(crossedThreshold(0.25, 0), 25);
assert.equal(crossedThreshold(0.76, 0), 75, 'a multi-threshold jump announces only the highest crossing');
assert.equal(crossedThreshold(0.76, 75), null);
assert.equal(crossedThreshold(2.51, 75), 250);
assert.equal(crossedThreshold(10.12, 250), 1000, 'the threshold schedule has no upper bound');

assert.equal(noticeText(75), 'Task budget status: approximately 75% of the task budget has been used.');
assert.equal(noticeText(100), 'Task budget status: approximately 100% of the task budget has been used. The budget is a guide rather than a hard cap, but you should now be working toward finalizing your submission.');
assert.equal(noticeText(125), 'Task budget status: approximately 125% of the task budget has been used. You are over budget — bring the work to a close and finalize your submission.');
assert.equal(resumeMessage(0.324), 'Budget check: you have used approximately 32% of the task budget, so meaningful budget remains. This is an opportunity to keep improving your level: raise the polish, depth, and quality wherever it falls short of your own standards. Continue working now; you will keep receiving task budget updates as you go.');

assert.equal(shouldResume({ finalFraction: 0.749, roundsUsed: 0, remainingMs: Infinity }), true);
assert.equal(shouldResume({ finalFraction: 0.75, roundsUsed: 0, remainingMs: Infinity }), false);
assert.equal(shouldResume({ finalFraction: 0.1, roundsUsed: 2, remainingMs: Infinity }), true);
assert.equal(shouldResume({ finalFraction: 0.1, roundsUsed: 3, remainingMs: Infinity }), false);
assert.equal(shouldResume({ finalFraction: 0.1, roundsUsed: 0, remainingMs: MINIMUM_RESUME_REMAINING_MS }), true);
assert.equal(shouldResume({ finalFraction: 0.1, roundsUsed: 0, remainingMs: MINIMUM_RESUME_REMAINING_MS - 1 }), false);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-budget-test-'));
try {
  assert.equal(await measureRunCost({ adapter: 'claude-cli', home: path.join(temporary, 'empty-home'), tolerateEmpty: true }), null);

  const statePath = path.join(temporary, 'state', 'spend.json');
  const spend = initialSpend(20, '2026-01-01T00:00:00.000Z');
  await writeJsonAtomic(statePath, spend);
  assert.deepEqual(await readJsonFile(statePath), spend);
  await Promise.all(Array.from({ length: 20 }, (_, index) => writeJsonAtomic(statePath, { index })));
  const concurrentResult = await readJsonFile(statePath);
  assert.equal(Number.isInteger(concurrentResult.index), true, 'concurrent atomic writes leave one complete JSON value');
  assert.deepEqual((await fs.readdir(path.dirname(statePath))).filter((name) => name.endsWith('.tmp')), []);

  const crossingDirectory = path.join(temporary, 'crossing');
  await fs.mkdir(crossingDirectory);
  await writeJsonAtomic(path.join(crossingDirectory, 'spend.json'), { budgetUsd: 20, spentUsd: 15.2, fraction: 0.76, measuredAt: new Date().toISOString() });
  await writeJsonAtomic(path.join(crossingDirectory, 'announced.json'), initialAnnounced());
  const first = await exec(process.execPath, [HOOK, crossingDirectory]);
  const payload = JSON.parse(first.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(payload.hookSpecificOutput.additionalContext, noticeText(75));
  const announced = await readJsonFile(path.join(crossingDirectory, 'announced.json'));
  assert.equal(announced.announcedPct, 75);
  assert.equal(announced.history.length, 1);
  assert.equal(announced.history[0].pct, 75);
  assert.equal(announced.history[0].spentUsd, 15.2);
  const second = await exec(process.execPath, [HOOK, crossingDirectory]);
  assert.equal(second.stdout, '');

  const missing = await exec(process.execPath, [HOOK, path.join(temporary, 'missing')]);
  assert.equal(missing.stdout, '');
  const corruptDirectory = path.join(temporary, 'corrupt');
  await fs.mkdir(corruptDirectory);
  await fs.writeFile(path.join(corruptDirectory, 'spend.json'), '{broken');
  await writeJsonAtomic(path.join(corruptDirectory, 'announced.json'), initialAnnounced());
  const corrupt = await exec(process.execPath, [HOOK, corruptDirectory]);
  assert.equal(corrupt.stdout, '');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log('Benchmark budget tests passed.');
