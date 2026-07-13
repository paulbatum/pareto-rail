import fs from 'node:fs/promises';
import path from 'node:path';
import { measureRunCost } from './ccusage-cost.mjs';
import { BUDGET_PROTOCOL, initialAnnounced, initialSpend, readJsonFile, writeJsonAtomic } from './budget.mjs';
import { fail } from './common.mjs';

export function parseBudgetUsd(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!(parsed > 0) || !Number.isFinite(parsed)) fail('--budget-usd must be a positive finite number.');
  return parsed;
}

export function startBudgetPoller({ adapter, home, budgetDirectory, budgetUsd, intervalMs }) {
  let pending;
  const refresh = async () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const cost = await measureRunCost({ adapter, home, tolerateEmpty: true });
        if (!cost) return readSpend(budgetDirectory, budgetUsd);
        const spend = {
          budgetUsd,
          spentUsd: cost.totalUsd,
          fraction: cost.totalUsd / budgetUsd,
          measuredAt: new Date().toISOString(),
        };
        await writeJsonAtomic(path.join(budgetDirectory, 'spend.json'), spend);
        return spend;
      } catch {
        // Polling and state publication are advisory. Keep the last complete state on any failure.
        return readSpend(budgetDirectory, budgetUsd);
      }
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
  const timer = setInterval(() => { void refresh(); }, intervalMs);
  timer.unref();
  return {
    refresh,
    stop() {
      clearInterval(timer);
    },
  };
}

export async function readSpend(directory, budgetUsd) {
  try {
    const spend = await readJsonFile(path.join(directory, 'spend.json'));
    if (Number.isFinite(spend?.spentUsd) && Number.isFinite(spend?.fraction)) return spend;
  } catch {}
  return initialSpend(budgetUsd);
}

export async function writeBudgetSummary({ outputDirectory, budgetDirectory, budgetUsd, resumes, finalSpend }) {
  let announced = initialAnnounced();
  try {
    const value = await readJsonFile(path.join(budgetDirectory, 'announced.json'));
    if (Number.isFinite(value?.announcedPct) && Array.isArray(value?.history)) announced = value;
  } catch {}
  const summary = {
    budgetUsd,
    protocol: BUDGET_PROTOCOL,
    noticeHistory: announced.history,
    resumes,
    finalSpendUsd: finalSpend.spentUsd,
    finalFraction: finalSpend.fraction,
  };
  await writeJsonAtomic(path.join(outputDirectory, 'budget.json'), summary);
  return summary;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export async function copyLastMessage(source, destination) {
  const content = await fs.readFile(source, 'utf8');
  await fs.writeFile(destination, content, 'utf8');
}
