import { useEffect, useRef, useState } from 'react';
import { fmtClock } from './format';
import { annotationTone, type AnalysisModel } from './model';

const GUTTER = 118;
const SECTION_Y = 4;
const SECTION_H = 14;
const LANE_H = 20;
const MARKER_H = 20;
const AXIS_H = 20;

type TimelineStripProps = {
  model: AnalysisModel;
  focusT: number | null;
  onJumpToEvent: (eventId: string) => void;
};

/**
 * The run at a glance: one lane per agent with per-event tick marks, chapter
 * bands on top, annotation and snapshot markers below, all on a shared clock.
 * Every mark is clickable and seeks the event stream.
 */
export function TimelineStrip({ model, focusT, onJumpToEvent }: TimelineStripProps) {
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

  const lanesY = SECTION_Y + SECTION_H + 8;
  const markersY = lanesY + model.agents.length * LANE_H + 4;
  const height = markersY + MARKER_H + AXIS_H;
  const duration = model.durationSeconds;
  const plotW = Math.max(0, width - GUTTER - 12);
  const x = (t: number) => GUTTER + (Math.min(t, duration) / duration) * plotW;

  return (
    <div className="timeline-strip" ref={wrapRef}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Run overview timeline">
          {/* Chapter bands */}
          <text x={GUTTER - 10} y={SECTION_Y + SECTION_H - 4} className="strip-label" textAnchor="end">chapters</text>
          {model.pkg.sections.sections.map((section) => (
            <g key={section.id} className="strip-section" onClick={() => onJumpToEvent(section.startEventId)}>
              <title>{`${section.title} · ${fmtClock(section.startSeconds)}–${fmtClock(section.endSeconds)} (${section.kind})`}</title>
              <rect
                x={x(section.startSeconds)}
                y={SECTION_Y}
                width={Math.max(2, x(section.endSeconds) - x(section.startSeconds) - 1.5)}
                height={SECTION_H}
              />
            </g>
          ))}

          {/* Agent lanes */}
          {model.agents.map((agent, laneIndex) => {
            const yMid = lanesY + laneIndex * LANE_H + LANE_H / 2;
            const laneColor = `var(--an-agent-${agent.colorIndex})`;
            return (
              <g key={agent.key}>
                <text x={GUTTER - 10} y={yMid + 3} className="strip-label" textAnchor="end">{agent.shortLabel}</text>
                <line x1={x(agent.firstEventT)} x2={x(agent.lastEventT)} y1={yMid} y2={yMid} style={{ stroke: laneColor }} className="strip-lane-line" />
                {model.merged
                  .filter((ref) => ref.agentKey === agent.key)
                  .map((ref) => (
                    <g key={ref.event.id} className="strip-tick" onClick={() => onJumpToEvent(ref.event.id)}>
                      <title>{`${ref.event.id} · ${fmtClock(ref.event.tSeconds)} · ${ref.event.summary ?? ref.event.kind}`}</title>
                      {/* widened invisible hit target behind the visible tick */}
                      <rect x={x(ref.event.tSeconds) - 2.5} y={yMid - 8} width={5} height={16} className="strip-hit" />
                      <rect x={x(ref.event.tSeconds) - 0.6} y={yMid - 5} width={1.2} height={10} style={{ fill: laneColor }} className="strip-tick-mark" />
                    </g>
                  ))}
              </g>
            );
          })}

          {/* Annotations + snapshot moments */}
          <text x={GUTTER - 10} y={markersY + 8} className="strip-label" textAnchor="end">notes</text>
          {model.pkg.annotations.annotations.map((annotation) => (
            <g key={annotation.id} className="strip-marker" onClick={() => onJumpToEvent(annotation.eventId)}>
              <title>{`${annotation.type}: ${annotation.title} · ${fmtClock(annotation.tSeconds)}`}</title>
              <rect
                x={x(annotation.tSeconds) - 3}
                y={markersY + 1}
                width={6}
                height={6}
                transform={`rotate(45 ${x(annotation.tSeconds)} ${markersY + 4})`}
                className={`strip-annotation tone-${annotationTone(annotation.type)}`}
              />
            </g>
          ))}
          {model.pkg.snapshotMoments.moments.map((moment) => (
            <g key={moment.ordinal} className="strip-marker" onClick={() => onJumpToEvent(moment.eventId)}>
              <title>{`Snapshot moment ${moment.ordinal} · ${fmtClock(moment.tSeconds)} · ${moment.command}`}</title>
              <rect x={x(moment.tSeconds) - 3.5} y={markersY + 11} width={7} height={7} className="strip-snapshot" />
            </g>
          ))}

          {/* Time axis */}
          {axisTicks(duration).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={SECTION_Y} y2={markersY + MARKER_H} className="strip-grid" />
              <text x={x(t)} y={height - 6} className="strip-axis-label" textAnchor="middle">{fmtClock(t)}</text>
            </g>
          ))}

          {/* Focused event cursor */}
          {focusT !== null && <line x1={x(focusT)} x2={x(focusT)} y1={0} y2={markersY + MARKER_H} className="strip-cursor" />}
        </svg>
      )}
    </div>
  );
}

function axisTicks(duration: number): number[] {
  const step = duration > 4200 ? 900 : duration > 1800 ? 600 : 300;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);
  return ticks;
}
