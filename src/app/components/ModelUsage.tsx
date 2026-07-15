import type { BenchmarkModelUsage } from '../../benchmark/types';

/** Every token the model read, however it was billed.  The raw `inputTokens` field counts
 * only the uncached remainder, which is near-zero under aggressive prompt caching and is not
 * comparable between harnesses: a first-sight token is billed as cache creation on one and as
 * ordinary input on the other.  The sum is the same quantity on both. */
export function totalInputTokens(model: BenchmarkModelUsage): number {
  return model.inputTokens + (model.cacheReadTokens ?? 0) + (model.cacheWriteTokens ?? 0);
}

/** `showRole` is the caller's model count: a role tells the reader which model did
 * what, so it says nothing when there is only one model to attribute work to. */
export function ModelUsage({ model, showRole }: { model: BenchmarkModelUsage; showRole: boolean }) {
  const total = totalInputTokens(model);
  const cacheRead = model.cacheReadTokens ?? 0;
  return (
    <div className="model-usage">
      <header>
        <span><strong>{model.modelName}</strong>{showRole && <small>{model.role}</small>}</span>
        <span>{model.costUsd === undefined ? 'Per-model cost unavailable' : `$${model.costUsd.toFixed(2)}`}</span>
      </header>
      <dl>
        <UsageCell label="Total input" value={count(total)} title={inputBreakdown(model)} />
        <UsageCell label="Cached" value={total === 0 ? '—' : `${((cacheRead / total) * 100).toFixed(1)}%`} title={`${count(cacheRead)} of ${count(total)} input tokens served from cache`} />
        <UsageCell label="Output" value={count(model.outputTokens)} title="Includes reasoning tokens" />
      </dl>
    </div>
  );
}

// Zero cache traffic is omitted rather than shown: a harness without an explicit cache-write step
// reports no writes at all, and a literal 0 reads as a measurement instead of an absent concept.
function inputBreakdown(model: BenchmarkModelUsage): string {
  const parts = [`${count(model.inputTokens)} new`];
  if (model.cacheWriteTokens) parts.push(`${count(model.cacheWriteTokens)} cache write`);
  if (model.cacheReadTokens) parts.push(`${count(model.cacheReadTokens)} cache read`);
  return parts.join(' + ');
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function UsageCell({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div><dt>{label}</dt><dd title={title}>{value}</dd></div>;
}
