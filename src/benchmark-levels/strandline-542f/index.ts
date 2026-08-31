import { MathUtils, Matrix4, Quaternion } from 'three';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandline542fGameplay } from './gameplay';
import {
  STRANDLINE_542F_BPM,
  STRANDLINE_542F_MARKERS,
  STRANDLINE_542F_RUN_SECTIONS,
  STRANDLINE_542F_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';
import { STRANDLINE_542F_JELLY_CENTER } from './visuals/environment';

export const strandline542fLevel: LevelDefinition = {
  id: 'strandline-542f',
  title: 'Strandline',
  description: 'Free a moon-sized jellyfish by hunting the violet colony rooted through its living strands.',
  bpm: STRANDLINE_542F_BPM,
  markers: STRANDLINE_542F_MARKERS,
  sections: STRANDLINE_542F_RUN_SECTIONS.map(({ name, fromBar }) => ({
    name,
    time: STRANDLINE_542F_TIME.bar(fromBar),
  })),
  post: {
    clearColor: 0x052d3a,
    bloom: { strength: 0.54, threshold: 0.9, radius: 0.12 },
    vignette: { inner: 0.4, outer: 1.14, strength: 0.42 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let parentKilled = false;
    let parentId = -1;
    let pullbackBlend = 0;
    const lookMatrix = new Matrix4();
    const lookQuaternion = new Quaternion();

    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = elapsedNow + seconds;
    };

    const callouts = [
      { at: STRANDLINE_542F_TIME.bar(0.25), message: 'SIGNAL: ONE LIVING CURRENT', hold: 2.1 },
      { at: STRANDLINE_542F_MARKERS.moonReveal - 0.3, message: 'BELL CONTACT — GREEN MOON', hold: 2.8 },
      { at: STRANDLINE_542F_MARKERS.forestReturn, message: 'BANKING BACK INTO THE STRANDS', hold: 2.2 },
      { at: STRANDLINE_542F_MARKERS.livingCurrent, message: 'PULSE RETURNING', hold: 2.0 },
      { at: STRANDLINE_542F_MARKERS.crownApproach, message: 'VIOLET MASS AT THE CROWN', hold: 2.5 },
      { at: STRANDLINE_542F_MARKERS.parent, message: 'PARENT WEB — STARVE EACH BROOD', hold: 3.1 },
      { at: STRANDLINE_542F_MARKERS.release, message: 'PULLING CLEAR', hold: 2.2 },
    ];

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      parentKilled = false;
      parentId = -1;
      pullbackBlend = 0;
      calloutUntil = -1;
      say('STRANDLINE — ENTERING THE TRAIL', 2.2);
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'parent') parentId = enemyId;
    });
    bus.on('stage', ({ enemyId, stageIndex }) => {
      if (enemyId !== parentId) return;
      feel.kickFov(2.2, { decay: 3.8 });
      feel.shake(0.42, { rollDegrees: 1.0, pitchDegrees: 0.45 });
      say(`PARENT CARAPACE ${stageIndex + 1}/3`, 1.8);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('WEB STARVED — PARENT OPEN', 1.65);
      if (phase === 'destroyed') {
        parentKilled = true;
        feel.kickFov(5.5, { decay: 2.2 });
        feel.shake(0.85, { rollDegrees: 1.5, pitchDegrees: 0.7, decay: 1.6 });
        say('PARENT TORN FREE — WHOLE CURRENT RESTORED', 3.8);
      }
    });
    bus.on('playerhit', ({ healthRemaining }) => {
      feel.shake(0.65, { rollDegrees: 1.25, pitchDegrees: 0.7 });
      say(`SOUR STING — HULL ${healthRemaining}`, 1.45);
    });
    bus.on('volley', ({ size, kills }) => {
      if (size === 6 && kills >= 5) {
        feel.kickFov(1.4);
        feel.shake(0.22, { rollDegrees: 0.7 });
      }
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
        ...createStrandline542fGameplay(bus),
        updateAttractCamera({ camera: attractCamera, curve, modeTime }) {
          const position = curve.getPointAt(0.012 + (Math.sin(modeTime * 0.18) + 1) * 0.003);
          const look = curve.getPointAt(0.055);
          attractCamera.position.copy(position);
          attractCamera.position.x += Math.sin(modeTime * 0.22) * 0.7;
          attractCamera.position.y += Math.cos(modeTime * 0.17) * 0.45;
          attractCamera.lookAt(look);
        },
        updateCameraEffects({ camera: runCamera, runTime: time, dt }) {
          const moonCenter = STRANDLINE_542F_MARKERS.moonReveal + 3.0;
          const moonWidth = 5.8;
          const moonOpen = Math.max(0, 1 - Math.abs(time - moonCenter) / moonWidth);
          feel.setFovOffset(-2.6 * moonOpen, { response: 4.5 });

          const crownT = MathUtils.smoothstep(time, STRANDLINE_542F_MARKERS.crownApproach, STRANDLINE_542F_MARKERS.parent);
          feel.setFovOffset(-1.7 * crownT * (1 - MathUtils.smoothstep(time, STRANDLINE_542F_MARKERS.parent, STRANDLINE_542F_MARKERS.release)));

          if (parentKilled) {
            pullbackBlend = Math.min(1, pullbackBlend + dt * 0.42);
            const pull = pullbackBlend * pullbackBlend * (3 - 2 * pullbackBlend);
            lookMatrix.lookAt(runCamera.position, STRANDLINE_542F_JELLY_CENTER, runCamera.up);
            lookQuaternion.setFromRotationMatrix(lookMatrix);
            runCamera.quaternion.slerp(lookQuaternion, Math.min(0.92, pull * 0.82));
            feel.setFovOffset(8.5 * pull, { response: 2.4 });
          }
          feel.update(dt, { shake: { frequency: 6.5, smoothing: 18 } });
        },
      },
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout++];
            say(callout.message, callout.hold);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running: game.state === 'running',
        });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
