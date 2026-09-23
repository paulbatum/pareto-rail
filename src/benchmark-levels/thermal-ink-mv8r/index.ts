import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { ARM_ATTACKS, CORE_SPAWN_TIME, ESCAPE_TIME, THERMAL_INK_BPM, createThermalInkGameplay } from './gameplay';
import { createOctopusRig } from './octopus';
import { resetSense } from './sense';
import { BARS, MARKERS, RUN_SECTIONS, bar } from './timing';
import {
  composeThermalInkOutput,
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setLensSpatter,
  setReticleActive,
  thermalWarmup,
  updateCameraFeel,
  updateSenses,
  updateVisuals,
} from './visuals';

export const thermalInkMv8rLevel: LevelDefinition = {
  id: 'thermal-ink-mv8r',
  title: 'Thermal Ink',
  description: 'A one-minute boss fight with a giant mutant octopus in a drowned sodium-lit harbor. Sever its arms, lose it in the ink, and strike through the dark in thermal.',
  bpm: THERMAL_INK_BPM,
  markers: MARKERS,
  sections: RUN_SECTIONS.map((section) => ({ name: section.name, time: bar(section.fromBar) })),
  post: {
    clearColor: 0x1a1008,
    bloom: { strength: 0.95, threshold: 0.62, radius: 0.32 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.72 },
    composeOutput: composeThermalInkOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const cameraFeel = createCameraFeel(camera);
    const rig = createOctopusRig();
    const gameplay = createThermalInkGameplay(bus, rig);
    resetSense();
    createEnvironment(scene, rig, gameplay.state);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // The thermal sight rides the trigger: holding inside ink lights it.
    // Dev inspection flags (comma-separated `debugValue`): `thermal` holds the
    // trigger, `finale` fakes the killing blow, `clean` skips lens spatter.
    const debugFlags = new Set((debugValue ?? '').split(','));
    const forceHold = debugFlags.has('thermal');
    if (debugFlags.has('clean')) setLensSpatter(false);
    let holding = false;
    const onDown = (event: PointerEvent) => {
      if (event.button === 0) holding = true;
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 0 || event.type === 'pointercancel') holding = false;
    };
    const onBlur = () => {
      holding = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);

    // Narration: the fight's beats get names.
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timed = [
      { at: bar(0.3), text: 'IT HAS THE HARBOR', hold: 2.2 },
      { at: bar(BARS.ink), text: 'INK — HOLD FOR THERMAL', hold: 3.2 },
      { at: bar(BARS.inkTwo), text: 'INK', hold: 1.4 },
      { at: CORE_SPAWN_TIME, text: 'IT REARS — THE CORE IS BARE', hold: 2.4 },
      { at: bar(BARS.blackout), text: 'BLACKOUT — STRIKE THE HEAT', hold: 2.6 },
    ];
    let nextTimed = 0;
    let severed = 0;
    let coreId = -1;
    const nodeIds = new Set<number>();
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'core') coreId = enemyId;
      if (kind === 'node') nodeIds.add(enemyId);
    });
    bus.on('stage', ({ enemyId }) => {
      if (enemyId === coreId && gameplay.state.coreStageBroken) say('IT SEALS UNDER ITS ARMS — WAIT FOR THE DARK', 2.6);
    });
    bus.on('kill', ({ enemyId }) => {
      if (nodeIds.delete(enemyId)) {
        severed += 1;
        say(`ARM SEVERED  ${severed}/${ARM_ATTACKS.length}`, 1.6);
      }
      if (enemyId === coreId) say('THE HEAT GOES OUT OF IT', 3.2);
    });
    bus.on('miss', ({ enemyId }) => {
      if (enemyId === coreId && gameplay.state.coreEscaped) say('IT SINKS BACK INTO THE INK', 3);
      nodeIds.delete(enemyId);
    });
    bus.on('runstart', () => {
      nextTimed = 0;
      severed = 0;
      coreId = -1;
      nodeIds.clear();
      calloutUntil = -1;
      hud.setCallout('');
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: {
        ...gameplay,
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateCameraFeel(context.dt, camera, true, context.runTime);
        },
      },
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });

    // Dev inspection: `debugValue=finale` fakes the killing blow at 52.5 s so
    // the collapse and relight can be captured without a firing policy.
    let finaleFaked = false;
    let removeWarmup: (() => void) | null = null;
    let warmupAge = 0;

    return {
      update(dt, elapsed) {
        now = elapsed;
        game.update(dt);
        const running = game.state === 'running';
        const runTime = gameplay.state.runTime;
        if (!running) gameplay.animateIdle(dt, camera);
        if (running) {
          while (nextTimed < timed.length && runTime >= timed[nextTimed].at) {
            say(timed[nextTimed].text, timed[nextTimed].hold);
            nextTimed += 1;
          }
          if (runTime >= ESCAPE_TIME && gameplay.state.coreEscaped) nextTimed = timed.length;
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        if (debugFlags.has('finale') && running && !finaleFaked && runTime >= 52.5 && coreId >= 0) {
          finaleFaked = true;
          bus.emit('kill', { enemyId: coreId, worldPosition: rig.core.position.clone(), scoreAwarded: 0 });
        }
        updateSenses({ running, runTime, holding: holding || forceHold, dt });
        updateVisuals(dt, { scene, camera, elapsed, running, runTime });

        if (warmupAge === 0) removeWarmup = thermalWarmup(scene, camera);
        warmupAge += dt;
        if (removeWarmup && warmupAge > 1.2) {
          removeWarmup();
          removeWarmup = null;
        }
      },
      dispose() {
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', onBlur);
        removeWarmup?.();
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
