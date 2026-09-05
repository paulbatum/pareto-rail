import { HemisphereLight, Mesh, Vector3 } from 'three';
import { vec4 } from 'three/tsl';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { bakeEnvironment, createGradientSky } from '../../engine/environment-light';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createTimeFeel } from '../../engine/time-feel';
import { createAudio, escapementAudio } from './audio';
import { ESCAPE_WHEEL_TEETH } from './visuals/escapement-boss';
import {
  createEscapementGameplay,
  ESCAPEMENT_BPM,
  ESCAPEMENT_DEBUG_TARGETS,
  normalizeEscapementDebugTarget,
  sectionAt,
} from './gameplay';
import { ESCAPEMENT_BAR, ESCAPEMENT_BARS, ESCAPEMENT_MARKERS, ESCAPEMENT_RUN_SECTIONS, ESCAPEMENT_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEscapementVisualRuntime,
  createProjectileMesh,
  createReticle,
  flashUniform,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  strikeKickUniform,
  updateVisuals,
} from './visuals';
import { createEscapementEnvironment, SUGGESTED_FAR_PLANE } from './visuals/environment/index';
import { LAMP_WARM, STEEL_BLUE, VOID } from './visuals/palette';

const DEG = Math.PI / 180;
const BEAT = ESCAPEMENT_TIME.beatSeconds;
const TOOTH = (Math.PI * 2) / ESCAPE_WHEEL_TEETH;
/** Lamp intensities were tuned without a tone curve; AgX needs them brighter. */
const LAMP_GAIN = 1.0;
/** The environment's steel-blue hemisphere fill, scaled down so unlit brass falls toward the void. */
const FILL_GAIN = 0.35;
/** Escape-wheel rate the Free Run reaches after four bars, in radians per second. */
const FREE_RUN_WHEEL_SPIN = 9;
const FREE_RUN_SPIN_RATE = 24;

