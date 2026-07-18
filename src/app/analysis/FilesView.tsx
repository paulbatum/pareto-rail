import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtBytes, fmtClock } from './format';
import type { AnalysisModel } from './model';
import { AgentChip, agentFor } from './bits';
import type { AnalysisFileHistory, FileEdit } from './types';

type FilesViewProps = { model: AnalysisModel; onJumpToEvent: (eventId: string) => void };

/** Per-file edit history: when every file was created and touched, by which
 * agent, plus what reached the evaluated payload. */
export function FilesView({ model, onJumpToEvent }: FilesViewProps) {
  const files = useMemo(
    () => [...model.pkg.files.files].sort((a, b) => a.firstTouchedTSeconds - b.firstTouchedTSeconds),
    [model],
  );
  const payloadByFile = useMemo(
    () => new Map(model.pkg.files.finalPayloadFiles.map((entry) => [entry.file, entry.status])),
    [model],
  );
  const trackedFiles = useMemo(() => new Set(files.map((entry) => entry.file)), [files]);
  const payloadOnly = model.pkg.files.finalPayloadFiles.filter((entry) => !trackedFiles.has(entry.file));

  return (
    <div className="files-view">
      <div className="event-facts files-facts">
        <span>entrant baseline <code>{model.pkg.files.entrantBaseline.slice(0, 12)}</code></span>
        <span>evaluated commit <code>{model.pkg.files.evaluatedCommit.slice(0, 12)}</code></span>
        <span>{files.length} files touched</span>
        <span>{model.pkg.files.finalPayloadFiles.length} in final payload</span>
      </div>

      <p className="analysis-label">Edit map</p>
      <p className="analysis-help">
        Each row is a file; marks are edit operations on the run clock, colored by the agent that made them.
        Squares are full writes, ticks are edits. Click any mark to open that moment in the timeline.
      </p>
      <EditMap model={model} files={files} onJumpToEvent={onJumpToEvent} />

      <p className="analysis-label">File records</p>
      <div className="files-table" role="table" aria-label="Per-file edit history">
        <div className="files-table-head" role="row">
          <span role="columnheader">File</span>
          <span role="columnheader">Payload</span>
          <span role="columnheader">Edits</span>
          <span role="columnheader">Agents</span>
          <span role="columnheader">Active window</span>
        </div>
        {files.map((file) => (
          <FileRecord
            key={file.file}
            model={model}
            file={file}
            payloadStatus={payloadByFile.get(file.file)}
            onJumpToEvent={onJumpToEvent}
          />
        ))}
      </div>

      {payloadOnly.length > 0 && (
        <>
          <p className="analysis-label">In final payload without a recorded edit history</p>
          <ul className="files-payload-only">
            {payloadOnly.map((entry) => (
              <li key={entry.file}><code>{entry.file}</code> <span className="payload-tag">{payloadStatusLabel(entry.status)}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const MAP_GUTTER = 250;
const MAP_ROW_H = 24;
const MAP_AXIS_H = 22;

function EditMap({ model, files, onJumpToEvent }: { model: AnalysisModel; files: AnalysisFileHistory[]; onJumpToEvent: (eventId: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const duration = model.durationSeconds;
  const plotW = Math.max(0, width - MAP_GUTTER - 12);
  const x = (t: number) => MAP_GUTTER + (Math.min(t, duration) / duration) * plotW;
  const height = files.length * MAP_ROW_H + MAP_AXIS_H;
  const ticks = useMemo(() => {
    const step = duration > 4200 ? 900 : duration > 1800 ? 600 : 300;
    const list: number[] = [];
    for (let t = 0; t <= duration; t += step) list.push(t);
    return list;
  }, [duration]);

  return (
    <div className="edit-map" ref={wrapRef}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="File edit map">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={height - MAP_AXIS_H} className="strip-grid" />
              <text x={x(t)} y={height - 7} className="strip-axis-label" textAnchor="middle">{fmtClock(t)}</text>
            </g>
          ))}
          {files.map((file, rowIndex) => {
            const yMid = rowIndex * MAP_ROW_H + MAP_ROW_H / 2;
            return (
              <g key={file.file}>
                <text x={MAP_GUTTER - 10} y={yMid + 3} className="strip-label" textAnchor="end">
                  <title>{file.file}</title>
                  {shortFileName(file.file, model.pkg.run.levelId)}
                </text>
                <line
                  x1={x(file.firstTouchedTSeconds)}
                  x2={x(file.lastTouchedTSeconds)}
                  y1={yMid}
                  y2={yMid}
                  className={`edit-map-span${file.inFinalPayload ? '' : ' is-dropped'}`}
                />
                {file.history.map((edit) => {
                  const agent = agentFor(model, edit.agent);
                  const color = `var(--an-agent-${agent?.colorIndex ?? 0})`;
                  const isWrite = edit.operation === 'write';
                  return (
                    <g key={edit.eventId} className="strip-tick" onClick={() => onJumpToEvent(edit.eventId)}>
                      <title>{`${edit.operation} · ${fmtClock(edit.tSeconds)} · ${agent?.shortLabel ?? edit.agent} · ${deltaLabel(edit)}`}</title>
                      <rect x={x(edit.tSeconds) - 4} y={yMid - 9} width={8} height={18} className="strip-hit" />
                      {isWrite
                        ? <rect x={x(edit.tSeconds) - 3.5} y={yMid - 3.5} width={7} height={7} style={{ fill: color }} />
                        : <rect x={x(edit.tSeconds) - 1} y={yMid - 5} width={2} height={10} style={{ fill: color }} />}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function FileRecord({
  model,
  file,
  payloadStatus,
  onJumpToEvent,
}: {
  model: AnalysisModel;
  file: AnalysisFileHistory;
  payloadStatus: string | undefined;
  onJumpToEvent: (eventId: string) => void;
}) {
  return (
    <details className="files-record">
      <summary role="row">
        <span role="cell" className="files-record-name"><code>{file.file}</code></span>
        <span role="cell">
          {file.inFinalPayload
            ? <span className="payload-tag">{payloadStatusLabel(payloadStatus)}</span>
            : <span className="payload-tag is-dropped">not shipped</span>}
        </span>
        <span role="cell">{file.editCount}</span>
        <span role="cell" className="files-record-agents">
          {file.agents.map((agentKey) => {
            const agent = agentFor(model, agentKey);
            return agent ? <AgentChip key={agentKey} agent={agent} /> : <code key={agentKey}>{agentKey}</code>;
          })}
        </span>
        <span role="cell">{fmtClock(file.firstTouchedTSeconds)} → {fmtClock(file.lastTouchedTSeconds)}</span>
      </summary>
      <ol className="files-history">
        {file.history.map((edit) => {
          const agent = agentFor(model, edit.agent);
          return (
            <li key={edit.eventId}>
              <button type="button" className="event-link" onClick={() => onJumpToEvent(edit.eventId)}>{fmtClock(edit.tSeconds)}</button>
              <span className="files-history-op">{edit.operation}</span>
              {agent && <AgentChip agent={agent} />}
              <span className="files-history-delta">{deltaLabel(edit)}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Git status letters from the payload diff, spelled out. */
function payloadStatusLabel(status: string | undefined): string {
  if (!status) return 'in payload';
  const map: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' };
  return map[status] ?? status;
}

function deltaLabel(edit: FileEdit): string {
  const delta = edit.deltaSummary;
  if (delta.lines != null || delta.bytes != null) {
    const parts: string[] = [];
    if (delta.lines != null) parts.push(`${delta.lines} lines`);
    if (delta.bytes != null) parts.push(fmtBytes(delta.bytes));
    return parts.join(' · ');
  }
  if (delta.added != null || delta.removed != null) return `+${delta.added ?? '?'} / −${delta.removed ?? '?'}`;
  return 'delta unrecorded';
}

function shortFileName(file: string, levelId: string): string {
  const prefix = `src/levels/${levelId}/`;
  const short = file.startsWith(prefix) ? file.slice(prefix.length) : file;
  return short.length > 34 ? `…${short.slice(-33)}` : short;
}
