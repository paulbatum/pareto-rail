import { fmtCount, fmtDuration, fmtTimestamp, fmtTokens, fmtUsd } from './format';
import type { AnalysisModel } from './model';
import { AgentChip } from './bits';

type RunDataViewProps = { model: AnalysisModel };

/** The complete mechanical record: configuration, models, cost and token
 * accounting, gates, subagent roster, final message, and the raw package JSON. */
export function RunDataView({ model }: RunDataViewProps) {
  const { run, trace } = model.pkg;
  const maxCost = Math.max(...run.cost.perModel.map((entry) => entry.costUsd), 0.01);

  return (
    <div className="rundata-view">
      <section>
        <p className="analysis-label">Run identity</p>
        <dl className="run-facts rundata-facts">
          <Fact label="Run id" value={run.runId} />
          <Fact label="Slot" value={run.slotId} />
          <Fact label="Level id" value={run.levelId} />
          <Fact label="Configuration" value={run.configurationId} />
          <Fact label="Theme" value={`${run.theme.id} (${run.theme.path})`} />
          <Fact label="Harness" value={`${run.harness.name} ${run.harness.version}`} />
          <Fact label="Blinded" value={run.blinded ? 'yes' : 'no'} />
          <Fact label="Disposition" value={run.disposition.status + (run.disposition.reason ? ` — ${run.disposition.reason}` : '')} />
          <Fact label="Started" value={fmtTimestamp(run.timing.startedAt)} />
          <Fact label="Finished" value={fmtTimestamp(run.timing.finishedAt)} />
          <Fact label="Wall time" value={fmtDuration(run.timing.wallTimeSeconds)} />
          <Fact label="Turns" value={fmtCount(run.timing.numTurns)} />
          <Fact label="Orchestrator" value={`${run.models.orchestrator}${run.models.orchestratorEffort ? ` · ${run.models.orchestratorEffort} effort` : ''}`} />
          <Fact label="Delegate" value={run.models.delegate ? `${run.models.delegate}${run.models.delegateEffort ? ` · ${run.models.delegateEffort} effort` : ''}` : 'none'} />
          <Fact label="Trace source" value={trace.source} />
          <Fact label="Session" value={trace.sessionId} />
          <Fact label="Extracted" value={fmtTimestamp(trace.generatedAt)} />
          <Fact label="Editorial layer by" value={model.pkg.sections.generatedBy} />
          <Fact label="Cost status" value={`${run.cost.status} (${run.cost.currency})`} />
        </dl>
      </section>

      <section>
        <p className="analysis-label">Cost by model — {fmtUsd(run.cost.totalUsd)} total</p>
        <div className="cost-bars">
          {run.cost.perModel.map((entry) => (
            <div key={entry.modelName} className="cost-bar-row">
              <span className="cost-bar-name">{entry.modelName}</span>
              <span className="cost-bar-track">
                <span className="cost-bar-fill" style={{ width: `${(entry.costUsd / maxCost) * 100}%` }} />
              </span>
              <span className="cost-bar-value">{fmtUsd(entry.costUsd)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="analysis-label">Token accounting — every model billed</p>
        <div className="token-table-wrap">
          <table className="token-table">
            <thead>
              <tr><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {Object.entries(run.tokenTotals).map(([key, totals]) => (
                <tr key={key}>
                  <th scope="row"><code>{key}</code></th>
                  <td title={fmtCount(totals.inputTokens)}>{fmtTokens(totals.inputTokens)}</td>
                  <td title={fmtCount(totals.outputTokens)}>{fmtTokens(totals.outputTokens)}</td>
                  <td title={fmtCount(totals.cacheReadInputTokens)}>{fmtTokens(totals.cacheReadInputTokens)}</td>
                  <td title={fmtCount(totals.cacheCreationInputTokens)}>{fmtTokens(totals.cacheCreationInputTokens)}</td>
                  <td>{fmtUsd(totals.costUSD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="analysis-help">Hover a figure for the exact count. Cache reads dominate under aggressive prompt caching.</p>
      </section>

      <section>
        <p className="analysis-label">Gates</p>
        <div className="token-table-wrap">
          <table className="token-table gates-table">
            <thead><tr><th>Gate</th><th>Command</th><th>Status</th><th>Exit</th><th>Time</th></tr></thead>
            <tbody>
              {run.gates.map((gate) => (
                <tr key={gate.id}>
                  <th scope="row">{gate.id}</th>
                  <td><code>{gate.command}</code></td>
                  <td className={gate.status === 'passed' ? 'is-pass' : 'is-fail'}>{gate.status}</td>
                  <td>{gate.exitCode ?? '—'}</td>
                  <td>{gate.wallTimeSeconds != null ? fmtDuration(gate.wallTimeSeconds) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="analysis-label">Agent roster</p>
        <div className="roster">
          {model.agents.map((agent) => (
            <div key={agent.key} className="roster-row">
              <AgentChip agent={agent} />
              <span className="roster-desc">{agent.label}</span>
              <span className="roster-meta">
                {agent.eventCount} events
                {agent.header?.durationSeconds !== undefined && ` · ran ${fmtDuration(agent.header.durationSeconds)}`}
                {agent.header?.usage && ` · ${fmtTokens(agent.header.usage.outputTokens)} output tok`}
                {agent.header && ` · depth ${agent.header.spawnDepth} · ${agent.header.agentType}`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="analysis-label">Agent&rsquo;s final message</p>
        <blockquote className="rundata-final-message">{run.finalMessage}</blockquote>
      </section>

      <section>
        <p className="analysis-label">Raw package files</p>
        <p className="analysis-help">The complete JSON of every file in this analysis package, verbatim.</p>
        <div className="catalog-disclosures rundata-raw">
          <RawFile name="run.json" value={model.pkg.run} />
          <RawFile name="sections.json" value={model.pkg.sections} />
          <RawFile name="annotations.json" value={model.pkg.annotations} />
          <RawFile name="narrative.json" value={model.pkg.narrative} />
          <RawFile name="files.json" value={model.pkg.files} />
          <RawFile name="snapshot-moments.json" value={model.pkg.snapshotMoments} />
          <RawFile name="snapshots.json" value={model.pkg.snapshots} />
          <RawFile name="trace.json" value={model.pkg.trace} note="368+ events — large" />
          {model.pkg.subagents.map((subagent) => (
            <RawFile key={subagent.header.agentId} name={`subagents/agent-${subagent.header.agentId}.json`} value={subagent} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function RawFile({ name, value, note }: { name: string; value: unknown; note?: string }) {
  return (
    <details>
      <summary><span>{name}</span>{note && <small>{note}</small>}</summary>
      <div className="catalog-disclosure-body">
        <pre className="catalog-raw">{JSON.stringify(value, null, 2)}</pre>
      </div>
    </details>
  );
}
