/* Page-side half of the playthrough recorder.
 *
 * `installCaptureRuntime` is injected into the page before any app code runs, so it
 * must be entirely self-contained: puppeteer ships its source across, not its
 * closure. It taps the audio graph, installs an autoplay policy, and records.
 */

export function installCaptureRuntime(config) {
  const MAX_LOCKS = 6;

  window.__raildDebug = { ...window.__raildDebug, immortal: config.immortal !== false };
  window.__paretoCapture = { audioTap: null, config };

  /* The game's sound is procedural and only exists at play time, so recording it means
     tapping the audio graph. The tap replaces the context's destination and is
     deliberately NOT wired on to the hardware output: nothing reaches the speakers of
     whatever machine is doing the recording. */
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      const tap = this.createMediaStreamDestination();
      const passthrough = this.createGain();
      passthrough.connect(tap);
      Object.defineProperty(this, 'destination', { get: () => passthrough, configurable: true });
      window.__paretoCapture.audioTap = tap;
    }
  };

  const lcg = (value) => {
    let state = value >>> 0 || 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  window.__paretoInstallAutoplay = (options) => {
    const handle = window.__raildCapture;
    if (!handle) throw new Error('Capture handle missing: the page must be loaded with ?capture=1');
    const { scene, camera, canvas, bus } = handle;
    const mode = options.policy;
    const tuning = options.tuning;
    const rng = lcg(options.seed);

    const targets = new Map();
    const counts = {};
    const volleySizes = [];
    let pointerDown = false;
    let lastPoint = { x: 0, y: 0 };
    let currentLocks = 0;
    let lastLockAt = -Infinity;
    let started = false;
    let ended = false;
    let summary = null;

    const findRoot = (enemyId) => {
      let found = null;
      scene.traverse((object) => {
        if (found) return;
        if (object.userData.raildRole === 'target' && object.userData.raildEnemyId === enemyId) found = object;
      });
      return found;
    };

    for (const type of ['spawn', 'lock', 'fire', 'hit', 'kill', 'miss', 'reject', 'playerhit']) {
      bus.on(type, () => { counts[type] = (counts[type] ?? 0) + 1; });
    }
    bus.on('runstart', () => { started = true; });
    bus.on('runend', (payload) => { ended = true; summary = payload; });
    bus.on('spawn', ({ enemyId, kind, letter }) => {
      const root = findRoot(enemyId);
      if (root) targets.set(enemyId, { id: enemyId, kind, letter, root, locks: 0, inFlight: false });
    });
    bus.on('lock', ({ enemyId, lockCount }) => {
      currentLocks = lockCount;
      lastLockAt = performance.now() / 1000;
      const target = targets.get(enemyId);
      if (target) target.locks += 1;
    });
    bus.on('unlock', ({ enemyId, lockCount }) => {
      currentLocks = lockCount;
      const target = targets.get(enemyId);
      if (target) target.locks = 0;
    });
    bus.on('fire', ({ enemyId }) => {
      const target = targets.get(enemyId);
      if (target) target.inFlight = true;
    });
    bus.on('hit', ({ enemyId }) => {
      const target = targets.get(enemyId);
      if (target) target.inFlight = false;
    });
    bus.on('reject', () => {
      currentLocks = 0;
      for (const target of targets.values()) { target.locks = 0; target.inFlight = false; }
    });
    bus.on('kill', ({ enemyId }) => targets.delete(enemyId));
    bus.on('miss', ({ enemyId }) => targets.delete(enemyId));

    const dispatch = (type, clientX, clientY, buttons) => {
      canvas.dispatchEvent(new PointerEvent(type, { clientX, clientY, buttons, button: 0, pointerId: 1, bubbles: true }));
    };
    const aim = (ndc) => {
      const rect = canvas.getBoundingClientRect();
      lastPoint = {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndc.y) / 2) * rect.height,
      };
      dispatch(pointerDown ? 'pointermove' : 'pointerdown', lastPoint.x, lastPoint.y, 1);
      pointerDown = true;
    };
    /* Release where the sight already is. A pointerup at the origin flings the reticle
       into the top-left corner between volleys, which is very visible on video. */
    const release = () => {
      if (!pointerDown) return false;
      dispatch('pointerup', lastPoint.x, lastPoint.y, 0);
      pointerDown = false;
      currentLocks = 0;
      for (const target of targets.values()) target.locks = 0;
      return true;
    };

    const priority = (target) => {
      if (target.kind === 'bolt' || target.kind === 'flare') return -2;
      if (target.locks > 0) return 2;
      return 0;
    };

    const projected = new camera.position.constructor();
    const visible = () => [...targets.values()]
      .filter((target) => target.kind !== 'letter' && target.root.parent)
      .map((target) => {
        target.root.getWorldPosition(projected);
        projected.project(camera);
        return { target, ndc: { x: projected.x, y: projected.y }, z: projected.z, distance: Math.hypot(projected.x, projected.y) };
      })
      .filter((entry) => entry.z >= -1 && entry.z <= 1 && Math.abs(entry.ndc.x) <= 0.98 && Math.abs(entry.ndc.y) <= 0.98)
      .sort((a, b) => priority(a.target) - priority(b.target) || a.distance - b.distance);

    /* Volley: plays for the lock-on mechanic instead of for reaction time. It slides the
       sight to the nearest unlocked target from wherever the sight already is, banking
       locks until the hand is full, and only then fires. Kills in a six-lock volley pay
       1.75x, and levels can gate targets behind whole-group releases. The speed limit is
       what makes it read as a hand moving across the screen: it picks up whatever it
       crosses on the way. */
    const volley = { point: { x: 0, y: 0 }, goalId: -1, holdStartedAt: 0, nextMoveAt: 0, lastTick: 0 };

    const releaseVolley = () => {
      const size = currentLocks;
      if (release() && size > 0) volleySizes.push(size);
      volley.goalId = -1;
      volley.holdStartedAt = 0;
    };

    const stepVolley = (now) => {
      const dt = volley.lastTick === 0 ? 0 : Math.min(0.1, now - volley.lastTick);
      volley.lastTick = now;
      if (!pointerDown) volley.holdStartedAt = now;

      if (currentLocks >= MAX_LOCKS) { releaseVolley(); return; }
      if (currentLocks > 0 && now - volley.holdStartedAt > tuning.maxHold) { releaseVolley(); return; }

      const candidates = visible().filter((entry) => entry.target.locks === 0 && !entry.target.inFlight);
      if (candidates.length === 0) {
        if (currentLocks > 0 && now - lastLockAt > tuning.grace) releaseVolley();
        return;
      }
      if (now < volley.nextMoveAt) return;

      const reach = (entry) => Math.hypot(entry.ndc.x - volley.point.x, entry.ndc.y - volley.point.y);
      let goal = candidates.find((entry) => entry.target.id === volley.goalId);
      if (!goal) {
        goal = [...candidates].sort((a, b) => priority(a.target) - priority(b.target) || reach(a) - reach(b))[0];
        volley.goalId = goal.target.id;
      }

      const dx = goal.ndc.x - volley.point.x;
      const dy = goal.ndc.y - volley.point.y;
      const gap = Math.hypot(dx, dy);
      const travel = tuning.speed * dt;
      if (gap <= travel || gap < 1e-4) {
        volley.point = { x: goal.ndc.x, y: goal.ndc.y };
        volley.goalId = -1;
        volley.nextMoveAt = now + tuning.dwell;
      } else {
        volley.point = { x: volley.point.x + (dx / gap) * travel, y: volley.point.y + (dy / gap) * travel };
      }
      aim(volley.point);
    };

    // The simulator's two reference styles, for comparison footage.
    let lastActionAt = -Infinity;
    let releaseAt = Infinity;
    let chosenId = -1;

    const stepPerfect = () => {
      if (currentLocks >= MAX_LOCKS) { release(); return; }
      const candidates = visible().filter((entry) => entry.target.locks === 0 && !entry.target.inFlight);
      if (candidates.length === 0) { if (currentLocks > 0) release(); return; }
      aim(candidates[0].ndc);
    };

    const stepImperfect = (now) => {
      if (currentLocks >= 3 || now >= releaseAt) {
        release();
        releaseAt = Infinity;
        chosenId = -1;
        return;
      }
      if (now - lastActionAt < 0.23) return;
      const candidates = visible().filter(() => rng() > 0.18);
      if (candidates.length === 0) {
        if (currentLocks > 0 && now - lastLockAt > 0.45) release();
        return;
      }
      if (chosenId < 0 || !targets.has(chosenId)) {
        const pick = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
        chosenId = pick.target.id;
        releaseAt = now + 0.35 + rng() * 0.4;
      }
      const chosen = candidates.find((entry) => entry.target.id === chosenId) ?? candidates[0];
      aim(chosen.ndc);
      lastActionAt = now;
    };

    const step = () => {
      if (!started || ended) return;
      const now = performance.now() / 1000;
      if (mode === 'volley') stepVolley(now);
      else if (mode === 'perfect') stepPerfect();
      else stepImperfect(now);
    };

    window.__paretoAutoplay = {
      step,
      hasEnded: () => ended,
      report: () => ({ counts, summary, volleySizes }),
    };
    return true;
  };

  window.__paretoRecord = async (options) => {
    const canvas = window.__raildCapture.canvas;
    const autoplay = window.__paretoAutoplay;
    const frameInterval = 1000 / options.fps;
    let frameCount = 0;
    let dropped = 0;

    let encoder = null;
    if (!options.dryRun) {
      encoder = new VideoEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          let binary = '';
          const stride = 0x8000;
          for (let i = 0; i < bytes.length; i += stride) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + stride));
          window.__paretoVideoSink(btoa(binary));
        },
        error: (error) => console.error('capture: encoder failed', error.message),
      });
      encoder.configure({
        codec: options.codec,
        width: canvas.width,
        height: canvas.height,
        bitrate: options.bitrate,
        framerate: options.fps,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime',
        avc: { format: 'annexb' },
      });
    }

    const audioChunks = [];
    let audioRecorder = null;
    let audioDone = Promise.resolve();
    const audioTap = window.__paretoCapture.audioTap;
    if (!options.dryRun && audioTap) {
      const audioStream = new MediaStream(audioTap.stream.getAudioTracks());
      audioRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192_000 });
      audioRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunks.push(event.data); };
      audioDone = new Promise((resolve) => { audioRecorder.onstop = resolve; });
    }

    /* Two ways to obtain frames. `render-loop` takes them straight from the game's draw
       loop, which is the only way to hold a true 60 fps: the browser compositor commits
       far fewer frames than the game draws, badly so at 1080p. `compositor` uses the
       canvas capture stream instead, for comparison or if the direct grab ever breaks. */
    let compositorReader = null;
    if (!options.dryRun && options.frameSource === 'compositor') {
      const stream = canvas.captureStream(options.fps);
      compositorReader = new MediaStreamTrackProcessor({ track: stream.getVideoTracks()[0] }).readable.getReader();
    }

    audioRecorder?.start();
    const startedAt = performance.now();
    let nextSlot = startedAt;
    let endedAt = null;

    const finished = (now) => {
      if (endedAt === null && autoplay.hasEnded()) endedAt = now;
      if (endedAt !== null && now - endedAt > options.tailSeconds * 1000) return true;
      return now - startedAt >= options.maxSeconds * 1000;
    };

    if (compositorReader) {
      for (;;) {
        const { value: frame, done } = await compositorReader.read();
        if (done || !frame) break;
        autoplay.step();
        const now = performance.now();
        if (encoder.encodeQueueSize > options.queueLimit) { dropped += 1; frame.close(); } else {
          encoder.encode(frame, { keyFrame: frameCount % 120 === 0 });
          frame.close();
          frameCount += 1;
        }
        if (finished(now)) break;
      }
      compositorReader.cancel().catch(() => {});
    } else {
      await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now();
          autoplay.step();
          if (finished(now)) { resolve(); return; }
          if (encoder && now >= nextSlot) {
            nextSlot += frameInterval;
            if (encoder.encodeQueueSize > options.queueLimit) dropped += 1;
            else {
              const frame = new VideoFrame(canvas, { timestamp: Math.round((now - startedAt) * 1000) });
              encoder.encode(frame, { keyFrame: frameCount % 120 === 0 });
              frame.close();
              frameCount += 1;
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    audioRecorder?.stop();
    await audioDone;
    if (encoder) { await encoder.flush(); encoder.close(); }

    let audioBase64 = '';
    if (audioChunks.length > 0) {
      const bytes = new Uint8Array(await new Blob(audioChunks).arrayBuffer());
      let binary = '';
      const stride = 0x8000;
      for (let i = 0; i < bytes.length; i += stride) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + stride));
      audioBase64 = btoa(binary);
    }

    return {
      audio: audioBase64,
      frameCount,
      dropped,
      seconds: (performance.now() - startedAt) / 1000,
      reachedEnd: autoplay.hasEnded(),
      ...autoplay.report(),
    };
  };
}
