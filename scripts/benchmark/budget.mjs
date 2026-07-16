import fs from 'node:fs/promises';
import path from 'node:path';

export const NOTICE_STEP_PCT = 25;
export const MINIMUM_SUBMIT_FRACTION = 0.75;
export const MAX_RESUME_ROUNDS = 3;
export const POLL_INTERVAL_MS = 30_000;
export const MINIMUM_RESUME_REMAINING_MS = 10 * 60 * 1_000;

export const BUDGET_PROTOCOL = Object.freeze({
  noticeStepPct: NOTICE_STEP_PCT,
  minimumSubmitFraction: MINIMUM_SUBMIT_FRACTION,
  maxResumeRounds: MAX_RESUME_ROUNDS,
  pollIntervalSeconds: POLL_INTERVAL_MS / 1_000,
  minimumResumeRemainingSeconds: MINIMUM_RESUME_REMAINING_MS / 1_000,
});

export const RESUME_MESSAGE_TEMPLATE = 'Budget check: you have used approximately {pct}% of the task budget, so meaningful budget remains. This is an opportunity to keep improving your level: raise the polish, depth, and quality wherever it falls short of your own standards. Continue working now; you will keep receiving task budget updates as you go.';

export function crossedThreshold(fraction, announcedPct = 0) {
  if (!Number.isFinite(fraction) || fraction < 0) return null;
  const highest = Math.floor((fraction * 100) / NOTICE_STEP_PCT) * NOTICE_STEP_PCT;
  return highest >= NOTICE_STEP_PCT && highest > announcedPct ? highest : null;
}

export function noticeText(pct) {
  if (pct < 100) return `Task budget status: approximately ${pct}% of the task budget has been used.`;
  if (pct === 100) return 'Task budget status: approximately 100% of the task budget has been used. The budget is a guide rather than a hard cap, but you should now be working toward finalizing your submission.';
  return `Task budget status: approximately ${pct}% of the task budget has been used. You are over budget — bring the work to a close and finalize your submission.`;
}

export function approximatePct(fraction) {
  return Math.max(0, Math.round((Number.isFinite(fraction) ? fraction : 0) * 100));
}

export function resumeMessage(fraction) {
  return RESUME_MESSAGE_TEMPLATE.replace('{pct}', String(approximatePct(fraction)));
}

export function shouldResume({ finalFraction, roundsUsed, remainingMs }) {
  return Number.isFinite(finalFraction)
    && finalFraction < MINIMUM_SUBMIT_FRACTION
    && Number.isInteger(roundsUsed)
    && roundsUsed >= 0
    && roundsUsed < MAX_RESUME_ROUNDS
    && (remainingMs === Infinity || (Number.isFinite(remainingMs) && remainingMs >= MINIMUM_RESUME_REMAINING_MS));
}

export function initialSpend(budgetUsd, measuredAt = new Date().toISOString()) {
  return { budgetUsd, spentUsd: 0, fraction: 0, measuredAt };
}

export function initialAnnounced() {
  return { announcedPct: 0, history: [] };
}

export async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

// Readers may run concurrently with hooks and pollers. Rename publishes a complete JSON document;
// it never exposes a partially-written state file.
export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function initializeBudgetDirectory(directory, budgetUsd) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    writeJsonAtomic(path.join(directory, 'spend.json'), initialSpend(budgetUsd)),
    writeJsonAtomic(path.join(directory, 'announced.json'), initialAnnounced()),
  ]);
}

// Claim the highest newly crossed notice threshold and persist it before returning the text to
// inject. Harness hooks and pi extensions share this state transition but wrap the result in their
// own delivery format. Advisory callers should catch errors so corrupt state never stops a run.
export async function claimBudgetNotice(directory) {
  const spendPath = path.join(directory, 'spend.json');
  const announcedPath = path.join(directory, 'announced.json');
  const [spend, announced] = await Promise.all([readJsonFile(spendPath), readJsonFile(announcedPath)]);
  if (!Number.isFinite(spend?.spentUsd) || !Number.isFinite(spend?.fraction)) return null;
  if (!Number.isFinite(announced?.announcedPct) || !Array.isArray(announced?.history)) return null;
  const pct = crossedThreshold(spend.fraction, announced.announcedPct);
  if (pct === null) return null;

  const at = new Date().toISOString();
  await writeJsonAtomic(announcedPath, {
    announcedPct: pct,
    history: [...announced.history, { pct, spentUsd: spend.spentUsd, at }],
  });
  return { pct, text: noticeText(pct) };
}