export const escapementLevel: LevelDefinition = {
  id: 'escapement',
  title: 'Escapement',
  description: 'Fly out of a seized clock, ride its great wheels and its pendulum, and free the escapement before the hour strikes.',
  bpm: ESCAPEMENT_BPM,
  perfProfile: 'flagship',
  markers: ESCAPEMENT_MARKERS,
  sections: ESCAPEMENT_RUN_SECTIONS.map((section) => ({ name: section.name, time: bar(section.fromBar) })),
  debugSelector: { queryParam: 'debugEnemy', label: 'Enemy', options: ESCAPEMENT_DEBUG_TARGETS },
  render: { toneMapping: 'agx', exposure: 0.85, farPlane: SUGGESTED_FAR_PLANE },
  post: {
    clearColor: 0x010102,
    bloom: { strength: 0.45, threshold: 1.35, radius: 0.22 },
    vignette: { inner: 0.4, outer: 1.1, strength: 0.6 },
    velocityBuffer: true,
    composeOutput({ base }) {
      return base.add(vec4(1.0, 0.72, 0.3, 0).mul(flashUniform));
    },
    stages: [
      { type: 'godrays', lightName: 'escapement-lamp', color: [1.0, 0.86, 0.62], density: 0.012, maxDensity: 0.32, distanceAttenuation: 2 },
      { type: 'lensflare', source: 'bloom', threshold: 0.8, strength: 0.6, tint: [1.0, 0.86, 0.62], ghostSamples: 4 },
      { type: 'chromaticAberration', strength: strikeKickUniform },
      { type: 'film', intensity: 0.06 },
    ],
  },
  createAudio,
  createRuntime({ scene, camera, renderer, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const cameraFeel = createCameraFeel(camera);
    const feel = createTimeFeel();

    // Lighting: the PMREM bake the enemy models were tuned under, then the sets.
    const sky = createGradientSky({
      zenith: LAMP_WARM.clone().multiplyScalar(0.14),
      horizon: STEEL_BLUE.clone().multiplyScalar(0.2),
      ground: VOID,
      horizonWidth: 0.35,
      sunDirection: new Vector3(0.2, 1, 0.35),
      sunColor: LAMP_WARM,
      sunIntensity: 16,
      sunAngularRadius: 0.08,
      haloAngularRadius: 0.6,
      haloIntensity: 0.08,
    });
    const bake = bakeEnvironment(renderer, () => sky.scene, { size: 128 });
    bake.attach(scene);
    const environment = createEscapementEnvironment(scene, { environmentNode: bake.node });
    const lamp = environment.getLampLight();
    lamp.intensity *= LAMP_GAIN;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.near = 4;
    lamp.shadow.camera.far = 520;
    lamp.shadow.bias = -0.002;
    environment.getSunLight().intensity *= LAMP_GAIN;
    const worksLamp = environment.root.getObjectByName('escapement-works-lamp');
    if (worksLamp && 'intensity' in worksLamp) (worksLamp as { intensity: number }).intensity *= LAMP_GAIN;
    environment.root.traverse((object) => {
      if ((object as HemisphereLight).isHemisphereLight) (object as HemisphereLight).intensity *= FILL_GAIN;
    });
    // The barrel cuts the lamp: its plates are what the god rays shine between.
    environment.root.getObjectByName('barrel')?.traverse((object) => {
      if ((object as Mesh).isMesh) object.castShadow = true;
    });

    const visuals = createEscapementVisualRuntime({ scene, renderer, environment });
    installVisualEventHandlers(bus, scene);

    const debugTarget = normalizeEscapementDebugTarget(debugValue);
    const gameplay = createEscapementGameplay(bus, debugTarget);
    gameplay.hooks.seatBossPart = visuals.seatBossPart;
    gameplay.hooks.onRatchetStep = (stage) => escapementAudio(bus)?.ratchetStep(stage);
    gameplay.hooks.onTickLeap = () => escapementAudio(bus)?.tickLeap();

    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    gameplay.onBossEvent((event) => {
      const audio = escapementAudio(bus);
      switch (event.type) {
        case 'ring':
          audio?.ringBell(event.ring - 1, event.part === 'arbor' ? 'arbor' : 'jewel');
          feel.hitStop(0.07);
          environment.setStrike(0, 2.5 + event.ring * 0.2);
          visuals.kickStrike(0.35 + event.ring * 0.03);
          break;
        case 'jewelBroken':
          audio?.jewelBreak();
          visuals.body.breakJewel(event.side);
          visuals.kickStrike(0.5, 0.18);
          say(event.side === 'left' ? 'LEFT PALLET SHEARED' : 'RIGHT PALLET SHEARED', 2.2);
          break;
        case 'arborStage':
          visuals.body.setStage('arbor');
          visuals.body.exposeArbor(true);
          say(event.stage === 1 ? 'THE ARBOR IS BARE' : 'THE ARBOR OPENS AGAIN', 2.4);
          break;
        case 'tickPour':
          visuals.body.exposeArbor(false);
          say('TICKS POUR FROM THE CROWN', 2.0);
          break;
        case 'killed':
          visuals.body.setStage('broken');
          visuals.kickStrike(0.9, 0.5);
          environment.setStrike(0, 9);
          say('THE CLOCK STRIKES TWELVE', 4.0);
          break;
        case 'deadline':
          say('THE HOUR NEVER STRUCK', 4.0);
          break;
        case 'engaged':
          say('THE ESCAPEMENT', 2.6);
          break;
      }
    });

    bus.on('fire', ({ volleySize, indexInVolley }) => {
      if (volleySize >= 6 && (indexInVolley ?? 0) === 0) feel.hitStop(0.06);
    });

    const callouts = [
      { at: bar(ESCAPEMENT_BARS.train) - 0.2, text: 'THE TRAIN', hold: 2.0 },
      { at: bar(ESCAPEMENT_BARS.orrery) - 0.2, text: 'THE ORRERY', hold: 2.2 },
      { at: bar(ESCAPEMENT_BARS.strike) - 1.0, text: 'THE HOUR HAMMER FALLS', hold: 2.4 },
      { at: bar(ESCAPEMENT_BARS.pendulum), text: 'THE PENDULUM', hold: 2.2 },
      { at: bar(ESCAPEMENT_BARS.freeRun), text: '', hold: 0 },
    ];
    let nextCallout = 0;
    let strikeSeen = false;
    let lastBeatIndex = -1;
    let wheelTarget = 0;
    let wheelAngle = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      strikeSeen = false;
      lastBeatIndex = -1;
      wheelTarget = 0;
      wheelAngle = 0;
      calloutUntil = -1;
      feel.reset();
      cameraFeel.restore();
      hud.setCallout('');
    });
    bus.on('runend', () => {
      feel.reset();
      cameraFeel.restore();
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
        updateCameraEffects({ camera: cam, runTime: time, dt }) {
          // The bob frame rolls the camera by the full swing; take 40 percent back so the roll is 60 percent of the bob angle.
          if (time >= ESCAPEMENT_MARKERS.pendulum && time < bar(ESCAPEMENT_BARS.freeRun)) {
            cam.rotateZ(0.4 * gameplay.swingDegreesAt(time) * DEG);
          }
          const section = sectionAt(time);
          const fovTarget = section === 'orrery' ? 8 : section === 'free-run' ? 12 : section === 'strike' ? 4 : 0;
          cameraFeel.setFovOffset(fovTarget, { response: 2.5 });
          cameraFeel.update(dt);
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

    /** Escape-wheel spin rate and gear spin multiplier during the Free Run, 1 before it. */
    function freeRunSpin(time: number) {
      const since = time - bar(ESCAPEMENT_BARS.freeRun);
      if (since < 0 || !gameplay.clockFreed()) return { gears: 1, wheel: 0 };
      const t = Math.min(1, since / (4 * ESCAPEMENT_BAR));
      return { gears: 1 + (FREE_RUN_SPIN_RATE - 1) * t * t, wheel: FREE_RUN_WHEEL_SPIN * t };
    }

    function driveClockwork(time: number, dt: number, running: boolean) {
      const section = running ? sectionAt(time) : 'barrel';
      gameplay.updateBoss(time);
      const snapshot = gameplay.bossSnapshot();
      const swing = -gameplay.swingDegreesAt(time) * DEG;
      environment.update(time, section);
      environment.setPendulumAmplitude(gameplay.amplitude() * DEG);
      environment.setPendulumAngle(swing);

      // The escape wheel steps one tooth per beat and free-spins once the clock is freed.
      const spin = freeRunSpin(running ? time : -1);
      const beatIndex = Math.floor(time / BEAT);
      if (beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;
        if (spin.wheel === 0) wheelTarget += TOOTH;
      }
      if (spin.wheel > 0) {
        wheelAngle += spin.wheel * dt;
        wheelTarget = wheelAngle;
      } else {
        wheelAngle += (wheelTarget - wheelAngle) * Math.min(1, dt * 22);
      }
      environment.pendulum.setEscapeWheelAngle(-wheelAngle);
      environment.setSpinRate(spin.gears);

      const body = visuals.body;
      body.setForkAngle(swing);
      body.setJewelLifted('left', snapshot.liftedPallet === 'left');
      body.setJewelLifted('right', snapshot.liftedPallet === 'right');
      if (spin.wheel > 0) body.setWheelSpin(spin.wheel);
      body.update(dt, (time / BEAT) % 1);
      body.updateMatrixWorld(true);

      // The bob's trail follows the bob through its swing.
      const pivot = environment.getPendulumPivot();
      const bob = pivot.clone().add(new Vector3(Math.sin(swing) * 300, -Math.cos(swing) * 300, 0));
      visuals.bobTrail.pushPoint(bob);
      visuals.bobTrail.update(dt, camera.position);
    }

    return {
      update(dt, elapsed) {
        now = elapsed;
        const running = game.state === 'running';
        const gameDt = feel.scaleDt(dt);
        if (running) {
          runTime += gameDt;
          while (nextCallout < callouts.length - 1 && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
          if (!strikeSeen && runTime >= ESCAPEMENT_MARKERS.strike) {
            strikeSeen = true;
            feel.hitStop(0.07);
            cameraFeel.kickFov(9, { decay: 3 });
            visuals.kickStrike(1.0, 0.75);
            visuals.impulse(environment.bell.origin, 140, 60);
            escapementAudio(bus);
          }
          if (runTime >= bar(ESCAPEMENT_BARS.freeRun) && nextCallout === callouts.length - 1) {
            nextCallout += 1;
            if (gameplay.clockFreed()) say('FREE RUN', 2.4);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        driveClockwork(running ? runTime : elapsed, dt, running);
        game.update(gameDt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running, section: running ? sectionAt(runTime) : 'barrel' });
      },
      dispose() {
        game.dispose();
        visuals.dispose();
        environment.dispose();
        bake.dispose();
        sky.dispose();
        cameraFeel.dispose();
      },
    };
  },
};
