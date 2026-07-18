import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EventFocus } from './AnalysisPage';
import { fmtClock, fmtCount } from './format';
import { buildStream, MAIN_AGENT_KEY, type AnalysisModel, type StreamItem } from './model';
import { StreamRow } from './EventRow';
import { TimelineStrip } from './TimelineStrip';
import type { TraceEventKind } from './types';

const KIND_GROUPS: { id: string; label: string; kinds: TraceEventKind[] }[] = [
  { id: 'prose', label: 'Prose', kinds: ['user-message', 'assistant-text'] },
  { id: 'thinking', label: 'Thinking', kinds: ['thinking'] },
  { id: 'tools', label: 'Tool calls', kinds: ['tool-call', 'tool-result'] },
  { id: 'delegation', label: 'Delegation', kinds: ['subagent-spawn', 'subagent-result'] },
];
const ALL_KINDS = new Set<TraceEventKind>(KIND_GROUPS.flatMap((group) => group.kinds));

type TimelineViewProps = {
  model: AnalysisModel;
  focus: EventFocus | null;
  onJumpToEvent: (eventId: string) => void;
};

export function TimelineView({ model, focus, onJumpToEvent }: TimelineViewProps) {
  const [agentKey, setAgentKey] = useState<string | undefined>(undefined);
  const [kinds, setKinds] = useState<Set<TraceEventKind>>(ALL_KINDS);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => buildStream(model, { agentKey, kinds, query }),
    [model, agentKey, kinds, query],
  );
  const eventRowCount = useMemo(() => items.filter((item) => item.type === 'event').length, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateHeight(items[index]),
    overscan: 12,
    getItemKey: (index) => itemKey(items[index]),
  });

  const toggleExpanded = (eventId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const viewAgent = (key: string) => {
    setAgentKey(key);
    setQuery('');
    setKinds(ALL_KINDS);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // Seek the stream to a focused event. If the current filters hide it, relax
  // them first; the effect re-runs once the wider item list lands.
  useEffect(() => {
    if (!focus) return;
    const index = items.findIndex((item) => item.type === 'event' && item.event.id === focus.eventId);
    if (index === -1) {
      const exists = model.eventIndex.has(focus.eventId);
      if (exists && (agentKey !== undefined || query !== '' || kinds.size !== ALL_KINDS.size)) {
        setAgentKey(undefined);
        setQuery('');
        setKinds(ALL_KINDS);
      }
      return;
    }
    setExpanded((current) => (current.has(focus.eventId) ? current : new Set(current).add(focus.eventId)));
    virtualizer.scrollToIndex(index, { align: 'center' });
    // Dynamic row heights settle after the first paint; re-seek once.
    const raf = requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, items]);

  const focusEvent = focus ? model.eventIndex.get(focus.eventId) : undefined;

  return (
    <div className="timeline-view">
      <TimelineStrip model={model} focusT={focusEvent ? focusEvent.event.tSeconds : null} onJumpToEvent={onJumpToEvent} />

      <div className="timeline-filters">
        <div className="timeline-filter-group" role="group" aria-label="Filter by agent">
          <FilterChip active={agentKey === undefined} onClick={() => setAgentKey(undefined)}>All agents</FilterChip>
          {model.agents.map((agent) => (
            <FilterChip
              key={agent.key}
              active={agentKey === agent.key}
              colorIndex={agent.colorIndex}
              onClick={() => setAgentKey(agentKey === agent.key ? undefined : agent.key)}
            >
              {agent.shortLabel}
            </FilterChip>
          ))}
        </div>
        <div className="timeline-filter-group" role="group" aria-label="Filter by event kind">
          {KIND_GROUPS.map((group) => {
            const active = group.kinds.every((kind) => kinds.has(kind));
            return (
              <FilterChip
                key={group.id}
                active={active}
                onClick={() => {
                  setKinds((current) => {
                    const next = new Set(current);
                    for (const kind of group.kinds) {
                      if (active) next.delete(kind);
                      else next.add(kind);
                    }
                    return next;
                  });
                }}
              >
                {group.label}
              </FilterChip>
            );
          })}
        </div>
        <input
          type="search"
          className="timeline-search"
          placeholder="Search events…"
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
        />
        <span className="timeline-count">{fmtCount(eventRowCount)} events</span>
      </div>

      <div className="timeline-layout">
        <nav className="timeline-chapter-rail" aria-label="Chapters">
          {model.pkg.sections.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="timeline-chapter-link"
              title={section.summary}
              onClick={() => onJumpToEvent(section.startEventId)}
            >
              <span>{fmtClock(section.startSeconds)}</span>
              {section.title}
            </button>
          ))}
        </nav>

        <div className="stream-scroll" ref={scrollRef}>
          <div className="stream-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="stream-row-slot"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <StreamRow
                    item={item}
                    model={model}
                    expanded={item.type === 'event' && expanded.has(item.event.id)}
                    focused={item.type === 'event' && focus !== null && item.event.id === focus.eventId}
                    onToggle={toggleExpanded}
                    onJumpToEvent={onJumpToEvent}
                    onViewAgent={viewAgent}
                  />
                </div>
              );
            })}
          </div>
          {items.length === 0 && (
            <p className="timeline-empty">Nothing matches these filters{agentKey === MAIN_AGENT_KEY ? '' : ''}. Clear the search or re-enable event kinds.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  colorIndex,
  onClick,
  children,
}: {
  active: boolean;
  colorIndex?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`filter-chip${active ? ' is-active' : ''}`}
      data-agent-color={colorIndex}
      aria-pressed={active}
      onClick={onClick}
    >
      {colorIndex !== undefined && <span className="agent-chip-dot" aria-hidden="true" />}
      {children}
    </button>
  );
}

function itemKey(item: StreamItem): string {
  return item.type === 'section' ? `section-${item.section.id}` : item.event.id;
}

function estimateHeight(item: StreamItem): number {
  if (item.type === 'section') return 150;
  let height = 42;
  height += item.annotations.length * 96;
  return height;
}
