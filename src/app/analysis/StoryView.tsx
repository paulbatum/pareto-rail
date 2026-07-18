import { Fragment } from 'react';
import { fmtClock } from './format';
import type { AnalysisModel } from './model';
import { AgentChip, SectionKindChip, agentFor } from './bits';
import type { AnalysisSection } from './types';

type StoryViewProps = { model: AnalysisModel; onJumpToEvent: (eventId: string) => void };

/** The editorial read of the run: verdict, stat callouts, the chapter-by-chapter
 * narrative, delegation analysis, and the reviewer's open questions. */
export function StoryView({ model, onJumpToEvent }: StoryViewProps) {
  const { narrative, sections } = model.pkg;
  const storyBySection = new Map(narrative.timeline_story.map((entry) => [entry.sectionId, entry.text]));

  return (
    <div className="story-view">
      <section className="story-verdict">
        <p className="analysis-label">Verdict</p>
        <p className="story-verdict-text">{narrative.verdict}</p>
      </section>

      <section>
        <p className="analysis-label">By the numbers</p>
        <div className="story-callouts">
          {narrative.stats_callouts.map((callout) => (
            <div key={callout.stat} className="story-callout">
              <strong>{callout.stat}</strong>
              <span>{callout.caption}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="analysis-label">The run, chapter by chapter</p>
        <ol className="story-chapters">
          {sections.sections.map((section) => (
            <StoryChapter
              key={section.id}
              model={model}
              section={section}
              story={storyBySection.get(section.id)}
              onJumpToEvent={onJumpToEvent}
            />
          ))}
        </ol>
      </section>

      <section className="story-prose">
        <p className="analysis-label">Delegation analysis</p>
        <p>{narrative.delegation_analysis}</p>
      </section>

      <section className="story-prose">
        <p className="analysis-label">Open questions for a human reviewer</p>
        <ul className="story-questions">
          {narrative.open_questions.map((question) => <li key={question}>{question}</li>)}
        </ul>
      </section>
    </div>
  );
}

function StoryChapter({
  model,
  section,
  story,
  onJumpToEvent,
}: {
  model: AnalysisModel;
  section: AnalysisSection;
  story: string | undefined;
  onJumpToEvent: (eventId: string) => void;
}) {
  return (
    <li className="story-chapter">
      <header className="story-chapter-head">
        <span className="story-chapter-time">{fmtClock(section.startSeconds)}–{fmtClock(section.endSeconds)}</span>
        <h3>{section.title}</h3>
        <span className="story-chapter-tags">
          <SectionKindChip kind={section.kind} />
          {section.agents.map((agentKey) => {
            const agent = agentFor(model, agentKey);
            return agent ? <AgentChip key={agentKey} agent={agent} /> : null;
          })}
        </span>
      </header>
      {story && <p className="story-chapter-text">{story}</p>}
      <div className="story-chapter-foot">
        <span className="story-chapter-key-events">
          Key events:{' '}
          {section.keyEventIds.map((eventId, index) => (
            <Fragment key={eventId}>
              {index > 0 && ' '}
              <button type="button" className="event-link" onClick={() => onJumpToEvent(eventId)}>{eventId}</button>
            </Fragment>
          ))}
        </span>
        <button type="button" className="event-link" onClick={() => onJumpToEvent(section.startEventId)}>
          Open in timeline →
        </button>
      </div>
    </li>
  );
}
