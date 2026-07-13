#!/usr/bin/env node
import path from 'node:path';
import { crossedThreshold, noticeText, readJsonFile, writeJsonAtomic } from './budget.mjs';

async function run(directory) {
  if (!directory) return;
  const spendPath = path.join(directory, 'spend.json');
  const announcedPath = path.join(directory, 'announced.json');
  const [spend, announced] = await Promise.all([readJsonFile(spendPath), readJsonFile(announcedPath)]);
  if (!Number.isFinite(spend?.spentUsd) || !Number.isFinite(spend?.fraction)) return;
  if (!Number.isFinite(announced?.announcedPct) || !Array.isArray(announced?.history)) return;
  const pct = crossedThreshold(spend.fraction, announced.announcedPct);
  if (pct === null) return;

  const at = new Date().toISOString();
  await writeJsonAtomic(announcedPath, {
    announcedPct: pct,
    history: [...announced.history, { pct, spentUsd: spend.spentUsd, at }],
  });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: noticeText(pct),
      hookEventName: 'PostToolUse',
    },
  }));
}

// A notice is advisory. Missing, stale, corrupt, or concurrently-replaced state must never affect
// the harness process that invoked this hook.
run(process.argv[2]).catch(() => {});
