import { useState, type ReactNode } from 'react';
import { fmtClock } from './format';
import { annotationTone, type AgentInfo, type AnalysisModel } from './model';
import type { AnalysisAnnotation } from './types';

/** Colored identity chip for an agent lane. Color always rides with the name,
 * so lane identity is never carried by color alone. */
export function AgentChip({ agent, title }: { agent: AgentInfo; title?: string }) {
  return (
    <span className="agent-chip" data-agent-color={agent.colorIndex} title={title ?? agent.label}>
      <span className="agent-chip-dot" aria-hidden="true" />
      {agent.shortLabel}
    </span>
  );
}

export function agentFor(model: AnalysisModel, key: string): AgentInfo | undefined {
  return model.agentByKey.get(key);
}

/** Pointwise editorial callout, rendered attached to its event. */
export function AnnotationCard({ annotation, clock }: { annotation: AnalysisAnnotation; clock?: boolean }) {
  return (
    <aside className={`annotation-card tone-${annotationTone(annotation.type)}`}>
      <header>
        <span className="annotation-type">{annotation.type}</span>
        <strong>{annotation.title}</strong>
        {clock && <span className="annotation-clock">{fmtClock(annotation.tSeconds)}</span>}
      </header>
      <p>{annotation.body}</p>
    </aside>
  );
}

/** Long text collapsed behind a measured preview; used for prompts, tool
 * results, and agent reports. */
export function Expandable({
  text,
  previewChars = 280,
  label,
  mono = true,
}: {
  text: string;
  previewChars?: number;
  label?: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const needsToggle = text.length > previewChars + 80;
  const shown = open || !needsToggle ? text : `${text.slice(0, previewChars).trimEnd()}…`;
  return (
    <div className={`expandable${mono ? ' is-mono' : ''}`}>
      {label && <span className="expandable-label">{label}</span>}
      <pre>{shown}</pre>
      {needsToggle && (
        <button type="button" className="expandable-toggle" onClick={() => setOpen(!open)}>
          {open ? 'Collapse' : `Show all · ${text.length.toLocaleString('en-US')} chars`}
        </button>
      )}
    </div>
  );
}

export function SectionKindChip({ kind }: { kind: string }) {
  return <span className="section-kind-chip" data-kind={kind}>{kind}</span>;
}

export function MetaRow({ children }: { children: ReactNode }) {
  return <div className="analysis-meta-row">{children}</div>;
}
