import type { ReactNode } from 'react';
import { fmtBytes, fmtClock, fmtTokens } from './format';
import type { AnalysisModel, StreamItem } from './model';
import { AgentChip, AnnotationCard, Expandable, SectionKindChip, agentFor } from './bits';
import type { AnalysisSection, TraceEvent } from './types';

type EventRowProps = {
  item: StreamItem;
  model: AnalysisModel;
  expanded: boolean;
  focused: boolean;
  onToggle: (eventId: string) => void;
  onJumpToEvent: (eventId: string) => void;
  onViewAgent: (agentKey: string) => void;
};

export function StreamRow({ item, model, expanded, focused, onToggle, onJumpToEvent, onViewAgent }: EventRowProps) {
  if (item.type === 'section') return <SectionHeader section={item.section} model={model} onJumpToEvent={onJumpToEvent} />;
  const { event, agentKey, result, annotations } = item;
  const agent = agentFor(model, agentKey);
  return (
    <article className={`event-row kind-${event.kind}${focused ? ' is-focused' : ''}`} id={`event-${event.id}`}>
      <header className="event-row-head">
        <button
          type="button"
          className="event-time"
          title={`${event.id} · ${event.ts}\nClick to focus and link this event`}
          onClick={() => onJumpToEvent(event.id)}
        >
          {fmtClock(event.tSeconds)}
        </button>
        {agent && <AgentChip agent={agent} />}
        <EventSummary event={event} result={result} expanded={expanded} onToggle={onToggle} onViewAgent={onViewAgent} />
      </header>
      {expanded && <EventDetail event={event} result={result} model={model} onViewAgent={onViewAgent} />}
      {annotations.map((annotation) => <AnnotationCard key={annotation.id} annotation={annotation} />)}
    </article>
  );
}

