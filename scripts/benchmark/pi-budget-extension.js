import { claimBudgetNotice } from './budget.mjs';

const budgetDirectory = process.env.PARETO_RAIL_BUDGET_DIRECTORY;
delete process.env.PARETO_RAIL_BUDGET_DIRECTORY;

// pi has no command-hook configuration file. Its extension event is the equivalent boundary: after
// each tool finishes, claim any threshold published by the controller's ccusage poller and steer the
// notice into the active turn. Serialize parallel tool completions so one process cannot claim the
// same threshold twice.
export default function budgetNotices(pi) {
  let queue = Promise.resolve();

  pi.on('tool_execution_end', async () => {
    queue = queue.then(async () => {
      if (!budgetDirectory) return;
      const notice = await claimBudgetNotice(budgetDirectory);
      if (!notice) return;
      pi.sendMessage({
        customType: 'pareto-rail-task-budget',
        content: notice.text,
        display: true,
      }, { deliverAs: 'steer' });
    }).catch(() => {
      // Notices are advisory. Missing, stale, or corrupt state must never affect the model run.
    });
    await queue;
  });
}
