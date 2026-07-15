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
      <div id="tip" data-game-ui className="tip hidden">HOLD to charge — SWEEP across all six targets — RELEASE to fire</div>

      <div
        id="pause"
        className="pause-overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
      >
        <div className="pause-panel">
          <h1 id="pause-title">Paused</h1>
          <button type="button" className="button primary" data-pause="resume">Resume</button>
          <button type="button" className="button" data-pause="end-run">End Run</button>
          <button type="button" className="button" data-pause="fullscreen">Fullscreen</button>
          <label>
            <span>Music</span>
            <input data-pause="music" type="range" min="0" max="100" defaultValue="80" />
          </label>
          <label>
            <span>Sound Effects</span>
            <input data-pause="sfx" type="range" min="0" max="100" defaultValue="80" />
          </label>
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

      <section className="unsupported hidden" data-game="unsupported" aria-live="assertive">
        <div className="unsupported-panel">
          <h1 data-unsupported="message">This game requires WebGPU</h1>
          <p>Please open this page in a browser with WebGPU enabled.</p>
        </div>
      </section>

      <div className="scanlines" aria-hidden="true" />
    </div>
  );
});
