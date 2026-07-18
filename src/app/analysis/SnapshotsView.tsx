import { useCallback, useEffect, useMemo, useState } from 'react';
import { snapshotImageUrl } from './data';
import { fmtBytes, fmtClock, fmtTimestamp } from './format';
import type { AnalysisModel } from './model';
import { AgentChip, agentFor } from './bits';
import type { SnapshotImage, SnapshotIndexMoment, SnapshotMoment } from './types';

type SnapshotsViewProps = { model: AnalysisModel; onJumpToEvent: (eventId: string) => void };

type LightboxImage = { url: string; caption: string; moment: number };

/** The images the agent rendered of its own work, reconstructed at the exact
 * file-tree state of each snapshot command, with full provenance. */
export function SnapshotsView({ model, onJumpToEvent }: SnapshotsViewProps) {
  const { snapshots, snapshotMoments } = model.pkg;
  const commandMomentByOrdinal = useMemo(
    () => new Map(snapshotMoments.moments.map((moment) => [moment.ordinal, moment])),
    [snapshotMoments],
  );

  const allImages = useMemo<LightboxImage[]>(() => {
    const list: LightboxImage[] = [];
    for (const moment of snapshots.moments) {
      for (const image of moment.images) {
        const url = snapshotImageUrl(model.pkg.id, image.path);
        if (url) list.push({ url, caption: imageCaption(image, moment.ordinal), moment: moment.ordinal });
      }
    }
    return list;
  }, [model.pkg.id, snapshots]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div className="snapshots-view">
      <p className="analysis-help snapshots-summary">{snapshots.reconstructionSummary}</p>

      {snapshots.moments.map((moment) => (
        <MomentCard
          key={moment.ordinal}
          model={model}
          moment={moment}
          commandMoment={commandMomentByOrdinal.get(moment.ordinal)}
          onJumpToEvent={onJumpToEvent}
          onOpenImage={(path) => {
            const index = allImages.findIndex((image) => image.url === snapshotImageUrl(model.pkg.id, path));
            if (index !== -1) setLightboxIndex(index);
          }}
        />
      ))}

      <section className="snapshots-verification">
        <p className="analysis-label">Final-state verification</p>
        <p className="analysis-help">{snapshots.finalStateVerification.method}</p>
        <p className={`snapshots-verdict ${snapshots.finalStateVerification.allFilesMatch ? 'is-pass' : 'is-fail'}`}>
          {snapshots.finalStateVerification.allFilesMatch
            ? '✓ Full replay reproduces the evaluated payload'
            : '✕ Replay diverges from the evaluated payload'}
        </p>
        <ul className="snapshots-verification-files">
          {snapshots.finalStateVerification.files.map((entry) => (
            <li key={entry.file} className={entry.match ? 'is-pass' : 'is-fail'}>
              <span aria-hidden="true">{entry.match ? '✓' : '✕'}</span> <code>{entry.file}</code>
            </li>
          ))}
        </ul>
        <div className="event-facts">
          <span>protocol <code>{snapshots.protocol}</code></span>
          <span>node <code>{snapshots.environment.node}</code></span>
          <span>renderer <code>{snapshots.environment.renderer}</code></span>
          <span>three.js <code>{snapshots.environment.threeVersion}</code></span>
        </div>
        <p className="analysis-help">{snapshots.environment.fidelityNote}</p>
      </section>

      {lightboxIndex !== null && (
        <Lightbox
          images={allImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSeek={setLightboxIndex}
        />
      )}
    </div>
  );
}

function MomentCard({
  model,
  moment,
  commandMoment,
  onJumpToEvent,
  onOpenImage,
}: {
  model: AnalysisModel;
  moment: SnapshotIndexMoment;
  commandMoment: SnapshotMoment | undefined;
  onJumpToEvent: (eventId: string) => void;
  onOpenImage: (path: string) => void;
}) {
  const agent = agentFor(model, moment.agent);
  return (
    <section className="moment-card">
      <header className="moment-head">
        <span className="moment-ordinal">{moment.ordinal}</span>
        <div className="moment-head-copy">
          <div className="moment-head-row">
            <button type="button" className="event-link" onClick={() => onJumpToEvent(moment.eventId)}>{fmtClock(moment.tSeconds)}</button>
            {agent && <AgentChip agent={agent} />}
            {commandMoment && (
              <span className={`moment-exit ${commandMoment.exitStatus === 'success' || commandMoment.exitStatus === '0' ? 'is-pass' : 'is-fail'}`}>
                {commandMoment.exitStatus}{commandMoment.stderrPresent ? ' · stderr' : ''}
              </span>
            )}
            {commandMoment && <span className="moment-wallclock">{fmtTimestamp(commandMoment.ts)}</span>}
          </div>
          <code className="moment-command">{moment.command}</code>
        </div>
      </header>

      {moment.filesChangedSincePreviousMoment.length > 0 && (
        <p className="moment-changed">
          Changed since previous moment:{' '}
          {moment.filesChangedSincePreviousMoment.map((file, index) => (
            <code key={file}>{index > 0 ? ' ' : ''}{shortPath(file, model.pkg.run.levelId)}</code>
          ))}
        </p>
      )}

      <div className="moment-grid">
        {moment.images.map((image) => {
          const url = snapshotImageUrl(model.pkg.id, image.path);
          if (!url) return null;
          return (
            <figure key={image.path} className="moment-figure">
              <button type="button" onClick={() => onOpenImage(image.path)}>
                <img src={url} alt={imageCaption(image, moment.ordinal)} loading="lazy" />
              </button>
              <figcaption title={`${image.path} · ${fmtBytes(image.bytes)}`}>{imageCaption(image, moment.ordinal)}</figcaption>
            </figure>
          );
        })}
      </div>

      <details className="moment-reconstruction">
        <summary>Reconstruction provenance</summary>
        <p>{moment.reconstruction.method}</p>
        <p>{moment.reconstruction.verified}</p>
        {moment.reconstruction.caveats && <p className="moment-caveats">Caveats: {moment.reconstruction.caveats}</p>}
        {moment.reconstruction.originalLuminance && moment.reconstruction.replayedLuminance && (
          <p className="moment-luminance">
            <span>original luminance [{moment.reconstruction.originalLuminance.join(', ')}]</span>
            <span>replayed luminance [{moment.reconstruction.replayedLuminance.join(', ')}]</span>
          </p>
        )}
      </details>
    </section>
  );
}

function Lightbox({
  images,
  index,
  onClose,
  onSeek,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onSeek: (index: number) => void;
}) {
  const image = images[index];
  const seek = useCallback(
    (delta: number) => onSeek((index + delta + images.length) % images.length),
    [index, images.length, onSeek],
  );

  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onClose();
      if (keyEvent.key === 'ArrowRight') seek(1);
      if (keyEvent.key === 'ArrowLeft') seek(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, seek]);

  if (!image) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.caption} onClick={onClose}>
      <figure onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <img src={image.url} alt={image.caption} />
        <figcaption>
          <span>moment {image.moment} · {image.caption}</span>
          <span>{index + 1} / {images.length}</span>
        </figcaption>
      </figure>
      <button type="button" className="lightbox-nav is-prev" aria-label="Previous image" onClick={(clickEvent) => { clickEvent.stopPropagation(); seek(-1); }}>‹</button>
      <button type="button" className="lightbox-nav is-next" aria-label="Next image" onClick={(clickEvent) => { clickEvent.stopPropagation(); seek(1); }}>›</button>
      <button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}>✕</button>
    </div>
  );
}

function imageCaption(image: SnapshotImage, ordinal: number): string {
  if (image.depicts?.export) {
    const yaw = image.depicts.yawDegrees !== undefined ? ` · ${image.depicts.yawDegrees}°` : '';
    return `${image.depicts.export}${yaw}`;
  }
  const name = image.path.split('/').pop() ?? image.path;
  return name.replace(/\.png$/, '').replace(/^gameplay__/, 'gameplay · ').replace(/-/g, ' ');
}

function shortPath(file: string, levelId: string): string {
  const prefix = `src/levels/${levelId}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
