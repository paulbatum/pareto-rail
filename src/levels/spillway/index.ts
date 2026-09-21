import { MathUtils } from 'three';
import { uniform } from 'three/tsl';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createTimeFeel } from '../../engine/time-feel';
import { createAudio } from './audio';
import { SPILLWAY_BPM, createSpillwayGameplay } from './gameplay';
import { speedFactorAt } from './rail';
import { SPILLWAY_BAR, SPILLWAY_MARKERS, SPILLWAY_RUN_SECTIONS, SPILLWAY_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

// Camera feel, by bar: FOV kicks where the river drops, a steady widening with
// speed, and shake while the flood runs.
const FOV_KICKS: Array<[bar: number, degrees: number]> = [[20.1, 7], [61.4, 9], [63, 6]];
const SPEED_FOV_DEGREES = 4.5;

// God rays only in the gorge. The shadow box covers a few hundred units, so in
// the open everything past it counts as lit and the rays become a flat veil.
const GODRAY_KEYS: Array<[bar: number, intensity: number]> = [[0, 0.2], [8, 0.5], [34, 0.5], [37, 0]];
const godrayIntensity = uniform(0);

// The named moments, few and short.
const CALLOUTS: Array<{ bar: number; text: string; hold: number }> = [
  { bar: 7.75, text: 'THE NARROWS', hold: 2 },
  { bar: 10.25, text: 'CUT THE CABLE', hold: 2.2 },
  { bar: 21.75, text: 'WHITEWATER', hold: 2 },
  { bar: 41.5, text: 'THE DAM', hold: 2.4 },
  { bar: 44.25, text: 'BREAK ITS LEGS', hold: 2.2 },
  { bar: 60.25, text: 'RIDE THE FLOOD', hold: 2.4 },
];

function godraysAt(time: number) {
  const b = time / SPILLWAY_BAR;
  for (let i = 1; i < GODRAY_KEYS.length; i += 1) {
    const [b1, v1] = GODRAY_KEYS[i];
    if (b <= b1) {
      const [b0, v0] = GODRAY_KEYS[i - 1];
      return MathUtils.lerp(v0, v1, MathUtils.smoothstep(b, b0, b1));
    }
  }
  return GODRAY_KEYS[GODRAY_KEYS.length - 1][1];
}

export const spillwayLevel: LevelDefinition = {
  id: 'spillway',
  title: 'Spillway',
  description: 'Chase a salvage walker down a granite gorge to the dam it means to tear open.',
  bpm: SPILLWAY_BPM,
  markers: SPILLWAY_MARKERS,
  sections: SPILLWAY_RUN_SECTIONS.map((section) => ({ name: section.name, time: SPILLWAY_TIME.bar(section.fromBar) })),
  render: {
    toneMapping: 'agx',
    exposure: 1.05,
    shadows: { type: 'pcf-soft' },
    farPlane: 3000,
    retainShaders: true,
    softwareParticleCapacity: 1500,
  },
  post: {
    clearColor: 0xaebfcc,
    // `threshold` is the blur radius and `radius` the luminance cutoff (see the bloom
    // note under "Post-processing" in docs/level-authoring.md): only the sun and
    // water glints bloom.
    bloom: { strength: 0.35, threshold: 0.4, radius: 2, resolutionScale: 0.25 },
    vignette: { inner: 0.45, outer: 1.2, strength: 0.4 },
    // Above 4K UHD the scene pass stops multisampling: 5K-class buffers pay ~0.4 ms for it on a 4090.
    multisampleMaxPixels: 9_000_000,
    velocityBuffer: true,
    stages: [
      { type: 'godrays', lightName: 'sun', color: [1, 0.9, 0.76], intensity: godrayIntensity, density: 0.45, maxDensity: 0.3, distanceAttenuation: 1.2, resolutionScale: 0.125, raymarchSteps: 48, cheapComposite: true },
      { type: 'lensflare', strength: 0.3, threshold: 1.2, tint: [0.85, 0.92, 1], ghostAttenuation: 30 },
    ],
  },
  createAudio,
  createRuntime({ scene, camera, renderer, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    const timeFeel = createTimeFeel();
    createEnvironment(scene, renderer);
    installVisualEventHandlers(bus, scene, { camera: cameraFeel, time: timeFeel });

    let runTime = 0;
    let nextKick = 0;
    let nextCallout = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      runTime = 0;
      nextKick = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
      timeFeel.reset();
      cameraFeel.restore();
    });
    bus.on('runend', () => timeFeel.reset());
    // The fight's own moments: the core bared, and the walker falling.
    let coreId = -1;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind !== 'core') return;
      coreId = enemyId;
      say('THE CORE', 2);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === coreId) say('WALKER DOWN', 3);
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
        ...createSpillwayGameplay(bus),
        updateCameraEffects({ runTime: time, dt }) {
          while (nextKick < FOV_KICKS.length && time >= bar(FOV_KICKS[nextKick][0])) {
            cameraFeel.kickFov(FOV_KICKS[nextKick][1], { decay: 1.6 });
            cameraFeel.shake(0.35);
            nextKick += 1;
          }
          cameraFeel.setFovOffset((speedFactorAt(time) - 1) * SPEED_FOV_DEGREES, { response: 2.5 });
          if (time > bar(58) && time < bar(66)) cameraFeel.shake(dt * (time < bar(60) ? 0.9 : 0.6), { decay: 1.2, maxTrauma: 0.55 });
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

    return {
      update(dt, elapsed) {
        now = elapsed;
        // Hit-stop slows the game clock only; visuals and audio keep real time.
        const gameDt = timeFeel.scaleDt(dt);
        if (game.state === 'running') {
          runTime += gameDt;
          while (nextCallout < CALLOUTS.length && runTime >= bar(CALLOUTS[nextCallout].bar)) {
            say(CALLOUTS[nextCallout].text, CALLOUTS[nextCallout].hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(gameDt);
        godrayIntensity.value = godraysAt(runTime);
        updateVisuals({ runTime: game.state === 'attract' ? 0 : runTime, dt, camera });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
        disposeVisuals();
      },
    };
  },
};