function SectionHeader({ section, model, onJumpToEvent }: { section: AnalysisSection; model: AnalysisModel; onJumpToEvent: (eventId: string) => void }) {
  return (
    <header className="stream-section">
      <div className="stream-section-rule" aria-hidden="true" />
      <div className="stream-section-head">
        <span className="stream-section-time">{fmtClock(section.startSeconds)}–{fmtClock(section.endSeconds)}</span>
        <SectionKindChip kind={section.kind} />
        {section.agents.map((agentKey) => {
          const agent = agentFor(model, agentKey);
          return agent ? <AgentChip key={agentKey} agent={agent} /> : null;
        })}
      </div>
      <h3>{section.title}</h3>
      <p>{section.summary}</p>
      {section.subsections && section.subsections.length > 0 && (
        <div className="stream-subsections">
          {section.subsections.map((subsection) => (
            <button
              key={subsection.id}
              type="button"
              className="stream-subsection"
              title={subsection.summary}
              onClick={() => onJumpToEvent(subsection.startEventId)}
            >
              <span>{fmtClock(subsection.startSeconds)}</span> {subsection.title}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

function EventSummary({
  event,
  result,
  expanded,
  onToggle,
  onViewAgent,
}: {
  event: TraceEvent;
  result?: TraceEvent;
  expanded: boolean;
  onToggle: (eventId: string) => void;
  onViewAgent: (agentKey: string) => void;
}) {
  const toggle = () => onToggle(event.id);
  switch (event.kind) {
    case 'user-message':
      return <ToggleLine onClick={toggle} expanded={expanded} chip="prompt" chipClass="chip-prompt" text={firstLine(event.text)} />;
    case 'thinking':
      return (
        <span className="event-thinking">
          thinking
          {event.usage ? <em> · {fmtTokens(event.usage.outputTokens)} output tok in this turn</em> : null}
        </span>
      );
    case 'assistant-text':
      return <ToggleLine onClick={toggle} expanded={expanded} chip="says" chipClass="chip-says" text={firstLine(event.text)} />;
    case 'tool-call':
      return (
        <ToggleLine
          onClick={toggle}
          expanded={expanded}
          chip={event.tool ?? 'tool'}
          chipClass="chip-tool"
          text={event.summary ?? ''}
          status={result ? (result.isError ? 'error' : 'ok') : undefined}
        />
      );
    case 'tool-result':
      return <ToggleLine onClick={toggle} expanded={expanded} chip="result" chipClass="chip-tool" text={firstLine(event.resultText)} status={event.isError ? 'error' : 'ok'} />;
    case 'subagent-spawn':
      return (
        <span className="event-spawn-line">
          <ToggleLine onClick={toggle} expanded={expanded} chip="spawn agent" chipClass="chip-spawn" text={`${event.description ?? ''} · ${event.model ?? ''}`} />
          {event.agentId && (
            <button type="button" className="event-link" onClick={() => onViewAgent(event.agentId!)}>view lane →</button>
          )}
        </span>
      );
    case 'subagent-result':
      return <ToggleLine onClick={toggle} expanded={expanded} chip="agent done" chipClass="chip-spawn" text={event.summary ?? firstLine(event.resultText)} status={event.status === 'completed' ? 'ok' : 'error'} />;
    default:
      return <span>{event.kind}</span>;
  }
}

function ToggleLine({
  onClick,
  expanded,
  chip,
  chipClass,
  text,
  status,
}: {
  onClick: () => void;
  expanded: boolean;
  chip: string;
  chipClass: string;
  text: string;
  status?: 'ok' | 'error';
}) {
  return (
    <button type="button" className="event-toggle" onClick={onClick} aria-expanded={expanded}>
      <span className={`event-chip ${chipClass}`}>{chip}</span>
      <span className="event-summary-text">{text || '—'}</span>
      {status && <span className={`event-status is-${status}`}>{status === 'ok' ? '✓' : '✕'}</span>}
      <span className="event-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
    </button>
  );
}

function EventDetail({
  event,
  result,
  model,
  onViewAgent,
}: {
  event: TraceEvent;
  result?: TraceEvent;
  model: AnalysisModel;
  onViewAgent: (agentKey: string) => void;
}) {
  switch (event.kind) {
    case 'user-message':
      return <Detail><Expandable text={event.text ?? ''} previewChars={2000} mono={false} /></Detail>;
    case 'assistant-text':
      return <Detail><Expandable text={event.text ?? ''} previewChars={2000} mono={false} /></Detail>;
    case 'tool-call':
      return (
        <Detail>
          {event.inputs && Object.keys(event.inputs).length > 0 && (
            <Expandable label="input" text={JSON.stringify(event.inputs, null, 2)} previewChars={600} />
          )}
          {result && <ResultBlock result={result} />}
          {!result && <p className="event-note">No recorded result for this call.</p>}
        </Detail>
      );
    case 'tool-result':
      return <Detail><ResultBlock result={event} /></Detail>;
    case 'subagent-spawn': {
      const agent = event.agentId ? model.agentByKey.get(event.agentId) : undefined;
      return (
        <Detail>
          <div className="event-facts">
            {event.agentId && <span>agent <code>{event.agentId}</code></span>}
            {event.subagentType && <span>type <code>{event.subagentType}</code></span>}
            {event.model && <span>model <code>{event.model}</code></span>}
            {agent?.header?.durationSeconds !== undefined && <span>ran {fmtClock(agent.header.durationSeconds)}</span>}
            {agent && <span>{agent.eventCount} events</span>}
          </div>
          {event.prompt && <Expandable label="spawning prompt" text={event.prompt} previewChars={500} mono={false} />}
          {event.agentId && (
            <button type="button" className="event-link" onClick={() => onViewAgent(event.agentId!)}>
              View this agent&rsquo;s full timeline →
            </button>
          )}
        </Detail>
      );
    }
    case 'subagent-result':
      return (
        <Detail>
          {event.status && <div className="event-facts"><span>status <code>{event.status}</code></span></div>}
          {event.resultText && <Expandable label="final report" text={event.resultText} previewChars={700} mono={false} />}
        </Detail>
      );
    default:
      return null;
  }
}

function ResultBlock({ result }: { result: TraceEvent }) {
  return (
    <div className={`event-result${result.isError ? ' is-error' : ''}`}>
      <Expandable
        label={result.isError ? 'result · error' : 'result'}
        text={result.resultText ?? ''}
        previewChars={600}
      />
      {result.truncated && result.byteLength !== undefined && (
        <p className="event-note">Payload truncated by the extractor — original size {fmtBytes(result.byteLength)}.</p>
      )}
    </div>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <div className="event-detail">{children}</div>;
}

function firstLine(text: string | undefined): string {
  if (!text) return '';
  const line = text.split('\n', 1)[0];
  return line.length > 220 ? `${line.slice(0, 220)}…` : line;
}
