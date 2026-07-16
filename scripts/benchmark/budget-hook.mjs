#!/usr/bin/env node
import { claimBudgetNotice } from './budget.mjs';

async function run(directory) {
  if (!directory) return;
  const notice = await claimBudgetNotice(directory);
  if (!notice) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: notice.text,
      hookEventName: 'PostToolUse',
    },
  }));
}

// A notice is advisory. Missing, stale, corrupt, or concurrently-replaced state must never affect
// the harness process that invoked this hook.
run(process.argv[2]).catch(() => {});
