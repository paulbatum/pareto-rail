import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_WAIT_MS = 900_000;
const DEFAULT_MAX_WAITS = 50;

const quotaDirectory = process.env.PARETO_RAIL_QUOTA_WAIT_DIRECTORY;
const waitMs = readNonNegativeInteger('PARETO_RAIL_QUOTA_WAIT_MS', DEFAULT_WAIT_MS);
const maxWaits = readNonNegativeInteger('PARETO_RAIL_QUOTA_WAIT_MAX', DEFAULT_MAX_WAITS);
delete process.env.PARETO_RAIL_QUOTA_WAIT_DIRECTORY;
delete process.env.PARETO_RAIL_QUOTA_WAIT_MS;
delete process.env.PARETO_RAIL_QUOTA_WAIT_MAX;

export const QUOTA_CONTINUATION_MESSAGE = 'You were interrupted by a provider usage limit and have been resumed in the same session. Continue the assignment from where you left off and finish it per the original instructions.';

export function isQuotaError(message) {
  if (message?.stopReason !== 'error' || typeof message.errorMessage !== 'string') return false;
  return /access_terminated_error/i.test(message.errorMessage)
    || (/403/i.test(message.errorMessage) && /usage limit/i.test(message.errorMessage));
}

export default function quotaWait(pi) {
  let attempts = 0;

  pi.on('agent_end', async (event) => {
    const messages = event?.messages ?? [];
    let lastAssistant;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        lastAssistant = messages[index];
        break;
      }
    }
    if (!isQuotaError(lastAssistant) || !quotaDirectory || attempts >= maxWaits) return;

    const attempt = attempts + 1;
    attempts = attempt;
    const errorMessage = lastAssistant.errorMessage;
    await writeRecord({
      detectedAt: new Date().toISOString(),
      errorMessage,
      waitMs,
    });
    await sleep(waitMs);

    // This call is deliberately not hidden behind the state writer. Queueing is the recovery path;
    // only the optional artifact write is allowed to fail without affecting the model run.
    await pi.sendMessage({
      customType: 'pareto-rail-quota-wait',
      content: QUOTA_CONTINUATION_MESSAGE,
      display: true,
    }, { deliverAs: 'steer', triggerTurn: true });
    await writeRecord({
      resumedAt: new Date().toISOString(),
      attempt,
    });
  });
}

async function writeRecord(record) {
  if (!quotaDirectory) return;
  try {
    await fs.appendFile(path.join(quotaDirectory, 'quota-waits.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // The wait log is diagnostic state. Its failure must not prevent the in-process continuation.
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function readNonNegativeInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
