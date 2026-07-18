/**
 * Derived, cross-referenced view of an analysis package. Everything in the
 * package joins on event ids (`ev-NNNN` main, `<agent8>-ev-NNNN` subagent), so
 * this module builds the lookup tables the views navigate with.
 */
import type {
  AnalysisAnnotation,
  AnalysisPackage,
  AnalysisSection,
  SubagentTranscript,
  TraceEvent,
  TraceEventKind,
} from './types';

export const MAIN_AGENT_KEY = 'main';

export type AgentInfo = {
  /** `main`, or the full subagent id — the key used by every package file. */
  key: string;
  /** Categorical color slot; 0 is always the orchestrator. */
  colorIndex: number;
  label: string;
  /** One distinctive word (e.g. `gameplay`) for chips and lane labels. */
  shortLabel: string;
  model: string;
  description?: string;
  header?: SubagentTranscript['header'];
  firstEventT: number;
  lastEventT: number;
  eventCount: number;
};

export type EventRef = { event: TraceEvent; agentKey: string };

export type StreamItem =
  | { type: 'section'; section: AnalysisSection }
  | {
      type: 'event';
      event: TraceEvent;
      agentKey: string;
      /** tool-result paired to this tool-call, folded into the same row. */
      result?: TraceEvent;
      annotations: AnalysisAnnotation[];
    };

export type AnalysisModel = {
  pkg: AnalysisPackage;
  agents: AgentInfo[];
  agentByKey: Map<string, AgentInfo>;
  /** Full-id agent lookup by the 8-char prefix used in cross-file event ids. */
  eventIndex: Map<string, EventRef>;
  annotationsByEventId: Map<string, AnalysisAnnotation[]>;
  /** All events across every transcript, ordered by run clock. */
  merged: EventRef[];
  durationSeconds: number;
};

export function buildAnalysisModel(pkg: AnalysisPackage): AnalysisModel {
  const agents: AgentInfo[] = [];
  const agentByKey = new Map<string, AgentInfo>();
  const eventIndex = new Map<string, EventRef>();
  const merged: EventRef[] = [];

  const register = (key: string, events: TraceEvent[], info: Omit<AgentInfo, 'key' | 'firstEventT' | 'lastEventT' | 'eventCount'>) => {
    const agent: AgentInfo = {
      key,
      ...info,
      firstEventT: events.length ? events[0].tSeconds : 0,
      lastEventT: events.length ? events[events.length - 1].tSeconds : 0,
      eventCount: events.length,
    };
    agents.push(agent);
    agentByKey.set(key, agent);
    for (const event of events) {
      eventIndex.set(event.id, { event, agentKey: key });
      merged.push({ event, agentKey: key });
    }
  };

  register(MAIN_AGENT_KEY, pkg.trace.events, {
    colorIndex: 0,
    label: `Orchestrator · ${pkg.run.models.orchestrator}`,
    shortLabel: 'main',
    model: pkg.run.models.orchestrator,
  });

  const titleWords = new Set(pkg.run.levelTitle.toLowerCase().split(/\s+/));
  pkg.subagents.forEach((subagent, index) => {
    register(subagent.header.agentId, subagent.events, {
      colorIndex: (index % 3) + 1,
      label: subagent.header.description,
      shortLabel: distinctiveWord(subagent.header.description, titleWords) ?? `agent ${index + 1}`,
      model: subagent.header.model,
      description: subagent.header.description,
      header: subagent.header,
    });
  });

  merged.sort((a, b) => a.event.tSeconds - b.event.tSeconds || a.event.id.localeCompare(b.event.id));

  const annotationsByEventId = new Map<string, AnalysisAnnotation[]>();
  for (const annotation of pkg.annotations.annotations) {
    const list = annotationsByEventId.get(annotation.eventId) ?? [];
    list.push(annotation);
    annotationsByEventId.set(annotation.eventId, list);
  }

  const lastEventT = merged.length ? merged[merged.length - 1].event.tSeconds : 0;
  return {
    pkg,
    agents,
    agentByKey,
    eventIndex,
    annotationsByEventId,
    merged,
    durationSeconds: Math.max(pkg.run.timing.wallTimeSeconds, lastEventT),
  };
}

