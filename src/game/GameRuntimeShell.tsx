import { forwardRef } from 'react';

/**
 * Static DOM owned by the game runtime.
 *
 * Gameplay updates these elements imperatively, but the document structure
 * stays with the React shell instead of being assembled from HTML strings.
 */
export const GameRuntimeShell = forwardRef<HTMLDivElement>(function GameRuntimeShell(_, ref) {
  return (
    <div ref={ref} className="game-runtime">
      <div data-game="app" />

      <div id="hud" data-game-ui className="hud">
        <div className="hud-left">
          <div className="hud-cell">
            <span className="hud-label">Score</span>
            <span className="hud-value" data-hud="score">0</span>
          </div>
          <div className="hud-cell hud-hull hidden" data-hud="hull-cell">
            <span className="hud-label">Hull</span>
            <span className="hud-value" data-hud="hull-pips" />
          </div>
        </div>
        <div className="hud-cell hud-time" data-hud="time-cell">
          <span className="hud-value hud-time-value" data-hud="time">0.0</span>
        </div>
        <div className="hud-cell hud-right">
          <span className="hud-label">Lock</span>
          <span className="hud-value"><span data-hud="locks">0</span>/6</span>
        </div>
      </div>

      <button type="button" data-game-ui data-pause="open" className="touch-pause" aria-label="Pause">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.4" y="2.6" width="3.2" height="10.8" />
          <rect x="9.4" y="2.6" width="3.2" height="10.8" />
        </svg>
      </button>

      <div id="end-screen" data-game-ui className="end-screen hidden">
        <div className="end-panel">
          <div className="label">Score</div>
          <div className="score" data-end="score">0</div>
          <div className="death-status hidden" data-end="death">Signal lost</div>
          <div className="end-detail" data-end="kills">Kills 0/0</div>
          <div className="rank" data-end="rank">D</div>
          <div className="end-extra hidden" data-end="details" />
          <div className="replay">Lock all six to replay</div>
        </div>
      </div>

      <div id="damage-flash" data-game-ui className="damage-flash" aria-hidden="true" />
      <div id="max-lock-flash" data-game-ui className="max-lock-flash hidden" aria-hidden="true">MAX</div>
      <div id="callout" data-game-ui className="callout hidden" aria-live="polite" />
      <div id="tip-stack" data-game-ui className="tip-stack">
        <div id="sound-tip" className="start-nudge hidden">
          <span className="sound-tip-note" aria-hidden="true">♪</span>
          <span>Best with sound on</span>
          <span className="sound-tip-note sound-tip-note-alt" aria-hidden="true">♫</span>
        </div>
        <div id="rotate-tip" className="start-nudge rotate-tip hidden">
          <svg className="rotate-tip-phone" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="6.2" y="2.8" width="7.6" height="14.4" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="14.4" r="0.9" fill="currentColor" />
          </svg>
          <span>Best in landscape</span>
        </div>
        <div id="tip" className="tip hidden">HOLD to charge — SWEEP across all six targets — RELEASE to fire</div>
      </div>

      <div
        id="pause"
        className="pause-overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Paused"
      >
        <div className="pause-panel">
          <div className="pause-columns">
            <div className="pause-actions">
              <button type="button" className="button primary" data-pause="resume">Resume</button>
              <button type="button" className="button" data-pause="fullscreen">Fullscreen</button>
              <button type="button" className="button pause-exit" data-pause="end-run">End Run (Exit)</button>
            </div>
            <div className="pause-settings">
              <h2>Sound</h2>
              <label>
                <span>Music</span>
                <input data-pause="music" type="range" min="0" max="100" defaultValue="80" />
              </label>
              <label>
                <span>Effects</span>
                <input data-pause="sfx" type="range" min="0" max="100" defaultValue="80" />
              </label>
              <h2>Visual</h2>
              <label>
                <span>Bloom</span>
                <input data-pause="bloom" type="range" min="0" max="100" defaultValue="100" />
              </label>
              <label>
                <span>Motion Blur</span>
                <input data-pause="motion-blur" type="range" min="0" max="100" defaultValue="100" />
              </label>
            </div>
          </div>
        </div>
      </div>

      <section className="unsupported hidden" data-game="unsupported" aria-live="assertive">
        <div className="unsupported-panel">
          <h1 data-unsupported="message">This game requires WebGPU</h1>
          <p data-unsupported="hint">Please open this page in a browser with WebGPU enabled.</p>
          <pre className="unsupported-detail hidden" data-unsupported="detail" />
        </div>
      </section>

      <div className="scanlines" aria-hidden="true" />
    </div>
  );
});
