import { DoubleSide, Mesh, RingGeometry, Vector3 } from 'three';
import { vec4 } from 'three/tsl';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { bakeEnvironment, createGradientSky } from '../../engine/environment-light';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { warmUpShaders } from '../../engine/shader-cache';
import { createTimeFeel } from '../../engine/time-feel';
import { createAdditiveBasicMaterial } from '../../engine/visual-kit';
import { createAudio, escapementAudio } from './audio';
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
import { createBurr, createChime, createJewelWasp, createOxideTick, createRatchet, createRubyBolt } from './visuals/enemies';
import { createEscapementEnvironment, SUGGESTED_FAR_PLANE } from './visuals/environment/index';
import { createArborTarget, createPalletJewel } from './visuals/escapement-boss';
import { hdr, LAMP_WARM, LOCK_COLD, STEEL_BLUE, VOID, WHITE_HOT } from './visuals/palette';

const DEG = Math.PI / 180;
const BEAT = ESCAPEMENT_TIME.beatSeconds;

/**
 * One of every target rig the run spawns, a projectile, and the two ring materials a
 * lock ring is made of, so their shaders compile during the attract screen instead of
 * at the first spawn of each kind. The rings copy the materials of `makeLockRing` in
 * visuals/index.ts; the renderer keys a shader on material settings, not colour.
 */
function warmUpObjects() {
  const lockRing = new Mesh(new RingGeometry(0.84, 0.9, 12), createAdditiveBasicMaterial({ color: hdr(LOCK_COLD, 1.6), side: DoubleSide }));
  const lockRingInner = new Mesh(new RingGeometry(0.66, 0.69, 36), createAdditiveBasicMaterial({ color: hdr(WHITE_HOT, 1.2), side: DoubleSide }));
  return [
    createBurr(),
    createOxideTick(),
    createRatchet(),
    createJewelWasp(),
    createRubyBolt(),
    createChime(),
    createPalletJewel('left'),
    createArborTarget(),
    createProjectileMesh(),
    lockRing,
    lockRingInner,
  ];
}
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
  // Under AgX at exposure 1 lit brass sits near 0.7 luminance and reads pale; 0.7 keeps it gold.
  // Every enemy kind is disposed on its kill and spawned again a bar later; without retention each wave compiles its shaders again.
  // The dust is 100k slots; on the software backend the render tools use, the perf and occlusion gates step it on the CPU.
  render: { toneMapping: 'agx', exposure: 0.7, farPlane: SUGGESTED_FAR_PLANE, retainShaders: true, softwareParticleCapacity: 4000 },
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

    // Lighting: the PMREM bake of visuals/enemies.ts's previewLightRig at 0.6 of its brightness; at full brightness
    // the plates behind the escapement wash out to beige under the works lamp.
    const sky = createGradientSky({
      zenith: LAMP_WARM.clone().multiplyScalar(0.55),
      horizon: STEEL_BLUE.clone().multiplyScalar(0.35),
      ground: VOID,
      horizonWidth: 0.35,
      sunDirection: new Vector3(0.2, 1, 0.35),
      sunColor: LAMP_WARM,
      sunIntensity: 20,
      sunAngularRadius: 0.08,
      haloAngularRadius: 0.6,
      haloIntensity: 0.1,
    });
    const bake = bakeEnvironment(renderer, () => sky.scene, { size: 128 });
    bake.attach(scene);
    const environment = createEscapementEnvironment(scene, { environmentNode: bake.node });
    const lamp = environment.getLampLight();
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.near = 4;
    lamp.shadow.camera.far = 520;
    lamp.shadow.bias = -0.002;
    // The lamp and the barrel never move, so the six shadow faces render once instead of every frame.
    lamp.shadow.autoUpdate = false;
    lamp.shadow.needsUpdate = true;
    // The barrel cuts the lamp: its plates are what the god rays shine between.
    environment.root.getObjectByName('barrel')?.traverse((object) => {
      if ((object as Mesh).isMesh) object.castShadow = true;
    });

    const visuals = createEscapementVisualRuntime({ scene, renderer, environment });
    installVisualEventHandlers(bus, scene);
    const warmUp = warmUpShaders(scene, warmUpObjects());

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

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      strikeSeen = false;
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
          // The boss section tightens to 56 degrees so the fork and jewels read at 120 units.
          const fovTarget = section === 'orrery' ? 8 : section === 'free-run' ? 12 : section === 'strike' ? 4 : section === 'boss' ? -6 : 0;
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

      // The boss body steps its escape wheel one tooth on each beat wrap of the phase it is given,
      // and free-spins it once the clock is freed.
      const spin = freeRunSpin(running ? time : -1);
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
      const rod = environment.layout.pendulum.length;
      const bob = pivot.clone().add(new Vector3(Math.sin(swing) * rod, -Math.cos(swing) * rod, 0));
      visuals.bobTrail.pushPoint(bob);
      visuals.bobTrail.update(dt, camera.position);
    }

    return {
      update(dt, elapsed) {
        now = elapsed;
        warmUp.update(camera);
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
        warmUp.dispose();
        visuals.dispose();
        environment.dispose();
        bake.dispose();
        sky.dispose();
        cameraFeel.dispose();
      },
    };
  },
};