/** `Build Mass Driver gameplay module` → `gameplay`. */
function distinctiveWord(description: string, titleWords: Set<string>): string | undefined {
  const stop = new Set(['build', 'the', 'a', 'an', 'and', 'for', 'module', 'modules', 'level', 'mass']);
  const words = description
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((word) => word.length > 1 && !stop.has(word) && !titleWords.has(word));
  return words[0];
}

export type StreamFilter = {
  agentKey?: string;
  kinds?: Set<TraceEventKind>;
  query?: string;
};

/**
 * The chronological reading order for the timeline: section markers interleaved
 * with events, tool results folded into their calls. Filtering re-slots the
 * section markers so a chapter header always precedes its first visible event.
 */
export function buildStream(model: AnalysisModel, filter: StreamFilter = {}): StreamItem[] {
  const paired = new Set<string>();
  const resultByToolUseId = new Map<string, TraceEvent>();
  for (const { event } of model.merged) {
    if (event.kind === 'tool-result' && event.toolUseId) resultByToolUseId.set(event.toolUseId, event);
  }
  for (const { event } of model.merged) {
    if (event.kind === 'tool-call' && event.toolUseId) {
      const result = resultByToolUseId.get(event.toolUseId);
      if (result) paired.add(result.id);
    }
  }

  const query = filter.query?.trim().toLowerCase();
  const events = model.merged.filter(({ event, agentKey }) => {
    if (event.kind === 'tool-result' && paired.has(event.id)) return false;
    if (filter.agentKey && agentKey !== filter.agentKey) return false;
    if (filter.kinds && !filter.kinds.has(event.kind)) return false;
    if (query && !eventMatches(model, event, query)) return false;
    return true;
  });

  const sections = [...model.pkg.sections.sections].sort((a, b) => a.startSeconds - b.startSeconds);
  const items: StreamItem[] = [];
  let sectionCursor = 0;
  for (const { event, agentKey } of events) {
    while (sectionCursor < sections.length && event.tSeconds >= sections[sectionCursor].startSeconds) {
      items.push({ type: 'section', section: sections[sectionCursor] });
      sectionCursor += 1;
    }
    const result = event.kind === 'tool-call' && event.toolUseId ? resultByToolUseId.get(event.toolUseId) : undefined;
    items.push({ type: 'event', event, agentKey, result, annotations: model.annotationsByEventId.get(event.id) ?? [] });
  }
  while (sectionCursor < sections.length) {
    items.push({ type: 'section', section: sections[sectionCursor] });
    sectionCursor += 1;
  }
  return items;
}

function eventMatches(model: AnalysisModel, event: TraceEvent, query: string): boolean {
  const parts = [event.summary, event.text, event.tool, event.description, event.resultText, event.prompt];
  for (const annotation of model.annotationsByEventId.get(event.id) ?? []) {
    parts.push(annotation.title, annotation.body);
  }
  return parts.some((part) => part !== undefined && part.toLowerCase().includes(query));
}

/** Annotation types grouped into display tones; every marker also carries its
 * type label, so tone is never the only carrier. */
export const ANNOTATION_TONES: Record<string, 'caution' | 'good' | 'accent' | 'neutral'> = {
  mistake: 'caution',
  'quality-flag': 'caution',
  budget: 'caution',
  recovery: 'good',
  fix: 'good',
  verification: 'good',
  milestone: 'accent',
  screenshot: 'accent',
  delegation: 'accent',
  decision: 'neutral',
  insight: 'neutral',
  polish: 'neutral',
};

export function annotationTone(type: string): 'caution' | 'good' | 'accent' | 'neutral' {
  return ANNOTATION_TONES[type] ?? 'neutral';
}
